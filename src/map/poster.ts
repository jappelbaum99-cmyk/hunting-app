// Printed maps: draws a framed piece of the map at poster size on a plain 2D
// canvas, straight from the map tiles (the same free USGS tiles the map uses,
// read from the desktop's saved tiles when they're there), then the property
// lines, areas, trails, pins and labels, a title, north arrow and scale bar.
// No WebGL, so the image can be far bigger than the screen.
import type { Position } from 'geojson';

import { boundsOf } from '@/lib/geo';
import { iconSvg, type IconName } from '@/lib/icons';
import { areaTypeInfo, dashFor, markerStyle, outlineLook, propertyColor } from '@/lib/styles';
import { lineMidpoint, trailParts, trailStyle } from '@/lib/trails';
import {
  AERIAL_MIN_ZOOM,
  AERIAL_TILE_URL,
  contourTiles,
  lidarStyleTiles,
  MISSOURI_BOUNDS,
  MO_AERIAL_MAX_ZOOM,
  MO_AERIAL_TILE_URL,
  SATELLITE_TILE_URL,
  TOPO_TILE_URL,
} from '@/map/layers';
import { tileUrl } from '@/map/offline';
import type { AreaGeometry, HubSettings, MapArea, MapMarker, MapTrail, OutlineLook, PosterLabelKind, PosterSettings, Property, Section } from '@/types/models';

const EARTH_HALF = 20037508.342789244;
const BACKGROUND = '#1d221d';

export const POSTER_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: '11x17', label: '11 × 17 in', w: 11, h: 17 },
  { id: '18x24', label: '18 × 24 in', w: 18, h: 24 },
  { id: '24x36', label: '24 × 36 in', w: 24, h: 36 },
  { id: '36x48', label: '36 × 48 in', w: 36, h: 48 },
];
export const POSTER_DPIS = [150, 200, 300];
// Canvas limits: Chrome won't make a side over 32,767 px, and a huge one runs out of memory.
export const MAX_POSTER_SIDE = 32_000;
export const MAX_POSTER_PIXELS = 200_000_000;
// Tiles fetched for one poster: a property-sized area, not a county.
export const MAX_POSTER_TILES = 4000;

export const DEFAULT_POSTER: PosterSettings = {
  size: '24x36',
  widthIn: 24,
  heightIn: 36,
  landscape: true,
  dpi: 200,
  format: 'jpg',
  base: 'satellite',
  photos: 'leafOff',
  lidarStyle: 'stretch',
  lidarBlend: 0,
  contours: 'off',
  show: { properties: true, sections: false, areas: true, trails: true, pins: true },
  labels: { property: true, section: false, area: true, trail: false, pin: true },
  textScale: 2.5,
  featureScale: 2.5,
  lineScale: 2.5,
  title: '',
  subtitle: '',
  northArrow: true,
  scaleBar: true,
  center: null,
  metersPerInch: null,
  labelAt: {},
  hiddenLabelIds: [],
  hiddenIds: [],
};

// Paper as it's laid out: width and height in inches.
export function paperSize(p: PosterSettings): { w: number; h: number } {
  const short = Math.min(p.widthIn, p.heightIn);
  const long = Math.max(p.widthIn, p.heightIn);
  return p.landscape ? { w: long, h: short } : { w: short, h: long };
}

export const mercX = (lng: number) => (lng * EARTH_HALF) / 180;
export const mercY = (lat: number) => Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * (EARTH_HALF / Math.PI);
export const toLng = (x: number) => (x / EARTH_HALF) * 180;
export const toLat = (y: number) => ((2 * Math.atan(Math.exp((y / EARTH_HALF) * Math.PI)) - Math.PI / 2) * 180) / Math.PI;

// Ground meters per web mercator meter where the poster is (mercator stretches toward the poles).
export const groundScale = (centerY: number) => Math.cos((toLat(centerY) * Math.PI) / 180);

// Where the poster's frame sits: in mercator meters, and pixels per mercator meter on the canvas.
export interface Frame {
  minX: number;
  maxY: number;
  // Mercator meters per canvas pixel.
  mpp: number;
  width: number;
  height: number;
  // Canvas pixels per inch of paper, which sets the size of text and lines.
  pxPerInch: number;
}

export function frameFor(center: [number, number], metersPerInch: number, paper: { w: number; h: number }, pxPerInch: number): Frame {
  const mpp = metersPerInch / pxPerInch;
  const width = Math.round(paper.w * pxPerInch);
  const height = Math.round(paper.h * pxPerInch);
  return { minX: center[0] - (width * mpp) / 2, maxY: center[1] + (height * mpp) / 2, mpp, width, height, pxPerInch };
}

export const toPx = (f: Frame, lng: number, lat: number): [number, number] => [(mercX(lng) - f.minX) / f.mpp, (f.maxY - mercY(lat)) / f.mpp];
export const fromPx = (f: Frame, x: number, y: number): [number, number] => [toLng(f.minX + x * f.mpp), toLat(f.maxY - y * f.mpp)];

// A frame that fits these bounds ([w, s, e, n]) on the paper with a little room around.
export function fitFrame(bounds: [number, number, number, number], paper: { w: number; h: number }): { center: [number, number]; metersPerInch: number } {
  const [w, s, e, n] = bounds;
  const x0 = mercX(w);
  const x1 = mercX(e);
  const y0 = mercY(s);
  const y1 = mercY(n);
  const metersPerInch = Math.max((x1 - x0) / paper.w, (y1 - y0) / paper.h) * 1.12;
  return { center: [(x0 + x1) / 2, (y0 + y1) / 2], metersPerInch: Math.max(metersPerInch, 1) };
}

// ---------- Tiles ----------

interface TileLayer {
  template: string;
  tileSize: 256 | 512;
  minZoom: number;
  maxZoom: number;
  opacity: number;
  // Only from the desktop's saved tiles (Missouri's photos are never fetched while browsing).
  savedOnly?: boolean;
  // Drawn lightened, like contours over satellite on the map.
  lighten?: boolean;
  bounds?: [number, number, number, number];
}

// The map zoom a canvas of this many mercator meters a pixel matches.
const mapZoomFor = (mpp: number) => Math.log2((2 * EARTH_HALF) / (256 * mpp));

function tileLayers(p: PosterSettings, mpp: number): TileLayer[] {
  const zoom = mapZoomFor(mpp);
  const layers: TileLayer[] = [];
  if (p.base === 'satellite') {
    layers.push({ template: SATELLITE_TILE_URL, tileSize: 256, minZoom: 0, maxZoom: 16, opacity: 1 });
    // Closer in than the satellite tiles go, the NAIP aerials, then Missouri's 6 inch photos where saved.
    if (zoom >= AERIAL_MIN_ZOOM) {
      layers.push({ template: AERIAL_TILE_URL, tileSize: 512, minZoom: AERIAL_MIN_ZOOM - 1, maxZoom: 18, opacity: 1 });
      if (window.hub && p.photos !== "leafOn") layers.push({ template: MO_AERIAL_TILE_URL, tileSize: 512, minZoom: AERIAL_MIN_ZOOM - 1, maxZoom: MO_AERIAL_MAX_ZOOM, opacity: 1, savedOnly: true, bounds: MISSOURI_BOUNDS });
    }
  }
  if (p.base === 'topo') layers.push({ template: TOPO_TILE_URL, tileSize: 256, minZoom: 0, maxZoom: 16, opacity: 1 });
  const lidar = lidarStyleTiles(p.lidarStyle)[0].replace(/^retry:\/\//, '');
  if (p.base === 'lidar') layers.push({ template: lidar, tileSize: 512, minZoom: 7, maxZoom: 18, opacity: 1 });
  else if (p.lidarBlend > 0) layers.push({ template: lidar, tileSize: 512, minZoom: 7, maxZoom: 18, opacity: p.lidarBlend });
  const contours = contourTiles(p.contours);
  if (contours && zoom >= 12) layers.push({ template: contours[0].replace(/^retry:\/\//, ''), tileSize: 512, minZoom: 12, maxZoom: 18, opacity: 1, lighten: p.base === 'satellite' });
  return layers;
}

interface TileJob {
  layer: number;
  url: string;
  // Where it lands on the canvas.
  x: number;
  y: number;
  size: number;
  savedOnly: boolean;
}

// printMpp: the printed poster's resolution, which picks the photos (so the
// preview shows the same ones the print will), while f sets the tile sizes.
function tileJobs(p: PosterSettings, f: Frame, sharp: boolean, printMpp = f.mpp): TileJob[][] {
  return tileLayers(p, printMpp).map((layer, index) => {
    // Sharp enough for the canvas: for the export the next zoom up, for the preview the nearest.
    const ideal = Math.log2((2 * EARTH_HALF) / (layer.tileSize * f.mpp));
    const z = Math.max(layer.minZoom, Math.min(layer.maxZoom, sharp ? Math.ceil(ideal - 0.15) : Math.round(ideal)));
    const size = (2 * EARTH_HALF) / 2 ** z;
    let minX = f.minX;
    let maxX = f.minX + f.width * f.mpp;
    let minY = f.maxY - f.height * f.mpp;
    let maxY = f.maxY;
    if (layer.bounds) {
      const [w, s, e, n] = layer.bounds;
      minX = Math.max(minX, mercX(w));
      maxX = Math.min(maxX, mercX(e));
      minY = Math.max(minY, mercY(s));
      maxY = Math.min(maxY, mercY(n));
      if (minX >= maxX || minY >= maxY) return [];
    }
    const x0 = Math.floor((minX + EARTH_HALF) / size);
    const x1 = Math.floor((maxX + EARTH_HALF - 1e-6) / size);
    const y0 = Math.floor((EARTH_HALF - maxY) / size);
    const y1 = Math.floor((EARTH_HALF - minY - 1e-6) / size);
    const jobs: TileJob[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        jobs.push({
          layer: index,
          url: tileUrl(layer.template, z, x, y, size),
          x: (-EARTH_HALF + x * size - f.minX) / f.mpp,
          y: (f.maxY - (EARTH_HALF - y * size)) / f.mpp,
          size: size / f.mpp,
          savedOnly: Boolean(layer.savedOnly),
        });
      }
    }
    // A small preview zoomed far out would need hundreds of close-up tiles; it leaves them out.
    if (!sharp && jobs.length > 600) return [];
    return jobs;
  });
}

export function countTiles(p: PosterSettings, f: Frame): number {
  return tileJobs(p, f, true).reduce((n, jobs) => n + jobs.length, 0);
}

async function bytesOf(url: string, savedOnly: boolean, signal: AbortSignal): Promise<ArrayBuffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      if (window.hub) {
        const tile = await window.hub.getTile(url, savedOnly ? { cacheOnly: true } : undefined);
        if (!tile) return null;
        return tile.bytes.buffer.slice(tile.bytes.byteOffset, tile.bytes.byteOffset + tile.bytes.byteLength) as ArrayBuffer;
      }
      if (savedOnly) return null;
      const response = await fetch(url, { signal });
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) return await response.arrayBuffer();
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1) ** 2));
  }
  throw new Error('tile failed');
}

export interface RenderProgress {
  done: number;
  total: number;
  failed: number;
}

export interface RenderResult {
  // Tiles that couldn't be loaded.
  failed: number;
  // Missouri winter photo tiles wanted, and how many were saved on this PC.
  savedWanted: number;
  savedFound: number;
}

// Draws the map tiles. Returns how many couldn't be loaded.
async function drawTiles(
  ctx: CanvasRenderingContext2D,
  p: PosterSettings,
  f: Frame,
  sharp: boolean,
  signal: AbortSignal,
  onProgress: ((progress: RenderProgress) => void) | undefined,
  printMpp: number,
): Promise<RenderResult> {
  const layers = tileLayers(p, printMpp);
  const jobs = tileJobs(p, f, sharp, printMpp);
  const all = jobs.flat();
  const images = new Map<TileJob, ImageBitmap | null>();
  const progress = { done: 0, total: all.length, failed: 0 };
  let savedFound = 0;
  let next = 0;
  const worker = async () => {
    while (next < all.length) {
      const job = all[next++];
      try {
        const bytes = await bytesOf(job.url, job.savedOnly, signal);
        images.set(job, bytes ? await createImageBitmap(new Blob([bytes])) : null);
        if (job.savedOnly && bytes) savedFound += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        progress.failed += 1;
        images.set(job, null);
      }
      progress.done += 1;
      onProgress?.({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  signal.throwIfAborted();

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.imageSmoothingQuality = 'high';
  jobs.forEach((layerJobs, index) => {
    const layer = layers[index];
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    // Contours are black lines; over a photo they read better light.
    if (layer.lighten) ctx.filter = 'invert(0.85)';
    for (const job of layerJobs) {
      const image = images.get(job);
      // Overlap by a hair so no seam shows between tiles.
      if (image) ctx.drawImage(image, job.x - 0.25, job.y - 0.25, job.size + 0.5, job.size + 0.5);
      image?.close();
    }
    ctx.restore();
  });
  return { failed: progress.failed, savedWanted: all.filter((j) => j.savedOnly).length, savedFound };
}

// ---------- Shapes, pins and labels ----------

export interface PosterData {
  properties: Property[];
  sections: Section[];
  areas: MapArea[];
  trails: MapTrail[];
  markers: MapMarker[];
  settings: HubSettings;
}

// Leaves out the single things turned off for this poster.
export function shownData(data: PosterData, p: PosterSettings): PosterData {
  const hidden = new Set(p.hiddenIds ?? []);
  if (!hidden.size) return data;
  const keep = <T extends { id: string }>(list: T[]) => list.filter((r) => !hidden.has(r.id));
  return { ...data, properties: keep(data.properties), sections: keep(data.sections), areas: keep(data.areas), trails: keep(data.trails), markers: keep(data.markers) };
}

// Size of a map pixel on the poster, in canvas pixels.
export const textUnit = (p: PosterSettings, f: Frame) => (f.pxPerInch / 72) * p.textScale;
// Pins and lines can be sized apart from the labels.
export const featureUnit = (p: PosterSettings, f: Frame) => (f.pxPerInch / 72) * (p.featureScale ?? p.textScale);
// Property lines, section lines, area outlines and trails each have their own size.
export type LineKind = 'property' | 'section' | 'area' | 'trail';
export const lineUnit = (p: PosterSettings, f: Frame, kind: LineKind) =>
  (f.pxPerInch / 72) * (p.lineScales?.[kind] ?? p.lineScale ?? p.featureScale ?? p.textScale);

function ringPath(ctx: CanvasRenderingContext2D, f: Frame, geometry: AreaGeometry): void {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  ctx.beginPath();
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach(([lng, lat], i) => {
        const [x, y] = toPx(f, lng, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
}

function linePath(ctx: CanvasRenderingContext2D, f: Frame, parts: Position[][]): void {
  ctx.beginPath();
  for (const part of parts) {
    part.forEach(([lng, lat], i) => {
      const [x, y] = toPx(f, lng, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
}

function drawShapes(ctx: CanvasRenderingContext2D, p: PosterSettings, f: Frame, data: PosterData): void {
  data = shownData(data, p);
  // Each kind of line has its own size.
  const su = lineUnit(p, f, 'section');
  const au = lineUnit(p, f, 'area');
  const pu = lineUnit(p, f, 'property');
  const tu = lineUnit(p, f, 'trail');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  // Canvas dashes are in pixels; the map's are in line widths.
  const dashes = (pattern: OutlineLook['pattern'], kind: 'property' | 'section', w: number) => {
    const dash = dashFor(pattern, kind);
    return dash[1] === 0 ? [] : dash.map((d) => d * w);
  };
  if (p.show.sections) {
    const look = outlineLook('section', data.settings);
    for (const s of data.sections) {
      ringPath(ctx, f, s.geometry);
      ctx.globalAlpha = look.fillOpacity;
      ctx.fillStyle = '#f7efe6';
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      const w = look.width * su;
      ctx.lineCap = look.pattern === 'dotted' ? 'round' : 'butt';
      ctx.setLineDash(dashes(look.pattern, 'section', w));
      ctx.strokeStyle = 'rgba(247, 239, 230, 0.9)';
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
    }
  }
  if (p.show.areas) {
    for (const a of data.areas) {
      const color = areaTypeInfo(a.type, data.settings).color;
      ringPath(ctx, f, a.geometry);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * au;
      ctx.stroke();
    }
  }
  if (p.show.properties) {
    const look = outlineLook('property', data.settings);
    for (const prop of data.properties) {
      const color = propertyColor(prop, data.settings);
      ringPath(ctx, f, prop.boundary);
      ctx.globalAlpha = look.fillOpacity;
      ctx.fillStyle = color;
      ctx.fill('evenodd');
      if (look.pattern === 'solid') {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = (look.width + 2.5) * pu;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const w = look.width * pu;
      ctx.lineCap = look.pattern === 'dotted' ? 'round' : 'butt';
      ctx.setLineDash(dashes(look.pattern, 'property', w));
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
    }
  }
  if (p.show.trails) {
    for (const t of data.trails) {
      const look = trailStyle(t, data.settings.trailStyles);
      linePath(ctx, f, trailParts(t));
      ctx.lineCap = 'round';
      if (look.outline) {
        ctx.strokeStyle = 'rgba(20, 12, 6, 0.7)';
        ctx.lineWidth = (look.px + 3) * tu;
        ctx.stroke();
      }
      const w = look.px * tu;
      ctx.lineCap = look.pattern === 'dashed' ? 'butt' : 'round';
      ctx.setLineDash(look.pattern === 'dashed' ? [2 * w, 1.5 * w] : look.pattern === 'dotted' ? [0.01, 2 * w] : []);
      ctx.strokeStyle = look.color;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function pinShape(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, d: number): void {
  const r = d / 2;
  ctx.beginPath();
  if (shape === 'square') {
    ctx.roundRect(x - r, y - r, d, d, d * 0.25);
  } else if (shape === 'diamond') {
    const k = r * 0.82 * Math.SQRT2;
    ctx.moveTo(x, y - k);
    ctx.lineTo(x + k, y);
    ctx.lineTo(x, y + k);
    ctx.lineTo(x - k, y);
    ctx.closePath();
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r * 0.92);
    ctx.lineTo(x + r, y + r * 0.92);
    ctx.lineTo(x - r, y + r * 0.92);
    ctx.closePath();
  } else if (shape === 'pin') {
    // A teardrop pointing down.
    ctx.arc(x, y - r * 0.2, r, Math.PI * 0.75, Math.PI * 0.25);
    ctx.lineTo(x, y + r * 1.2);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

function drawPins(ctx: CanvasRenderingContext2D, p: PosterSettings, f: Frame, data: PosterData): void {
  if (!p.show.pins) return;
  data = shownData(data, p);
  const u = featureUnit(p, f);
  for (const m of data.markers) {
    const style = markerStyle(m, data.settings);
    const [x, y] = toPx(f, m.lng, m.lat);
    const d = style.size * u;
    const border = Math.min(Math.max(style.size * 0.16, 1), 2.5) * u;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 6 * u;
    ctx.shadowOffsetY = 2 * u;
    pinShape(ctx, style.shape, x, y, d);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.restore();
    pinShape(ctx, style.shape, x, y, d);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = border;
    ctx.stroke();
  }
}

export interface PosterLabel {
  // `${kind}:${record id}`.
  id: string;
  kind: PosterLabelKind;
  text: string;
  color: string;
  icon: IconName | null;
  // The thing it names: a pin's spot, an area's middle, the top of a property.
  anchor: [number, number];
  // Where its centre goes by default, in map pixels from the anchor.
  offset: [number, number];
  // Pins: more room to the right, in pin-size pixels (half the pin).
  featureOffset: number;
  // Pins: the label hangs off the right of the dot.
  hangs: boolean;
  font: { size: number; weight: number; upper: boolean };
}

export function posterLabels(data: PosterData, p: PosterSettings): PosterLabel[] {
  const labels: PosterLabel[] = [];
  data = shownData(data, p);
  const top = (g: AreaGeometry): [number, number] => {
    const [w, , e, n] = boundsOf(g);
    return [(w + e) / 2, n];
  };
  const middle = (g: AreaGeometry): [number, number] => {
    const [w, s, e, n] = boundsOf(g);
    return [(w + e) / 2, (s + n) / 2];
  };
  if (p.labels.property && p.show.properties) {
    for (const prop of data.properties) {
      if (prop.name) labels.push({ id: `property:${prop.id}`, kind: 'property', text: prop.name, color: propertyColor(prop, data.settings), icon: null, anchor: top(prop.boundary), offset: [0, 24], featureOffset: 0, hangs: false, font: { size: 13, weight: 700, upper: false } });
    }
  }
  if (p.labels.section && p.show.sections) {
    for (const s of data.sections) {
      if (s.name) labels.push({ id: `section:${s.id}`, kind: 'section', text: s.name, color: '#f7efe6', icon: null, anchor: top(s.geometry), offset: [0, 22], featureOffset: 0, hangs: false, font: { size: 12, weight: 700, upper: true } });
    }
  }
  if (p.labels.area && p.show.areas) {
    for (const a of data.areas) {
      if (a.name) labels.push({ id: `area:${a.id}`, kind: 'area', text: a.name, color: '#ffffff', icon: areaTypeInfo(a.type, data.settings).icon, anchor: middle(a.geometry), offset: [0, 0], featureOffset: 0, hangs: false, font: { size: 12, weight: 600, upper: false } });
    }
  }
  if (p.labels.trail && p.show.trails) {
    for (const t of data.trails) {
      if (t.name) labels.push({ id: `trail:${t.id}`, kind: 'trail', text: t.name, color: '#ffffff', icon: null, anchor: lineMidpoint(t.line.coordinates) as [number, number], offset: [0, 0], featureOffset: 0, hangs: false, font: { size: 12, weight: 600, upper: false } });
    }
  }
  if (p.labels.pin && p.show.pins) {
    for (const m of data.markers) {
      if (!m.name) continue;
      const size = markerStyle(m, data.settings).size;
      labels.push({ id: `pin:${m.id}`, kind: 'pin', text: m.name, color: '#ffffff', icon: null, anchor: [m.lng, m.lat], offset: [5, 0], featureOffset: size / 2, hangs: true, font: { size: 12, weight: 600, upper: false } });
    }
  }
  return labels.filter((l) => !p.hiddenLabelIds.includes(l.id));
}

export const fontFamily = () => getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';

export const labelFont = (label: PosterLabel, u: number) => `${label.font.weight} ${label.font.size * u}px ${fontFamily()}`;

const labelText = (label: PosterLabel) => (label.font.upper ? label.text.toUpperCase() : label.text);

let measureCtx: CanvasRenderingContext2D | null = null;

// The label's width and height in canvas pixels at this unit size.
export function labelBox(label: PosterLabel, u: number): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = labelFont(label, u);
  if ('letterSpacing' in measureCtx) measureCtx.letterSpacing = label.font.upper ? `${0.04 * label.font.size * u}px` : '0px';
  const text = measureCtx.measureText(labelText(label)).width;
  const icon = label.icon ? 15 * u + 4 * u : 0;
  return { w: text + icon, h: label.font.size * u * 1.25 };
}

// The label's centre on the canvas: where it was dragged, or its default spot.
export function labelCenter(label: PosterLabel, p: PosterSettings, f: Frame, u: number): [number, number] {
  const moved = p.labelAt[label.id];
  if (moved) return toPx(f, moved[0], moved[1]);
  const [ax, ay] = toPx(f, label.anchor[0], label.anchor[1]);
  const extra = label.hangs ? labelBox(label, u).w / 2 : 0;
  return [ax + label.offset[0] * u + label.featureOffset * featureUnit(p, f) + extra, ay + label.offset[1] * u];
}

const iconImages = new Map<string, Promise<HTMLImageElement>>();

function iconImage(name: IconName, color: string): Promise<HTMLImageElement> {
  const key = `${name}|${color}`;
  let image = iconImages.get(key);
  if (!image) {
    const svg = iconSvg(name, 96).replace('stroke="currentColor"', `stroke="${color}"`).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    image = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    iconImages.set(key, image);
  }
  return image;
}

// A line from a pin to its label once the label has been moved away from it.
function drawLeader(ctx: CanvasRenderingContext2D, label: PosterLabel, p: PosterSettings, f: Frame, u: number, center: [number, number]): void {
  if (label.kind !== 'pin' || !p.labelAt[label.id]) return;
  const [ax, ay] = toPx(f, label.anchor[0], label.anchor[1]);
  const box = labelBox(label, u);
  // To the nearest point of the label's box.
  const ex = Math.max(center[0] - box.w / 2, Math.min(ax, center[0] + box.w / 2));
  const ey = Math.max(center[1] - box.h / 2, Math.min(ay, center[1] + box.h / 2));
  if (Math.hypot(ex - ax, ey - ay) < 14 * u) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = 3 * u;
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2 * u;
  ctx.stroke();
  ctx.restore();
}

export async function drawLabels(ctx: CanvasRenderingContext2D, p: PosterSettings, f: Frame, labels: PosterLabel[]): Promise<void> {
  const u = textUnit(p, f);
  for (const label of labels) drawLeader(ctx, label, p, f, u, labelCenter(label, p, f, u));
  for (const label of labels) {
    const [cx, cy] = labelCenter(label, p, f, u);
    const box = labelBox(label, u);
    let x = cx - box.w / 2;
    if (label.icon) {
      const img = await iconImage(label.icon, label.color);
      const s = 15 * u;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 4 * u;
      ctx.drawImage(img, x, cy - s / 2, s, s);
      ctx.restore();
      x += s + 4 * u;
    }
    ctx.save();
    ctx.font = labelFont(label, u);
    if ('letterSpacing' in ctx) ctx.letterSpacing = label.font.upper ? `${0.04 * label.font.size * u}px` : '0px';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // A soft dark halo, then a tight dark edge, then the text, like the map's labels.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 5 * u;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 2.6 * u;
    ctx.strokeText(labelText(label), x, cy);
    ctx.shadowBlur = 0;
    ctx.fillStyle = label.color;
    ctx.fillText(labelText(label), x, cy);
    ctx.restore();
  }
}

// ---------- Title, north arrow, scale bar ----------

function niceScale(maxFeet: number): { feet: number; label: string } {
  if (maxFeet >= 5280 * 0.5) {
    const miles = maxFeet / 5280;
    const steps = [0.5, 1, 2, 3, 5, 10, 20];
    const pick = [...steps].reverse().find((s) => s <= miles) ?? 0.5;
    return { feet: pick * 5280, label: pick === 0.5 ? '½ mile' : `${pick} mile${pick === 1 ? '' : 's'}` };
  }
  const steps = [50, 100, 200, 250, 500, 1000, 2000];
  const pick = [...steps].reverse().find((s) => s <= maxFeet) ?? 50;
  return { feet: pick, label: `${pick.toLocaleString()} ft` };
}

function drawFurniture(ctx: CanvasRenderingContext2D, p: PosterSettings, f: Frame, sources: string): void {
  const inch = f.pxPerInch;
  const short = Math.min(f.width, f.height) / inch;
  const margin = 0.5 * inch;
  const family = fontFamily();
  const wordmark = getComputedStyle(document.documentElement).getPropertyValue('--font-wordmark').trim() || family;

  if (p.title.trim() || p.subtitle.trim()) {
    const titleSize = Math.max(0.36, short * 0.034) * inch;
    const subSize = titleSize * 0.45;
    ctx.save();
    ctx.font = `600 ${titleSize}px ${wordmark}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${titleSize * 0.06}px`;
    const titleW = p.title.trim() ? ctx.measureText(p.title.trim().toUpperCase()).width : 0;
    ctx.font = `600 ${subSize}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const subW = p.subtitle.trim() ? ctx.measureText(p.subtitle.trim()).width : 0;
    const pad = titleSize * 0.45;
    const w = Math.max(titleW, subW) + pad * 2;
    const h = pad * 2 + (p.title.trim() ? titleSize : 0) + (p.subtitle.trim() ? subSize * 1.5 : 0);
    ctx.fillStyle = 'rgba(28, 19, 13, 0.82)';
    ctx.beginPath();
    ctx.roundRect(margin, margin, w, h, pad * 0.6);
    ctx.fill();
    ctx.fillStyle = '#f08a24';
    ctx.fillRect(margin, margin + h - pad * 0.18, w, pad * 0.18);
    let y = margin + pad;
    ctx.textBaseline = 'top';
    if (p.title.trim()) {
      ctx.font = `600 ${titleSize}px ${wordmark}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${titleSize * 0.06}px`;
      ctx.fillStyle = '#f7efe6';
      ctx.fillText(p.title.trim().toUpperCase(), margin + pad, y);
      y += titleSize * 1.1;
    }
    if (p.subtitle.trim()) {
      ctx.font = `600 ${subSize}px ${family}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.fillStyle = '#d9c8b4';
      ctx.fillText(p.subtitle.trim(), margin + pad, y + subSize * 0.2);
    }
    ctx.restore();
  }

  // North arrow and scale bar share a box in the bottom right.
  if (p.northArrow || p.scaleBar) {
    const size = Math.max(0.32, short * 0.028) * inch;
    const pad = size * 0.45;
    const feetPerPx = (f.mpp * groundScale(f.maxY - (f.height * f.mpp) / 2)) / 0.3048;
    const scale = niceScale(feetPerPx * f.width * 0.18);
    const barW = scale.feet / feetPerPx;
    const arrowW = p.northArrow ? size * 1.1 : 0;
    const w = pad * 2 + (p.scaleBar ? barW : 0) + (p.northArrow && p.scaleBar ? pad * 1.5 : 0) + arrowW;
    const h = pad * 2 + size * 1.6;
    const x0 = f.width - margin - w;
    const y0 = f.height - margin - h;
    ctx.save();
    ctx.fillStyle = 'rgba(28, 19, 13, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, pad * 0.6);
    ctx.fill();
    if (p.scaleBar) {
      const bx = x0 + pad;
      const by = y0 + h - pad - size * 0.35;
      const bh = size * 0.22;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#1c130d' : '#f7efe6';
        ctx.fillRect(bx + (barW / 4) * i, by, barW / 4, bh);
      }
      ctx.strokeStyle = '#f7efe6';
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.strokeRect(bx, by, barW, bh);
      ctx.fillStyle = '#f7efe6';
      ctx.font = `600 ${size * 0.42}px ${family}`;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText('0', bx, by - size * 0.12);
      ctx.textAlign = 'right';
      ctx.fillText(scale.label, bx + barW, by - size * 0.12);
    }
    if (p.northArrow) {
      const cx = x0 + w - pad - arrowW / 2;
      const top = y0 + pad;
      const ah = size * 1.15;
      ctx.beginPath();
      ctx.moveTo(cx, top + size * 0.45);
      ctx.lineTo(cx + arrowW * 0.38, top + size * 0.45 + ah);
      ctx.lineTo(cx, top + size * 0.45 + ah * 0.72);
      ctx.closePath();
      ctx.fillStyle = '#f08a24';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, top + size * 0.45);
      ctx.lineTo(cx - arrowW * 0.38, top + size * 0.45 + ah);
      ctx.lineTo(cx, top + size * 0.45 + ah * 0.72);
      ctx.closePath();
      ctx.fillStyle = '#f7efe6';
      ctx.fill();
      ctx.font = `700 ${size * 0.42}px ${family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#f7efe6';
      ctx.fillText('N', cx, top - size * 0.05);
    }
    ctx.restore();
  }

  // Credit for the free map data, small in the bottom left.
  ctx.save();
  const credit = 8 * (inch / 72);
  ctx.font = `500 ${credit}px ${family}`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = credit * 0.4;
  ctx.fillText(sources, margin * 0.5, f.height - margin * 0.4);
  ctx.restore();
}

export function sourcesText(p: PosterSettings, f: Frame, printMpp = f.mpp): string {
  const parts = ['Map data: USGS The National Map'];
  if (p.base === 'satellite' && mapZoomFor(printMpp) >= AERIAL_MIN_ZOOM) parts.push('NAIP');
  if (p.base === 'satellite' && window.hub && p.photos !== 'leafOn') {
    const [w, s, e, n] = MISSOURI_BOUNDS;
    const lng = toLng(f.minX + (f.width * f.mpp) / 2);
    const lat = toLat(f.maxY - (f.height * f.mpp) / 2);
    if (lng > w && lng < e && lat > s && lat < n && mapZoomFor(printMpp) >= AERIAL_MIN_ZOOM) parts.push('MSDIS Missouri 6 inch');
  }
  if (p.base === 'lidar' || p.lidarBlend > 0 || p.contours !== 'off') parts.push('3DEP lidar');
  return `${parts.join(' · ')} · Made with Fenceline`;
}

// ---------- Whole poster ----------

export interface RenderOptions {
  // Draw labels into the image (the editor shows its own, draggable ones instead).
  labels: boolean;
  sharp: boolean;
  signal: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  // The printed poster's mercator meters per pixel, when drawing a preview of it.
  printMpp?: number;
}

// Draws the poster onto the canvas, which must already be frame-sized. Returns tiles that failed.
export async function renderPoster(canvas: HTMLCanvasElement, p: PosterSettings, f: Frame, data: PosterData, options: RenderOptions): Promise<RenderResult> {
  const ctx = canvas.getContext('2d')!;
  const printMpp = options.printMpp ?? f.mpp;
  const result = await drawTiles(ctx, p, f, options.sharp, options.signal, options.onProgress, printMpp);
  drawShapes(ctx, p, f, data);
  drawPins(ctx, p, f, data);
  if (options.labels) await drawLabels(ctx, p, f, posterLabels(data, p));
  drawFurniture(ctx, p, f, sourcesText(p, f, printMpp));
  return result;
}

// ---------- Saving ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Writes the print size into the file, so it opens at the right size in print software.
async function withDpi(blob: Blob, dpi: number, format: 'jpg' | 'png'): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === 'jpg') {
    // JFIF header: units (1 = dots per inch), then x and y density.
    const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF';
    if (!isJfif) return blob;
    bytes[13] = 1;
    bytes[14] = dpi >> 8;
    bytes[15] = dpi & 0xff;
    bytes[16] = dpi >> 8;
    bytes[17] = dpi & 0xff;
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  // PNG: a pHYs chunk (pixels per meter) right after the IHDR chunk.
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.slice(4, 17)));
  const ihdrEnd = 8 + 25;
  return new Blob([bytes.slice(0, ihdrEnd), chunk, bytes.slice(ihdrEnd)], { type: 'image/png' });
}

export async function posterBlob(canvas: HTMLCanvasElement, p: PosterSettings): Promise<Blob> {
  const type = p.format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error('The poster was too big to save. Try a lower DPI.');
  return withDpi(blob, p.dpi, p.format);
}
