// Downloads the map tiles for one property (plus a small buffer) into the
// desktop app's tile cache, so the property works with no internet.
// Only property-sized areas: there's a hard cap, and no free-form boxes.
import { boundsOf } from '@/lib/geo';
import {
  contourTiles,
  lidarStyleTiles,
  normalizeTileUrl,
  SATELLITE_TILE_URL,
  TOPO_TILE_URL,
  type MapLayersState,
} from '@/map/layers';
import type { AreaGeometry } from '@/types/models';

// About a quarter mile around the property line.
const BUFFER_M = 400;
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

// Zooms match what the map asks for: 256 px imagery up to 16 (the USGS
// limit), 512 px lidar tiles one level lower than the map zoom, up to 17.
function layerPlans(layers: MapLayersState): LayerPlan[] {
  const strip = (url: string) => url.replace(/^retry:\/\//, '');
  const plans: LayerPlan[] = [
    { label: 'Satellite', template: SATELLITE_TILE_URL, minZoom: 11, maxZoom: 16, kbPerTile: 30 },
    { label: 'Topo', template: TOPO_TILE_URL, minZoom: 11, maxZoom: 16, kbPerTile: 25 },
    { label: 'Lidar', template: strip(lidarStyleTiles(layers.lidarStyle)[0]), minZoom: 10, maxZoom: 17, kbPerTile: 120 },
  ];
  const contours = contourTiles(layers.contours);
  if (contours) plans.push({ label: 'Contours', template: strip(contours[0]), minZoom: 12, maxZoom: 17, kbPerTile: 15 });
  return plans;
}

const toMercX = (lng: number) => (lng * EARTH_HALF) / 180;
const toMercY = (lat: number) => Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * (EARTH_HALF / Math.PI);

function tileRange(bbox: [number, number, number, number], z: number) {
  const size = (2 * EARTH_HALF) / 2 ** z;
  const [w, s, e, n] = bbox;
  const x0 = Math.floor((toMercX(w) + EARTH_HALF) / size);
  const x1 = Math.floor((toMercX(e) + EARTH_HALF) / size);
  const y0 = Math.floor((EARTH_HALF - toMercY(n)) / size);
  const y1 = Math.floor((EARTH_HALF - toMercY(s)) / size);
  return { x0, x1, y0, y1, size };
}

function tileUrl(template: string, z: number, x: number, y: number, size: number): string {
  const minX = -EARTH_HALF + x * size;
  const maxY = EARTH_HALF - y * size;
  const bbox = `${minX},${maxY - size},${minX + size},${maxY}`;
  return normalizeTileUrl(
    template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{bbox-epsg-3857}', bbox),
  );
}

// The property's bounding box grown by the buffer, as [west, south, east, north].
function bufferedBounds(boundary: AreaGeometry): [number, number, number, number] {
  const [w, s, e, n] = boundsOf(boundary);
  const dLat = BUFFER_M / 111_320;
  const dLng = BUFFER_M / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [w - dLng, s - dLat, e + dLng, n + dLat];
}

export interface DownloadPlan {
  urls: string[];
  estimatedMb: number;
  byLayer: { label: string; tiles: number }[];
  tooBig: boolean;
}

export function planDownload(boundary: AreaGeometry, layers: MapLayersState): DownloadPlan {
  const bbox = bufferedBounds(boundary);
  const urls: string[] = [];
  const byLayer: DownloadPlan['byLayer'] = [];
  let kb = 0;
  for (const plan of layerPlans(layers)) {
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
}

// Fetches every tile into the desktop cache. Tiles already saved are skipped
// quickly. Stops early when `signal` aborts.
export async function runDownload(
  plan: DownloadPlan,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<DownloadProgress> {
  const hub = window.hub;
  if (!hub) throw new Error('Offline maps need the desktop app.');
  const progress: DownloadProgress = { done: 0, total: plan.urls.length, failed: 0 };
  let next = 0;

  const worker = async () => {
    while (next < plan.urls.length && !signal.aborted) {
      const url = plan.urls[next++];
      let ok = false;
      for (let attempt = 0; attempt < RETRIES && !ok && !signal.aborted; attempt++) {
        try {
          await hub.getTile(url);
          ok = true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      if (!ok) progress.failed += 1;
      progress.done += 1;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return progress;
}
