// Trails: lines on the map (deer trails, walking paths, ATV roads, fence
// lines), drawn in the hub or walked with the phone's GPS.
import type { LineString, Position } from 'geojson';

import type { TrailKind } from '@/types/models';

export const TRAIL_KINDS: Record<TrailKind, { label: string; color: string; dashed: boolean }> = {
  deer: { label: 'Deer trail', color: '#c4935c', dashed: true },
  path: { label: 'Walking path', color: '#f7efe6', dashed: false },
  road: { label: 'ATV / road', color: '#d4b04a', dashed: false },
  fence: { label: 'Fence line', color: '#a8a8a0', dashed: true },
  other: { label: 'Other line', color: '#9fd0ff', dashed: false },
};

export function trailKindInfo(kind: string): { label: string; color: string; dashed: boolean } {
  return TRAIL_KINDS[kind as TrailKind] ?? TRAIL_KINDS.other;
}

const EARTH_M = 6_371_000;

// Distance between two [lng, lat] points, meters.
export function metersBetween(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

export function lineLengthM(points: Position[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += metersBetween(points[i - 1], points[i]);
  return total;
}

// "320 yd" or "1.4 mi".
export function formatDistance(meters: number): string {
  const yards = meters / 0.9144;
  return yards < 1760 ? `${Math.round(yards)} yd` : `${(yards / 1760).toFixed(1)} mi`;
}

export function lineBounds(line: LineString): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of line.coordinates) {
    w = Math.min(w, x);
    s = Math.min(s, y);
    e = Math.max(e, x);
    n = Math.max(n, y);
  }
  return [w, s, e, n];
}

// The point halfway along a line, for its label.
export function lineMidpoint(points: Position[]): Position {
  const half = lineLengthM(points) / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const step = metersBetween(points[i - 1], points[i]);
    if (walked + step >= half) {
      const k = step ? (half - walked) / step : 0;
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * k, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * k];
    }
    walked += step;
  }
  return points[0];
}

// Drops points that barely change the line's shape (Douglas-Peucker), so a
// walked trail stays small to store and send. `toleranceM` is how far, at most,
// the simplified line may stray from the walked one.
export function simplifyLine(points: Position[], toleranceM = 4): Position[] {
  if (points.length < 3) return points;
  // Work in local meters around the first point.
  const [lng0, lat0] = points[0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111_320;
  const xy = points.map(([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky]);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let farDist = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > farDist) [far, farDist] = [i, d];
    }
    if (far !== -1 && farDist > toleranceM) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Walked tracks are stored as a flat [lng, lat, lng, lat, ...] list (the
// camp database can't hold lists inside lists), rounded to about 10 cm.
export function packPoints(points: Position[]): number[] {
  return points.flatMap(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
}

export function unpackPoints(coords: number[]): Position[] {
  const points: Position[] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) points.push([coords[i], coords[i + 1]]);
  return points;
}
