// Lidar drawn on the device from the bare-earth elevation (the same float TIFFs
// as 3D terrain and slope, about 1 m a pixel up close), instead of the picture
// the USGS server draws:
// - shade: hillshade lit from two sides (northwest and northeast), so trails,
//   ditches and banks show whichever way they run.
// - relief: micro-relief, each spot against the ground around it. Blue is a
//   little lower (trail beds, ditches, washes), orange a little higher (banks,
//   berms), over a soft hillshade so the shape of the land stays.
// Tiles are fetched with a margin (PAD pixels each side) so the smoothing and
// slopes at a tile's edge see the ground past it, and tiles join without seams.

export type ReliefStyle = 'shade' | 'relief';

export const DEM_PAD = 24;
const EARTH_HALF = 20037508.342789244;

// The padded request for a tile URL that carries "&pad=N": the box grown by N
// pixels each side and the size by 2N, with the marker dropped. The map and the
// offline download both use this, so a saved tile is found again.
export function padDemUrl(url: string): string {
  const pad = Number(url.match(/[?&]pad=(\d+)/)?.[1] ?? 0);
  const box = url.match(/bbox=([-\d.e]+),([-\d.e]+),([-\d.e]+),([-\d.e]+)/);
  const size = url.match(/size=(\d+),(\d+)/);
  if (!pad || !box || !size) return url;
  const [w, s, e, n] = box.slice(1).map(Number);
  const [sx, sy] = [Number(size[1]), Number(size[2])];
  const [px, py] = [((e - w) / sx) * pad, ((n - s) / sy) * pad];
  return url
    .replace(box[0], `bbox=${[w - px, s - py, e + px, n + py].map((v) => v.toFixed(1)).join(',')}`)
    .replace(size[0], `size=${sx + 2 * pad},${sy + 2 * pad}`)
    .replace(/&pad=\d+/, '');
}

// Ground meters per pixel for a (padded) tile URL.
function cellMeters(url: string, width: number): number {
  const box = url.match(/bbox=([-\d.e]+),([-\d.e]+),([-\d.e]+),([-\d.e]+)/);
  if (!box) return 1;
  const [w, s, e, n] = box.slice(1).map(Number);
  const lat = (Math.atan(Math.exp((((s + n) / 2 / EARTH_HALF) * Math.PI))) * 360) / Math.PI - 90;
  return ((e - w) / width) * Math.cos((lat * Math.PI) / 180);
}

// Three passes of a box blur, about a Gaussian, radius r pixels.
function blur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let count = 0;
      for (let x = -r; x < width; x++) {
        if (x + r < width) (sum += a[y * width + x + r]), count++;
        if (x - r - 1 >= 0) (sum -= a[y * width + x - r - 1]), count--;
        if (x >= 0) b[y * width + x] = sum / count;
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let y = -r; y < height; y++) {
        if (y + r < height) (sum += b[(y + r) * width + x]), count++;
        if (y - r - 1 >= 0) (sum -= b[(y - r - 1) * width + x]), count--;
        if (y >= 0) a[y * width + x] = sum / count;
      }
    }
  }
  return a;
}

const LIGHTS = [315, 45].map((az) => {
  const a = (az * Math.PI) / 180;
  const alt = (40 * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(alt), Math.cos(a) * Math.cos(alt), Math.sin(alt)];
});
// Hills drawn this much steeper than they are, so low ground still shows its shape.
const SHADE_EXAGGERATION = 2;
// Micro-relief: the neighborhood each spot is compared with, and the height
// difference that gets the full color.
const RELIEF_NEIGHBORHOOD_M = 6;
const RELIEF_FULL_M = 0.8;

export async function reliefPng(tile: { width: number; height: number; meters: Float32Array }, url: string, style: ReliefStyle, pad = DEM_PAD): Promise<ArrayBuffer> {
  const { width, height } = tile;
  const z = Float32Array.from(tile.meters);
  // Gaps (no data) take the nearest value before them, so they don't draw as cliffs.
  for (let i = 0; i < z.length; i++) if (!(z[i] > -1000 && z[i] < 10000)) z[i] = i > 0 ? z[i - 1] : 0;
  const cell = cellMeters(url, width);
  const at = (x: number, y: number) => z[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const r = Math.max(1, Math.min(Math.floor(pad / 3), Math.round(RELIEF_NEIGHBORHOOD_M / cell)));
  const around = style === 'relief' ? blur(z, width, height, r) : null;
  const outW = width - 2 * pad;
  const outH = height - 2 * pad;
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = x + pad;
      const sy = y + pad;
      const dzdx = ((at(sx + 1, sy) - at(sx - 1, sy)) / (2 * cell)) * SHADE_EXAGGERATION;
      const dzdy = ((at(sx, sy + 1) - at(sx, sy - 1)) / (2 * cell)) * SHADE_EXAGGERATION;
      const len = Math.hypot(dzdx, dzdy, 1);
      let light = 0;
      for (const [lx, ly, lz] of LIGHTS) light += Math.max(0, (-dzdx * lx + dzdy * ly + lz) / len);
      light /= LIGHTS.length;
      const i = (y * outW + x) * 4;
      if (!around) {
        const g = Math.round(255 * Math.min(1, light * 1.15));
        rgba[i] = g;
        rgba[i + 1] = g;
        rgba[i + 2] = g;
      } else {
        const k = sy * width + sx;
        const rel = Math.max(-1, Math.min(1, (z[k] - around[k]) / RELIEF_FULL_M));
        const shade = 0.55 + 0.45 * light;
        const [cr, cg, cb] = rel >= 0 ? [255, 255 - 130 * rel, 255 - 200 * rel] : [255 + 200 * rel, 255 + 120 * rel, 255];
        rgba[i] = cr * shade;
        rgba[i + 1] = cg * shade;
        rgba[i + 2] = cb * shade;
      }
      rgba[i + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(outW, outH);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, outW, outH), 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
