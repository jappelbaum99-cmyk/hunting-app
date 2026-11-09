// Food plot soil tests: the lab's numbers, typed in, and what they mean to buy.
import booleanIntersects from '@turf/boolean-intersects';
import type { Polygon } from 'geojson';

import type { MapArea, MapMarker, PlotEntry, SoilTest, WorkSchedule } from '@/types/models';

export const LIME_BAG_LB = 40;
export const FERTILIZER_BAG_LB = 50;
export const DEFAULT_RETEST_YEARS = 3;

// Saved tests, newest first.
export function soilTests(area: MapArea): SoilTest[] {
  return (area.soilTests ?? []).filter((t) => !t.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function saveSoilTest(area: MapArea, test: SoilTest): MapArea {
  const list = area.soilTests ?? [];
  return { ...area, soilTests: list.some((t) => t.id === test.id) ? list.map((t) => (t.id === test.id ? test : t)) : [...list, test] };
}

export function removeSoilTest(area: MapArea, id: string): MapArea {
  const now = new Date().toISOString();
  return { ...area, soilTests: (area.soilTests ?? []).map((t) => (t.id === id ? { ...t, deletedAt: now, updatedAt: now } : t)) };
}

export type PhRating = { label: string; tone: 'bad' | 'fair' | 'good' };

// Most food plots do best from 6.0 to 7.0; clover and alfalfa like the top of that.
export function phRating(ph: number): PhRating {
  if (ph < 5.5) return { label: 'Low', tone: 'bad' };
  if (ph < 6) return { label: 'A little low', tone: 'fair' };
  if (ph <= 7) return { label: 'Good', tone: 'good' };
  if (ph <= 7.5) return { label: 'A little high', tone: 'fair' };
  return { label: 'High', tone: 'bad' };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const formatNumber = (n: number) => round1(n).toLocaleString();

// Tons of ag lime per acre, or null when an ENM recommendation has no ENM per ton to go with it.
export function limeTonsPerAcre(test: SoilTest): number | null {
  if (!test.lime) return null;
  if (test.limeUnits === 'tons') return test.lime;
  return test.limeEnm ? test.lime / test.limeEnm : null;
}

export interface LimeNeed {
  tons: number;
  bags: number;
}

export function limeFor(test: SoilTest, acres: number): LimeNeed | null {
  const perAcre = limeTonsPerAcre(test);
  if (!perAcre || acres <= 0) return null;
  const tons = perAcre * acres;
  return { tons, bags: Math.ceil((tons * 2000) / LIME_BAG_LB) };
}

// Bagged blends sold at farm stores, as N-P2O5-K2O percents.
export const BLENDS: { name: string; n: number; p: number; k: number }[] = [
  { name: '13-13-13', n: 13, p: 13, k: 13 },
  { name: '10-10-10', n: 10, p: 10, k: 10 },
  { name: '17-17-17', n: 17, p: 17, k: 17 },
  { name: '19-19-19', n: 19, p: 19, k: 19 },
  { name: '6-24-24', n: 6, p: 24, k: 24 },
  { name: '10-20-20', n: 10, p: 20, k: 20 },
  { name: '0-20-20', n: 0, p: 20, k: 20 },
  { name: '18-46-0', n: 18, p: 46, k: 0 },
  { name: '0-46-0', n: 0, p: 46, k: 0 },
  { name: '0-0-60', n: 0, p: 0, k: 60 },
  { name: '46-0-0', n: 46, p: 0, k: 0 },
  { name: '34-0-0', n: 34, p: 0, k: 0 },
];

export interface FertilizerPlan {
  blend: string;
  // Pounds of the blend per acre, and for the whole plot.
  perAcre: number;
  pounds: number;
  bags: number;
  // Pounds of N, P2O5 and K2O per acre it gives.
  gives: { n: number; p: number; k: number };
  // What it leaves short, per acre.
  short: { n: number; p: number; k: number };
}

const needOf = (test: SoilTest) => ({ n: test.nLbs ?? 0, p: test.pLbs ?? 0, k: test.kLbs ?? 0 });

export const needsFertilizer = (test: SoilTest) => {
  const need = needOf(test);
  return need.n > 0 || need.p > 0 || need.k > 0;
};

// Enough of the blend to cover the phosphorus and potassium (or the nitrogen, when
// that's all that's asked for), and what that gives and leaves short.
export function planBlend(test: SoilTest, blendName: string, acres: number): FertilizerPlan | null {
  const blend = BLENDS.find((b) => b.name === blendName);
  const need = needOf(test);
  if (!blend || acres <= 0 || !needsFertilizer(test)) return null;
  const drivers = (need.p > 0 || need.k > 0 ? (['p', 'k'] as const) : (['n'] as const)).filter((x) => need[x] > 0 && blend[x] > 0);
  if (!drivers.length) return null;
  const perAcre = Math.max(...drivers.map((x) => (need[x] * 100) / blend[x]));
  const gives = { n: (perAcre * blend.n) / 100, p: (perAcre * blend.p) / 100, k: (perAcre * blend.k) / 100 };
  const short = { n: Math.max(0, need.n - gives.n), p: Math.max(0, need.p - gives.p), k: Math.max(0, need.k - gives.k) };
  const pounds = perAcre * acres;
  return { blend: blend.name, perAcre, pounds, bags: Math.ceil(pounds / FERTILIZER_BAG_LB), gives, short };
}

// The blend that comes closest: shortfalls count double, and extra counts too,
// since it's money spread on the ground.
export function bestBlend(test: SoilTest): string | null {
  const need = needOf(test);
  let best: { name: string; score: number } | null = null;
  for (const blend of BLENDS) {
    const plan = planBlend(test, blend.name, 1);
    if (!plan) continue;
    const score = (['n', 'p', 'k'] as const).reduce((sum, x) => sum + 2 * plan.short[x] + Math.max(0, plan.gives[x] - need[x]), 0);
    if (!best || score < best.score) best = { name: blend.name, score };
  }
  return best?.name ?? null;
}

// A one-line summary of the results, for the plot log and lists.
export function testSummary(test: SoilTest): string {
  const unit = test.units === 'ppm' ? ' ppm' : ' lb/ac';
  const parts = [
    test.ph != null ? `pH ${test.ph}` : null,
    test.p != null ? `P ${formatNumber(test.p)}${unit}` : null,
    test.k != null ? `K ${formatNumber(test.k)}${unit}` : null,
    test.om != null ? `OM ${test.om}%` : null,
  ];
  return parts.filter(Boolean).join(' · ') || 'No numbers saved';
}

// The plot log entry that goes with a test, sharing its id.
export function logEntryForTest(test: SoilTest, existing?: PlotEntry): PlotEntry {
  return {
    id: test.id,
    action: 'soil_test',
    what: null,
    date: test.date,
    notes: testSummary(test),
    createdAt: existing?.createdAt ?? test.createdAt,
    deletedAt: test.deletedAt,
  };
}

export const retestSchedule = (area: MapArea): WorkSchedule | undefined => (area.schedules ?? []).find((s) => s.work === 'soil_test' && !s.deletedAt);

export function newRetestSchedule(lastDone: string, everyYears = DEFAULT_RETEST_YEARS): WorkSchedule {
  return { id: crypto.randomUUID(), work: 'soil_test', detail: null, everyYears, startMonth: 2, endMonth: 3, lastDone, handledSeason: null, createdAt: new Date().toISOString(), deletedAt: null };
}

// The Action Board card for the work a test calls for, or null when it calls for none.
export function workText(plotName: string, test: SoilTest, acres: number, blend: string | null): string | null {
  const lime = limeFor(test, acres);
  const plan = blend ? planBlend(test, blend, acres) : null;
  const parts = [
    lime ? `lime ${formatNumber(lime.tons)} tons (${lime.bags.toLocaleString()} ${LIME_BAG_LB}-lb bags)` : null,
    plan ? `${Math.round(plan.pounds).toLocaleString()} lb ${plan.blend} (${plan.bags} bags)` : null,
  ].filter(Boolean);
  return parts.length ? `${plotName}: ${parts.join(', ')}` : null;
}

// ---------- Soil tests taken in the field (groups of sample spots) ----------


export interface SampleRun {
  // The phone's test id, or for spots dropped on the hub, the field and day.
  key: string;
  // The field typed or picked on the phone, if any.
  fieldName: string | null;
  // The field (area) it belongs to, once known.
  areaId: string | null;
  spots: MapMarker[];
  firstAt: string;
  lastAt: string;
  // The test made from it, once results are in.
  test: { areaId: string; testId: string } | null;
}

const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Every soil test taken in the field: sample spots grouped by the phone's test,
// or (dropped on the hub) by field and day, with the test they went into.
export function sampleRuns(markers: MapMarker[], areas: MapArea[]): SampleRun[] {
  const spots = markers.filter((m) => m.type === 'soil_sample' && !m.deletedAt);
  const areaOf = (m: MapMarker) =>
    m.sampleOf ?? areas.find((a) => !a.deletedAt && booleanIntersects({ type: 'Point', coordinates: [m.lng, m.lat] }, a.geometry))?.id ?? null;
  const testOf = new Map<string, { areaId: string; testId: string }>();
  for (const area of areas) for (const t of soilTests(area)) for (const id of t.sampleIds ?? []) testOf.set(id, { areaId: area.id, testId: t.id });
  const runs = new Map<string, SampleRun>();
  for (const m of spots) {
    const areaId = areaOf(m);
    const key = m.soilRun?.id ?? `hub:${areaId ?? 'none'}:${dayOf(m.createdAt)}`;
    let run = runs.get(key);
    if (!run) {
      run = { key, fieldName: m.soilRun?.fieldName ?? null, areaId, spots: [], firstAt: m.createdAt, lastAt: m.createdAt, test: null };
      runs.set(key, run);
    }
    run.spots.push(m);
    run.areaId ??= areaId;
    if (m.createdAt < run.firstAt) run.firstAt = m.createdAt;
    if (m.createdAt > run.lastAt) run.lastAt = m.createdAt;
    run.test ??= testOf.get(m.id) ?? null;
  }
  return [...runs.values()].map((r) => ({ ...r, spots: r.spots.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export const runName = (run: Pick<SampleRun, 'fieldName' | 'firstAt'>, areaName?: string | null) =>
  areaName || run.fieldName || `Soil test ${new Date(run.firstAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

// A field outline drawn around sample spots: the outside points, pushed out a
// little so the spots sit inside. Too few spots make a small square.
export function fieldAroundSpots(spots: { lng: number; lat: number }[]): Polygon {
  const lat0 = spots.reduce((t, s) => t + s.lat, 0) / spots.length;
  const lng0 = spots.reduce((t, s) => t + s.lng, 0) / spots.length;
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = spots.map((s) => ({ x: (s.lng - lng0) * mPerLng, y: (s.lat - lat0) * mPerLat }));
  const back = (p: { x: number; y: number }): [number, number] => [lng0 + p.x / mPerLng, lat0 + p.y / mPerLat];
  // Monotone chain hull.
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const PAD = 15;
  if (hull.length < 3) {
    const half = 25;
    const ring = [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ].map((p) => ({ x: p.x + (pts[0]?.x ?? 0), y: p.y + (pts[0]?.y ?? 0) }));
    return { type: 'Polygon', coordinates: [[...ring, ring[0]].map(back)] };
  }
  const cx = hull.reduce((t, p) => t + p.x, 0) / hull.length;
  const cy = hull.reduce((t, p) => t + p.y, 0) / hull.length;
  const grown = hull.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((p.x - cx) / d) * PAD, y: p.y + ((p.y - cy) / d) * PAD };
  });
  return { type: 'Polygon', coordinates: [[...grown, grown[0]].map(back)] };
}
