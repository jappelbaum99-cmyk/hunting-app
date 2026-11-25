// "Fit to property line": the parts of a drawn shape that stick out past the
// property line are cut off along it. Where the shape's edge leaves the
// property and comes back in, that outside stretch is swapped for the property
// line between those two points, so the shape ends exactly on the line.
//
// Corners are often snapped right onto the property line while drawing, so a
// point on the line can't be called inside or outside. Instead each piece of
// the shape's edge (between corners and crossings) is judged by its middle.
import type { Position } from 'geojson';

const EPS = 1e-12;

function inside(p: Position, ring: Position[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Where segment a-b crosses segment c-d: t along a-b and u along c-d (0-1), or null.
function cross(a: Position, b: Position, c: Position, d: Position): { t: number; u: number } | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < EPS) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1 ? { t, u } : null;
}

interface Piece {
  // Start of the piece (a corner of the shape or a crossing of the line).
  p: Position;
  // Whether the piece from here to the next point is inside the property.
  in: boolean;
}

// The shape's outline cut into pieces at every crossing of the property line.
function pieces(ring: Position[], property: Position[]): Piece[] {
  const pts: Position[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [a, b] = [ring[i], ring[i + 1]];
    pts.push(a);
    const hits: number[] = [];
    for (let k = 0; k < property.length - 1; k++) {
      const x = cross(a, b, property[k], property[k + 1]);
      if (x) hits.push(x.t);
    }
    hits.sort((m, n) => m - n);
    for (const t of hits) pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { p, in: inside([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], property) };
  });
}

// Whether a closed ring (first point repeated) sticks out past the property
// ring: part of its edge is inside the property and part outside.
export function sticksOut(ring: Position[], property: Position[]): boolean {
  if (ring.length < 4 || property.length < 4) return false;
  const all = pieces(ring, property);
  return all.some((x) => x.in) && all.some((x) => !x.in);
}

// The shape cut to the property line. Both rings closed (first point repeated).
// Returns the same ring when it doesn't stick out or can't be fit.
export function fitInside(ring: Position[], property: Position[]): Position[] {
  if (!sticksOut(ring, property)) return ring;
  const scaleX = Math.cos((ring[0][1] * Math.PI) / 180);
  const dist = (a: Position, b: Position) => Math.hypot((a[0] - b[0]) * scaleX, a[1] - b[1]);
  const along = [0];
  for (let k = 1; k < property.length; k++) along.push(along[k - 1] + dist(property[k - 1], property[k]));
  const perimeter = along[along.length - 1];
  // How far along the property line a point on (or by) it is.
  const alongOf = (p: Position): number => {
    let best = { gap: Infinity, s: 0 };
    for (let k = 0; k < property.length - 1; k++) {
      const [a, b] = [property[k], property[k + 1]];
      const dx = (b[0] - a[0]) * scaleX;
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (((p[0] - a[0]) * scaleX) * dx + (p[1] - a[1]) * dy) / len2));
      const gap = Math.hypot((p[0] - a[0]) * scaleX - t * dx, p[1] - a[1] - t * dy);
      if (gap < best.gap) best = { gap, s: along[k] + t * (along[k + 1] - along[k]) };
    }
    return best.s;
  };
  // The property line between two points on it, one way or the other round.
  const lineBetween = (from: number, to: number, forward: boolean): Position[] => {
    const span = forward ? (to - from + perimeter) % perimeter : (from - to + perimeter) % perimeter;
    const corners: { offset: number; p: Position }[] = [];
    for (let k = 0; k < property.length - 1; k++) {
      const offset = forward ? (along[k] - from + perimeter) % perimeter : (from - along[k] + perimeter) % perimeter;
      if (offset > 1e-12 && offset < span - 1e-12) corners.push({ offset, p: property[k] });
    }
    return corners.sort((m, n) => m.offset - n.offset).map((c) => c.p);
  };
  // The right way round is the part of the property line that runs through the
  // drawn shape: how much of a path is inside it.
  const insideShare = (path: Position[], from: Position, to: Position) => {
    const pts = [from, ...path, to];
    const probes = [...path, ...pts.slice(0, -1).map((p, k) => [(p[0] + pts[k + 1][0]) / 2, (p[1] + pts[k + 1][1]) / 2])];
    return probes.filter((p) => inside(p, ring)).length / Math.max(1, probes.length);
  };

  const all = pieces(ring, property);
  // Start on a piece that's inside, so each outside stretch is whole.
  const start = all.findIndex((x, i) => x.in && !all[(i + all.length - 1) % all.length].in);
  if (start === -1) return ring;
  const ordered = [...all.slice(start), ...all.slice(0, start)];

  const out: Position[] = [];
  for (let i = 0; i < ordered.length; ) {
    if (ordered[i].in) {
      out.push(ordered[i].p);
      i++;
      continue;
    }
    // An outside stretch: it leaves at this point and comes back in where the
    // next inside piece starts (the start of the ring at the end).
    let j = i;
    while (j < ordered.length && !ordered[j].in) j++;
    const leave = ordered[i].p;
    const back = j < ordered.length ? ordered[j].p : ordered[0].p;
    const [s0, s1] = [alongOf(leave), alongOf(back)];
    const forward = lineBetween(s0, s1, true);
    const backward = lineBetween(s0, s1, false);
    out.push(leave, ...(insideShare(forward, leave, back) >= insideShare(backward, leave, back) ? forward : backward));
    i = j;
  }
  const cleaned = out.filter((p, k) => k === 0 || dist(p, out[k - 1]) > 1e-10);
  cleaned.push(cleaned[0]);
  return cleaned.length >= 4 ? cleaned : ring;
}
