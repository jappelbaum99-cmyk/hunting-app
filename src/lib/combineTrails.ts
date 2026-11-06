// Combining trails: several walks of one road leave lines side by side, a few
// yards apart from GPS drift, and one walk out and back lies on top of itself.
// This keeps one line and folds the rest into it. Where a line runs along the
// kept one it's dropped; where it carries on past an end the kept line gets
// longer; where it turns off, that part stays as its own branch, connected to
// the kept line.
import type { Position } from 'geojson';

import { lineLengthM, simplifyLine } from '@/lib/trails';

export const COMBINE_DISTANCES_FT = [30, 50, 80, 120];
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

// The closest point on a line, looking only as far along it as `upTo`.
function nearestOn(line: Position[], p: Position, kx: number, ky: number, upTo = Infinity): Nearest {
  let best: Nearest = { gap: Infinity, along: 0, at: line[0] };
  let walked = 0;
  for (let i = 0; i < line.length - 1 && walked < upTo; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * ky;
    const length = Math.hypot(dx, dy);
    const limit = length === 0 ? 0 : Math.min(1, (upTo - walked) / length);
    const t = length === 0 ? 0 : Math.max(0, Math.min(limit, ((p[0] - a[0]) * kx * dx + (p[1] - a[1]) * ky * dy) / (length * length)));
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

type Sample = { at: Position; near: Nearest };
type Part = { points: Position[]; joinStart: Nearest | null; joinEnd: Nearest | null };

// Which samples lie along the other line, and what's left over between them.
function leftoverParts(samples: Sample[], distanceM: number): Part[] | null {
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
    // Measured along the other line: a road crossing stays close for a while but
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

  const parts: Part[] = [];
  for (let i = 0; i < samples.length; ) {
    if (covered[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < samples.length && !covered[end + 1]) end++;
    const walked = samples.slice(i, end + 1).map((s) => s.at);
    // A stub no longer than the gap between the lines is only drift at the end of a walk.
    if (lineLengthM(walked) > distanceM) {
      parts.push({ points: simplifyLine(walked, 1), joinStart: i > 0 ? samples[i - 1].near : null, joinEnd: end < samples.length - 1 ? samples[end + 1].near : null });
    }
    i = end + 1;
  }
  return parts;
}

export interface LineMerge {
  // The kept line, longer if the other carried on past one of its ends.
  line: Position[];
  // What's left of the other line, each part connected to the kept line.
  branches: Position[][];
}

// Adds what's left to the kept line: past its ends if that's where a part
// leaves it, otherwise as a connected branch.
function attachParts(base: Position[], parts: Part[], distanceM: number): LineMerge {
  const { kx, ky } = makeProjection(base[0]);
  const baseLength = lineLengthM(base);
  let line = base;
  let startUsed = false;
  let endUsed = false;
  const branches: Position[][] = [];
  for (const part of parts) {
    const join = part.joinStart && part.joinEnd ? null : (part.joinStart ?? part.joinEnd);
    const along = join ? nearestOn(base, join.at, kx, ky).along : 0;
    // Pointing away from the kept line, starting where it leaves.
    const outward = part.joinStart ? part.points : [...part.points].reverse();
    if (join && !startUsed && along <= distanceM) {
      line = [...[...outward].reverse(), ...line];
      startUsed = true;
    } else if (join && !endUsed && baseLength - along <= distanceM) {
      line = [...line, ...outward];
      endUsed = true;
    } else {
      branches.push([...(part.joinStart ? [part.joinStart.at] : []), ...part.points, ...(part.joinEnd ? [part.joinEnd.at] : [])]);
    }
  }
  return { line, branches };
}

// Folds `other` into `base`, or returns null when they don't run together.
export function mergeLines(base: Position[], other: Position[], distanceM: number): LineMerge | null {
  if (base.length < 2 || other.length < 2) return null;
  const { kx, ky } = makeProjection(base[0]);
  const samples = samplePoints(other, kx, ky).map((at) => ({ at, near: nearestOn(base, at, kx, ky) }));
  const parts = leftoverParts(samples, distanceM);
  return parts && attachParts(base, parts, distanceM);
}

// A line that runs back over itself, as a walk out and back does, keeps its
// first pass. Returns null when it never doubles back.
export function foldLine(line: Position[], distanceM: number): LineMerge | null {
  if (line.length < 2) return null;
  const { kx, ky } = makeProjection(line[0]);
  // The stretch just walked is always close by; it only counts as doubling back
  // once the line has gone much farther than the gap between the passes.
  const awayM = Math.max(MIN_OVERLAP_M, distanceM * 2);
  let walked = 0;
  const points = samplePoints(line, kx, ky);
  const samples = points.map((at, i) => {
    if (i > 0) walked += Math.hypot((at[0] - points[i - 1][0]) * kx, (at[1] - points[i - 1][1]) * ky);
    return { at, near: walked > awayM ? nearestOn(line, at, kx, ky, walked - awayM) : { gap: Infinity, along: 0, at } };
  });
  const parts = leftoverParts(samples, distanceM);
  // The line starts on its first pass, so the first part left over is the keeper.
  if (!parts || parts.length === 0 || parts[0].joinStart) return null;
  return attachParts(parts[0].points, parts.slice(1), distanceM);
}

export interface CombineResult {
  // Lines whose shape changed, by id.
  changed: Map<string, Position[]>;
  removed: string[];
  // New lines, each with the id of the line it came from.
  branches: { from: string; points: Position[] }[];
}

// Starting from one line, folds in every line that overlaps it, including any
// that only overlap a branch left over from an earlier merge. Lines doubling
// back on themselves are straightened out first.
export function combineLines(lines: { id: string; points: Position[] }[], startId: string, distanceM: number): CombineResult {
  const working = new Map(lines.map((l) => [l.id, { points: l.points, from: l.id, isBranch: false }]));
  const active = [startId];
  const changed = new Set<string>();
  const removed = new Set<string>();
  let nextBranch = 0;
  let merges = 0;
  const addBranches = (points: Position[][], from: string) => {
    for (const branch of points) {
      const branchId = `branch-${nextBranch++}`;
      working.set(branchId, { points: branch, from, isBranch: true });
      active.push(branchId);
    }
  };

  const start = working.get(startId);
  const startFolded = start && foldLine(start.points, distanceM);
  if (start && startFolded) {
    start.points = startFolded.line;
    changed.add(startId);
    addBranches(startFolded.branches, startId);
  }

  while (active.length && merges < MAX_MERGES) {
    const id = active.pop() as string;
    const current = working.get(id);
    if (!current) continue;
    let grew = false;
    for (const [otherId, other] of working) {
      if (otherId === id) continue;
      const folded = foldLine(other.points, distanceM);
      const merged = mergeLines(current.points, folded?.line ?? other.points, distanceM);
      if (!merged) continue;
      merges++;
      if (merged.line !== current.points) {
        current.points = merged.line;
        changed.add(id);
        grew = true;
      }
      working.delete(otherId);
      if (!other.isBranch) removed.add(otherId);
      addBranches([...merged.branches, ...(folded?.branches ?? [])], other.from);
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

// The part of a line between two distances along it.
function sliceLine(line: Position[], from: number, to: number, kx: number, ky: number): Position[] {
  const points: Position[] = [];
  let walked = 0;
  const pointAt = (a: Position, b: Position, t: number): Position => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const length = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
    const end = walked + length;
    if (length > 0 && end >= from && walked <= to) {
      if (points.length === 0) points.push(from <= walked ? a : pointAt(a, b, (from - walked) / length));
      points.push(to >= end ? b : pointAt(a, b, (to - walked) / length));
    }
    walked = end;
  }
  return points;
}

// Cuts a line in two at the point on it nearest `at`, or returns null if that's
// at one of its ends, which would leave a part too short to use.
export function splitLine(line: Position[], at: Position, minPartM = 5): [Position[], Position[]] | null {
  if (line.length < 2) return null;
  const { kx, ky } = makeProjection(line[0]);
  const { along } = nearestOn(line, at, kx, ky);
  const total = lineLengthM(line);
  const parts: [Position[], Position[]] = [sliceLine(line, 0, along, kx, ky), sliceLine(line, along, Infinity, kx, ky)];
  return total > 0 && parts.every((part) => part.length >= 2 && lineLengthM(part) >= minPartM) ? parts : null;
}

// What's left of a line once the stretch between two clicked spots is gone: up
// to two parts, leaving out any too short to use.
export function removeStretch(line: Position[], a: Position, b: Position, minPartM = 5): Position[][] {
  if (line.length < 2) return [line];
  const { kx, ky } = makeProjection(line[0]);
  const [from, to] = [nearestOn(line, a, kx, ky).along, nearestOn(line, b, kx, ky).along].sort((x, y) => x - y);
  return [sliceLine(line, 0, from, kx, ky), sliceLine(line, to, Infinity, kx, ky)].filter((part) => part.length >= 2 && lineLengthM(part) >= minPartM);
}

// How close to a line's end still counts as meeting its end, not its middle.
const END_ZONE_M = 10;
// How far back from its end a line may have run past the one it meets.
const OVERSHOOT_M = 30;
// Samples are STEP_M apart, so one always lands this close to a crossing.
const CROSSING_M = 2;

// Where a line's end meets another line partway along: the T. Null if it reaches an end.
function findT(line: Position[], other: Position[], kx: number, ky: number): { gapM: number; line: Position[]; other: Position[] } | null {
  let best: { gapM: number; line: Position[]; other: Position[] } | null = null;
  const lengthOf = (points: Position[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot((p[0] - points[i][0]) * kx, (p[1] - points[i][1]) * ky), 0);
  const otherLength = lengthOf(other);
  for (const end of [line[0], line[line.length - 1]]) {
    const atStart = end === line[0];
    const near = nearestOn(other, end, kx, ky);
    if (near.along <= END_ZONE_M || otherLength - near.along <= END_ZONE_M) continue;
    if (best && near.gap >= best.gapM) continue;
    const pointing = atStart ? [...line].reverse() : line;
    const length = lengthOf(pointing);
    // If it ran a little past the other line, stop it where they cross. Never
    // looks back over more than half the line, so a short one can't vanish.
    let cut = Infinity;
    const tailStart = Math.max(length / 2, length - OVERSHOOT_M);
    const tail = samplePoints(sliceLine(pointing, tailStart, Infinity, kx, ky), kx, ky);
    for (let i = 0; i < tail.length && cut === Infinity; i++) {
      if (nearestOn(other, tail[i], kx, ky).gap < CROSSING_M) cut = tailStart + lengthOf(tail.slice(0, i + 1));
    }
    const kept = sliceLine(pointing, 0, cut, kx, ky);
    const meet = cut === Infinity ? near : nearestOn(other, kept[kept.length - 1], kx, ky);
    const trimmed = [...kept, meet.at];
    // Joining a pair again meets at a corner that's already there.
    const noRepeats = (points: Position[]) => points.filter((p, i) => i === 0 || Math.hypot((p[0] - points[i - 1][0]) * kx, (p[1] - points[i - 1][1]) * ky) > 0.01);
    best = {
      gapM: cut === Infinity ? near.gap : 0,
      line: noRepeats(atStart ? trimmed.reverse() : trimmed),
      // The meeting point becomes a corner of the other line, so the two share it.
      other: noRepeats([...sliceLine(other, 0, meet.along, kx, ky), ...sliceLine(other, meet.along, Infinity, kx, ky).slice(1)]),
    };
  }
  return best;
}

export type LineConnection =
  // End to end: one line now.
  | { kind: 'ends'; line: Position[]; gapM: number }
  // One line's end meets the other partway along. A line can't fork, so they stay two lines.
  | { kind: 't'; a: Position[]; b: Position[]; gapM: number };

// Connects two lines where they come closest, end to end or at a T.
export function connectLines(a: Position[], b: Position[]): LineConnection {
  const { kx, ky } = makeProjection(a[0]);
  const ends = joinLines(a, b);
  const aMeetsB = findT(a, b, kx, ky);
  const bMeetsA = findT(b, a, kx, ky);
  const t = aMeetsB && (!bMeetsA || aMeetsB.gapM <= bMeetsA.gapM) ? { a: aMeetsB.line, b: aMeetsB.other, gapM: aMeetsB.gapM } : bMeetsA && { a: bMeetsA.other, b: bMeetsA.line, gapM: bMeetsA.gapM };
  return t && t.gapM < ends.gapM ? { kind: 't', ...t } : { kind: 'ends', ...ends };
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

// Lines closer than this at their ends count as connected.
const TOUCH_M = 1;
// A click this close to where two lines meet means that meeting point.
const JUNCTION_M = 10;
// Both spots of a Delete part must be this close to one stretch.
const SAME_STRETCH_M = 20;

// Sorts lines into sets that connect to each other, first line's set first.
function groupParts(parts: Position[][], apart: (i: number, j: number) => boolean = () => false): Position[][][] {
  const { kx, ky } = makeProjection(parts[0][0]);
  const endsOn = (x: Position[], y: Position[]) => [x[0], x[x.length - 1]].some((end) => nearestOn(y, end, kx, ky).gap < TOUCH_M);
  const group = parts.map((_, i) => i);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (apart(i, j) || !(endsOn(parts[i], parts[j]) || endsOn(parts[j], parts[i]))) continue;
      const [keep, drop] = [Math.min(group[i], group[j]), Math.max(group[i], group[j])];
      for (let k = 0; k < group.length; k++) if (group[k] === drop) group[k] = keep;
    }
  }
  return [...new Set(group)].map((id) => parts.filter((_, i) => group[i] === id));
}

// Makes two trails one: their closest lines are joined end to end if they meet
// that way, or left as branches sharing a point if they meet at a T.
export function joinParts(a: Position[][], b: Position[][]): { parts: Position[][]; gapM: number } {
  let best: { i: number; j: number; connection: LineConnection } | null = null;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const connection = connectLines(a[i], b[j]);
      if (!best || connection.gapM < best.connection.gapM) best = { i, j, connection };
    }
  }
  if (!best) return { parts: a, gapM: 0 };
  const { i, j, connection } = best;
  const parts =
    connection.kind === 'ends'
      ? [...a.map((part, n) => (n === i ? connection.line : part)), ...b.filter((_, n) => n !== j)]
      : [...a.map((part, n) => (n === i ? connection.a : part)), ...b.map((part, n) => (n === j ? connection.b : part))];
  return { parts, gapM: connection.gapM };
}

function nearestPart(parts: Position[][], at: Position): number {
  const { kx, ky } = makeProjection(at);
  let best = 0;
  let bestGap = Infinity;
  parts.forEach((part, i) => {
    const { gap } = nearestOn(part, at, kx, ky);
    if (gap < bestGap) [best, bestGap] = [i, gap];
  });
  return best;
}

// Cuts a trail where clicked, returning each set of lines that's now apart. At
// a T it unhooks the branch and leaves the line it met whole. Null if nothing
// comes apart: right at an end, or the lines still connect another way.
export function cutParts(parts: Position[][], at: Position): Position[][][] | null {
  const { kx, ky } = makeProjection(at);
  const distance = (p: Position) => Math.hypot((p[0] - at[0]) * kx, (p[1] - at[1]) * ky);
  const unhook = new Set<string>();
  parts.forEach((y, j) => {
    parts.forEach((x, i) => {
      if (i !== j && [y[0], y[y.length - 1]].some((end) => distance(end) < JUNCTION_M && nearestOn(x, end, kx, ky).gap < TOUCH_M)) unhook.add(`${Math.min(i, j)},${Math.max(i, j)}`);
    });
  });
  if (unhook.size > 0) {
    const groups = groupParts(parts, (i, j) => unhook.has(`${i},${j}`));
    if (groups.length > 1) return groups;
  }
  const index = nearestPart(parts, at);
  const pieces = splitLine(parts[index], at);
  if (!pieces) return null;
  const next = [...parts.map((part, n) => (n === index ? pieces[0] : part)), pieces[1]];
  const groups = groupParts(next, (i, j) => i === index && j === next.length - 1);
  return groups.length > 1 ? groups : null;
}

// What's left of a trail once the stretch between two spots is gone, as sets of
// connected lines; empty if nothing is. Null if the spots are on different lines.
export function removeFromParts(parts: Position[][], a: Position, b: Position): Position[][][] | null {
  const { kx, ky } = makeProjection(a);
  let index = -1;
  let bestGap = Infinity;
  parts.forEach((part, i) => {
    const gap = Math.max(nearestOn(part, a, kx, ky).gap, nearestOn(part, b, kx, ky).gap);
    if (gap < bestGap) [index, bestGap] = [i, gap];
  });
  if (bestGap > SAME_STRETCH_M) return null;
  const next = parts.flatMap((part, i) => (i === index ? removeStretch(part, a, b) : [part]));
  return next.length > 0 ? groupParts(next) : [];
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
