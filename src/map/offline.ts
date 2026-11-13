// Downloads the map tiles for one property (plus a small buffer) into the
// desktop app's tile cache, so the property works with no internet.
// Only property-sized areas: there's a hard cap, and no free-form boxes.
import { boundsOf } from '@/lib/geo';
import {
  AERIAL_MIN_ZOOM,
  AERIAL_TILE_URL,
  contourTiles,
  lidarStyleTiles,
  MISSOURI_BOUNDS,
  MO_AERIAL_MAX_ZOOM,
  MO_AERIAL_TILE_URL,
  normalizeTileUrl,
  SATELLITE_TILE_URL,
  TERRAIN_TILE_URL,
  TOPO_TILE_URL,
  type MapLayersState,
} from '@/map/layers';
import type { AreaGeometry } from '@/types/models';

// How far around the property line maps are saved: a quarter or half mile.
export const OFFLINE_RADII = [
  { meters: 400, label: '¼ mile' },
  { meters: 800, label: '½ mile' },
] as const;
export const DEFAULT_OFFLINE_RADIUS_M = 400;
export const MAX_DOWNLOAD_TILES = 5000;
const CONCURRENCY = 4;
const RETRIES = 3;
const EARTH_HALF = 20037508.342789244;

interface LayerPlan {
  label: string;
  template: string;
  minZoom: number;
  maxZoom: number;
  // Rough average tile size, for the estimate only.
  kbPerTile: number;
}

// Zooms match what the map asks for, all the way in: 256 px imagery up to 16 (the
// USGS limit), 512 px close-up aerial and lidar tiles one level lower than the map
// zoom, up to 18 (map zoom 19, the closest it goes). 3D terrain is always saved,
// so turning 3D on near a property is quick too.
function layerPlans(layers: MapLayersState, bbox: [number, number, number, number]): LayerPlan[] {
  const strip = (url: string) => url.replace(/^retry:\/\//, '');
  const plans: LayerPlan[] = [
    { label: 'Satellite', template: SATELLITE_TILE_URL, minZoom: 11, maxZoom: 16, kbPerTile: 30 },
    { label: 'Satellite close-up', template: AERIAL_TILE_URL, minZoom: AERIAL_MIN_ZOOM - 1, maxZoom: 18, kbPerTile: 70 },
    { label: 'Topo', template: TOPO_TILE_URL, minZoom: 11, maxZoom: 16, kbPerTile: 25 },
    { label: 'Lidar', template: strip(lidarStyleTiles(layers.lidarStyle)[0]), minZoom: 10, maxZoom: 18, kbPerTile: 120 },
    { label: '3D terrain', template: TERRAIN_TILE_URL, minZoom: 10, maxZoom: 15, kbPerTile: 260 },
  ];
  // Missouri's 6 inch photos, for a property in (or touching) Missouri. The map only
  // shows them where they've been downloaded, so this is the one way they arrive.
  const [w, s, e, n] = bbox;
  const [mw, ms, me, mn] = MISSOURI_BOUNDS;
  if (w < me && e > mw && s < mn && n > ms) {
    plans.push({ label: 'Missouri 6 inch close-up', template: MO_AERIAL_TILE_URL, minZoom: AERIAL_MIN_ZOOM - 1, maxZoom: MO_AERIAL_MAX_ZOOM, kbPerTile: 60 });
  }
  // The plain tile; colors are drawn when it's shown.
  const contours = contourTiles(layers.contours);
  if (contours) plans.push({ label: 'Contours', template: strip(contours[0]), minZoom: 12, maxZoom: 18, kbPerTile: 15 });
  return plans;
}

const toMercX = (lng: number) => (lng * EARTH_HALF) / 180;
const toMercY = (lat: number) => Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * (EARTH_HALF / Math.PI);

export function tileRange(bbox: [number, number, number, number], z: number) {
  const size = (2 * EARTH_HALF) / 2 ** z;
  const [w, s, e, n] = bbox;
  const x0 = Math.floor((toMercX(w) + EARTH_HALF) / size);
  const x1 = Math.floor((toMercX(e) + EARTH_HALF) / size);
  const y0 = Math.floor((EARTH_HALF - toMercY(n)) / size);
  const y1 = Math.floor((EARTH_HALF - toMercY(s)) / size);
  return { x0, x1, y0, y1, size };
}

export function tileUrl(template: string, z: number, x: number, y: number, size: number): string {
  const minX = -EARTH_HALF + x * size;
  const maxY = EARTH_HALF - y * size;
  const bbox = `${minX},${maxY - size},${minX + size},${maxY}`;
  return normalizeTileUrl(
    template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{bbox-epsg-3857}', bbox),
  );
}

// The property's bounding box grown by the radius, as [west, south, east, north].
function bufferedBounds(boundary: AreaGeometry, radiusM: number): [number, number, number, number] {
  const [w, s, e, n] = boundsOf(boundary);
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [w - dLng, s - dLat, e + dLng, n + dLat];
}

export interface DownloadPlan {
  urls: string[];
  estimatedMb: number;
  byLayer: { label: string; tiles: number }[];
  tooBig: boolean;
}

// `skip` leaves out layers by label (the phone has no 3D terrain).
export function planDownload(boundary: AreaGeometry, layers: MapLayersState, radiusM: number = DEFAULT_OFFLINE_RADIUS_M, skip: string[] = []): DownloadPlan {
  const bbox = bufferedBounds(boundary, radiusM);
  const urls: string[] = [];
  const byLayer: DownloadPlan['byLayer'] = [];
  let kb = 0;
  for (const plan of layerPlans(layers, bbox).filter((p) => !skip.includes(p.label))) {
    let tiles = 0;
    for (let z = plan.minZoom; z <= plan.maxZoom; z++) {
      const { x0, x1, y0, y1, size } = tileRange(bbox, z);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          urls.push(tileUrl(plan.template, z, x, y, size));
          tiles += 1;
        }
      }
    }
    kb += tiles * plan.kbPerTile;
    byLayer.push({ label: plan.label, tiles });
  }
  return { urls, estimatedMb: kb / 1024, byLayer, tooBig: urls.length > MAX_DOWNLOAD_TILES };
}

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
  // Tiles that had to be fetched (the rest were already saved).
  fetched?: number;
}

// Fetches every tile into the desktop cache. Tiles already saved are skipped
// quickly. Stops early when `signal` aborts. The background download uses
// fewer at a time, so the map in front stays quick.
export async function runDownload(
  plan: Pick<DownloadPlan, 'urls'>,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
  concurrency = CONCURRENCY,
  // Saves one tile somewhere other than the desktop's disk (the phone page).
  save?: (url: string) => Promise<{ cached: boolean }>,
): Promise<DownloadProgress> {
  const hub = window.hub;
  const saveTile = save ?? (hub ? (url: string) => hub.getTile(url, { saveOnly: true }) : null);
  if (!saveTile) throw new Error('Offline maps need the desktop app.');
  const progress: DownloadProgress = { done: 0, total: plan.urls.length, failed: 0, fetched: 0 };
  let next = 0;

  const worker = async () => {
    while (next < plan.urls.length && !signal.aborted) {
      const url = plan.urls[next++];
      let ok = false;
      for (let attempt = 0; attempt < RETRIES && !ok && !signal.aborted; attempt++) {
        try {
          const tile = await saveTile(url);
          if (!tile.cached) progress.fetched = (progress.fetched ?? 0) + 1;
          ok = true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      if (!ok && !signal.aborted) progress.failed += 1;
      progress.done += 1;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return progress;
}
