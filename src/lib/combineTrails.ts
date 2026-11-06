// Combining trails: several walks of one road leave lines side by side, a few
// yards apart from GPS drift. This keeps one line and folds the others into it.
// Where another line runs along the kept one it's dropped; where it carries on
// past an end the kept line gets longer; where it turns off, that part stays as
// its own branch, connected to the kept line.
import type { Position } from 'geojson';

import { lineLengthM, simplifyLine } from '@/lib/trails';

export const COMBINE_DISTANCES_FT = [30, 50, 80];
export const DEFAULT_COMBINE_FT = 50;
export const feetToMeters = (feet: number) => feet * 0.3048;

// Lines must run together at least this far to count as overlapping.
const MIN_OVERLAP_M = 30;
const STEP_M = 3;
// Past this many merges something is wrong; stop rather than hang.
const MAX_MERGES = 500;

interface Nearest {
  gap: number;
  along: number;
  at: Position;
}

function makeProjection(origin: Position) {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  const ky = 110_540;
  return { kx, ky };
}

function nearestOn(line: Position[], p: Position, kx: number, ky: number): Nearest {
  let best: Nearest = { gap: Infinity, along: 0, at: line[0] };
  let walked = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * ky;
    const length = Math.hypot(dx, dy);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * kx * dx + (p[1] - a[1]) * ky * dy) / (length * length)));
    const at = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const gap = Math.hypot((p[0] - at[0]) * kx, (p[1] - at[1]) * ky);
    if (gap < best.gap) best = { gap, along: walked + t * length, at };
    walked += length;
  }
  return best;
}

// Points every few meters along a line, keeping its corners.
function samplePoints(line: Position[], kx: number, ky: number): Position[] {
  const points: Position[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const steps = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) / STEP_M));
    for (let s = 0; s < steps; s++) points.push([a[0] + (s / steps) * (b[0] - a[0]), a[1] + (s / steps) * (b[1] - a[1])]);
  }
  points.push(line[line.length - 1]);
  return points;
}

export interface LineMerge {
  // The kept line, longer if the other carried on past one of its ends.
  line: Position[];
  // What's left of the other line, each part connected to the kept line.
  branches: Position[][];
}

// Folds `other` into `base`, or returns null when they don't run together.
export function mergeLines(base: Position[], other: Position[], distanceM: number): LineMerge | null {
  if (base.length < 2 || other.length < 2) return null;
  const { kx, ky } = makeProjection(base[0]);
  const samples = samplePoints(other, kx, ky).map((at) => ({ at, near: nearestOn(base, at, kx, ky) }));
  const runLength = (from: number, to: number) => lineLengthM(samples.slice(from, to + 1).map((s) => s.at));

  // Stretches that stay close for long enough.
  const covered = samples.map(() => false);
  for (let i = 0; i < samples.length; ) {
    if (samples[i].near.gap > distanceM) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < samples.length && samples[end + 1].near.gap <= distanceM) end++;
    // Measured along the kept line: a road crossing stays close for a while but
    // barely moves along it. A wider distance needs a longer run to rule out
    // a crossing at an angle.
    if (Math.abs(samples[end].near.along - samples[i].near.along) >= Math.max(MIN_OVERLAP_M, distanceM * 3)) covered.fill(true, i, end + 1);
    i = end + 1;
  }
  if (!covered.includes(true)) return null;

  // A short wander off the line between two close stretches is GPS drift.
  for (let i = 0; i < samples.length; ) {
    if (covered[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < samples.length && !covered[end + 1]) end++;
    if (i > 0 && end < samples.length - 1 && runLength(i - 1, end + 1) < MIN_OVERLAP_M) covered.fill(true, i, end + 1);
    i = end + 1;
  }

  // What's left, connected to the kept line wherever it leaves it.
  const baseLength = lineLengthM(base);
  const parts: { points: Position[]; joinStart: Nearest | null; joinEnd: Nearest | null }[] = [];
  for (let i = 0; i < samples.length; ) {
    if (covered[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < samples.length && !covered[end + 1]) end++;
    const joinStart = i > 0 ? samples[i - 1].near : null;
    const joinEnd = end < samples.length - 1 ? samples[end + 1].near : null;
    const walked = samples.slice(i, end + 1).map((s) => s.at);
    // A stub no longer than the gap between the lines is only drift at the end of a walk.
    if (lineLengthM(walked) > distanceM) parts.push({ points: simplifyLine(walked, 1), joinStart, joinEnd });
    i = end + 1;
  }

  let line = base;
  let startUsed = false;
  let endUsed = false;
  const branches: Position[][] = [];
  for (const part of parts) {
    const join = part.joinStart && part.joinEnd ? null : (part.joinStart ?? part.joinEnd);
    // Pointing away from the kept line, starting where it leaves.
    const outward = part.joinStart ? part.points : [...part.points].reverse();
    if (join && !startUsed && join.along <= distanceM) {
      line = [...[...outward].reverse(), ...line];
      startUsed = true;
    } else if (join && !endUsed && baseLength - join.along <= distanceM) {
      line = [...line, ...outward];
      endUsed = true;
    } else {
      branches.push([...(part.joinStart ? [part.joinStart.at] : []), ...part.points, ...(part.joinEnd ? [part.joinEnd.at] : [])]);
    }
  }
  return { line, branches };
}

export interface CombineResult {
  // Lines whose shape changed, by id.
  changed: Map<string, Position[]>;
  removed: string[];
  // New lines, each with the id of the line it came from.
  branches: { from: string; points: Position[] }[];
}

// Starting from one line, folds in every line that overlaps it, including any
// that only overlap a branch left over from an earlier merge.
export function combineLines(lines: { id: string; points: Position[] }[], startId: string, distanceM: number): CombineResult {
  const working = new Map(lines.map((l) => [l.id, { points: l.points, from: l.id, isBranch: false }]));
  const active = [startId];
  const changed = new Set<string>();
  const removed = new Set<string>();
  let nextBranch = 0;
  let merges = 0;

  while (active.length && merges < MAX_MERGES) {
    const id = active.pop() as string;
    const current = working.get(id);
    if (!current) continue;
    let grew = false;
    for (const [otherId, other] of working) {
      if (otherId === id) continue;
      const merged = mergeLines(current.points, other.points, distanceM);
      if (!merged) continue;
      merges++;
      if (merged.line !== current.points) {
        current.points = merged.line;
        changed.add(id);
        grew = true;
      }
      working.delete(otherId);
      if (!other.isBranch) removed.add(otherId);
      for (const points of merged.branches) {
        const branchId = `branch-${nextBranch++}`;
        working.set(branchId, { points, from: other.from, isBranch: true });
        active.push(branchId);
      }
    }
    // A longer line can now reach lines it couldn't before.
    if (grew) active.push(id);
  }

  return {
    changed: new Map([...changed].filter((id) => !id.startsWith('branch-') && working.has(id)).map((id) => [id, (working.get(id) as { points: Position[] }).points])),
    removed: [...removed],
    branches: [...working.values()].filter((l) => l.isBranch).map((l) => ({ from: l.from, points: l.points })),
  };
}

// Cuts a line in two at the point on it nearest `at`, or returns null if that's
// at one of its ends, which would leave a part too short to use.
export function splitLine(line: Position[], at: Position, minPartM = 5): [Position[], Position[]] | null {
  if (line.length < 2) return null;
  const { kx, ky } = makeProjection(line[0]);
  const { along, at: cut } = nearestOn(line, at, kx, ky);
  const first: Position[] = [line[0]];
  let walked = 0;
  let i = 0;
  for (; i < line.length - 1; i++) {
    const step = Math.hypot((line[i + 1][0] - line[i][0]) * kx, (line[i + 1][1] - line[i][1]) * ky);
    if (walked + step >= along) break;
    walked += step;
    first.push(line[i + 1]);
  }
  const parts: [Position[], Position[]] = [[...first, cut], [cut, ...line.slice(i + 1)]];
  return parts.every((part) => lineLengthM(part) >= minPartM) ? parts : null;
}

// Connects two lines by their closest ends, keeping the first line's direction.
export function joinLines(a: Position[], b: Position[]): { line: Position[]; gapM: number } {
  const flipped = [...b].reverse();
  const options = [
    { gapM: lineLengthM([a[a.length - 1], b[0]]), line: [a, b] },
    { gapM: lineLengthM([a[a.length - 1], b[b.length - 1]]), line: [a, flipped] },
    { gapM: lineLengthM([b[b.length - 1], a[0]]), line: [b, a] },
    { gapM: lineLengthM([b[0], a[0]]), line: [flipped, a] },
  ];
  const best = options.reduce((x, y) => (y.gapM < x.gapM ? y : x));
  const [first, second] = best.line;
  // Ends already touching don't need a second point on the same spot.
  return { line: best.gapM < 1 ? [...first, ...second.slice(1)] : [...first, ...second], gapM: best.gapM };
}

// The line nearest a clicked point, if any is within `maxM`.
export function nearestLine<T extends { id: string; points: Position[] }>(lines: T[], at: Position, maxM: number): T | null {
  let best: T | null = null;
  let bestGap = maxM;
  for (const line of lines) {
    if (line.points.length < 2) continue;
    const { kx, ky } = makeProjection(at);
    const { gap } = nearestOn(line.points, at, kx, ky);
    if (gap <= bestGap) {
      best = line;
      bestGap = gap;
    }
  }
  return best;
}

// Whether two lines run together, for spotting ones of a different type.
export const overlaps = (a: Position[], b: Position[], distanceM: number) => mergeLines(a, b, distanceM) !== null;
