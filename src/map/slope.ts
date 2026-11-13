// Slope shading: each lidar elevation tile (the same float TIFFs 3D terrain
// uses, saved with a property's offline maps) colored by how steep the ground
// is. Flats and benches, where deer bed and travel, stand out from the steep
// sides around them.

// Steepness classes, in degrees, flattest first. The last has no upper limit.
export const SLOPE_CLASSES: { upTo: number; color: string; label: string }[] = [
  { upTo: 5, color: '#2e9e4f', label: 'Flat (0–5°)' },
  { upTo: 10, color: '#9ccc3c', label: 'Gentle (5–10°)' },
  { upTo: 15, color: '#f2d03b', label: 'Moderate (10–15°)' },
  { upTo: 20, color: '#f39a2b', label: 'Steep (15–20°)' },
  { upTo: 30, color: '#e4532d', label: 'Very steep (20–30°)' },
  { upTo: 90, color: '#9b2fae', label: 'Cliffy (30°+)' },
];

const EARTH_HALF = 20037508.342789244;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const CLASS_RGB = SLOPE_CLASSES.map((c) => ({ upTo: c.upTo, rgb: rgb(c.color) }));

// The tile's box (web-mercator meters) from its request URL.
function bboxOf(url: string): [number, number, number, number] | null {
  const m = url.match(/bbox=([-\d.e]+),([-\d.e]+),([-\d.e]+),([-\d.e]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

// A colored PNG of slope for an elevation tile.
export async function slopePng(tile: { width: number; height: number; meters: Float32Array }, url: string): Promise<ArrayBuffer> {
  const { width, height, meters } = tile;
  const box = bboxOf(url);
  // Ground meters per pixel: mercator meters shrink by cos(latitude).
  let cellX = 4;
  let cellY = 4;
  if (box) {
    const midY = (box[1] + box[3]) / 2;
    const lat = (Math.atan(Math.exp((midY / EARTH_HALF) * Math.PI)) * 360) / Math.PI - 90;
    const shrink = Math.cos((lat * Math.PI) / 180);
    cellX = ((box[2] - box[0]) / width) * shrink;
    cellY = ((box[3] - box[1]) / height) * shrink;
  }
  const at = (x: number, y: number) => meters[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const here = at(x, y);
      if (!Number.isFinite(here) || here < -1000) continue;
      // Across two pixels each way, so single noisy pixels don't speckle.
      const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * cellX);
      const dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * cellY);
      const degrees = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      const c = CLASS_RGB.find((k) => degrees < k.upTo) ?? CLASS_RGB[CLASS_RGB.length - 1];
      rgba[i] = c.rgb[0];
      rgba[i + 1] = c.rgb[1];
      rgba[i + 2] = c.rgb[2];
      rgba[i + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
