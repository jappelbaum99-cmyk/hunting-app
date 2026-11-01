// Free USGS map sources (public domain, no account or key).
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
// MapLibre finds its worker relative to its own file, which breaks once Vite
// bundles it, so hand it the worker's real URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export type BaseMapId = 'satellite' | 'topo' | 'lidar';
export type LidarStyleId = 'stretch' | 'multidirectional' | 'tinted' | 'slope';
export type ContourInterval = 'off' | '10' | '5' | '2';

export interface MapLayersState {
  base: BaseMapId;
  lidarStyle: LidarStyleId;
  // Lidar shading blended over satellite/topo, 0-1. The lidar base map ignores it.
  lidarBlend: number;
  contours: ContourInterval;
}

export const DEFAULT_LAYERS: MapLayersState = {
  base: 'satellite',
  lidarStyle: 'stretch',
  lidarBlend: 0,
  contours: 'off',
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
const ATTRIBUTION = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';

// The USGS elevation server often answers 502/504 under load, so every USGS
// tile goes through this protocol, which retries a few times before giving up.
// Those error pages carry no CORS header, so the browser reports them as a
// network failure (TypeError) rather than a response; both cases are retried.
const RETRY_PROTOCOL = 'retry';
const RETRY_DELAYS_MS = [800, 2000, 4000, 8000];

async function fetchImage(url: string, signal: AbortSignal): Promise<ArrayBuffer | string> {
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

let setUp = false;

export function setUpMapLibre(): void {
  if (setUp) return;
  setUp = true;
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.addProtocol(RETRY_PROTOCOL, async (params, abortController) => {
    const url = params.url.slice(`${RETRY_PROTOCOL}://`.length);
    for (let attempt = 0; ; attempt++) {
      const result = await fetchImage(url, abortController.signal);
      if (typeof result !== 'string') return { data: result };
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`USGS tile failed (${result}): ${url}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      abortController.signal.throwIfAborted();
    }
  });
}

function elevationTiles(rasterFunction: string): string[] {
  const rule = encodeURIComponent(JSON.stringify({ rasterFunction }));
  return [
    `${RETRY_PROTOCOL}://${ELEVATION_EXPORT}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png&f=image&renderingRule=${rule}`,
  ];
}

export function lidarStyleTiles(id: LidarStyleId): string[] {
  return elevationTiles(LIDAR_STYLES.find((s) => s.id === id)!.rasterFunction);
}

export function contourTiles(id: ContourInterval): string[] | null {
  const fn = CONTOUR_OPTIONS.find((c) => c.id === id)?.rasterFunction;
  return fn ? elevationTiles(fn) : null;
}

export const LAYER_IDS = {
  satellite: 'base-satellite',
  topo: 'base-topo',
  lidar: 'base-lidar',
  lidarBlend: 'overlay-lidar',
  contours: 'overlay-contours',
} as const;

export function buildBaseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [`${RETRY_PROTOCOL}://${BASEMAP_TILES}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 16,
        attribution: ATTRIBUTION,
      },
      topo: {
        type: 'raster',
        tiles: [`${RETRY_PROTOCOL}://${BASEMAP_TILES}/USGSTopo/MapServer/tile/{z}/{y}/{x}`],
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
      { id: LAYER_IDS.satellite, type: 'raster', source: 'satellite' },
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
