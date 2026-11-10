// Snapping while drawing: a click near an existing line lands exactly on it,
// so sections and areas share the property line instead of almost touching it.
// Distances are measured on screen, so snapping feels the same at any zoom.
import type { Position } from 'geojson';

import type { AreaGeometry } from '@/types/models';

export interface Snap {
  position: [number, number];
  // A corner of the line, or somewhere along it.
  kind: 'vertex' | 'edge';
}

type Project = (lngLat: [number, number]) => { x: number; y: number };

// Every ring (outline) of the shapes, as lng/lat points.
export function ringsOf(geometries: AreaGeometry[]): Position[][] {
  return geometries.flatMap((g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()));
}

// Corners win over edges when both are in reach: hitting an exact corner is
// almost always what's wanted.
export function findSnap(
  cursor: { x: number; y: number },
  rings: Position[][],
  tolerancePx: number,
  project: Project,
): Snap | null {
  if (tolerancePx <= 0) return null;
  let bestVertex: { d: number; p: [number, number] } | null = null;
  let bestEdge: { d: number; p: [number, number] } | null = null;

  for (const ring of rings) {
    const screen = ring.map((p) => project([p[0], p[1]]));
    for (let i = 0; i < ring.length; i++) {
      const a = screen[i];
      const d = Math.hypot(a.x - cursor.x, a.y - cursor.y);
      if (d <= tolerancePx && (!bestVertex || d < bestVertex.d)) bestVertex = { d, p: [ring[i][0], ring[i][1]] };

      if (i === ring.length - 1) continue;
      const b = screen[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      // Closest point on segment a-b to the cursor, as a fraction along it.
      const t = Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / len2));
      const ed = Math.hypot(a.x + t * dx - cursor.x, a.y + t * dy - cursor.y);
      if (ed <= tolerancePx && (!bestEdge || ed < bestEdge.d)) {
        // Interpolating lng/lat is accurate enough over one property edge.
        const [p, q] = [ring[i], ring[i + 1]];
        bestEdge = { d: ed, p: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] };
      }
    }
  }

  if (bestVertex) return { position: bestVertex.p, kind: 'vertex' };
  if (bestEdge) return { position: bestEdge.p, kind: 'edge' };
  return null;
}

// How far a drawn edge can stray and still count as following a line, and how
// long it has to keep that up. A line that only touches or crosses a boundary
// stays short of the length, so it's left as drawn.
const FOLLOW_DISTANCE_M = 15;
const FOLLOW_MIN_LENGTH_M = 40;

interface NearLine {
  line: number;
  // Distance along the line, and the closest point on it.
  along: number;
  at: Position;
}

// Snapped clicks still leave gaps, because the straight edges between them cut
// across a boundary's bends. Where a closed ring runs close to one of the
// closed lines, this swaps that stretch for the line itself, so the two share
// an edge. Returns the same ring when nothing changes.
export function followNearbyLines(ring: Position[], lines: Position[][], distanceM = FOLLOW_DISTANCE_M, minLengthM = FOLLOW_MIN_LENGTH_M): Position[] {
  if (ring.length < 4 || lines.length === 0) return ring;

  // Flat meters are accurate enough across one property.
  const scaleX = 111320 * Math.cos((ring[0][1] * Math.PI) / 180);
  const scaleY = 110540;
  const gapM = (a: Position, b: Position) => Math.hypot((a[0] - b[0]) * scaleX, (a[1] - b[1]) * scaleY);
  const areaM2 = (r: Position[]) => {
    let sum = 0;
    for (let i = 0; i < r.length - 1; i++) sum += r[i][0] * scaleX * (r[i + 1][1] * scaleY) - r[i + 1][0] * scaleX * (r[i][1] * scaleY);
    return Math.abs(sum) / 2;
  };

  const targets = lines
    .filter((line) => line.length >= 4)
    .map((line) => {
      const distances = [0];
      for (let i = 1; i < line.length; i++) distances.push(distances[i - 1] + gapM(line[i - 1], line[i]));
      return { line, distances, total: distances[distances.length - 1] };
    });

  const nearestLine = (p: Position): NearLine | null => {
    let best: (NearLine & { gap: number }) | null = null;
    targets.forEach(({ line, distances }, lineIndex) => {
      for (let i = 0; i < line.length - 1; i++) {
        const [a, b] = [line[i], line[i + 1]];
        const dx = (b[0] - a[0]) * scaleX;
        const dy = (b[1] - a[1]) * scaleY;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * scaleX * dx + (p[1] - a[1]) * scaleY * dy) / len2));
        const at = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const gap = gapM(p, at);
        if (gap <= distanceM && (!best || gap < best.gap)) best = { gap, line: lineIndex, along: distances[i] + t * (distances[i + 1] - distances[i]), at };
      }
    });
    return best;
  };

  // Walk the drawn edges in small steps, noting which line each step is near.
  const stepM = distanceM / 3;
  const samples: { at: Position; corner: boolean; near: NearLine | null }[] = [];
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [a, b] = [ring[i], ring[i + 1]];
    const length = gapM(a, b);
    perimeter += length;
    const steps = Math.max(1, Math.ceil(length / stepM));
    for (let s = 0; s < steps; s++) {
      const at = [a[0] + (s / steps) * (b[0] - a[0]), a[1] + (s / steps) * (b[1] - a[1])];
      samples.push({ at, corner: s === 0, near: nearestLine(at) });
    }
  }
  const sameLine = (a: NearLine | null, b: NearLine | null) => (a && b ? a.line === b.line : a === b);

  // Start where a stretch begins, so none gets split across the ring's seam.
  const start = samples.findIndex((sample, i) => !sameLine(sample.near, samples[(i + samples.length - 1) % samples.length].near));
  if (start === -1) {
    // The whole ring is near one line. It's only a trace of that line if the
    // lengths agree; a thin sliver beside the line must not become the line.
    const whole = samples[0].near && targets[samples[0].near.line];
    return whole && Math.abs(whole.total - perimeter) <= whole.total * 0.25 ? whole.line.map((p) => [...p]) : ring;
  }
  const ordered = [...samples.slice(start), ...samples.slice(0, start)];

  // The part of a line between two points, the way the drawing went along it.
  const lineBetween = (from: NearLine, to: NearLine, progress: number) => {
    const { line, distances, total } = targets[from.line];
    const span = Math.abs(progress);
    const corners: { offset: number; p: Position }[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const offset = progress >= 0 ? (distances[i] - from.along + total) % total : (from.along - distances[i] + total) % total;
      if (offset > 0 && offset < span) corners.push({ offset, p: line[i] });
    }
    corners.sort((a, b) => a.offset - b.offset);
    return [from.at, ...corners.map((c) => c.p), to.at];
  };

  const next: Position[] = [];
  let changed = false;
  for (let i = 0; i < ordered.length; ) {
    const near = ordered[i].near;
    let end = i;
    while (end + 1 < ordered.length && sameLine(ordered[end + 1].near, near)) end++;
    let replacement: Position[] | null = null;
    // Only the stretch between the shape's own corners follows the line. A run
    // also takes in the first bit of an edge that leaves the line (a section's
    // dividing line, say); following that would slide the corner where the
    // divider meets the line sideways, so neighbors stop meeting.
    let first = i;
    while (first <= end && !ordered[first].corner) first++;
    let lastCorner = end;
    while (lastCorner >= first && !ordered[lastCorner].corner) lastCorner--;
    const from = first < lastCorner ? ordered[first].near : null;
    const last = first < lastCorner ? ordered[lastCorner].near : null;
    if (near && from && last) {
      const { total } = targets[near.line];
      let length = 0;
      let progress = 0;
      for (let k = first; k < lastCorner; k++) {
        length += gapM(ordered[k].at, ordered[k + 1].at);
        // Each step is short, so a big jump is the line's start/end seam.
        const step = (ordered[k + 1].near as NearLine).along - (ordered[k].near as NearLine).along;
        progress += step > total / 2 ? step - total : step < -total / 2 ? step + total : step;
      }
      // A far longer way along the line means this isn't really following it.
      if (length >= minLengthM && Math.abs(progress) <= length * 1.5 + 2 * distanceM) replacement = lineBetween(from, last, progress);
    }
    if (replacement) {
      next.push(...replacement);
      changed = true;
    } else {
      for (let k = i; k <= end; k++) if (ordered[k].corner) next.push(ordered[k].at);
    }
    i = end + 1;
  }
  if (!changed) return ring;

  const cleaned = next.filter((p, i) => i === 0 || gapM(p, next[i - 1]) > 0.01);
  if (gapM(cleaned[0], cleaned[cleaned.length - 1]) > 0.01) cleaned.push(cleaned[0]);
  else cleaned[cleaned.length - 1] = cleaned[0];
  // Keep what was drawn if following would collapse the shape, as with a thin
  // strip whose two long sides are both near the line.
  return cleaned.length >= 4 && areaM2(cleaned) >= areaM2(ring) / 2 ? cleaned : ring;
}
