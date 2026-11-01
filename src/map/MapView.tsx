import 'maplibre-gl/dist/maplibre-gl.css';

import type { FeatureCollection, Position } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, RasterTileSource } from 'maplibre-gl';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { PROPERTY_LINE_COLOR } from '@/lib/featureTypes';
import { areasToFeatures, boundsOf, markersToFeatures, propertiesToFeatures } from '@/lib/geo';
import {
  buildBaseStyle,
  contourTiles,
  DEFAULT_LAYERS,
  LAYER_IDS,
  lidarStyleTiles,
  setUpMapLibre,
  type MapLayersState,
} from '@/map/layers';
import type { AreaGeometry, MapArea, MapMarker, Property, Selection } from '@/types/models';

export const DEFAULT_CENTER: [number, number] = [-91.536, 37.6456]; // Salem, MO
const DEFAULT_ZOOM = 12;
const CAMERA_KEY = 'hunting-hub-camera';
// Zooming always goes with a selection, so leave room for the detail panel
// (--detail-width in styles.css) that floats over the right side of the map.
const DETAIL_PANEL_WIDTH = 320;
const FIT_PADDING = { top: 80, bottom: 80, left: 80, right: 80 };

export interface MapViewHandle {
  fitTo(geometry: AreaGeometry): void;
  flyTo(lng: number, lat: number): void;
}

export type MapInteraction = 'browse' | 'place' | 'draw';

interface MapViewProps {
  ref?: Ref<MapViewHandle>;
  layers: MapLayersState;
  properties: Property[];
  areas: MapArea[];
  markers: MapMarker[];
  selection: Selection | null;
  interaction: MapInteraction;
  draftPoints: Position[];
  draftColor: string;
  onMapClick(position: Position): void;
  onSelect(selection: Selection | null): void;
  onMarkerMoved(id: string, position: Position): void;
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function loadCamera(): { center: [number, number]; zoom: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? 'null');
    if (Array.isArray(saved?.center) && typeof saved?.zoom === 'number') return saved;
  } catch {
    // Fall through to the default view.
  }
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

function saveCamera(map: maplibregl.Map): void {
  try {
    const { lng, lat } = map.getCenter();
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ center: [lng, lat], zoom: map.getZoom() }));
  } catch {
    // Remembering the view is only a convenience.
  }
}

function addFeatureLayers(map: maplibregl.Map): void {
  map.addSource('properties', { type: 'geojson', data: EMPTY });
  map.addSource('areas', { type: 'geojson', data: EMPTY });
  map.addSource('draft', { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'property-fill',
    type: 'fill',
    source: 'properties',
    paint: { 'fill-color': PROPERTY_LINE_COLOR, 'fill-opacity': ['case', ['get', 'selected'], 0.12, 0.03] },
  });
  map.addLayer({
    id: 'property-casing',
    type: 'line',
    source: 'properties',
    paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.5 },
  });
  map.addLayer({
    id: 'property-line',
    type: 'line',
    source: 'properties',
    paint: { 'line-color': PROPERTY_LINE_COLOR, 'line-width': ['case', ['get', 'selected'], 3.5, 2.5] },
  });
  map.addLayer({
    id: 'area-fill',
    type: 'fill',
    source: 'areas',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.5, 0.3] },
  });
  map.addLayer({
    id: 'area-line',
    type: 'line',
    source: 'areas',
    paint: { 'line-color': ['case', ['get', 'selected'], '#ffffff', ['get', 'color']], 'line-width': 2 },
  });
  map.addLayer({
    id: 'draft-fill',
    type: 'fill',
    source: 'draft',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 },
  });
  map.addLayer({
    id: 'draft-line',
    type: 'line',
    source: 'draft',
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1] },
  });
  map.addLayer({
    id: 'draft-vertex',
    type: 'circle',
    source: 'draft',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 },
  });
}

function draftFeatures(points: Position[], cursor: Position | null, color: string): FeatureCollection {
  const ring = cursor ? [...points, cursor] : points;
  const features: FeatureCollection['features'] = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: p },
    properties: { color },
  }));
  if (ring.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
      properties: { color },
    });
  } else if (ring.length === 2) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: { color } });
  }
  return { type: 'FeatureCollection', features };
}

function centerOf(geometry: AreaGeometry): [number, number] {
  const [w, s, e, n] = boundsOf(geometry);
  return [(w + e) / 2, (s + n) / 2];
}

// Property names go along the top edge so they don't sit under stands in the middle.
function topCenterOf(geometry: AreaGeometry): [number, number] {
  const [w, , e, n] = boundsOf(geometry);
  return [(w + e) / 2, n];
}

export function MapView(props: MapViewProps) {
  const { ref, layers, properties, areas, markers, selection, interaction, draftPoints, draftColor } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // Bumped once the style loads so the data effects below run against a ready map.
  const [readyTick, setReadyTick] = useState(0);
  // Matches the tiles baked into buildBaseStyle().
  const loadedTiles = useRef<{ lidar: string; contours: string }>({ lidar: DEFAULT_LAYERS.lidarStyle, contours: '10' });
  const markerElements = useRef(new Map<string, maplibregl.Marker>());
  const labelElements = useRef(new Map<string, maplibregl.Marker>());
  const cursorRef = useRef<Position | null>(null);
  // Latest props for map event handlers, which are bound once.
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    fitTo(geometry) {
      const [w, s, e, n] = boundsOf(geometry);
      mapRef.current?.fitBounds([w, s, e, n], { padding: { ...FIT_PADDING, right: FIT_PADDING.right + DETAIL_PANEL_WIDTH }, maxZoom: 17, duration: 800 });
    },
    flyTo(lng, lat) {
      const map = mapRef.current;
      map?.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), offset: [-DETAIL_PANEL_WIDTH / 2, 0], duration: 800 });
    },
  }));

  // Create the map once.
  useEffect(() => {
    setUpMapLibre();
    const camera = loadCamera();
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: buildBaseStyle(),
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: 19,
      doubleClickZoom: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) Object.assign(window, { __map: map });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 140 }), 'bottom-right');

    // 'style.load' fires before tiles arrive, unlike 'load', which waits on the slow USGS servers.
    map.once('style.load', () => {
      addFeatureLayers(map);
      readyRef.current = true;
      setReadyTick((t) => t + 1);
    });
    map.on('moveend', () => saveCamera(map));

    map.on('click', (event) => {
      const { interaction: mode, onMapClick, onSelect } = latest.current;
      const position: Position = [event.lngLat.lng, event.lngLat.lat];
      if (mode !== 'browse') {
        onMapClick(position);
        return;
      }
      const hit = map.queryRenderedFeatures(event.point, { layers: ['area-fill', 'property-fill'] })[0];
      const id = hit?.properties?.id as string | undefined;
      if (!id) onSelect(null);
      else onSelect({ kind: hit.layer.id === 'area-fill' ? 'area' : 'property', id });
    });

    map.on('mousemove', (event) => {
      if (latest.current.interaction !== 'draw') return;
      cursorRef.current = [event.lngLat.lng, event.lngLat.lat];
      const source = map.getSource<GeoJSONSource>('draft');
      source?.setData(draftFeatures(latest.current.draftPoints, cursorRef.current, latest.current.draftColor));
    });

    for (const layer of ['area-fill', 'property-fill']) {
      map.on('mouseenter', layer, () => {
        if (latest.current.interaction === 'browse') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        if (latest.current.interaction === 'browse') map.getCanvas().style.cursor = '';
      });
    }

    const markersById = markerElements.current;
    const labelsById = labelElements.current;
    return () => {
      markersById.clear();
      labelsById.clear();
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Base map and overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const show = (id: string, visible: boolean) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    show(LAYER_IDS.satellite, layers.base === 'satellite');
    show(LAYER_IDS.topo, layers.base === 'topo');
    show(LAYER_IDS.lidar, layers.base === 'lidar');
    show(LAYER_IDS.lidarBlend, layers.base !== 'lidar' && layers.lidarBlend > 0);
    map.setPaintProperty(LAYER_IDS.lidarBlend, 'raster-opacity', layers.lidarBlend);
    // setTiles reloads every tile, so only call it when the style really changed.
    if (loadedTiles.current.lidar !== layers.lidarStyle) {
      loadedTiles.current.lidar = layers.lidarStyle;
      map.getSource<RasterTileSource>('lidar')?.setTiles(lidarStyleTiles(layers.lidarStyle));
    }

    const contours = contourTiles(layers.contours);
    show(LAYER_IDS.contours, contours !== null);
    if (contours && loadedTiles.current.contours !== layers.contours) {
      loadedTiles.current.contours = layers.contours;
      map.getSource<RasterTileSource>('contours')?.setTiles(contours);
    }
    // Contours come back as black lines; lighten them over satellite imagery.
    map.setPaintProperty(LAYER_IDS.contours, 'raster-brightness-min', layers.base === 'satellite' ? 0.85 : 0);
  }, [layers, readyTick]);

  // Property and area shapes.
  const selectedId = selection?.id ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource<GeoJSONSource>('properties')?.setData(propertiesToFeatures(properties, selectedId));
    map.getSource<GeoJSONSource>('areas')?.setData(areasToFeatures(areas, selectedId));

    // Names for shapes, drawn as HTML so no font server is needed.
    const wanted = new Map<string, { text: string; at: [number, number]; kind: string }>();
    for (const p of properties) wanted.set(p.id, { text: p.name, at: topCenterOf(p.boundary), kind: 'property' });
    for (const a of areas) wanted.set(a.id, { text: a.name, at: centerOf(a.geometry), kind: 'area' });
    syncHtmlMarkers(map, labelElements.current, wanted, (item, existing) => {
      const el = existing ?? document.createElement('div');
      // classList, not className: maplibre adds its own positioning class to this element.
      el.classList.add('map-label', `map-label-${item.kind}`);
      el.textContent = item.text;
      return el;
    }, { anchor: 'center' });
  }, [properties, areas, selectedId, readyTick]);

  // Point markers (stands, cameras, ...) as draggable HTML pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const features = markersToFeatures(markers, selectedId).features;
    const wanted = new Map(
      features.map((f) => [
        f.properties!.id as string,
        { ...(f.properties as { id: string; name: string; color: string; selected: boolean }), at: f.geometry.coordinates as [number, number] },
      ]),
    );
    syncHtmlMarkers(
      map,
      markerElements.current,
      wanted,
      (item, existing) => {
        const el = existing ?? document.createElement('div');
        el.classList.add('map-pin');
        el.classList.toggle('map-pin-selected', item.selected);
        el.style.setProperty('--pin-color', item.color);
        el.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = 'map-pin-dot';
        const label = document.createElement('span');
        label.className = 'map-pin-label';
        label.textContent = item.name;
        el.append(dot, label);
        return el;
      },
      // Anchor on the left edge so the dot, not the label, sits on the location.
      { anchor: 'left', offset: [-7, 0] },
      (marker, id) => {
        marker.setDraggable(true);
        marker.getElement().addEventListener('click', (event) => {
          if (latest.current.interaction !== 'browse') return;
          event.stopPropagation();
          latest.current.onSelect({ kind: 'marker', id });
        });
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          latest.current.onMarkerMoved(id, [lng, lat]);
        });
      },
    );
  }, [markers, selectedId, readyTick]);

  // Shape being drawn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (interaction !== 'draw') cursorRef.current = null;
    map.getSource<GeoJSONSource>('draft')?.setData(draftFeatures(draftPoints, cursorRef.current, draftColor));
    map.getCanvas().style.cursor = interaction === 'browse' ? '' : 'crosshair';
  }, [draftPoints, draftColor, interaction, readyTick]);

  return <div ref={containerRef} className="map" />;
}

interface HtmlItem {
  at: [number, number];
}

// Adds, updates and removes maplibre HTML markers to match `wanted`.
function syncHtmlMarkers<T extends HtmlItem>(
  map: maplibregl.Map,
  current: Map<string, maplibregl.Marker>,
  wanted: Map<string, T>,
  render: (item: T, existing: HTMLElement | null) => HTMLElement,
  placement: Partial<Pick<maplibregl.MarkerOptions, 'anchor' | 'offset'>>,
  onCreate?: (marker: maplibregl.Marker, id: string) => void,
): void {
  for (const [id, marker] of current) {
    if (!wanted.has(id)) {
      marker.remove();
      current.delete(id);
    }
  }
  for (const [id, item] of wanted) {
    const existing = current.get(id);
    if (existing) {
      render(item, existing.getElement());
      existing.setLngLat(item.at);
    } else {
      const marker = new maplibregl.Marker({ element: render(item, null), ...placement }).setLngLat(item.at).addTo(map);
      current.set(id, marker);
      onCreate?.(marker, id);
    }
  }
}
