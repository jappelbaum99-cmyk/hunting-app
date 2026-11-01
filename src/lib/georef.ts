// Places an image on the map from matched control points.
//
// Works in Web Mercator meters, the projection the map is drawn in, so a
// screenshot of another web map (also Web Mercator) lines up with no bending.
// Up to three points use a least-squares similarity fit (move, scale, rotate),
// which is exactly what a web map screenshot needs; with three, the spare
// point shows how accurate the clicks were. Four or more switch to an affine
// fit, which also absorbs the stretch of a scanned or photographed paper map.
import type { ControlPoint } from '@/types/models';

const EARTH_RADIUS = 6378137;
const FEET_PER_METER = 3.28084;

type Vec = [number, number];

function toMercator([lng, lat]: Vec): Vec {
  const x = (EARTH_RADIUS * lng * Math.PI) / 180;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

function fromMercator([x, y]: Vec): Vec {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [lng, lat];
}

// Image pixel -> mercator meters.
type Transform = (pixel: Vec) => Vec;

// Image y grows downward, map y grows upward, so flip y before fitting.
const flip = ([x, y]: Vec): Vec => [x, -y];

function similarityFit(points: ControlPoint[]): Transform | null {
  // Complex-number form z = a * w + b, solved by least squares about the
  // centroids (exact when there are only two points).
  const ws = points.map((p) => flip(p.image));
  const zs = points.map((p) => toMercator(p.map));
  const mean = (vs: Vec[]): Vec => [vs.reduce((s, v) => s + v[0], 0) / vs.length, vs.reduce((s, v) => s + v[1], 0) / vs.length];
  const [wc, zc] = [mean(ws), mean(zs)];
  let [re, im, norm] = [0, 0, 0];
  ws.forEach((w, i) => {
    const [x, y] = [w[0] - wc[0], w[1] - wc[1]];
    const [X, Y] = [zs[i][0] - zc[0], zs[i][1] - zc[1]];
    re += x * X + y * Y;
    im += x * Y - y * X;
    norm += x * x + y * y;
  });
  if (norm === 0) return null;
  const a: Vec = [re / norm, im / norm];
  return (pixel) => {
    const [x, y] = flip(pixel);
    const [dx, dy] = [x - wc[0], y - wc[1]];
    return [a[0] * dx - a[1] * dy + zc[0], a[0] * dy + a[1] * dx + zc[1]];
  };
}

// Solves the 3x3 system m * x = v with Cramer's rule.
function solve3(m: number[][], v: number[]): number[] | null {
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  return [0, 1, 2].map((col) => det(m.map((row, i) => row.map((value, j) => (j === col ? v[i] : value)))) / d);
}

function affineFit(points: ControlPoint[]): Transform | null {
  // Fit X = a*x + b*y + c and Y = d*x + e*y + f by least squares. Pixels are
  // centred first so the normal equations stay well conditioned.
  const pixels = points.map((p) => flip(p.image));
  const meters = points.map((p) => toMercator(p.map));
  const cx = pixels.reduce((s, p) => s + p[0], 0) / pixels.length;
  const cy = pixels.reduce((s, p) => s + p[1], 0) / pixels.length;
  const rows = pixels.map(([x, y]) => [x - cx, y - cy, 1]);

  const ata = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const atb = (k: 0 | 1) => [0, 1, 2].map((i) => rows.reduce((s, r, n) => s + r[i] * meters[n][k], 0));
  const fx = solve3(ata, atb(0));
  const fy = solve3(ata, atb(1));
  if (!fx || !fy) return null;
  return (pixel) => {
    const [x, y] = flip(pixel);
    const r = [x - cx, y - cy, 1];
    return [fx[0] * r[0] + fx[1] * r[1] + fx[2], fy[0] * r[0] + fy[1] * r[1] + fy[2]];
  };
}

function fit(points: ControlPoint[]): Transform | null {
  if (points.length < 2) return null;
  return points.length < 4 ? similarityFit(points) : affineFit(points);
}

// Image corners on the map, in the order maplibre's image source wants:
// top-left, top-right, bottom-right, bottom-left. Null until there are enough points.
export function overlayCorners(
  points: ControlPoint[],
  width: number,
  height: number,
): [Vec, Vec, Vec, Vec] | null {
  const transform = fit(points);
  if (!transform) return null;
  const corners: Vec[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const [tl, tr, br, bl] = corners.map((c) => fromMercator(transform(c)));
  return [tl, tr, br, bl];
}

// How far (in feet on the ground) each control point is from where the fit
// puts it. Always zero with two points, since the fit passes through both.
export function controlPointErrorsFeet(points: ControlPoint[]): number[] {
  const transform = fit(points);
  if (!transform) return points.map(() => 0);
  return points.map((p) => {
    const [x, y] = transform(p.image);
    const [mx, my] = toMercator(p.map);
    // Mercator meters are stretched by 1/cos(lat); undo that for ground distance.
    const scale = Math.cos((p.map[1] * Math.PI) / 180);
    return Math.hypot(x - mx, y - my) * scale * FEET_PER_METER;
  });
}
