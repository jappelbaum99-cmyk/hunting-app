// The phone's Map tab: the camp map from the hub (property lines, sections,
// areas, trails and pins) over USGS satellite, topo or lidar, with where you
// are from GPS. Each property's map can be saved on the phone, so it all works
// in the woods with no signal (GPS doesn't need any).
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Feature, FeatureCollection, Position } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';
import type { FieldData } from '@/field/fieldData';
import type { FieldPin } from '@/types/models';
import { clearSavedTiles, saveTile, storageUsedMb, tileStoreAvailable, turnOnSavedTiles } from '@/field/tileStore';
import type { CampMap } from '@/lib/campMap';
import { pinTypeInfo } from '@/lib/featureTypes';
import { boundsOf } from '@/lib/geo';
import { compassPointOf } from '@/lib/standRating';
import { formatDistance, lineLengthM, metersBetween } from '@/lib/trails';
import { AERIAL_TILE_URL, buildBaseStyle, DEFAULT_LAYERS, LAYER_IDS, MO_AERIAL_TILE_URL, retryFailedTiles, setUpMapLibre } from '@/map/layers';
import { DEFAULT_OFFLINE_RADIUS_M, planDownload, runDownload } from '@/map/offline';

type Base = 'satellite' | 'topo' | 'lidar';
type Fix = { lat: number; lng: number; accuracyM: number };
type Tool = 'pin' | 'walk' | 'soil';
// A pin tapped on the map: one from the hub (moving it asks the hub), or one of
// this phone's own the hub doesn't have yet (moving it just moves it).
type Picked = { id: string; source: 'hub' | 'mine'; type: string; name: string; kind: string; lat: number; lng: number };

// The phone has no 3D, so its saved maps leave the terrain tiles out.
// The maps to pick from, and the ones a property's offline save keeps. For now
// only topo is saved (about 1 MB a property); satellite is for looking while
// there's signal. Add a map to SAVED_BASES, and turn contours on, to save more.
const PHONE_BASES: Base[] = ['topo', 'satellite'];
const SAVED_BASES: Base[] = ['topo'];
const PHONE_CONTOURS = false;
const PHONE_SKIP = [
  '3D terrain',
  ...(SAVED_BASES.includes('satellite') ? [] : ['Satellite', 'Satellite close-up', 'Missouri 6 inch close-up']),
  ...(SAVED_BASES.includes('topo') ? [] : ['Topo']),
  ...(SAVED_BASES.includes('lidar') ? [] : ['Lidar']),
];
// Saved maps: what's included, so a change here can ask for a fresh save.
const PHONE_LAYERS = [...SAVED_BASES, ...(PHONE_CONTOURS ? ['contours10'] : [])].join(',');
const BASE_LABELS: Record<Base, string> = { topo: 'Topo', satellite: 'Satellite', lidar: 'Lidar' };
// Topo tiles stop at zoom 16; a little past that is still readable.
const MAX_ZOOM: Record<Base, number> = { topo: 17.5, satellite: 19, lidar: 19 };
// Sign and cameras: small dots with no name (tap one to see it), so they
// don't crowd out the stands.
const SMALL_PINS = ['rub', 'scrape', 'camera'];
// Tiles fetched at once. The browser allows about 6 per server, and the maps come
// from four servers, so the list is mixed to keep them all busy at once.
const SAVE_AT_ONCE = 12;
const SECTION_COLOR = '#f7efe6';

// Close-up photos: USGS's are by far the slowest to fetch. Where Missouri's 6
// inch photos cover a spot they're drawn on top, so the USGS one is skipped.
// Missouri's server sends a JPEG inside the state and a blank PNG outside it,
// which is what decides, right up to the state line.
const isUsgsCloseUp = (url: string) => url.startsWith(AERIAL_TILE_URL.split('?')[0]);
const isMoCloseUp = (url: string) => url.startsWith(MO_AERIAL_TILE_URL.split('?')[0]);
const bboxOf = (url: string) => url.match(/bbox=([^&]+)/)?.[1] ?? url;
const ME_COLOR = '#2f8fff';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

// A circle around a point, `meters` across each way, as a polygon.
function circle(lng: number, lat: number, meters: number): Feature {
  const ring: Position[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    ring.push([lng + (Math.sin(a) * meters) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(a) * meters) / 110_540]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

function bearingDeg(from: Fix, to: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

// Takes turns between servers: one from each, then the next from each.
function mixByServer(urls: string[]): string[] {
  const byHost = new Map<string, string[]>();
  for (const url of urls) {
    const host = new URL(url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), url]);
  }
  const lists = [...byHost.values()];
  const mixed: string[] = [];
  for (let i = 0; mixed.length < urls.length; i++) for (const list of lists) if (i < list.length) mixed.push(list[i]);
  return mixed;
}

const yards = (m: number) => (m < 1600 ? `${Math.round(m * 1.0936)} yd` : `${(m / 1609.34).toFixed(1)} mi`);

function campFeatures(map: CampMap | null): FeatureCollection {
  if (!map) return EMPTY;
  const features: Feature[] = [
    ...map.areas.map((a): Feature => ({ type: 'Feature', geometry: a.geometry, properties: { kind: 'area', color: a.color } })),
    ...map.sections.map((s): Feature => ({ type: 'Feature', geometry: s.geometry, properties: { kind: 'section', color: SECTION_COLOR } })),
    ...map.properties.map((p): Feature => ({ type: 'Feature', geometry: p.boundary, properties: { kind: 'property', color: p.color } })),
    ...map.trails.map((t): Feature => ({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: t.lines },
      properties: { kind: 'trail', color: t.color, dashed: t.dashed, px: t.px },
    })),
  ];
  return { type: 'FeatureCollection', features };
}

// Where a name goes for an outline: the middle of its box.
const middleOf = (geometry: Parameters<typeof boundsOf>[0]): [number, number] => {
  const [w, s, e, n] = boundsOf(geometry);
  return [(w + e) / 2, (s + n) / 2];
};

function addCampLayers(map: maplibregl.Map) {
  map.addSource('camp', { type: 'geojson', data: EMPTY });
  map.addSource('walk', { type: 'geojson', data: EMPTY });
  map.addSource('me', { type: 'geojson', data: EMPTY });
  const polygons: maplibregl.FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
  map.addLayer({ id: 'area-fill', type: 'fill', source: 'camp', filter: ['all', polygons, ['==', ['get', 'kind'], 'area']], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } });
  map.addLayer({ id: 'area-line', type: 'line', source: 'camp', filter: ['all', polygons, ['==', ['get', 'kind'], 'area']], paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } });
  map.addLayer({
    id: 'section-line',
    type: 'line',
    source: 'camp',
    filter: ['all', polygons, ['==', ['get', 'kind'], 'section']],
    paint: { 'line-color': SECTION_COLOR, 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [4, 2] },
  });
  map.addLayer({ id: 'property-line', type: 'line', source: 'camp', filter: ['all', polygons, ['==', ['get', 'kind'], 'property']], paint: { 'line-color': ['get', 'color'], 'line-width': 3 } });
  const trails: maplibregl.FilterSpecification = ['==', ['get', 'kind'], 'trail'];
  map.addLayer({ id: 'trail-line', type: 'line', source: 'camp', filter: ['all', trails, ['!', ['get', 'dashed']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'px'] } });
  map.addLayer({ id: 'trail-dashed', type: 'line', source: 'camp', filter: ['all', trails, ['get', 'dashed']], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'px'], 'line-dasharray': [3, 2] } });
  map.addLayer({ id: 'walk-line', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f08a24', 'line-width': 4 } });
  map.addLayer({ id: 'me-accuracy', type: 'fill', source: 'me', paint: { 'fill-color': ME_COLOR, 'fill-opacity': 0.15 } });
  map.addLayer({ id: 'me-accuracy-line', type: 'line', source: 'me', paint: { 'line-color': ME_COLOR, 'line-width': 1, 'line-opacity': 0.5 } });
}

function setBase(map: maplibregl.Map, base: Base, contours: boolean) {
  const show = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  show(LAYER_IDS.satellite, base === 'satellite');
  show(LAYER_IDS.aerial, base === 'satellite');
  show(LAYER_IDS.aerialMo, base === 'satellite');
  show(LAYER_IDS.topo, base === 'topo');
  show(LAYER_IDS.lidar, base === 'lidar');
  show(LAYER_IDS.contours, contours);
  // Black lines read poorly on photos, so they're lightened there.
  map.setPaintProperty(LAYER_IDS.contours, 'raster-brightness-min', base === 'satellite' ? 0.85 : 0);
  // Cream section lines vanish on the light topo map, so they're dark there.
  map.setPaintProperty('section-line', 'line-color', base === 'topo' ? '#5a3d2b' : SECTION_COLOR);
}

function labelEl(text: string, className: string): HTMLElement {
  const el = document.createElement('div');
  el.classList.add('fm-label', className);
  el.textContent = text;
  return el;
}

export function MapTab(props: {
  visible: boolean;
  data: FieldData;
  fix: Fix | null;
  gpsError: string | null;
  onData(update: (d: FieldData) => FieldData): void;
  onMessage(text: string): void;
  // Drop a pin, walk a trail or an area, and soil tests: opened from the buttons along the bottom.
  tools: Record<Tool, ReactNode>;
}) {
  const { visible, data, fix } = props;
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const prefs = data.mapView ?? {};
  const base: Base = prefs.base && PHONE_BASES.includes(prefs.base) ? prefs.base : PHONE_BASES[0];
  const labels = prefs.labels !== false;
  const setPrefs = (patch: NonNullable<FieldData['mapView']>) => props.onData((d) => ({ ...d, mapView: { ...d.mapView, ...patch } }));
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const [contours, setContours] = useState(false);
  const [follow, setFollow] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  // A pin being moved: the map slides under a cross in the middle, which marks the new spot.
  const [moving, setMoving] = useState<Picked | null>(null);
  const movingRef = useRef<Picked | null>(null);
  movingRef.current = moving;
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  // Set when the cross was snapped to your GPS spot, for the pin's accuracy.
  const [usedGps, setUsedGps] = useState(false);
  const [sheet, setSheet] = useState(false);
  // The tool panel open over the bottom of the map, if any.
  const [tool, setTool] = useState<Tool | null>(null);
  const [saving, setSaving] = useState<{ id: string; done: number; total: number } | null>(null);
  const [usedMb, setUsedMb] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const centered = useRef(false);
  const campMap = data.map ?? null;

  // The map, made once and kept while the page is open.
  useEffect(() => {
    setUpMapLibre();
    turnOnSavedTiles();
    const first = campMap?.properties[0];
    const map = new maplibregl.Map({
      container: box.current!,
      style: buildBaseStyle(),
      center: first ? middleOf(first.boundary) : data.stands[0] ? [data.stands[0].lng, data.stands[0].lat] : [-92.5, 38.5],
      zoom: first || data.stands[0] ? 15 : 6,
      maxZoom: MAX_ZOOM[base],
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    retryFailedTiles(map);
    map.on('load', () => {
      addCampLayers(map);
      setReady(true);
    });
    // Moving the map by hand stops following you.
    map.on('dragstart', () => {
      setFollow(false);
      setUsedGps(false);
    });
    // Only while moving a pin, so panning normally doesn't redraw this panel.
    map.on('move', () => {
      if (!movingRef.current) return;
      const c = map.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
    });
    if (first) map.fitBounds(boundsOf(first.boundary), { padding: 40, duration: 0 });
    mapRef.current = map;
    return () => {
      abort.current?.abort();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Hidden tabs have no size; the map needs telling when it shows again.
  useEffect(() => {
    if (visible) mapRef.current?.resize();
  }, [visible]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    setBase(mapRef.current, base, contours);
    mapRef.current.setMaxZoom(MAX_ZOOM[base]);
  }, [ready, base, contours]);

  // Lines and outlines.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('camp') as maplibregl.GeoJSONSource).setData(campFeatures(campMap));
  }, [ready, campMap]);

  // Pins and names: HTML markers, like the hub (no font server needed).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markers.current.forEach((m) => m.remove());
    const list: maplibregl.Marker[] = [];
    const pin = (p: Picked & { color: string; mine?: boolean }) => {
      const small = !!p.type && SMALL_PINS.includes(p.type);
      const el = document.createElement('button');
      el.classList.add('fm-pin');
      if (p.mine) el.classList.add('mine');
      if (small) el.classList.add('small');
      el.style.setProperty('--pin', p.color);
      el.append(document.createElement('i'));
      if (labels && !small) el.append(labelEl(p.name, 'fm-pin-name'));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setPicked({ id: p.id, source: p.source, type: p.type, name: p.name, kind: p.kind, lat: p.lat, lng: p.lng });
      });
      list.push(new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, small ? -4 : -7] }).setLngLat([p.lng, p.lat]).addTo(map));
    };
    if (campMap) {
      for (const p of campMap.pins) pin({ id: p.id, source: 'hub', name: p.name || pinTypeInfo(p.type, data.pinTypes).label, kind: pinTypeInfo(p.type, data.pinTypes).label, lat: p.lat, lng: p.lng, color: p.color, type: p.type });
      if (labels) {
        for (const p of campMap.properties) list.push(new maplibregl.Marker({ element: labelEl(p.name, 'fm-property-name') }).setLngLat(middleOf(p.boundary)).addTo(map));
        for (const s of campMap.sections) list.push(new maplibregl.Marker({ element: labelEl(s.name, 'fm-section-name') }).setLngLat(middleOf(s.geometry)).addTo(map));
      }
    } else {
      // No map from the hub yet: the stands still show.
      for (const s of data.stands) pin({ id: s.id, source: 'hub', type: 'stand', name: s.name, kind: 'Stand', lat: s.lat, lng: s.lng, color: '#f08a24' });
    }
    // This phone's own pins the hub hasn't taken in yet, outlined.
    for (const p of data.pins.filter((p) => !p.deletedAt && !data.handled[p.id] && !p.soil)) {
      const info = pinTypeInfo(p.type, data.pinTypes);
      pin({ id: p.id, source: 'mine', name: p.note || info.label, kind: `${info.label} (yours, not on the hub yet)`, lat: p.lat, lng: p.lng, color: info.color, mine: true, type: p.type });
    }
    markers.current = list;
  }, [ready, campMap, data.stands, data.pins, data.handled, data.pinTypes, labels]);

  useEffect(() => {
    for (const m of markers.current) m.getElement().classList.remove('fm-moving');
    if (!moving) return;
    const el = markers.current.find((m) => {
      const at = m.getLngLat();
      return Math.abs(at.lat - moving.lat) < 1e-9 && Math.abs(at.lng - moving.lng) < 1e-9;
    });
    el?.getElement().classList.add('fm-moving');
  }, [moving]);

  // The walk being recorded.
  const walk = data.activeWalk?.points ?? null;
  // Starting a walk follows you, so the line draws where you can see it.
  const walkId = data.activeWalk?.id ?? null;
  useEffect(() => {
    if (walkId) setFollow(true);
  }, [walkId]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('walk') as maplibregl.GeoJSONSource).setData(
      walk && walk.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: walk }, properties: {} } : EMPTY,
    );
  }, [ready, walk]);

  // You: a blue dot, with a ring for how sure the GPS is.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('me') as maplibregl.GeoJSONSource).setData(fix ? circle(fix.lng, fix.lat, fix.accuracyM) : EMPTY);
    if (!fix) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const el = document.createElement('div');
      el.classList.add('fm-me');
      meMarker.current = new maplibregl.Marker({ element: el }).setLngLat([fix.lng, fix.lat]).addTo(map);
    } else meMarker.current.setLngLat([fix.lng, fix.lat]);
    if (follow) map.easeTo({ center: [fix.lng, fix.lat], duration: 500 });
    // Without a camp map, start where you are.
    if (!centered.current && !campMap && data.stands.length === 0) {
      centered.current = true;
      map.jumpTo({ center: [fix.lng, fix.lat], zoom: 16 });
    }
  }, [ready, fix, follow]);

  const findMe = () => {
    const map = mapRef.current;
    if (!map) return;
    if (!fix) return props.onMessage(props.gpsError ?? 'Finding GPS… step out from under heavy cover if it takes a while.');
    setFollow(true);
    map.easeTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 });
  };

  const showAll = () => {
    const map = mapRef.current;
    const first = campMap?.properties[0];
    if (!map || !campMap || !first) return;
    let [w, s, e, n] = boundsOf(first.boundary);
    for (const p of campMap.properties) {
      const b = boundsOf(p.boundary);
      [w, s, e, n] = [Math.min(w, b[0]), Math.min(s, b[1]), Math.max(e, b[2]), Math.max(n, b[3])];
    }
    setFollow(false);
    map.fitBounds([w, s, e, n], { padding: 40, duration: 600 });
  };

  const plans = useMemo(
    () =>
      (campMap?.properties ?? []).map((p) => ({
        property: p,
        plan: planDownload(p.boundary, { ...DEFAULT_LAYERS, contours: PHONE_CONTOURS ? '10' : 'off' }, DEFAULT_OFFLINE_RADIUS_M, PHONE_SKIP),
      })),
    [campMap],
  );

  useEffect(() => {
    if (sheet) void storageUsedMb().then(setUsedMb);
  }, [sheet, saving === null]);

  const save = async (id: string) => {
    const entry = plans.find((p) => p.property.id === id);
    if (!entry || saving) return;
    if (!navigator.onLine) return props.onMessage('Saving maps needs signal. Try on Wi-Fi before you head out.');
    const controller = new AbortController();
    abort.current = controller;
    const all = entry.plan.urls;
    setSaving({ id, done: 0, total: all.length });
    try {
      // First everything but the USGS close-ups, noting where Missouri's photos came back.
      const covered = new Set<string>();
      const first = all.filter((url) => !isUsgsCloseUp(url));
      const one = await runDownload(
        { urls: mixByServer(first) },
        (p) => setSaving({ id, done: p.done, total: all.length }),
        controller.signal,
        SAVE_AT_ONCE,
        async (url) => {
          if (!isMoCloseUp(url)) return saveTile(url);
          // A Missouri photo that doesn't come through isn't missing: the USGS one is saved instead.
          const tile = await saveTile(url).catch(() => null);
          if (tile?.type === 'image/jpeg') covered.add(bboxOf(url));
          return tile ?? { cached: false };
        },
      );
      if (controller.signal.aborted) return;
      // Then the USGS close-ups Missouri's photos don't cover.
      const rest = all.filter((url) => isUsgsCloseUp(url) && !covered.has(bboxOf(url)));
      const skipped = all.length - first.length - rest.length;
      const two = await runDownload(
        { urls: rest },
        (p) => setSaving({ id, done: first.length + skipped + p.done, total: all.length }),
        controller.signal,
        SAVE_AT_ONCE,
        saveTile,
      );
      if (controller.signal.aborted) return;
      const result = { total: one.total + two.total, failed: one.failed + two.failed };
      props.onData((d) => ({
        ...d,
        offlineMaps: { ...d.offlineMaps, [id]: { savedAt: new Date().toISOString(), tiles: result.total - result.failed, failed: result.failed, layers: PHONE_LAYERS } },
      }));
      props.onMessage(
        result.failed
          ? `${entry.property.name} saved, but ${result.failed} map squares didn't come through. Save again to fill them in.`
          : `${entry.property.name} saved. Its map works with no signal now.`,
      );
    } catch (error) {
      props.onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      abort.current = null;
      setSaving(null);
    }
  };

  const removeAll = async () => {
    if (!confirm('Remove every saved map from this phone? Your pins and hunts stay.')) return;
    abort.current?.abort();
    await clearSavedTiles();
    props.onData((d) => ({ ...d, offlineMaps: {} }));
    setUsedMb(await storageUsedMb());
    props.onMessage('Saved maps removed.');
  };

  const startMove = (p: Picked) => {
    const map = mapRef.current;
    if (!map) return;
    setPicked(null);
    setTool(null);
    setFollow(false);
    setUsedGps(false);
    setMoving(p);
    setCenter({ lat: p.lat, lng: p.lng });
    map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 17), duration: 500 });
  };

  const snapToMe = () => {
    const map = mapRef.current;
    if (!map) return;
    if (!fix) return props.onMessage(props.gpsError ?? 'Finding GPS… step out from under heavy cover if it takes a while.');
    map.easeTo({ center: [fix.lng, fix.lat], duration: 400 });
    setUsedGps(true);
  };

  const saveMove = () => {
    const map = mapRef.current;
    if (!map || !moving) return;
    const { lat, lng } = map.getCenter();
    const at = new Date().toISOString();
    const accuracyM = usedGps && fix ? Math.round(fix.accuracyM) : null;
    if (moving.source === 'mine') {
      props.onData((d) => ({ ...d, pins: d.pins.map((p) => (p.id === moving.id ? { ...p, lat, lng, accuracyM, updatedAt: at } : p)) }));
      props.onMessage(`${moving.name} moved.`);
    } else {
      // The hub's pin moves once someone there says OK, keeping its name and history.
      // A second move before then just changes the spot already sent.
      props.onData((d) => {
        const pending = d.pins.find((p) => p.moveStandId === moving.id && !p.deletedAt && !d.handled[p.id]);
        if (pending) return { ...d, pins: d.pins.map((p) => (p.id === pending.id ? { ...p, lat, lng, accuracyM, updatedAt: at } : p)) };
        const request: FieldPin = {
          id: crypto.randomUUID(),
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          lat,
          lng,
          accuracyM,
          type: moving.type,
          note: `New spot for ${moving.name}`,
          status: 'new',
          markerId: null,
          moveStandId: moving.id,
          loggedBy: d.camp?.hunter ?? null,
        };
        return { ...d, pins: [request, ...d.pins] };
      });
      props.onMessage(`New spot for ${moving.name} saved. ${data.camp ? 'It goes to the hub as soon as you have signal, and' : 'Send it from the Send tab; then'} the hub moves it once someone there says OK.`);
    }
    setMoving(null);
  };

  const movedBy = moving && center ? metersBetween([moving.lng, moving.lat], [center.lng, center.lat]) : 0;

  const pickedInfo = picked && fix ? `${yards(metersBetween([fix.lng, fix.lat], [picked.lng, picked.lat]))} ${compassPointOf(bearingDeg(fix, picked))} of you` : null;
  const savedCount = Object.keys(data.offlineMaps ?? {}).length;

  return (
    <div className="field-map" style={visible ? undefined : { display: 'none' }}>
      <div ref={box} className="field-map-canvas" onClick={() => setPicked(null)} />

      <div className="fm-top">
        <div className="fm-bases">
          {PHONE_BASES.map((b) => (
            <button key={b} className={base === b ? 'active' : ''} onClick={() => setPrefs({ base: b })}>
              {BASE_LABELS[b]}
            </button>
          ))}
          {PHONE_CONTOURS && (
            <button className={contours ? 'active' : ''} onClick={() => setContours(!contours)}>
              Contours
            </button>
          )}
        </div>
        <button className={`fm-chip${labels ? ' active' : ''}`} onClick={() => setPrefs({ labels: !labels })}>
          Labels
        </button>
      </div>

      {!online && !SAVED_BASES.includes(base) && (
        <div className="fm-note fm-note-top">{BASE_LABELS[base]} needs signal; it isn't saved on the phone. Switch to {BASE_LABELS[SAVED_BASES[0]]} to see the saved map.</div>
      )}

      <div className="fm-side">
        <button className={`fm-round${follow ? ' active' : ''}`} onClick={findMe} aria-label="Where am I">
          <Icon name="locate" size={22} />
        </button>
        {campMap && campMap.properties.length > 0 && (
          <button className="fm-round" onClick={showAll} aria-label="Show the whole property">
            <Icon name="map" size={22} />
          </button>
        )}
        {tileStoreAvailable && (
          <button className={`fm-round${savedCount ? ' saved' : ''}`} onClick={() => setSheet(true)} aria-label="Offline maps">
            <Icon name="download" size={22} />
          </button>
        )}
      </div>

      {!campMap && !tool && (
        <div className="fm-note">{data.camp ? 'Property lines show here once a partner opens the hub with this version.' : 'Join your camp (Camp tab) to see property lines, sections and pins.'}</div>
      )}

      {picked && !tool && !moving && (
        <div className="fm-card">
          <div>
            <strong>{picked.name}</strong>
            <span className="muted">
              {picked.kind}
              {pickedInfo ? ` · ${pickedInfo}` : ''}
            </span>
          </div>
          <button className="fm-move-button" onClick={() => startMove(picked)}>
            Move
          </button>
          <button className="fm-close" onClick={() => setPicked(null)} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      {moving && (
        <>
          <div className="fm-cross" aria-hidden>
            <span />
          </div>
          <div className="fm-move">
            <strong>Moving {moving.name}</strong>
            <span className="muted">
              {usedGps ? 'At your GPS spot' : 'Drag the map to put the cross on the new spot'}
              {movedBy >= 1 ? ` · ${yards(movedBy)} from where it is` : ''}
            </span>
            {moving.source === 'hub' && <span className="muted">The hub moves it once someone there says OK.</span>}
            <div className="fm-move-buttons">
              <button onClick={() => setMoving(null)}>Cancel</button>
              <button onClick={snapToMe}>Use my spot</button>
              <button className="primary" disabled={movedBy < 1} onClick={saveMove}>
                Save spot
              </button>
            </div>
          </div>
        </>
      )}

      {moving ? null : tool ? (
        <div className="fm-panel">
          <div className="fm-panel-head">
            <span className="fm-grip" />
            <button className="fm-close" onClick={() => setTool(null)} aria-label="Back to the map">
              <Icon name="close" size={18} />
            </button>
          </div>
          {props.gpsError && <p className="field-warn">{props.gpsError}</p>}
          {props.tools[tool]}
        </div>
      ) : (
        <div className="fm-bottom">
          {data.activeWalk && (
            <button className="fm-status" onClick={() => setTool('walk')}>
              <i /> {data.activeWalk.shape === 'area' ? 'Walking area' : 'Walking trail'} · {formatDistance(lineLengthM(data.activeWalk.points))} · tap to stop or see it
            </button>
          )}
          {!data.activeWalk && data.soilRun && (
            <button className="fm-status soil" onClick={() => setTool('soil')}>
              <i /> Soil test · {data.pins.filter((p) => p.soil?.runId === data.soilRun?.id).length} cores · tap to add a core
            </button>
          )}
          <div className="fm-actions">
            <button onClick={() => setTool('pin')}>
              <Icon name="pin" size={22} />
              Drop pin
            </button>
            <button className={data.activeWalk ? 'active' : ''} onClick={() => setTool('walk')}>
              <Icon name="track" size={22} />
              {data.activeWalk ? 'Walking' : 'Walk area'}
            </button>
            <button className={data.soilRun ? 'active' : ''} onClick={() => setTool('soil')}>
              <Icon name="rock" size={22} />
              Soil test
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <div className="fm-sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="fm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="fm-sheet-head">
              <h2>Offline maps</h2>
              <button className="fm-close" onClick={() => setSheet(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="hint">
              Save a property and its topo map works with no signal, ¼ mile past the line. Satellite needs signal. Your GPS dot works without
              signal too.
            </p>
            {plans.length === 0 && <p className="hint">No properties from the hub yet.</p>}
            {plans.map(({ property, plan }) => {
              const saved = data.offlineMaps?.[property.id];
              const busy = saving?.id === property.id;
              return (
                <div key={property.id} className="fm-offline-row">
                  <div>
                    <strong>{property.name}</strong>
                    <span className="muted">
                      {busy
                        ? `Saving… ${Math.round((saving.done / Math.max(1, saving.total)) * 100)}%`
                        : saved
                          ? `Saved ${new Date(saved.savedAt).toLocaleDateString()}${saved.failed ? ` · ${saved.failed} missing` : ''}${saved.layers !== PHONE_LAYERS ? ' · save again for new maps' : ''}`
                          : plan.tooBig
                            ? 'Too big to save on a phone'
                            : `About ${Math.max(1, Math.round(plan.estimatedMb))} MB`}
                    </span>
                  </div>
                  {busy ? (
                    <button onClick={() => abort.current?.abort()}>Stop</button>
                  ) : (
                    <button className="primary" disabled={!!saving || plan.tooBig} onClick={() => void save(property.id)}>
                      {saved ? 'Update' : 'Save'}
                    </button>
                  )}
                </div>
              );
            })}
            <div className="fm-sheet-foot">
              <span className="muted">{usedMb !== null ? `Using about ${Math.round(usedMb)} MB on this phone` : ''}</span>
              {savedCount > 0 && <button onClick={() => void removeAll()}>Remove saved maps</button>}
            </div>
            <p className="hint">On iPhone, add this page to your Home Screen so Safari keeps the saved maps.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapTab;
