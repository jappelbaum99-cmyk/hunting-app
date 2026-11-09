// Deer Activity Projection and Hunting Opportunity scores for the Hunt Forecast,
// following Fenceline's outline (inspired by Dr. Grant Woods' public comments; not
// his formula). Local trail camera activity is the anchor; a seasonal rut curve,
// the temperature trend, time of day, rain and hunting pressure adjust it. Moon
// phase and barometric pressure are left out on purpose. The weights are starting
// values to tune, and the scores are relative estimates, not chances of seeing a deer.
import type { CameraPhoto, DeerKind, HuntReport, MapMarker } from '@/types/models';
import { compassPointOf, type RatedStand, type Sit } from '@/lib/standRating';
import { hoursBetween, type Forecast, type ForecastHour } from '@/lib/weather';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const ACTIVITY_WEIGHTS = { camera: 0.4, season: 0.25, temperature: 0.15, timeOfDay: 0.1, rain: 0.05, pressure: 0.05 } as const;
type Part = keyof typeof ACTIVITY_WEIGHTS;

const PART_NAMES: Record<Part, string> = {
  camera: 'Camera activity',
  season: 'Season and rut',
  temperature: 'Temperature trend',
  timeOfDay: 'Time of day',
  rain: 'Rain',
  pressure: 'Hunting pressure',
};

// Missouri's peak breeding is about mid-November; set it to your area in the forecast.
export const DEFAULT_RUT_PEAK = '11-15';

export interface ScorePart {
  part: Part;
  name: string;
  // 0-100, 50 = no help or harm.
  score: number;
  weight: number;
  // Plain words for why.
  why: string;
}

export interface WindowScore {
  sitId: string;
  score: number;
  label: ScoreLabel;
  parts: ScorePart[];
  // Left out for lack of data, with why.
  missing: { name: string; why: string }[];
  confidence: 'High' | 'Medium' | 'Low';
  confidenceWhy: string;
}

export type ScoreLabel = 'Low' | 'Moderate' | 'High' | 'Very high';

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 75) return 'Very high';
  if (score >= 55) return 'High';
  if (score >= 35) return 'Moderate';
  return 'Low';
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const DEER: DeerKind[] = ['buck', 'doe', 'fawn', 'unknown'];

// ---------- Camera evidence ----------

interface CameraEvent {
  time: number;
  cameraId: string;
  buck: boolean;
}

export interface CameraSummary {
  // Deer events (photos of the same camera within 10 minutes count once).
  events: CameraEvent[];
  // Camera-days with any photo, by local date and camera, for uptime.
  activeDays: Set<string>;
  newest: number | null;
  // Counting tagged deer, or (with nothing tagged) any photo with an animal.
  taggedOnly: boolean;
  cameras: number;
}

const dayKey = (time: number, cameraId: string) => `${new Date(time).toDateString()}|${cameraId}`;

// The photos from these cameras, boiled down to deer events and camera uptime.
export function summarizeCameras(photos: CameraPhoto[], cameraIds: Set<string>, now: number): CameraSummary {
  const recent = photos.filter((p) => !p.deletedAt && cameraIds.has(p.cameraId) && Date.parse(p.takenAt) > now - 75 * DAY && Date.parse(p.takenAt) <= now);
  const taggedOnly = recent.some((p) => p.kinds.some((k) => DEER.includes(k)));
  const isDeer = (p: CameraPhoto) => (taggedOnly ? p.kinds.some((k) => DEER.includes(k)) : p.status === 'animal' || p.ai === 'animal');
  const activeDays = new Set<string>();
  let newest: number | null = null;
  const byCamera = new Map<string, { time: number; buck: boolean }[]>();
  for (const p of recent) {
    const time = Date.parse(p.takenAt);
    activeDays.add(dayKey(time, p.cameraId));
    newest = newest === null ? time : Math.max(newest, time);
    if (!isDeer(p)) continue;
    const list = byCamera.get(p.cameraId) ?? [];
    list.push({ time, buck: p.kinds.includes('buck') });
    byCamera.set(p.cameraId, list);
  }
  const events: CameraEvent[] = [];
  for (const [cameraId, list] of byCamera) {
    list.sort((a, b) => a.time - b.time);
    let last = -Infinity;
    for (const shot of list) {
      // A burst of photos of the same deer is one event, so one deer can't swamp the score.
      if (shot.time - last > 10 * 60_000) events.push({ time: shot.time, cameraId, buck: shot.buck });
      else if (shot.buck) events[events.length - 1].buck = true;
      last = shot.time;
    }
  }
  return { events, activeDays, newest, taggedOnly, cameras: new Set(recent.map((p) => p.cameraId)).size };
}

// Minutes after local midnight.
const clockOf = (time: number) => {
  const d = new Date(time);
  return d.getHours() * 60 + d.getMinutes();
};

const inClock = (time: number, from: number, to: number) => {
  const m = clockOf(time);
  return from <= to ? m >= from && m < to : m >= from || m < to;
};

const activeCameraDays = (summary: CameraSummary, start: number, end: number) => {
  let n = 0;
  for (let t = start; t < end; t += DAY) for (const key of summary.activeDays) if (key.startsWith(`${new Date(t).toDateString()}|`)) n += 1;
  return n;
};

function cameraPart(summary: CameraSummary, window: { from: number; to: number }, windowName: string, now: number): ScorePart | { missing: string } {
  if (summary.newest === null) return { missing: 'No trail camera photos from these stands’ property in the last few weeks.' };
  const ageDays = (now - summary.newest) / DAY;
  if (ageDays > 3) return { missing: `The newest camera photos are ${Math.round(ageDays)} days old. Bring in new ones for this part of the score.` };
  const recentStart = now - 2 * DAY;
  const baseStart = now - 32 * DAY;
  const recentDays = activeCameraDays(summary, recentStart, now + DAY);
  const baseDays = activeCameraDays(summary, baseStart, recentStart);
  const inWindow = (e: CameraEvent) => inClock(e.time, window.from, window.to);
  const recent = summary.events.filter((e) => e.time >= recentStart && inWindow(e)).length;
  const base = summary.events.filter((e) => e.time >= baseStart && e.time < recentStart && inWindow(e)).length;
  if (baseDays < 5 || base < 3) return { missing: 'Not enough camera history yet to know what’s normal here for this time of day.' };
  const baseRate = base / baseDays;
  const recentRate = recentDays ? recent / recentDays : 0;
  // Pulled toward normal by a day's worth, so one quiet or busy night doesn't swing it far.
  const ratio = (recentRate * recentDays + baseRate) / ((recentDays + 1) * baseRate);
  const score = clamp(50 + 25 * Math.log2(Math.max(ratio, 0.05)));
  const what = summary.taggedOnly ? 'deer' : 'animal';
  const per = (n: number) => (Math.round(n * 10) / 10).toString();
  const why =
    ratio >= 1.25
      ? `Cameras show ${per(recentRate)} ${what} visits a camera-day in the ${windowName} lately, above the usual ${per(baseRate)}.`
      : ratio <= 0.8
        ? `Cameras show ${per(recentRate)} ${what} visits a camera-day in the ${windowName} lately, below the usual ${per(baseRate)}.`
        : `Camera activity in the ${windowName} is about normal (${per(recentRate)} a camera-day).`;
  return { part: 'camera', name: PART_NAMES.camera, score, weight: ACTIVITY_WEIGHTS.camera, why };
}

function timeOfDayPart(summary: CameraSummary, window: { from: number; to: number }, windowName: string, morning: boolean): ScorePart {
  const total = summary.events.filter((e) => e.time > Date.now() - 60 * DAY).length;
  const share = (window.to - window.from + 1440) % 1440 / 1440;
  if (total < 10) {
    // Dawn and dusk are when deer move most; property data takes over once there's enough.
    return { part: 'timeOfDay', name: PART_NAMES.timeOfDay, score: morning ? 66 : 72, weight: ACTIVITY_WEIGHTS.timeOfDay, why: `${morning ? 'Dawn' : 'Dusk'} is a common time for deer to move.` };
  }
  const inWindow = summary.events.filter((e) => e.time > Date.now() - 60 * DAY && inClock(e.time, window.from, window.to)).length;
  const ratio = inWindow / total / share;
  const score = clamp(50 + 25 * Math.log2(Math.max(ratio, 0.05)));
  return {
    part: 'timeOfDay',
    name: PART_NAMES.timeOfDay,
    score,
    weight: ACTIVITY_WEIGHTS.timeOfDay,
    why: `${Math.round((inWindow / total) * 100)}% of your camera visits come in the ${windowName}.`,
  };
}

// ---------- Season ----------

export interface RutPhase {
  name: string;
  // Days from the breeding peak (negative = before).
  daysFromPeak: number;
}

export function rutPhase(time: number, peak: string): RutPhase {
  const [month, day] = peak.split('-').map(Number);
  const date = new Date(time);
  let peakTime = new Date(date.getFullYear(), month - 1, day).getTime();
  // In January, last fall's rut is the one that matters.
  if (peakTime - time > 200 * DAY) peakTime = new Date(date.getFullYear() - 1, month - 1, day).getTime();
  const d = Math.round((time - peakTime) / DAY);
  const name = d < -30 ? 'Early season' : d < -7 ? 'Pre-rut' : d <= 7 ? 'Peak breeding' : d <= 30 ? 'Post-rut' : 'Late season';
  return { name, daysFromPeak: d };
}

function seasonPart(time: number, peak: string): ScorePart {
  const phase = rutPhase(time, peak);
  // A bell around the peak, leaning early: bucks search hardest just before most does are ready.
  const d = phase.daysFromPeak + 4;
  const score = clamp(42 + 55 * Math.exp(-(d * d) / (2 * 15 * 15)));
  const when = phase.daysFromPeak < 0 ? `${-phase.daysFromPeak} days before` : phase.daysFromPeak > 0 ? `${phase.daysFromPeak} days after` : 'right at';
  return { part: 'season', name: PART_NAMES.season, score, weight: ACTIVITY_WEIGHTS.season, why: `${phase.name}: ${when} the rut peak you set.` };
}

// ---------- Weather ----------

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function temperaturePart(forecast: Forecast, sit: Sit, peak: string): ScorePart | { missing: string } {
  const hours = hoursBetween(forecast, sit.start, sit.end);
  const now = mean(hours.map((h) => h.tempF));
  // Like with like: the same hours on the three days before.
  const before = [1, 2, 3]
    .map((n) => forecast.hours.filter((h) => h.time >= sit.start - n * DAY && h.time <= sit.end - n * DAY))
    .filter((hs) => hs.length > 0)
    .map((hs) => mean(hs.map((h) => h.tempF)));
  if (!before.length) return { missing: 'No temperatures from the days before to compare with.' };
  const delta = now - mean(before);
  const late = rutPhase(sit.start, peak).daysFromPeak > 30;
  let score: number;
  if (late) {
    // Late season: a modest warm-up on cold days gets deer up to feed.
    score = delta >= 3 && delta <= 12 ? 72 : delta > 12 ? 58 : delta <= -10 ? 48 : 55;
  } else {
    // Otherwise a real cool-down after warmth helps most; steady weather is fine.
    score = delta <= -8 ? 85 : delta <= -4 ? 72 : delta < 4 ? 55 : delta < 8 ? 42 : 32;
    if (now > 75) score = Math.min(score, 35);
  }
  const d = Math.round(Math.abs(delta));
  const why =
    Math.abs(delta) < 3
      ? `About the same temperature as the last few days (${Math.round(now)}°F).`
      : `${d}°F ${delta < 0 ? 'cooler' : 'warmer'} than the same time the last few days (${Math.round(now)}°F).`;
  return { part: 'temperature', name: PART_NAMES.temperature, score, weight: ACTIVITY_WEIGHTS.temperature, why };
}

function rainPart(hours: ForecastHour[]): ScorePart {
  const inches = hours.reduce((t, h) => t + h.precipIn, 0);
  const worstHour = Math.max(...hours.map((h) => h.precipIn));
  const chance = Math.max(...hours.map((h) => h.precipChance));
  let score = 58;
  let why = 'No rain expected.';
  if (worstHour > 0.15 || inches > 0.3) [score, why] = [30, 'Heavy rain or storms expected.'];
  else if (inches > 0.08) [score, why] = [42, 'Steady rain expected.'];
  else if (inches > 0.01 || chance >= 50) [score, why] = [52, 'Light rain possible; it seldom stops deer.'];
  return { part: 'rain', name: PART_NAMES.rain, score, weight: ACTIVITY_WEIGHTS.rain, why };
}

function pressurePart(reports: HuntReport[], start: number): ScorePart {
  const hunts = reports.filter((r) => !r.deletedAt && Date.parse(r.start) > start - 3 * DAY && Date.parse(r.start) < start).length;
  const score = hunts === 0 ? 58 : hunts === 1 ? 50 : hunts === 2 ? 45 : 35;
  return {
    part: 'pressure',
    name: PART_NAMES.pressure,
    score,
    weight: ACTIVITY_WEIGHTS.pressure,
    why: hunts === 0 ? 'No hunts logged here in the 3 days before.' : `${hunts} hunt${hunts === 1 ? '' : 's'} logged here in the 3 days before.`,
  };
}

// ---------- The window score ----------

export interface ActivityInput {
  forecast: Forecast;
  sits: Sit[];
  cameras: CameraSummary;
  reports: HuntReport[];
  rutPeak: string;
  now: number;
  // Use this hub's own trail camera photos and hunt logs. Off for now: the forecast
  // uses only internet weather and the rut date.
  useLocal: boolean;
}

export function scoreWindow(input: ActivityInput, sit: Sit): WindowScore {
  const { forecast, cameras, reports, rutPeak, now } = input;
  const morning = sit.id.endsWith('-am');
  const windowName = morning ? 'morning' : 'evening';
  const window = { from: clockOf(sit.start), to: clockOf(sit.end) };
  const hours = hoursBetween(forecast, sit.start, sit.end);
  const parts: ScorePart[] = [];
  const missing: { name: string; why: string }[] = [];
  const add = (part: Part, result: ScorePart | { missing: string }) => {
    if ('missing' in result) missing.push({ name: PART_NAMES[part], why: result.missing });
    else parts.push(result);
  };
  if (input.useLocal) add('camera', cameraPart(cameras, window, windowName, now));
  add('season', seasonPart(sit.peak, rutPeak));
  add('temperature', temperaturePart(forecast, sit, rutPeak));
  add('timeOfDay', timeOfDayPart(input.useLocal ? cameras : { ...cameras, events: [] }, window, windowName, morning));
  add('rain', rainPart(hours));
  if (input.useLocal) add('pressure', pressurePart(reports, sit.start));
  const totalWeight = parts.reduce((t, p) => t + p.weight, 0);
  const score = Math.round(parts.reduce((t, p) => t + p.score * p.weight, 0) / totalWeight);

  const hasCamera = parts.some((p) => p.part === 'camera');
  const ahead = (sit.start - now) / HOUR;
  let confidence: WindowScore['confidence'] = 'Low';
  let confidenceWhy = 'No recent camera data, so this leans on the season and weather alone.';
  if (!input.useLocal)
    [confidence, confidenceWhy] =
      ahead < 36
        ? ['Medium', 'Weather and season only; the forecast is close.']
        : ahead < 96
          ? ['Low', 'Weather and season only, and the forecast is a day or more out.']
          : ['Low', 'More than 4 days out the weather forecast often changes, so treat this as a rough look ahead.'];
  else if (hasCamera && cameras.cameras >= 2 && ahead < 36) [confidence, confidenceWhy] = ['High', `${cameras.cameras} cameras reporting and the forecast is close.`];
  else if (hasCamera) [confidence, confidenceWhy] = ['Medium', cameras.cameras < 2 ? 'Only one camera reporting.' : 'The forecast is a day or more out.'];
  return { sitId: sit.id, score, label: scoreLabel(score), parts, missing, confidence, confidenceWhy };
}

// The biggest pushes up and down, for "Why this score?".
export function drivers(score: WindowScore): { up: ScorePart[]; down: ScorePart[] } {
  const effect = (p: ScorePart) => (p.score - 50) * p.weight;
  const sorted = [...score.parts].sort((a, b) => effect(b) - effect(a));
  return { up: sorted.filter((p) => effect(p) > 1).slice(0, 3), down: sorted.filter((p) => effect(p) < -1).reverse().slice(0, 3) };
}

// Daylight buck visits on camera in the last 48 hours, for the evidence line.
export function daylightBucks(summary: CameraSummary, forecast: Forecast, now: number): number {
  return summary.events.filter((e) => {
    if (!e.buck || e.time < now - 2 * DAY) return false;
    const day = forecast.days.find((d) => Math.abs(d.sunrise - e.time) < 14 * HOUR);
    return day ? e.time >= day.sunrise && e.time <= day.sunset : false;
  }).length;
}

// ---------- Hunting Opportunity (per stand) ----------

export const OPPORTUNITY_WEIGHTS = { activity: 0.5, windDirection: 0.2, windSteady: 0.15, hunter: 0.05 } as const;

export interface Opportunity {
  score: number;
  label: ScoreLabel;
  why: string;
}

// How huntable a stand is for the window: the activity score, the wind against
// the stand's good winds and bedding, how steady the wind is, and the hunter's
// comfort. Access routes aren't mapped yet, so that part is left out.
export function standOpportunity(activity: WindowScore, rated: RatedStand, forecast: Forecast, sit: Sit): Opportunity {
  const hours = hoursBetween(forecast, sit.start, sit.end);
  const direction = rated.rating === 'good' ? 90 : rated.rating === 'ok' ? 60 : rated.rating === 'bad' ? 12 : 50;
  const points = new Set(hours.map((h) => compassPointOf(h.windFromDeg)));
  const minSpeed = Math.min(...hours.map((h) => h.windMph));
  const maxSpeed = Math.max(...hours.map((h) => h.windMph));
  const maxGust = Math.max(...hours.map((h) => h.gustMph));
  let steady = points.size <= 1 ? 88 : points.size === 2 ? 68 : 38;
  if (minSpeed < 3) steady -= 20;
  if (maxSpeed > 20 || maxGust > 28) steady -= 18;
  const rain = hours.reduce((t, h) => t + h.precipIn, 0);
  const temps = hours.map((h) => h.tempF);
  const hunter = rain > 0.2 ? 30 : Math.min(...temps) < 15 || Math.max(...temps) > 80 ? 45 : 78;
  const w = OPPORTUNITY_WEIGHTS;
  const total = w.activity + w.windDirection + w.windSteady + w.hunter;
  const score = Math.round((activity.score * w.activity + direction * w.windDirection + clamp(steady) * w.windSteady + hunter * w.hunter) / total);
  const notes: string[] = [];
  if (rated.rating === 'bad') notes.push(rated.scentInto.length ? `scent into ${rated.scentInto.join(' and ')}` : 'wrong wind');
  else if (rated.rating === 'good') notes.push('good wind');
  else if (rated.rating === 'unset') notes.push('no good winds set');
  if (points.size >= 3) notes.push('wind shifting');
  if (minSpeed < 3) notes.push('light, swirly wind');
  if (maxGust > 28) notes.push(`gusts to ${Math.round(maxGust)} mph`);
  return { score, label: scoreLabel(score), why: notes.join(', ') };
}

// The cameras whose photos count for the stands being forecast.
export function camerasFor(markers: MapMarker[], propertyId: string | null): Set<string> {
  return new Set(markers.filter((m) => m.type === 'camera' && !m.deletedAt && (!propertyId || m.propertyId === propertyId)).map((m) => m.id));
}

// For now the Hunt Forecast scores come only from internet weather and the rut
// date you set; trail camera photos and hunt logs on this PC aren't used yet.
export const FORECAST_USES_LOCAL_DATA = false;
