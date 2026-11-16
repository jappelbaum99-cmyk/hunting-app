// A small map of the stand on the phone's hunt screen, with the deer logged on
// this hunt: where each came in and the way it went. Uses the same map tiles as
// the Map tab, so it works with no signal where the property's map is saved.
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Feature, FeatureCollection } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import { turnOnSavedTiles } from '@/field/tileStore';
import type { CampMap } from '@/lib/campMap';
import { offsetPosition } from '@/lib/geo';
import { kindInfo } from '@/lib/reports';
import { buildBaseStyle, LAYER_IDS, retryFailedTiles, setUpMapLibre } from '@/map/layers';
import type { Sighting } from '@/types/models';

const YARD_M = 0.9144;
// Zoomed so about 150 yards each way shows.
const ZOOM = 16.3;
const STAND_COLOR = '#f08a24';

type Base = 'topo' | 'satellite' | 'lidar' | 'infrared';

const BASE_LAYERS: Record<Base, string[]> = {
  topo: [LAYER_IDS.topo],
  satellite: [LAYER_IDS.satellite, LAYER_IDS.aerial, LAYER_IDS.aerialMo],
  lidar: [LAYER_IDS.lidar],
  infrared: [LAYER_IDS.satellite, LAYER_IDS.aerial, LAYER_IDS.aerialMo, LAYER_IDS.infrared],
};

function features(at: [number, number], sightings: Sighting[], campMap: CampMap | null): FeatureCollection {
  const out: Feature[] = [];
  for (const p of campMap?.properties ?? []) out.push({ type: 'Feature', geometry: p.boundary, properties: { kind: 'property' } });
  for (const s of sightings) {
    const color = kindInfo(s.kind).color;
    const seen: [number, number] | null =
      s.lat !== null && s.lng !== null ? [s.lng, s.lat] : s.fromStand ? offsetPosition(at[0], at[1], s.fromStand.bearingDeg, s.fromStand.yards * YARD_M) : null;
    const went = s.wentTo && s.lat === null ? offsetPosition(at[0], at[1], s.wentTo.bearingDeg, s.wentTo.yards * YARD_M) : null;
    const came = s.cameFrom && s.lat === null ? offsetPosition(at[0], at[1], s.cameFrom.bearingDeg, s.cameFrom.yards * YARD_M) : null;
    if (went || came) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...(came ? [came] : []), seen ?? at, ...(went ? [went] : [])] }, properties: { kind: 'path', color } });
    if (came) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: came }, properties: { kind: 'from', color } });
    if (went) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: went }, properties: { kind: 'went', color } });
    if (seen) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: seen }, properties: { kind: 'deer', color } });
  }
  out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { kind: 'stand' } });
  return { type: 'FeatureCollection', features: out };
}

export function StandMap(props: { at: [number, number]; sightings: Sighting[]; base: Base; campMap: CampMap | null }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUpMapLibre();
    turnOnSavedTiles();
    const map = new maplibregl.Map({
      container: box.current!,
      style: buildBaseStyle(),
      center: props.at,
      zoom: ZOOM,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // A page scroll over the map scrolls the page, not the map.
      cooperativeGestures: true,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    retryFailedTiles(map);
    map.on('load', () => {
      map.addSource('hunt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'hunt-property',
        type: 'line',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'property'],
        paint: { 'line-color': '#f4c542', 'line-width': 2.5 },
      });
      map.addLayer({
        id: 'hunt-path-casing',
        type: 'line',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'path'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': 'rgba(20, 12, 6, 0.8)', 'line-width': 6 },
      });
      map.addLayer({
        id: 'hunt-path',
        type: 'line',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'path'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#f7efe6', 'line-width': 3 },
      });
      // Where it was first seen: a small dot where its line starts.
      map.addLayer({
        id: 'hunt-from',
        type: 'circle',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'from'],
        paint: { 'circle-radius': 3.5, 'circle-color': '#f7efe6', 'circle-stroke-color': 'rgba(20, 12, 6, 0.8)', 'circle-stroke-width': 1.5 },
      });
      // Where it went: a hollow ring at the end of its line.
      map.addLayer({
        id: 'hunt-went',
        type: 'circle',
        source: 'hunt',
        filter: ['==', ['get', 'kind'], 'went'],
        paint: { 'circle-radius': 5, 'circle-color': 'rgba(0, 0, 0, 0)', 'circle-stroke-color': '#f7efe6', 'circle-stroke-width': 2.5 },
      });
      map.addLayer({
        id: 'hunt-points',
        type: 'circle',
        source: 'hunt',
        filter: ['in', ['get', 'kind'], ['literal', ['deer', 'stand']]],
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'stand', 8, 6],
          'circle-color': ['match', ['get', 'kind'], 'stand', STAND_COLOR, ['get', 'color']],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // A map this version no longer offers (saved on the phone earlier) shows as topo.
    const shown = new Set(BASE_LAYERS[props.base] ?? BASE_LAYERS.topo);
    for (const id of [LAYER_IDS.topo, LAYER_IDS.satellite, LAYER_IDS.aerial, LAYER_IDS.aerialMo, LAYER_IDS.lidar, LAYER_IDS.infrared, LAYER_IDS.greenness]) {
      map.setLayoutProperty(id, 'visibility', shown.has(id) ? 'visible' : 'none');
    }
  }, [ready, props.base]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('hunt') as maplibregl.GeoJSONSource).setData(features(props.at, props.sightings, props.campMap));
    // Keyed on the sightings' contents: the hunt screen re-renders as you type.
  }, [ready, props.at[0], props.at[1], JSON.stringify(props.sightings), props.campMap]);

  return <div ref={box} className="stand-map" aria-label="Map of the stand and the deer seen" />;
}
