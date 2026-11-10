// Ground elevation for thermals, from the same USGS lidar tiles 3D terrain
// uses (zoom 15, about 4 m a pixel). On the desktop they come from the saved
// copies when a property's maps are saved, so this works offline too.
import { fetchTileBytes, TERRAIN_TILE_URL } from '@/map/layers';
import { tileUrl } from '@/map/offline';
import { readElevationTiff } from '@/map/terrain';
import type { ElevationAt } from '@/lib/thermals';

const ZOOM = 15;
const EARTH_HALF = 20037508.342789244;
const TILE_M = (EARTH_HALF * 2) / 2 ** ZOOM;
// Gaps and the server's "no data" value.
const NO_DATA = -1000;

interface Grid {
  width: number;
  height: number;
  meters: Float32Array;
}

const grids = new Map<string, Grid | 'failed'>();
const loading = new Map<string, Promise<void>>();

const mercX = (lng: number) => (lng * EARTH_HALF) / 180;
const mercY = (lat: number) => Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * (EARTH_HALF / Math.PI);
// Tile column/row and the position inside it (0-1 from the top-left).
function locate(lng: number, lat: number) {
  const fx = (mercX(lng) + EARTH_HALF) / TILE_M;
  const fy = (EARTH_HALF - mercY(lat)) / TILE_M;
  return { x: Math.floor(fx), y: Math.floor(fy), u: fx - Math.floor(fx), v: fy - Math.floor(fy) };
}

function loadTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (grids.has(key)) return Promise.resolve();
  let pending = loading.get(key);
  if (!pending) {
    pending = fetchTileBytes(tileUrl(TERRAIN_TILE_URL, ZOOM, x, y, TILE_M))
      .then((bytes) => {
        grids.set(key, readElevationTiff(bytes));
      })
      .catch(() => {
        // The busy USGS server; tried again next time it's asked for.
        grids.delete(key);
      })
      .finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
}

// Loads the tiles covering `radiusM` around each point. Resolves when done
// (some may have failed; elevationAt then answers null there).
export async function loadElevationAround(points: [number, number][], radiusM: number): Promise<void> {
  const wanted = new Set<string>();
  for (const [lng, lat] of points) {
    const dLat = radiusM / 110_540;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const a = locate(lng - dLng, lat + dLat);
    const b = locate(lng + dLng, lat - dLat);
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) wanted.add(`${x}/${y}`);
  }
  await Promise.all([...wanted].map((key) => {
    const [x, y] = key.split('/').map(Number);
    return loadTile(x, y);
  }));
}

// Whether every tile around these points is already loaded.
export function elevationReady(points: [number, number][], radiusM: number): boolean {
  for (const [lng, lat] of points) {
    const dLat = radiusM / 110_540;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const a = locate(lng - dLng, lat + dLat);
    const b = locate(lng + dLng, lat - dLat);
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) if (!grids.has(`${x}/${y}`)) return false;
  }
  return true;
}

function pixel(x: number, y: number, px: number, py: number): number | null {
  // Pixels past an edge come from the neighboring tile.
  let tx = x;
  let ty = y;
  let ix = px;
  let iy = py;
  const grid0 = grids.get(`${tx}/${ty}`);
  if (!grid0 || grid0 === 'failed') return null;
  if (ix >= grid0.width) {
    tx += 1;
    ix -= grid0.width;
  }
  if (iy >= grid0.height) {
    ty += 1;
    iy -= grid0.height;
  }
  const grid = grids.get(`${tx}/${ty}`);
  if (!grid || grid === 'failed') return null;
  const m = grid.meters[iy * grid.width + ix];
  return Number.isFinite(m) && m > NO_DATA ? m : null;
}

// Elevation in meters, smoothly blended between the four nearest lidar pixels.
export const elevationAt: ElevationAt = (lng, lat) => {
  const { x, y, u, v } = locate(lng, lat);
  const grid = grids.get(`${x}/${y}`);
  if (!grid || grid === 'failed') return null;
  // Pixel centers sit half a pixel in.
  const fx = Math.max(0, u * grid.width - 0.5);
  const fy = Math.max(0, v * grid.height - 0.5);
  const px = Math.floor(fx);
  const py = Math.floor(fy);
  const ax = fx - px;
  const ay = fy - py;
  const p00 = pixel(x, y, px, py);
  const p10 = pixel(x, y, px + 1, py);
  const p01 = pixel(x, y, px, py + 1);
  const p11 = pixel(x, y, px + 1, py + 1);
  if (p00 === null || p10 === null || p01 === null || p11 === null) return p00;
  return p00 * (1 - ax) * (1 - ay) + p10 * ax * (1 - ay) + p01 * (1 - ax) * ay + p11 * ax * ay;
};
