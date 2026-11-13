// Free USGS map sources (public domain, no account or key).
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
// MapLibre finds its worker relative to its own file, which breaks once Vite
// bundles it, so hand it the worker's real URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { readElevationTiff, toTerrariumPng } from '@/map/terrain';
import { tintPng } from '@/map/tint';
import { slopePng } from '@/map/slope';

export type BaseMapId = 'satellite' | 'topo' | 'lidar';
export type LidarStyleId = 'stretch' | 'multidirectional' | 'tinted' | 'slope';
export type ContourInterval = 'off' | '10' | '5' | '2';

export interface MapLayersState {
  base: BaseMapId;
  lidarStyle: LidarStyleId;
  // Lidar shading blended over satellite/topo, 0-1. The lidar base map ignores it.
  lidarBlend: number;
  contours: ContourInterval;
  // Slope shading: ground colored by steepness, and how strongly, 0-1.
  slope: boolean;
  slopeOpacity: number;
  // How strongly contour lines show, 0-1.
  contourOpacity: number;
  // Deer sighting arrows from hunt reports.
  sightings: boolean;
  // New spots hunted from (trees, climbers) that aren't stands.
  huntSpots: boolean;
  // Hills and draws in 3D (tilt with right-drag or Ctrl-drag).
  terrain: boolean;
  // How much taller than real the hills are drawn in 3D, 1-3x.
  terrainHeight: number;
}

export const DEFAULT_LAYERS: MapLayersState = {
  base: 'satellite',
  lidarStyle: 'stretch',
  lidarBlend: 0,
  contours: 'off',
  slope: false,
  slopeOpacity: 0.45,
  contourOpacity: 1,
  sightings: false,
  huntSpots: false,
  terrain: false,
  terrainHeight: 1,
};

export const BASE_MAPS: { id: BaseMapId; label: string }[] = [
  { id: 'satellite', label: 'Satellite' },
  { id: 'topo', label: 'Topo' },
  { id: 'lidar', label: 'Lidar' },
];

// Raster functions offered by the USGS 3DEP elevation service. The stretched
// hillshade has the strongest shadows, which shows benches, ditches and old roads best.
export const LIDAR_STYLES: { id: LidarStyleId; label: string; rasterFunction: string }[] = [
  { id: 'stretch', label: 'Hillshade', rasterFunction: 'Hillshade Gray-Stretch' },
  { id: 'multidirectional', label: 'Hillshade (soft)', rasterFunction: 'Hillshade Multidirectional' },
  { id: 'tinted', label: 'Elevation tinted', rasterFunction: 'Hillshade Elevation Tinted' },
  { id: 'slope', label: 'Slope', rasterFunction: 'Slope Map' },
];

export const CONTOUR_OPTIONS: { id: ContourInterval; label: string; rasterFunction: string | null }[] = [
  { id: 'off', label: 'Off', rasterFunction: null },
  { id: '10', label: '10 ft', rasterFunction: 'Preset 10ft Contour Interval' },
  { id: '5', label: '5 ft', rasterFunction: 'Preset 5ft Contour Interval' },
  { id: '2', label: '2 ft', rasterFunction: 'Preset 2ft Contour Interval' },
];

const BASEMAP_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services';
const ELEVATION_EXPORT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
// The USGS satellite tiles stop at zoom 16 (about 2 m a pixel). Closer in, the
// same NAIP aerial photos come from USGS's image server at full detail (60 cm or better).
const AERIAL_EXPORT = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
export const AERIAL_TILE_URL = `${AERIAL_EXPORT}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image`;
// Map zoom where the close-up aerial photos take over from the satellite tiles.
export const AERIAL_MIN_ZOOM = 15;
// They fade in over this much zoom rather than all at once: the two sources can
// be different years and colors, and a hard switch made the map jump.
const AERIAL_BLEND_ZOOMS = 0.8;
// How long a newly loaded tile takes to fade in, in milliseconds.
const TILE_FADE_MS = 250;
// Missouri's own statewide aerial photos (MSDIS, 6 inch, leaf-off 2023-2024): free
// and public, about four times sharper than NAIP. Only tiles saved by a property's
// "Download for offline" are shown, so nothing is pulled from the state's server
// while browsing. "jpgpng" comes back see-through outside Missouri.
const MO_AERIAL_EXPORT = 'https://stateimagery.msdis.missouri.edu/arcgis/rest/services/Missouri_6inch_Statewide_2023_2024_Dynamic/ImageServer/exportImage';
export const MO_AERIAL_TILE_URL = `${MO_AERIAL_EXPORT}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image`;
// West, south, east, north, a little past the state line.
export const MISSOURI_BOUNDS: [number, number, number, number] = [-95.8, 35.95, -89.05, 40.65];
// 512 px tiles: source zoom 18 is about 30 cm a pixel, map zoom 19.
export const MO_AERIAL_MAX_ZOOM = 18;
export const SATELLITE_TILE_URL = `${BASEMAP_TILES}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`;
export const TOPO_TILE_URL = `${BASEMAP_TILES}/USGSTopo/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';

// The USGS elevation server often answers 502/504 under load, so every USGS
// tile goes through this protocol, which retries a few times before giving up.
// Those error pages carry no CORS header, so the browser reports them as a
// network failure (TypeError) rather than a response; both cases are retried.
const RETRY_PROTOCOL = 'retry';
// Same retries, then the float elevation TIFF is re-coded for 3D terrain (src/map/terrain.ts).
const RETRY_DEM_PROTOCOL = 'retry-dem';
// Same retries, then black lines are redrawn in a color: retry-tint://RRGGBB/<url> (contours).
const RETRY_TINT_PROTOCOL = 'retry-tint';
// Same retries, then the elevation TIFF is colored by steepness (src/map/slope.ts).
const RETRY_SLOPE_PROTOCOL = 'retry-slope';
// Kept short: MapLibre loads only so many images at once, saved tiles included,
// so a tile waiting out a busy server holds up tiles that are already on disk.
// One that gives up is tried again later by retryFailedTiles; meanwhile it shows
// the coarser zoom level, stretched.
const RETRY_DELAYS_MS = [800, 2500];
// MapLibre's default is 16. Saved tiles come off the disk, so more at once
// doesn't load the USGS servers any harder (the browser limits connections per server).
const MAX_PARALLEL_IMAGE_REQUESTS = 32;
// Tiles only from the desktop's saved tiles; never fetched. A tile that isn't
// saved is an empty see-through one, so the layer below shows through.
const SAVED_PROTOCOL = 'saved';
// A 1x1 PNG whose one pixel is fully see-through (RGBA 0, 0, 0, 0).
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

// Lidar tiles are requested by bounding box. Rounding the box gives each tile
// one exact URL, so the on-disk cache (and the property download, which
// builds the same URLs itself) always agree on the name.
export function normalizeTileUrl(url: string): string {
  return url.replace(/bbox=([-\d.e,]+)/, (_, box: string) => `bbox=${box.split(',').map((n) => Number(n).toFixed(1)).join(',')}`);
}

// Tiles saved in a plain browser (the phone page's offline maps). The desktop
// app keeps its own on disk instead.
export interface BrowserTileStore {
  get(url: string): Promise<ArrayBuffer | null>;
}
let browserTiles: BrowserTileStore | null = null;

export function setBrowserTileStore(store: BrowserTileStore | null): void {
  browserTiles = store;
}

async function fetchImage(url: string, signal: AbortSignal): Promise<ArrayBuffer | string> {
  if (window.hub) {
    // Desktop app: the main process serves the tile from disk, or fetches and saves it.
    // When the map stops wanting the tile (it moved on), stop waiting right away and
    // cancel the fetch. Otherwise a slow USGS server keeps the map's loading slots
    // busy with tiles nobody will see, and tiles already on disk queue up behind them,
    // showing a blurry stand-in meanwhile.
    const hub = window.hub;
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        void hub.cancelTile(requestId).catch(() => {});
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const tile = await Promise.race([hub.getTile(url, { requestId }), aborted]);
      if (!tile) return 'missing';
      return tile.bytes.buffer.slice(tile.bytes.byteOffset, tile.bytes.byteOffset + tile.bytes.byteLength) as ArrayBuffer;
    } catch (error) {
      if (signal.aborted) throw error;
      return String(error);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
  const saved = browserTiles ? await browserTiles.get(url).catch(() => null) : null;
  if (saved) return saved;
  try {
    const response = await fetch(url, { signal });
    const isImage = response.headers.get('content-type')?.startsWith('image/');
    if (response.ok && isImage) return await response.arrayBuffer();
    return `HTTP ${response.status}`;
  } catch (error) {
    if (signal.aborted) throw error;
    return String(error);
  }
}

// A USGS tile's bytes with the same short retries the map uses (and, on the
// desktop, the same saved copy on disk). Used for elevation outside the map.
export async function fetchTileBytes(url: string, signal: AbortSignal = new AbortController().signal): Promise<ArrayBuffer> {
  const normalized = normalizeTileUrl(url);
  for (let attempt = 0; ; attempt++) {
    const result = await fetchImage(normalized, signal);
    if (typeof result !== 'string') return result;
    if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`USGS tile failed (${result}): ${normalized}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    signal.throwIfAborted();
  }
}

let setUp = false;

export function setUpMapLibre(): void {
  if (setUp) return;
  setUp = true;
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.setMaxParallelImageRequests(MAX_PARALLEL_IMAGE_REQUESTS);
  const withRetries = async (url: string, signal: AbortSignal): Promise<ArrayBuffer> => {
    for (let attempt = 0; ; attempt++) {
      const result = await fetchImage(url, signal);
      if (typeof result !== 'string') return result;
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`USGS tile failed (${result}): ${url}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      signal.throwIfAborted();
    }
  };
  maplibregl.addProtocol(RETRY_PROTOCOL, async (params, abortController) => ({
    data: await withRetries(normalizeTileUrl(params.url.slice(`${RETRY_PROTOCOL}://`.length)), abortController.signal),
  }));
  maplibregl.addProtocol(RETRY_DEM_PROTOCOL, async (params, abortController) => {
    const tiff = await withRetries(normalizeTileUrl(params.url.slice(`${RETRY_DEM_PROTOCOL}://`.length)), abortController.signal);
    return { data: await toTerrariumPng(readElevationTiff(tiff)) };
  });
  maplibregl.addProtocol(RETRY_SLOPE_PROTOCOL, async (params, abortController) => {
    const url = normalizeTileUrl(params.url.slice(`${RETRY_SLOPE_PROTOCOL}://`.length));
    const tiff = await withRetries(url, abortController.signal);
    return { data: await slopePng(readElevationTiff(tiff), url) };
  });
  maplibregl.addProtocol(RETRY_TINT_PROTOCOL, async (params, abortController) => {
    const rest = params.url.slice(`${RETRY_TINT_PROTOCOL}://`.length);
    const slash = rest.indexOf('/');
    const png = await withRetries(normalizeTileUrl(rest.slice(slash + 1)), abortController.signal);
    return { data: await tintPng(png, `#${rest.slice(0, slash)}`) };
  });
  maplibregl.addProtocol(SAVED_PROTOCOL, async (params) => {
    const url = normalizeTileUrl(params.url.slice(`${SAVED_PROTOCOL}://`.length));
    if (!window.hub && browserTiles) {
      const saved = await browserTiles.get(url).catch(() => null);
      return { data: saved ?? (EMPTY_PNG.buffer.slice(0) as ArrayBuffer) };
    }
    const tile = window.hub ? await window.hub.getTile(url, { cacheOnly: true }).catch(() => null) : null;
    const bytes = tile ? tile.bytes : EMPTY_PNG;
    return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  });
}

// After a tile gives up, MapLibre keeps showing the coarser stand-in until the
// zoom changes, so a busy spell on the USGS server leaves a blurry square on the
// lidar. Try each failed tile again, further apart each time, for as long as the
// map is open; a tile that's been fine for a while starts over at the short wait.
// (A tile off screen when its turn comes is skipped; it loads fresh when it's back.)
const TILE_RETRY_ROUNDS_MS = [3_000, 8_000, 15_000, 30_000, 60_000, 120_000];
const TILE_RETRY_RESET_MS = 10 * 60_000;

export function retryFailedTiles(map: maplibregl.Map): void {
  const tries = new Map<string, { round: number; at: number }>();
  type TileError = { sourceId?: string; tile?: { tileID?: { canonical?: { x: number; y: number; z: number } } } };
  map.on('error', (event) => {
    const { sourceId, tile: failed } = event as unknown as TileError;
    const tile = failed?.tileID?.canonical;
    if (!sourceId || !tile) return;
    const key = `${sourceId}/${tile.z}/${tile.x}/${tile.y}`;
    const now = Date.now();
    const last = tries.get(key);
    const round = last && now - last.at < TILE_RETRY_RESET_MS ? last.round + 1 : 0;
    tries.set(key, { round, at: now });
    setTimeout(() => {
      // The source may be gone (lidar style changed) or the map closed.
      if (!map.getStyle() || !map.getSource(sourceId)) return;
      try {
        map.refreshTiles(sourceId, [{ x: tile.x, y: tile.y, z: tile.z }]);
      } catch {
        // Nothing to refresh.
      }
    }, TILE_RETRY_ROUNDS_MS[Math.min(round, TILE_RETRY_ROUNDS_MS.length - 1)]);
  });
}

function elevationTiles(rasterFunction: string): string[] {
  const rule = encodeURIComponent(JSON.stringify({ rasterFunction }));
  return [
    `${RETRY_PROTOCOL}://${ELEVATION_EXPORT}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png&f=image&renderingRule=${rule}`,
  ];
}

// Bare-earth elevation in meters as float TIFFs, for 3D terrain.
export const TERRAIN_TILE_URL = `${ELEVATION_EXPORT}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=tiff&pixelType=F32&compression=None&interpolation=RSP_BilinearInterpolation&f=image`;

export function lidarStyleTiles(id: LidarStyleId): string[] {
  return elevationTiles(LIDAR_STYLES.find((s) => s.id === id)!.rasterFunction);
}

// Contour line colors offered in Choose map; null is the original look
// (black, lightened over satellite). Any other color can be picked too.
export const CONTOUR_COLORS: { label: string; color: string }[] = [
  { label: 'White', color: '#ffffff' },
  { label: 'Black', color: '#000000' },
  { label: 'Brown', color: '#8b5a2b' },
];

// Contour tiles, recolored when a color is given. The saved copy on disk is the
// same tile either way, so offline maps work in any color.
export function contourTiles(id: ContourInterval, color: string | null = null): string[] | null {
  const fn = CONTOUR_OPTIONS.find((c) => c.id === id)?.rasterFunction;
  if (!fn) return null;
  const tiles = elevationTiles(fn);
  return color ? tiles.map((url) => url.replace(`${RETRY_PROTOCOL}://`, `${RETRY_TINT_PROTOCOL}://${color.replace('#', '')}/`)) : tiles;
}

export const LAYER_IDS = {
  satellite: 'base-satellite',
  aerial: 'base-aerial',
  aerialMo: 'base-aerial-mo',
  topo: 'base-topo',
  lidar: 'base-lidar',
  lidarBlend: 'overlay-lidar',
  contours: 'overlay-contours',
  slope: 'overlay-slope',
} as const;

export function buildBaseStyle(): StyleSpecification {
  return {
    version: 8,
    // Tilted, the far-off ground can only get rough tiles (sharp ones all the way to
    // the horizon would be hundreds of downloads), so it fades into a light haze
    // and sky instead of looking smeared. Flat on, none of this shows.
    sky: {
      'sky-color': '#9dbad6',
      'horizon-color': '#dde4e6',
      'fog-color': '#dde4e6',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.4,
      'fog-ground-blend': 0.75,
      'atmosphere-blend': 0,
    },
    sources: {
      satellite: {
        type: 'raster',
        tiles: [`${RETRY_PROTOCOL}://${SATELLITE_TILE_URL}`],
        tileSize: 256,
        maxzoom: 16,
        attribution: ATTRIBUTION,
      },
      // 512 px tiles, so source zoom 14 is map zoom 15.
      aerial: {
        type: 'raster',
        tiles: [`${RETRY_PROTOCOL}://${AERIAL_TILE_URL}`],
        tileSize: 512,
        minzoom: AERIAL_MIN_ZOOM - 1,
        maxzoom: 18,
        attribution: `${ATTRIBUTION} NAIP`,
      },
      aerialMo: {
        type: 'raster',
        tiles: [`${SAVED_PROTOCOL}://${MO_AERIAL_TILE_URL}`],
        tileSize: 512,
        minzoom: AERIAL_MIN_ZOOM - 1,
        maxzoom: MO_AERIAL_MAX_ZOOM,
        bounds: MISSOURI_BOUNDS,
        attribution: '<a href="https://msdis.missouri.edu">MSDIS</a> Missouri 6 inch',
      },
      topo: {
        type: 'raster',
        tiles: [`${RETRY_PROTOCOL}://${TOPO_TILE_URL}`],
        tileSize: 256,
        maxzoom: 16,
        attribution: ATTRIBUTION,
      },
      lidar: {
        type: 'raster',
        tiles: lidarStyleTiles(DEFAULT_LAYERS.lidarStyle),
        tileSize: 512,
        minzoom: 8,
        maxzoom: 18,
        attribution: `${ATTRIBUTION} 3DEP lidar`,
      },
      terrain: {
        type: 'raster-dem',
        tiles: [`${RETRY_DEM_PROTOCOL}://${TERRAIN_TILE_URL}`],
        tileSize: 256,
        encoding: 'terrarium',
        minzoom: 8,
        maxzoom: 15,
        attribution: `${ATTRIBUTION} 3DEP lidar`,
      },
      // Steepness colors from the same elevation tiles as 3D terrain; past
      // zoom 15 the zoom-15 tiles are stretched (about 4 m a pixel).
      slope: {
        type: 'raster',
        tiles: [`${RETRY_SLOPE_PROTOCOL}://${TERRAIN_TILE_URL}`],
        tileSize: 256,
        minzoom: 11,
        maxzoom: 15,
        attribution: `${ATTRIBUTION} 3DEP lidar`,
      },
      contours: {
        type: 'raster',
        tiles: contourTiles('10')!,
        tileSize: 512,
        minzoom: 12,
        maxzoom: 18,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1d221d' } },
      { id: LAYER_IDS.satellite, type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': TILE_FADE_MS } },
      {
        id: LAYER_IDS.aerial,
        type: 'raster',
        source: 'aerial',
        minzoom: AERIAL_MIN_ZOOM,
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], AERIAL_MIN_ZOOM, 0, AERIAL_MIN_ZOOM + AERIAL_BLEND_ZOOMS, 1],
          'raster-fade-duration': TILE_FADE_MS,
        },
      },
      // On top of NAIP where a Missouri property was downloaded; see-through elsewhere.
      {
        id: LAYER_IDS.aerialMo,
        type: 'raster',
        source: 'aerialMo',
        minzoom: AERIAL_MIN_ZOOM,
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], AERIAL_MIN_ZOOM, 0, AERIAL_MIN_ZOOM + AERIAL_BLEND_ZOOMS, 1],
          'raster-fade-duration': TILE_FADE_MS,
        },
      },
      { id: LAYER_IDS.topo, type: 'raster', source: 'topo', layout: { visibility: 'none' } },
      {
        id: LAYER_IDS.lidar,
        type: 'raster',
        source: 'lidar',
        layout: { visibility: 'none' },
      },
      {
        id: LAYER_IDS.lidarBlend,
        type: 'raster',
        source: 'lidar',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.5 },
      },
      // Under the contours, so lines stay readable over the colors.
      {
        id: LAYER_IDS.slope,
        type: 'raster',
        source: 'slope',
        minzoom: 11,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.45, 'raster-resampling': 'linear', 'raster-fade-duration': TILE_FADE_MS },
      },
      {
        id: LAYER_IDS.contours,
        type: 'raster',
        source: 'contours',
        minzoom: 12,
        layout: { visibility: 'none' },
      },
    ],
  };
}
