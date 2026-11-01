import 'maplibre-gl/dist/maplibre-gl.css';

import type { FeatureCollection, Polygon, Position } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, ImageSource, RasterTileSource } from 'maplibre-gl';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';

import { Compass } from '@/components/Compass';
import type { StandRating } from '@/lib/standRating';
import { areasToFeatures, boundsOf, propertiesToFeatures } from '@/lib/geo';
import { findSnap, type Snap } from '@/lib/snap';
import { markerStyle, propertyColor } from '@/lib/styles';
import {
  buildBaseStyle,
  contourTiles,
  DEFAULT_LAYERS,
  LAYER_IDS,
  lidarStyleTiles,
  setUpMapLibre,
  type MapLayersState,
} from '@/map/layers';
import type { AreaGeometry, HubSettings, MapArea, MapMarker, Property, Section, Selection } from '@/types/models';

export const DEFAULT_CENTER: [number, number] = [-91.536, 37.6456]; // Salem, MO
const DEFAULT_ZOOM = 12;
const CAMERA_KEY = 'hunting-hub-camera';
// Panels float over the map, so zooming centres things in the space between
// them. Each inset is a panel's width plus its gaps (see styles.css): the
// sidebar on the left (--sidebar-width), and on the right the detail panel
// (--detail-width), which is open whenever we zoom to a selection.
const SIDEBAR_INSET = 300 + 24;
export const DETAIL_PANEL_INSET = 340 + 24;
const FIT_MARGIN = 60;

export interface MapViewHandle {
  // rightInset: width of whatever panel covers the right side of the map.
  fitTo(geometry: AreaGeometry, rightInset?: number): void;
  flyTo(lng: number, lat: number): void;
}

export type MapInteraction = 'browse' | 'place' | 'draw' | 'align';

// A map image ready to draw: corners are top-left, top-right, bottom-right, bottom-left.
export interface OverlayView {
  id: string;
  url: string;
  corners: [[number, number], [number, number], [number, number], [number, number]];
  opacity: number;
}

// A map-side control point while lining up an image.
export interface AlignMarker {
  index: number;
  position: [number, number];
}

interface MapViewProps {
  ref?: Ref<MapViewHandle>;
  layers: MapLayersState;
  properties: Property[];
  areas: MapArea[];
  markers: MapMarker[];
  sections: Section[];
  settings: HubSettings;
  // Outlines that drawing snaps onto, and how close (screen pixels) counts; 0 = off.
  snapRings: Position[][];
  snapPx: number;
  overlays: OverlayView[];
  alignMarkers: AlignMarker[];
  // Stand id -> forecast rating, while the Hunt Forecast is open.
  standRatings: Record<string, StandRating> | null;
  // Downwind scent wedges for rated stands.
  scentCones: { id: string; rating: StandRating; cone: Polygon }[];
  // Shown as an arrow on the compass when known.
  windFromDeg: number | null;
  selection: Selection | null;
  interaction: MapInteraction;
  draftPoints: Position[];
  draftColor: string;
  onMapClick(position: Position): void;
  onSelect(selection: Selection | null): void;
  onMarkerMoved(id: string, position: Position): void;
  onAlignMarkerMoved(index: number, position: [number, number]): void;
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
  map.addSource('scent', { type: 'geojson', data: EMPTY });
  map.addSource('sections', { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'property-fill',
    type: 'fill',
    source: 'properties',
    // A light see-through tint. Not clickable: properties are picked from the
    // sidebar, so clicks inside one reach the stands and areas on it.
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.16, 0.08] },
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
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 3.5, 2.5] },
  });
  // Management sections: under areas, so a food plot inside a section stays clickable.
  map.addLayer({
    id: 'section-fill',
    type: 'fill',
    source: 'sections',
    paint: { 'fill-color': '#f7efe6', 'fill-opacity': ['case', ['get', 'selected'], 0.16, 0.05] },
  });
  map.addLayer({
    id: 'section-line',
    type: 'line',
    source: 'sections',
    paint: {
      'line-color': ['case', ['get', 'selected'], '#f08a24', '#f7efe6'],
      'line-width': ['case', ['get', 'selected'], 3, 2],
      'line-dasharray': [4, 2],
      'line-opacity': 0.9,
    },
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
  // Scent cones sit over areas, so you can see one drifting into bedding.
  map.addLayer({
    id: 'scent-fill',
    type: 'fill',
    source: 'scent',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
  });
  map.addLayer({
    id: 'scent-line',
    type: 'line',
    source: 'scent',
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [3, 2] },
  });
  // Arrows drifting downwind inside each cone (moved by the animation in MapView).
  map.addImage('wind-chevron', windChevronImage(), { pixelRatio: 2 });
  map.addSource('scent-arrows', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'scent-arrows',
    type: 'symbol',
    source: 'scent-arrows',
    layout: {
      'icon-image': 'wind-chevron',
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': 1.6,
    },
    paint: { 'icon-opacity': ['get', 'opacity'] },
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
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'snap']]],
    paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'draft-snap',
    type: 'circle',
    source: 'draft',
    filter: ['has', 'snap'],
    paint: {
      // Bigger ring on a corner, smaller on a straight edge.
      'circle-radius': ['case', ['==', ['get', 'snap'], 'vertex'], 9, 6],
      'circle-color': 'rgba(240, 138, 36, 0.25)',
      'circle-stroke-color': '#f08a24',
      'circle-stroke-width': 2.5,
    },
  });
}

// A soft white chevron pointing up (north); the layer rotates it downwind.
// Drawn on a canvas so no icon files or sprite server are needed.
function windChevronImage(): ImageData {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const chevron = () => {
    ctx.beginPath();
    ctx.moveTo(10, 26);
    ctx.lineTo(20, 14);
    ctx.lineTo(30, 26);
  };
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 7;
  chevron();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 3.5;
  chevron();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// Where the drifting arrows are at time `now`: a few lanes across each cone,
// each with arrows staggered along it, moving from the stand out to the tip.
const ARROW_LANES = [-0.55, 0, 0.55];
const ARROWS_PER_LANE = 2;
const ARROW_PERIOD_MS = 3200;

function scentArrowFeatures(cones: { cone: Polygon }[], now: number | null): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const { cone } of cones) {
    const ring = cone.coordinates[0];
    const origin = ring[0];
    // Ring is: origin, arc points (left to right), origin.
    const arc = ring.slice(1, -1);
    if (arc.length < 3) continue;
    const mid = (arc.length - 1) / 2;
    ARROW_LANES.forEach((lane, laneIndex) => {
      const tip = arc[Math.round(mid + lane * mid)];
      const cosLat = Math.cos((origin[1] * Math.PI) / 180);
      const bearing = (Math.atan2((tip[0] - origin[0]) * cosLat, tip[1] - origin[1]) * 180) / Math.PI;
      for (let k = 0; k < ARROWS_PER_LANE; k++) {
        // Still arrows (reduced motion) sit at fixed spots along the lane.
        const phase =
          now === null
            ? (k + 1) / (ARROWS_PER_LANE + 1)
            : (now / ARROW_PERIOD_MS + k / ARROWS_PER_LANE + laneIndex * 0.17) % 1;
        // Keep arrows off the stand itself and fade them in and out at the ends.
        const t = 0.12 + phase * 0.8;
        const opacity = now === null ? 0.7 : Math.sin(phase * Math.PI) * 0.85;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [origin[0] + (tip[0] - origin[0]) * t, origin[1] + (tip[1] - origin[1]) * t] },
          properties: { bearing, opacity },
        });
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

function draftFeatures(points: Position[], cursor: Position | null, color: string, snap: Snap['kind'] | null = null): FeatureCollection {
  const ring = cursor ? [...points, cursor] : points;
  const features: FeatureCollection['features'] = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: p },
    properties: { color },
  }));
  // A ring under the cursor shows the next click will snap onto a line.
  if (cursor && snap) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: cursor }, properties: { color, snap } });
  }
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
  const { ref, layers, properties, areas, markers, sections, overlays, alignMarkers, standRatings, selection, interaction } = props;
  const { draftPoints, draftColor, settings } = props;
  // The compass is a maplibre control (so it stacks with the zoom buttons)
  // whose contents React renders through a portal.
  const [compassHost, setCompassHost] = useState<HTMLElement | null>(null);
  const [bearing, setBearing] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // Bumped once the style loads so the data effects below run against a ready map.
  const [readyTick, setReadyTick] = useState(0);
  // Matches the tiles baked into buildBaseStyle().
  const loadedTiles = useRef<{ lidar: string; contours: string }>({ lidar: DEFAULT_LAYERS.lidarStyle, contours: '10' });
  const markerElements = useRef(new Map<string, maplibregl.Marker>());
  const labelElements = useRef(new Map<string, maplibregl.Marker>());
  const alignElements = useRef(new Map<string, maplibregl.Marker>());
  // Overlay id -> image URL currently loaded into its maplibre source.
  const overlayUrls = useRef(new Map<string, string>());
  const cursorRef = useRef<Position | null>(null);
  // Latest props for map event handlers, which are bound once.
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    fitTo(geometry, rightInset = DETAIL_PANEL_INSET) {
      const [w, s, e, n] = boundsOf(geometry);
      const padding = {
        top: FIT_MARGIN + 50, // clear of the toolbar
        bottom: FIT_MARGIN,
        left: FIT_MARGIN + SIDEBAR_INSET,
        right: FIT_MARGIN + rightInset,
      };
      mapRef.current?.fitBounds([w, s, e, n], { padding, maxZoom: 17, duration: 800 });
    },
    flyTo(lng, lat) {
      const map = mapRef.current;
      const offset: [number, number] = [(SIDEBAR_INSET - DETAIL_PANEL_INSET) / 2, 0];
      map?.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), offset, duration: 800 });
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
    // Bottom right, bottom to top: attribution, zoom buttons, compass.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const host = document.createElement('div');
    host.className = 'maplibregl-ctrl compass-host';
    map.addControl({ onAdd: () => host, onRemove: () => host.remove() }, 'bottom-right');
    setCompassHost(host);
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 140 }), 'bottom-left');
    map.on('rotate', () => setBearing(map.getBearing()));

    // 'style.load' fires before tiles arrive, unlike 'load', which waits on the slow USGS servers.
    map.once('style.load', () => {
      addFeatureLayers(map);
      readyRef.current = true;
      setReadyTick((t) => t + 1);
    });
    map.on('moveend', () => saveCamera(map));

    // While drawing, a point near an existing line lands exactly on it.
    const snapAt = (point: { x: number; y: number }): Snap | null => {
      const { interaction: mode, snapRings, snapPx } = latest.current;
      if (mode !== 'draw') return null;
      return findSnap(point, snapRings, snapPx, (lngLat) => map.project(lngLat));
    };

    map.on('click', (event) => {
      const { interaction: mode, onMapClick, onSelect } = latest.current;
      const position: Position = snapAt(event.point)?.position ?? [event.lngLat.lng, event.lngLat.lat];
      if (mode !== 'browse') {
        onMapClick(position);
        return;
      }
      // Areas win over the sections they sit in.
      const hits = map.queryRenderedFeatures(event.point, { layers: ['area-fill', 'section-fill'] });
      const hit = hits.find((h) => h.layer.id === 'area-fill') ?? hits[0];
      const id = hit?.properties?.id as string | undefined;
      onSelect(id ? { kind: hit.layer.id === 'area-fill' ? 'area' : 'section', id } : null);
    });

    map.on('mousemove', (event) => {
      if (latest.current.interaction !== 'draw') return;
      const snap = snapAt(event.point);
      cursorRef.current = snap?.position ?? [event.lngLat.lng, event.lngLat.lat];
      const source = map.getSource<GeoJSONSource>('draft');
      source?.setData(draftFeatures(latest.current.draftPoints, cursorRef.current, latest.current.draftColor, snap?.kind));
    });

    for (const layer of ['area-fill', 'section-fill']) {
      map.on('mouseenter', layer, () => {
        if (latest.current.interaction === 'browse') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        if (latest.current.interaction === 'browse') map.getCanvas().style.cursor = '';
      });
    }

    const markersById = markerElements.current;
    const labelsById = labelElements.current;
    const alignById = alignElements.current;
    const urlsById = overlayUrls.current;
    return () => {
      markersById.clear();
      labelsById.clear();
      alignById.clear();
      urlsById.clear();
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
    map.getSource<GeoJSONSource>('properties')?.setData(propertiesToFeatures(properties, selectedId, settings));
    map.getSource<GeoJSONSource>('areas')?.setData(areasToFeatures(areas, selectedId, settings));
    map.getSource<GeoJSONSource>('sections')?.setData({
      type: 'FeatureCollection',
      features: sections.map((s) => ({
        type: 'Feature',
        geometry: s.geometry,
        properties: { id: s.id, selected: s.id === selectedId },
      })),
    });

    // Names for shapes, drawn as HTML so no font server is needed.
    const wanted = new Map<string, { text: string; at: [number, number]; kind: string; color?: string }>();
    for (const p of properties) {
      wanted.set(p.id, { text: p.name, at: topCenterOf(p.boundary), kind: 'property', color: propertyColor(p, settings) });
    }
    // Section names sit at the top of the section so they don't cover areas in the middle.
    for (const s of sections) wanted.set(s.id, { text: s.name, at: topCenterOf(s.geometry), kind: 'section' });
    for (const a of areas) wanted.set(a.id, { text: a.name, at: centerOf(a.geometry), kind: 'area' });
    syncHtmlMarkers(map, labelElements.current, wanted, (item, existing) => {
      const el = existing ?? document.createElement('div');
      // classList, not className: maplibre adds its own positioning class to this element.
      el.classList.add('map-label', `map-label-${item.kind}`);
      el.textContent = item.text;
      el.style.color = item.color ?? '';
      return el;
    }, { anchor: 'center' });
  }, [properties, areas, sections, selectedId, settings, readyTick]);

  // Point markers (stands, cameras, ...) as draggable HTML pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const wanted = new Map(
      markers.map((m) => [
        m.id,
        { id: m.id, name: m.name, selected: m.id === selectedId, style: markerStyle(m, settings), at: [m.lng, m.lat] as [number, number] },
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
        // Forecast highlight: good stands glow, bad ones fade.
        const rating = standRatings?.[item.id];
        for (const r of ['good', 'ok', 'bad', 'unset'] as const) el.classList.toggle(`rating-${r}`, rating === r);
        el.classList.toggle('rated', standRatings !== null);
        el.style.setProperty('--pin-color', item.style.color);
        el.style.setProperty('--pin-size', `${item.style.size}px`);
        el.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = `map-pin-dot shape-${item.style.shape}`;
        const label = document.createElement('span');
        label.className = 'map-pin-label';
        label.textContent = item.name;
        el.append(dot, label);
        return el;
      },
      // Anchored on the left edge; the dot's negative margin (styles.css)
      // centres it on the location so the label hangs off to the right.
      { anchor: 'left' },
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
  }, [markers, selectedId, standRatings, settings, readyTick]);

  // Map images, drawn above the base maps and under property lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const loaded = overlayUrls.current;
    const wanted = new Map(overlays.map((o) => [o.id, o]));
    for (const id of [...loaded.keys()]) {
      if (wanted.has(id)) continue;
      map.removeLayer(`overlay-${id}`);
      map.removeSource(`overlay-${id}`);
      loaded.delete(id);
    }
    for (const o of overlays) {
      const sourceId = `overlay-${o.id}`;
      const source = map.getSource<ImageSource>(sourceId);
      if (!source) {
        map.addSource(sourceId, { type: 'image', url: o.url, coordinates: o.corners });
        map.addLayer(
          { id: sourceId, type: 'raster', source: sourceId, paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 0 } },
          'property-fill',
        );
      } else if (loaded.get(o.id) !== o.url) {
        source.updateImage({ url: o.url, coordinates: o.corners });
      } else {
        source.setCoordinates(o.corners);
      }
      map.setPaintProperty(sourceId, 'raster-opacity', o.opacity);
      loaded.set(o.id, o.url);
    }
  }, [overlays, readyTick]);

  // Numbered, draggable map points while lining up an image.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const wanted = new Map(alignMarkers.map((m) => [String(m.index), { at: m.position, index: m.index }]));
    syncHtmlMarkers(
      map,
      alignElements.current,
      wanted,
      (item, existing) => {
        const el = existing ?? document.createElement('div');
        el.classList.add('control-point', 'on-map');
        el.textContent = String(item.index + 1);
        return el;
      },
      { anchor: 'center' },
      (marker, key) => {
        marker.setDraggable(true);
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          latest.current.onAlignMarkerMoved(Number(key), [lng, lat]);
        });
      },
    );
  }, [alignMarkers, readyTick]);

  // Scent cones: red when the scent reaches bedding (or the wind is wrong), orange otherwise.
  const { scentCones } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource<GeoJSONSource>('scent')?.setData({
      type: 'FeatureCollection',
      features: scentCones.map((c) => ({
        type: 'Feature',
        geometry: c.cone,
        properties: { id: c.id, color: c.rating === 'bad' ? '#ff453a' : '#ffa53b' },
      })),
    });
  }, [scentCones, readyTick]);

  // Drifting arrows: one animation loop for the map's life, reading the
  // latest cones from a ref. About 20 updates a second is smooth enough and
  // light on the PC; with "reduce motion" on, the arrows hold still.
  const conesRef = useRef(scentCones);
  conesRef.current = scentCones;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let last = 0;
    let shown = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const cones = conesRef.current;
      // Nothing to animate: clear once, then idle.
      if (cones.length === 0) {
        if (shown > 0) map.getSource<GeoJSONSource>('scent-arrows')?.setData(EMPTY);
        shown = 0;
        return;
      }
      // Still arrows only need to follow the slider, so update them less often.
      if (now - last < (reduceMotion ? 250 : 50)) return;
      last = now;
      shown = cones.length;
      map.getSource<GeoJSONSource>('scent-arrows')?.setData(scentArrowFeatures(cones, reduceMotion ? null : now));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [readyTick]);

  // Shape being drawn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (interaction !== 'draw') cursorRef.current = null;
    map.getSource<GeoJSONSource>('draft')?.setData(draftFeatures(draftPoints, cursorRef.current, draftColor));
    map.getCanvas().style.cursor = interaction === 'browse' ? '' : 'crosshair';
  }, [draftPoints, draftColor, interaction, readyTick]);

  return (
    <div ref={containerRef} className="map">
      {compassHost &&
        createPortal(
          <Compass
            bearing={bearing}
            windFromDeg={props.windFromDeg}
            onResetNorth={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 })}
          />,
          compassHost,
        )}
    </div>
  );
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
