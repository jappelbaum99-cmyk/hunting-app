// Test a stand spot: replays past seasons' weather (October through December)
// over a spot you might hang a stand, and checks every morning and evening sit
// for whether your scent reaches the way deer come and go. The wind carries it
// in a cone; thermals carry it up or down the land; whichever leads at the
// moment decides. Weather is Open-Meteo's history (free, no key), the same
// service as the forecast.
import booleanIntersects from '@turf/boolean-intersects';
import type { Polygon } from 'geojson';

import { scentCone } from '@/lib/scent';
import { compassPointOf } from '@/lib/standRating';
import {
  BAD_PULL,
  shelterAt,
  shelteredWind,
  sunPosition,
  terrainAt,
  thermalAt,
  traceThermalPath,
  WEAK_PULL,
  withWind,
  type ElevationAt,
  type Terrain,
  type ThermalPath,
  type ThermalState,
} from '@/lib/thermals';
import { fetchHistory, weatherAt, type Forecast, type ForecastHour } from '@/lib/weather';
import { COMPASS_POINTS, type CompassPoint } from '@/types/models';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Seasons tested: the last few that are over.
export const TEST_YEARS = 3;
// Each sit is checked this often.
const STEP = 15 * MINUTE;
// Above this the thermals lead and the wind's cone no longer decides where scent goes.
const THERMALS_LEAD = 0.55;
// Scent spreads as it drifts: a thermal path counts as reaching the deer's way
// when it passes this close, plus a little more the further it has gone.
const PATH_REACH_M = 15;
const PATH_SPREAD = 0.12;
const PATH_STEP_M = 8;

// What a moment at the spot comes to: scent stays clear of the deer, swirls
// (thermals switching), or the wind or the thermals carry it onto their way.
export type MomentVerdict = 'clean' | 'swirl' | 'wind' | 'thermal';

export interface Moment {
  time: number;
  verdict: MomentVerdict;
  hour: ForecastHour;
  cone: Polygon;
  thermal: ThermalState | null;
  path: ThermalPath | null;
}

export interface TestSit {
  id: string;
  season: number;
  // Local date, e.g. '2025-11-04'.
  date: string;
  half: 'am' | 'pm';
  start: number;
  end: number;
  // Where the slider starts: the moment deer are most likely moving.
  peak: number;
  // Share of the sit the scent stayed clear (prime time counts double), 0-1.
  clean: number;
  verdict: 'good' | 'ok' | 'bad';
  // Shares of the sit's checks the wind or thermals carried scent to the deer, or it swirled.
  wind: number;
  thermal: number;
  swirl: number;
  // The wind when deer are moving.
  peakWind: CompassPoint;
  peakMph: number;
  // When thermals stopped (morning) or started (evening) carrying scent to the deer, if they did.
  thermalUntil: number | null;
  thermalFrom: number | null;
}

export interface StandTestResult {
  seasons: Forecast[];
  sits: TestSit[];
  // 0-100: how much of the prime time over all sits stayed clean.
  score: number;
  grade: 'Good' | 'Fair' | 'Poor';
  byHalf: Record<'am' | 'pm', { sits: number; good: number; ok: number; bad: number; clean: number }>;
  byMonth: { month: number; label: string; clean: number; sits: number }[];
  // Over all checks: how often each one decided.
  shares: Record<MomentVerdict, number>;
  // By the wind's direction: how often scent stayed clean with that wind. Calm is under 3 mph.
  byWind: { point: CompassPoint | 'calm'; checks: number; clean: number }[];
  // Winds it does well on: these are the spot's "good winds".
  goodWinds: CompassPoint[];
  notes: string[];
}

export interface TestPlace {
  spot: [number, number];
  // Where deer come from to where they go, [lng, lat].
  route: [number, number][];
}

// ---------- Weather ----------

const seasonCache = new Map<string, Promise<Forecast>>();

// October through December of `year`, cached for the session.
function season(lat: number, lng: number, year: number, signal?: AbortSignal): Promise<Forecast> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${year}`;
  let pending = seasonCache.get(key);
  if (!pending) {
    pending = fetchHistory(lat, lng, `${year}-10-01`, `${year}-12-31`, signal).then((f) => ({ ...f, days: sunDays(lat, lng, year) }));
    pending.catch(() => seasonCache.delete(key));
    seasonCache.set(key, pending);
  }
  return pending;
}

// The seasons to test: the last TEST_YEARS that are over (history runs a few days behind).
export function testSeasons(now = new Date()): number[] {
  const lastDone = now.getMonth() === 11 && now.getDate() === 31 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: TEST_YEARS }, (_, i) => lastDone - TEST_YEARS + 1 + i);
}

export async function fetchSeasons(lat: number, lng: number, years: number[], signal?: AbortSignal): Promise<Forecast[]> {
  return Promise.all(years.map((y) => season(lat, lng, y, signal)));
}

// Sunrise and sunset for each day, worked out from the sun's position, so the
// clocks changing in November doesn't move them.
function sunDays(lat: number, lng: number, year: number): Forecast['days'] {
  const days: Forecast['days'] = [];
  const up = (t: number) => sunPosition(t, lat, lng).elevation > -0.833;
  // The moment the sun crosses the horizon between a and b (one up, one down).
  const crossing = (a: number, b: number) => {
    const rising = up(b);
    for (let i = 0; i < 20; i++) {
      const mid = (a + b) / 2;
      if (up(mid) === rising) b = mid;
      else a = mid;
    }
    return b;
  };
  for (let t = Date.UTC(year, 9, 1); t <= Date.UTC(year, 11, 31); t += DAY) {
    // Solar noon there, near enough.
    const noon = t + 12 * HOUR - (lng / 15) * HOUR;
    const d = new Date(t);
    days.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      sunrise: crossing(noon - 12 * HOUR, noon),
      sunset: crossing(noon, noon + 12 * HOUR),
    });
  }
  return days;
}

// ---------- One moment ----------

function toMeters(origin: [number, number]) {
  const mx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  return ([lng, lat]: [number, number]): [number, number] => [(lng - origin[0]) * mx, (lat - origin[1]) * 110_540];
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}

export interface MomentContext {
  place: TestPlace;
  terrain: Terrain | null;
  elevationAt: ElevationAt;
  // The route in meters around the spot.
  routeM: [number, number][];
  toM: (p: [number, number]) => [number, number];
}

export function momentContext(place: TestPlace, elevationAt: ElevationAt): MomentContext {
  const toM = toMeters(place.spot);
  return { place, terrain: terrainAt(place.spot, elevationAt), elevationAt, routeM: place.route.map(toM), toM };
}

function distToRoute(p: [number, number], routeM: [number, number][]): number {
  if (routeM.length === 1) return Math.hypot(p[0] - routeM[0][0], p[1] - routeM[0][1]);
  let best = Infinity;
  for (let j = 1; j < routeM.length; j++) best = Math.min(best, distToSegment(p, routeM[j - 1], routeM[j]));
  return best;
}

// Whether the thermal path carries scent onto the deer's way: it has to drift
// toward it, not just start near it. A stand 10 m above a trail with the air
// rising sends scent up and away, and deer pass under it.
function pathReachesRoute(path: ThermalPath, ctx: MomentContext): boolean {
  const { routeM, toM } = ctx;
  const atStand = distToRoute([0, 0], routeM);
  return path.points.some((pt, i) => {
    if (i === 0) return false;
    const d = distToRoute(toM(pt), routeM);
    const reach = PATH_REACH_M + i * PATH_STEP_M * PATH_SPREAD;
    return d < reach && d < atStand - PATH_STEP_M / 2;
  });
}

// What the wind and thermals do with your scent at the spot at `time`.
export function momentAt(forecast: Forecast, time: number, ctx: MomentContext): Moment {
  const hour = weatherAt(forecast, time);
  const { spot, route } = ctx.place;
  const cone = scentCone(spot[0], spot[1], hour);
  const routeLine = route.length > 1 ? { type: 'LineString' as const, coordinates: route } : { type: 'Point' as const, coordinates: route[0] };
  const windHits = route.length > 0 && booleanIntersects(cone, routeLine);
  let thermal: ThermalState | null = null;
  let path: ThermalPath | null = null;
  if (ctx.elevationAt(spot[0], spot[1]) !== null) {
    const state = thermalAt(forecast, time, ctx.terrain);
    if (state) {
      const shelter = shelterAt(spot, hour.windFromDeg, ctx.elevationAt);
      thermal = withWind(state, shelteredWind(state.windMph, shelter));
      path = traceThermalPath(spot, thermal, hour.windFromDeg, ctx.elevationAt);
    }
  }
  const pull = thermal?.pull ?? 0;
  let verdict: MomentVerdict = 'clean';
  if (path && pull >= BAD_PULL && route.length > 0 && pathReachesRoute(path, ctx)) verdict = 'thermal';
  else if (windHits && pull < THERMALS_LEAD) verdict = 'wind';
  else if (thermal?.phase === 'switching' && pull >= WEAK_PULL) verdict = 'swirl';
  return { time, verdict, hour, cone, thermal, path };
}

// ---------- The seasons ----------

const MONTH_LABELS = ['October', 'November', 'December'];
const COMPASS_WORDS: Record<CompassPoint, string> = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

// e.g. "1 hour 20 minutes after sunrise".
function relative(mins: number, event: string): string {
  const m = Math.abs(mins);
  const span = m >= 60 ? `${Math.floor(m / 60)} hour${m >= 120 ? 's' : ''}${m % 60 ? ` ${m % 60} minutes` : ''}` : `${m} minutes`;
  return mins === 0 ? event : `${span} ${mins > 0 ? 'after' : 'before'} ${event}`;
}

// Morning: an hour before sunrise to 3 hours after; evening: 3 hours before
// sunset to 30 minutes after, the same as the forecast's sits.
function sitsOf(forecast: Forecast, seasonYear: number): Omit<TestSit, 'clean' | 'verdict' | 'wind' | 'thermal' | 'swirl' | 'peakWind' | 'peakMph' | 'thermalUntil' | 'thermalFrom'>[] {
  return forecast.days.flatMap((d) => [
    { id: `${d.date}-am`, season: seasonYear, date: d.date, half: 'am' as const, start: d.sunrise - HOUR, end: d.sunrise + 3 * HOUR, peak: d.sunrise },
    { id: `${d.date}-pm`, season: seasonYear, date: d.date, half: 'pm' as const, start: d.sunset - 3 * HOUR, end: d.sunset + HOUR / 2, peak: d.sunset - HOUR },
  ]);
}

// Prime time, when deer move most: counts double.
function isPrime(half: 'am' | 'pm', t: number, sunrise: number, sunset: number): boolean {
  return half === 'am' ? t >= sunrise - 30 * MINUTE && t <= sunrise + 90 * MINUTE : t >= sunset - 90 * MINUTE && t <= sunset + 30 * MINUTE;
}

// Runs every sit. Yields to the page now and then (onProgress 0-1) so it stays responsive.
export async function testStand(
  seasons: Forecast[],
  years: number[],
  place: TestPlace,
  elevationAt: ElevationAt,
  onProgress?: (done: number) => void,
  signal?: AbortSignal,
): Promise<StandTestResult> {
  const ctx = momentContext(place, elevationAt);
  const sits: TestSit[] = [];
  const shares: Record<MomentVerdict, number> = { clean: 0, swirl: 0, wind: 0, thermal: 0 };
  const windTally = new Map<CompassPoint | 'calm', { checks: number; clean: number }>();
  const all = seasons.flatMap((f, i) => sitsOf(f, years[i]).map((s) => ({ s, f })));
  let checks = 0;
  for (let n = 0; n < all.length; n++) {
    if (n % 40 === 0) {
      signal?.throwIfAborted();
      onProgress?.(n / all.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const { s, f } = all[n];
    const day = f.days.find((d) => d.date === s.date)!;
    let weight = 0;
    let cleanWeight = 0;
    const count: Record<MomentVerdict, number> = { clean: 0, swirl: 0, wind: 0, thermal: 0 };
    let thermalUntil: number | null = null;
    let thermalFrom: number | null = null;
    let samples = 0;
    for (let t = s.start; t <= s.end; t += STEP) {
      const m = momentAt(f, t, ctx);
      const w = isPrime(s.half, t, day.sunrise, day.sunset) ? 2 : 1;
      weight += w;
      if (m.verdict === 'clean') cleanWeight += w;
      count[m.verdict]++;
      shares[m.verdict]++;
      samples++;
      checks++;
      if (m.verdict === 'thermal') {
        thermalUntil = t;
        thermalFrom ??= t;
      }
      const point = m.hour.windMph < 3 ? 'calm' : compassPointOf(m.hour.windFromDeg);
      const tally = windTally.get(point) ?? { checks: 0, clean: 0 };
      tally.checks++;
      if (m.verdict === 'clean') tally.clean++;
      windTally.set(point, tally);
    }
    const clean = weight ? cleanWeight / weight : 0;
    const peakHour = weatherAt(f, s.peak);
    sits.push({
      ...s,
      clean,
      verdict: clean >= 0.8 ? 'good' : clean >= 0.5 ? 'ok' : 'bad',
      wind: count.wind / samples,
      thermal: count.thermal / samples,
      swirl: count.swirl / samples,
      peakWind: compassPointOf(peakHour.windFromDeg),
      peakMph: peakHour.windMph,
      thermalUntil,
      thermalFrom,
    });
  }
  onProgress?.(1);
  for (const k of Object.keys(shares) as MomentVerdict[]) shares[k] = checks ? shares[k] / checks : 0;

  const half = (h: 'am' | 'pm') => {
    const list = sits.filter((s) => s.half === h);
    return {
      sits: list.length,
      good: list.filter((s) => s.verdict === 'good').length,
      ok: list.filter((s) => s.verdict === 'ok').length,
      bad: list.filter((s) => s.verdict === 'bad').length,
      clean: list.length ? list.reduce((t, s) => t + s.clean, 0) / list.length : 0,
    };
  };
  const byMonth = [10, 11, 12].map((month, i) => {
    const list = sits.filter((s) => Number(s.date.slice(5, 7)) === month);
    return { month, label: MONTH_LABELS[i], sits: list.length, clean: list.length ? list.reduce((t, s) => t + s.clean, 0) / list.length : 0 };
  });
  const byWind = [...COMPASS_POINTS, 'calm' as const].map((point) => ({ point, ...(windTally.get(point) ?? { checks: 0, clean: 0 }) }));
  // A good wind: clean most of the time, and it blew often enough to judge.
  const goodWinds = COMPASS_POINTS.filter((p) => {
    const t = windTally.get(p);
    return t && t.checks >= checks * 0.03 && t.clean / t.checks >= 0.75;
  });
  const score = Math.round((sits.reduce((t, s) => t + s.clean, 0) / Math.max(1, sits.length)) * 100);
  const result: StandTestResult = {
    seasons,
    sits,
    score,
    grade: score >= 75 ? 'Good' : score >= 50 ? 'Fair' : 'Poor',
    byHalf: { am: half('am'), pm: half('pm') },
    byMonth,
    shares,
    byWind,
    goodWinds,
    notes: [],
  };
  result.notes = notesFor(result, ctx);
  return result;
}

// Plain lines on what makes the spot work or not.
function notesFor(r: StandTestResult, ctx: MomentContext): string[] {
  const notes: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const { am, pm } = r.byHalf;
  if (Math.abs(am.clean - pm.clean) >= 0.15) {
    notes.push(am.clean > pm.clean ? `Better for mornings (${pct(am.clean)} clear) than evenings (${pct(pm.clean)}).` : `Better for evenings (${pct(pm.clean)} clear) than mornings (${pct(am.clean)}).`);
  }
  const busted = r.shares.wind + r.shares.thermal;
  if (busted > 0.05) {
    if (r.shares.thermal > r.shares.wind * 1.5) notes.push(`Thermals are the bigger problem here: they carry your scent to the deer ${pct(r.shares.thermal)} of the time, the wind ${pct(r.shares.wind)}.`);
    else if (r.shares.wind > r.shares.thermal * 1.5) notes.push(`The wind is the bigger problem here: it carries your scent to the deer ${pct(r.shares.wind)} of the time, thermals ${pct(r.shares.thermal)}.`);
    else notes.push(`Wind and thermals share the blame: wind ${pct(r.shares.wind)} of the time, thermals ${pct(r.shares.thermal)}.`);
  }
  // When morning thermals stop dragging scent to the deer, and when evening ones start.
  const typical = (times: number[], anchor: (s: TestSit) => number, list: TestSit[]) => {
    if (times.length === 0) return null;
    const offsets = list.map((s, i) => times[i] - anchor(s)).sort((a, b) => a - b);
    return offsets[Math.floor(offsets.length / 2)];
  };
  const amThermal = r.sits.filter((s) => s.half === 'am' && s.thermalUntil !== null);
  if (amThermal.length >= am.sits * 0.25) {
    const sunriseOf = (s: TestSit) => r.seasons.flatMap((f) => f.days).find((d) => d.date === s.date)!.sunrise;
    const off = typical(amThermal.map((s) => s.thermalUntil!), sunriseOf, amThermal);
    if (off !== null) {
      const mins = Math.round(off / MINUTE);
      const steady = median(amThermal.map((s) => s.thermal)) >= 0.75;
      const until = mins >= 175 ? (steady ? 'the whole sit' : 'on and off through the sit') : `until about ${relative(mins, 'sunrise')}`;
      notes.push(`On ${pct(amThermal.length / am.sits)} of mornings, falling thermals drain your scent onto the deer's way, usually ${until}.`);
    }
  }
  const pmThermal = r.sits.filter((s) => s.half === 'pm' && s.thermalFrom !== null);
  if (pmThermal.length >= pm.sits * 0.25) {
    const sunsetOf = (s: TestSit) => r.seasons.flatMap((f) => f.days).find((d) => d.date === s.date)!.sunset;
    const off = typical(pmThermal.map((s) => s.thermalFrom!), sunsetOf, pmThermal);
    if (off !== null) {
      const mins = Math.round(off / MINUTE);
      notes.push(`On ${pct(pmThermal.length / pm.sits)} of evenings, thermals carry your scent onto the deer's way, usually ${mins <= -175 ? (median(pmThermal.map((s) => s.thermal)) >= 0.75 ? 'the whole sit' : 'on and off through the sit') : `from about ${relative(mins, 'sunset')}`}.`);
    }
  }
  if (r.shares.swirl > 0.12) notes.push(`Thermals are switching ${pct(r.shares.swirl)} of the time you'd be sitting, so scent swirls then.`);
  if (!ctx.terrain) notes.push('No lidar elevation here, so thermals were left out; it needs internet or saved maps.');
  else if (ctx.terrain.slope < 0.05) notes.push('Little slope at the spot, so the wind decides more than thermals do.');
  if (r.goodWinds.length) notes.push(`Winds that work: ${r.goodWinds.map((w) => COMPASS_WORDS[w]).join(', ')}.`);
  else notes.push('No wind direction kept it clean most of the time.');
  return notes;
}
