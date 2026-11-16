// The stand map on the phone's hunt screen: the deer logged on this hunt, and
// (when it's where they're logged) range rings around the stand and the deer
// being logged, with each tap placing its next point. Uses the same map tiles
// as the Map tab, so it works with no signal where the property's map is saved.
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Feature, FeatureCollection, Position } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import { turnOnSavedTiles } from '@/field/tileStore';
import type { CampMap } from '@/lib/campMap';
import { offsetPosition } from '@/lib/geo';
import { kindInfo } from '@/lib/reports';
import { buildBaseStyle, isDeviceLidar, LAYER_IDS, lidarStyleTiles, retryFailedTiles, setUpMapLibre } from '@/map/layers';
import type { PhoneLidarStyle } from '@/field/fieldData';
import type { Sighting } from '@/types/models';

const YARD_M = 0.9144;
const STAND_COLOR = '#f08a24';
// Rings around the stand, yards; the map opens fitted to the outer one.
const RINGS = [25, 50, 100, 150];
const FIT_YARDS = 165;

type Base = 'topo' | 'satellite' | 'esri' | 'lidar' | 'infrared';
type Where = NonNullable<Sighting['fromStand']>;

// The deer being logged: its three points so far, drawn brighter than the rest.
export interface DraftDeer {
  cameFrom: Where | null;
  fromStand: Where | null;
  wentTo: Where | null;
  color: string;
}

const BASE_LAYERS: Record<Base, string[]> = {
  topo: [LAYER_IDS.topo],
  satellite: [LAYER_IDS.satellite, LAYER_IDS.aerial, LAYER_IDS.aerialMo],
  esri: [LAYER_IDS.esri],
  lidar: [LAYER_IDS.lidar],
  infrared: [LAYER_IDS.satellite, LAYER_IDS.aerial, LAYER_IDS.aerialMo, LAYER_IDS.infrared],
};

export type PointKind = 'from' | 'closest' | 'went';

function deerFeatures(at: [number, number], s: Pick<Sighting, 'lat' | 'lng' | 'fromStand' | 'wentTo' | 'cameFrom'>, color: string, draft: boolean): Feature[] {
  const out: Feature[] = [];
  const pos = (w: Where) => offsetPosition(at[0], at[1], w.bearingDeg, w.yards * YARD_M);
  const seen: [number, number] | null = s.lat !== null && s.lng !== null ? [s.lng, s.lat] : s.fromStand ? pos(s.fromStand) : null;
  const went = s.wentTo && s.lat === null ? pos(s.wentTo) : null;
  const came = s.cameFrom && s.lat === null ? pos(s.cameFrom) : null;
  const line = [came, seen, went].filter((p): p is [number, number] => p !== null);
  if (line.length > 1) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { kind: 'path', color, draft } });
  // The deer being placed draws its points as markers you can drag.
  if (draft) return out;
  if (came) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: came }, properties: { kind: 'from', color, draft } });
  if (went) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: went }, properties: { kind: 'went', color, draft } });
  if (seen) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: seen }, properties: { kind: 'deer', color, draft } });
  return out;
}

function features(at: [number, number], sightings: Sighting[], campMap: CampMap | null, draft: DraftDeer | null): FeatureCollection {
  const out: Feature[] = [];
  for (const p of campMap?.properties ?? []) out.push({ type: 'Feature', geometry: p.boundary, properties: { kind: 'property' } });
  for (const s of sightings) out.push(...deerFeatures(at, s, kindInfo(s.kind).color, false));
  if (draft) out.push(...deerFeatures(at, { lat: null, lng: null, ...draft }, draft.color, true));
  out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { kind: 'stand' } });
  return { type: 'FeatureCollection', features: out };
}

function ringFeatures(at: [number, number]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: RINGS.map((yards) => {
      const ring: Position[] = [];
      for (let deg = 0; deg <= 360; deg += 6) ring.push(offsetPosition(at[0], at[1], deg, yards * YARD_M));
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: { yards } };
    }),
  };
}

export function StandMap(props: {
  at: [number, number];
  sightings: Sighting[];
  base: Base;
  campMap: CampMap | null;
  // Logging a deer on the map: rings, the deer so far, and taps.
  draft?: DraftDeer | null;
  onTap?(position: [number, number]): void;
  // Dragging one of the deer's points moves it (while dragging and on letting go).
  onMovePoint?(which: PointKind, position: [number, number]): void;
  // Which way is up (the phone's compass), 0 = north.
  bearing?: number;
  lidarStyle?: PhoneLidarStyle;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onTap = useRef(props.onTap);
  onTap.current = props.onTap;
  const ringLabels = useRef<maplibregl.Marker[]>([]);
  const onMovePoint = useRef(props.onMovePoint);
  onMovePoint.current = props.onMovePoint;
  // The deer's draggable points, and the one under a finger right now.
  const pointMarkers = useRef(new Map<PointKind, maplibregl.Marker>());
  const dragging = useRef<PointKind | null>(null);
  const draggedAt = useRef(0);
  const picking = !!props.onTap;

  useEffect(() => {
    setUpMapLibre();
    turnOnSavedTiles();
    const map = new maplibregl.Map({
      container: box.current!,
      style: buildBaseStyle(),
      center: props.at,
      zoom: 16.3,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // One finger scrolls the page; two move the map. A tap places a point.
      cooperativeGestures: true,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    retryFailedTiles(map);
    // About 165 yards each way of the stand, so the 150 yd ring fits.
    const corner = (deg: number) => offsetPosition(props.at[0], props.at[1], deg, FIT_YARDS * YARD_M * Math.SQRT2);
    const [sw, ne] = [corner(225), corner(45)];
    map.fitBounds([sw, ne], { padding: 4, duration: 0 });
    // A tap on one of the deer's points, or the end of dragging one, isn't a new spot.
    map.on('click', (e) => {
      const target = e.originalEvent.target as HTMLElement | null;
      if (target?.closest('.stand-map-point') || Date.now() - draggedAt.current < 400) return;
      onTap.current?.([e.lngLat.lng, e.lngLat.lat]);
    });
    map.on('load', () => {
      map.addSource('rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'hunt-rings',
        type: 'line',
        source: 'rings',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#f7efe6', 'line-width': 1.2, 'line-opacity': 0.7, 'line-dasharray': [3, 3] },
      });
      map.addSource('hunt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'hunt-property',
        type: 'line',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'property'],
        paint: { 'line-color': '#f4c542', 'line-width': 2.5 },
      });
      // Deer already logged fade back while a new one is being placed.
      const fade = (on: number, off: number): maplibregl.ExpressionSpecification => ['case', ['get', 'draft'], on, off];
      map.addLayer({
        id: 'hunt-path-casing',
        type: 'line',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'rgba(20, 12, 6, 0.8)', 'line-width': fade(7, 6), 'line-opacity': fade(1, 0.6) },
      });
      map.addLayer({
        id: 'hunt-path',
        type: 'line',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['case', ['get', 'draft'], '#ffffff', '#f7efe6'], 'line-width': fade(4, 3), 'line-opacity': fade(1, 0.6) },
      });
      // Where it was first seen: a small dot where its line starts.
      map.addLayer({
        id: 'hunt-from',
        type: 'circle',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'from'],
        paint: { 'circle-radius': fade(5, 3.5), 'circle-color': '#f7efe6', 'circle-stroke-color': 'rgba(20, 12, 6, 0.8)', 'circle-stroke-width': 1.5, 'circle-opacity': fade(1, 0.6) },
      });
      // Where it went: a hollow ring at the end of its line.
      map.addLayer({
        id: 'hunt-went',
        type: 'circle',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'went'],
        paint: { 'circle-radius': fade(7, 5), 'circle-color': 'rgba(0, 0, 0, 0)', 'circle-stroke-color': '#f7efe6', 'circle-stroke-width': 2.5, 'circle-stroke-opacity': fade(1, 0.6) },
      });
      map.addLayer({
        id: 'hunt-points',
        type: 'circle',
        source: 'hunt',
        filter: ['in', ['get', 'kind'], ['literal', ['deer', 'stand']]],
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'stand', 8, ['case', ['get', 'draft'], 9, 6]],
          'circle-color': ['match', ['get', 'kind'], 'stand', STAND_COLOR, ['get', 'color']],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': ['case', ['==', ['get', 'draft'], false], 0.6, 1],
          'circle-stroke-opacity': ['case', ['==', ['get', 'draft'], false], 0.6, 1],
        },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      for (const m of ringLabels.current) m.remove();
      for (const m of pointMarkers.current.values()) m.remove();
      pointMarkers.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // A map this version no longer offers (saved on the phone earlier) shows as topo.
    const shown = new Set(BASE_LAYERS[props.base] ?? BASE_LAYERS.topo);
    // Lidar drawn on the phone comes from its own elevation tiles.
    const style = props.lidarStyle ?? 'stretch';
    if (props.base === 'lidar' && isDeviceLidar(style)) {
      shown.delete(LAYER_IDS.lidar);
      shown.add(LAYER_IDS.lidarDem);
      (map.getSource('lidarDem') as maplibregl.RasterTileSource | undefined)?.setTiles(lidarStyleTiles(style));
    }
    for (const id of [LAYER_IDS.topo, LAYER_IDS.satellite, LAYER_IDS.aerial, LAYER_IDS.aerialMo, LAYER_IDS.esri, LAYER_IDS.lidar, LAYER_IDS.lidarDem, LAYER_IDS.infrared, LAYER_IDS.greenness]) {
      map.setLayoutProperty(id, 'visibility', shown.has(id) ? 'visible' : 'none');
    }
    // Light rings vanish on the light topo map, so they're dark there.
    map.setPaintProperty('hunt-rings', 'line-color', props.base === 'topo' ? '#5a3d2b' : '#f7efe6');
  }, [ready, props.base, props.lidarStyle]);

  // Range rings, with their yards as small labels (HTML: no glyph server).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('rings') as maplibregl.GeoJSONSource).setData(ringFeatures(props.at));
    map.setLayoutProperty('hunt-rings', 'visibility', picking ? 'visible' : 'none');
    for (const m of ringLabels.current) m.remove();
    ringLabels.current = picking
      ? RINGS.map((yards) => {
          const el = document.createElement('div');
          el.classList.add('stand-map-ring');
          el.textContent = String(yards);
          return new maplibregl.Marker({ element: el }).setLngLat(offsetPosition(props.at[0], props.at[1], 0, yards * YARD_M)).addTo(map);
        })
      : [];
  }, [ready, picking, props.at[0], props.at[1]]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('hunt') as maplibregl.GeoJSONSource).setData(features(props.at, props.sightings, props.campMap, props.draft ?? null));
    // Keyed on contents: the hunt screen re-renders as you type.
  }, [ready, props.at[0], props.at[1], JSON.stringify(props.sightings), JSON.stringify(props.draft ?? null), props.campMap]);

  // The deer being placed: a marker for each point set, dragged to adjust it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const draft = props.draft ?? null;
    const at = props.at;
    const wanted: [PointKind, Where | null][] = [
      ['from', draft?.cameFrom ?? null],
      ['closest', draft?.fromStand ?? null],
      ['went', draft?.wentTo ?? null],
    ];
    for (const [kind, where] of wanted) {
      let marker = pointMarkers.current.get(kind);
      if (!where || !props.onTap) {
        marker?.remove();
        pointMarkers.current.delete(kind);
        continue;
      }
      const position = offsetPosition(at[0], at[1], where.bearingDeg, where.yards * YARD_M);
      if (!marker) {
        const el = document.createElement('div');
        el.classList.add('stand-map-point', `point-${kind}`);
        el.setAttribute('aria-label', kind === 'from' ? 'First seen: drag to move' : kind === 'closest' ? 'Closest: drag to move' : 'Went: drag to move');
        marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(position).addTo(map);
        const m = marker;
        m.on('dragstart', () => (dragging.current = kind));
        m.on('drag', () => {
          const p = m.getLngLat();
          onMovePoint.current?.(kind, [p.lng, p.lat]);
        });
        m.on('dragend', () => {
          const p = m.getLngLat();
          dragging.current = null;
          draggedAt.current = Date.now();
          onMovePoint.current?.(kind, [p.lng, p.lat]);
        });
        pointMarkers.current.set(kind, m);
      } else if (dragging.current !== kind) {
        marker.setLngLat(position);
      }
      if (kind === 'closest') marker.getElement().style.setProperty('--deer', draft?.color ?? '#a07a55');
    }
  }, [ready, props.at[0], props.at[1], JSON.stringify(props.draft ?? null), !!props.onTap]);

  // Turn with the compass, around the stand.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.easeTo({ bearing: props.bearing ?? 0, center: props.at, duration: 250 });
  }, [ready, Math.round(props.bearing ?? 0)]);

  return <div ref={box} className={`stand-map${picking ? ' picking' : ''}`} aria-label="Map of the stand and the deer seen" />;
}
