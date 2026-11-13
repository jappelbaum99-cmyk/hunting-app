// Thermals: the slow drift of air up or down slopes as the ground warms and
// cools, which carries scent along the land when the wind is light. Rules of
// thumb, not a physics model:
// - The ground warms when the sun on it is strong enough, and cools when it
//   isn't. Warm ground sends air up the slope (rising); cooling ground lets it
//   sink and drain downhill into draws and bottoms (falling).
// - How much sun a slope gets depends on which way it faces: an east slope
//   turns uphill earlier in the morning, a west slope holds on later in the
//   afternoon, and a steep north slope in winter may hardly turn at all.
// - The sunshine comes from the forecast (Open-Meteo's measured-and-modeled
//   sunshine for each hour), so a cloudy or hazy morning switches later.
// - Between warm enough and cool enough the air swirls.
// - Wind wins once it blows: under about 5 mph thermals lead, over about 12 mph
//   the wind carries the scent and thermals only bend it.
import { weatherAt, type Forecast } from '@/lib/weather';

export type ThermalPhase = 'falling' | 'rising' | 'switching';
export type ThermalStrength = 'strong' | 'moderate' | 'weak';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Sun on the ground (W/m²) above which it warms enough to send air uphill, and
// below which it cools and air drains down. Between them the air swirls. On
// flat ground on a clear November day these land about 1½ hours after sunrise
// and 1¼ hours before sunset.
const RISE_WM2 = 170;
const FALL_WM2 = 140;
// How far ahead to look for the next change.
const LOOKAHEAD = 24 * HOUR;
const SCAN_STEP = 10 * MINUTE;

// A stand's ground: how steep (rise over run) and which way it faces (the
// downhill direction, degrees from north).
export interface Terrain {
  slope: number;
  facingDeg: number;
}

export interface ThermalState {
  phase: ThermalPhase;
  strength: ThermalStrength;
  // How much thermals steer scent against the wind, 0 (wind only) to 1 (thermals only).
  pull: number;
  // How hard the sun or the cooling drives them, before the wind, 0-1.
  drive: number;
  // The wind they're up against, mph (lower at a stand sheltered from it).
  windMph: number;
  // Sun on this ground right now, W/m².
  sunWm2: number;
  // When the phase next changes, epoch ms, if within the next day.
  nextChange: number | null;
  nextPhase: ThermalPhase | null;
}

export const PHASE_LABELS: Record<ThermalPhase, string> = {
  falling: 'Falling (downhill)',
  rising: 'Rising (uphill)',
  switching: 'Switching (swirling)',
};

// ---------- The sun ----------

const RAD = Math.PI / 180;

// Where the sun is: height above the horizon and compass direction, degrees.
// The usual low-precision solar formulas, good to a fraction of a degree.
export function sunPosition(time: number, lat: number, lng: number): { elevation: number; azimuth: number } {
  const d = time / 86_400_000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const hourAngle = ((gmst + lng) * RAD - ra) % (2 * Math.PI);
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle));
  return { elevation: elevation / RAD, azimuth: ((azimuth / RAD) + 360) % 360 };
}

// Sun on the ground, W/m², for the hour just before `time` (the ground warms
// from the sun it has had). Flat ground when `terrain` is null.
export function sunOnGround(forecast: Forecast, time: number, terrain: Terrain | null): number {
  const hour = weatherAt(forecast, time);
  // The sun's angle halfway through that hour.
  const sun = sunPosition(time - 30 * MINUTE, forecast.lat, forecast.lng);
  const sinElev = Math.sin(Math.max(0, sun.elevation) * RAD);
  if (sinElev <= 0.01) return 0;
  let direct = hour.directWm2;
  let diffuse = hour.diffuseWm2;
  if (direct === undefined || diffuse === undefined) {
    // An older saved forecast without sunshine: estimate it from the sun's height and cloud.
    const cloud = Math.min(1, Math.max(0, hour.cloudCover / 100));
    const total = 990 * sinElev * (1 - 0.75 * cloud ** 3.4) - 30;
    direct = Math.max(0, total * (1 - cloud));
    diffuse = Math.max(0, total - direct);
  }
  if (!terrain || terrain.slope < 0.02) return direct + diffuse;
  // How squarely the beam hits the slope, compared with flat ground.
  const tilt = Math.atan(terrain.slope);
  const cosElev = Math.cos(Math.max(0, sun.elevation) * RAD);
  const incidence = Math.cos(tilt) * sinElev + Math.sin(tilt) * cosElev * Math.cos((sun.azimuth - terrain.facingDeg) * RAD);
  const beam = direct * Math.min(4, Math.max(0, incidence) / sinElev);
  // A tilted slope sees a little less of the sky.
  return beam + diffuse * ((1 + Math.cos(tilt)) / 2);
}

function phaseFor(sun: number): ThermalPhase {
  return sun >= RISE_WM2 ? 'rising' : sun < FALL_WM2 ? 'falling' : 'switching';
}

// Thermals on this ground at `time`. Flat open ground when `terrain` is null.
export function thermalAt(forecast: Forecast, time: number, terrain: Terrain | null = null): ThermalState | null {
  if (forecast.hours.length === 0) return null;
  const hour = weatherAt(forecast, time);
  const sun = sunOnGround(forecast, time, terrain);
  const phase = phaseFor(sun);

  let nextChange: number | null = null;
  let nextPhase: ThermalPhase | null = null;
  const last = forecast.hours[forecast.hours.length - 1].time;
  for (let t = time + SCAN_STEP; t <= Math.min(time + LOOKAHEAD, last); t += SCAN_STEP) {
    const p = phaseFor(sunOnGround(forecast, t, terrain));
    if (p !== phase) {
      nextChange = t;
      nextPhase = p;
      break;
    }
  }

  // How hard they're driven. Rising: by how far the sun is past the line.
  // Falling: clear nights cool fastest and drain hardest.
  const clear = 1 - Math.min(100, Math.max(0, hour.cloudCover)) / 100;
  const drive =
    phase === 'rising'
      ? Math.min(1, 0.35 + (sun - RISE_WM2) / 400)
      : phase === 'falling'
        ? (sun > 0 ? 0.5 : 0.6) + 0.4 * clear
        : 0.4;
  return { phase, nextChange, nextPhase, sunWm2: sun, ...againstWind(drive, hour.windMph) };
}

// When thermals run uphill on this ground on the day of `time` (first and
// last rising moment), or null if the sun never warms it enough.
export function risingWindow(forecast: Forecast, time: number, terrain: Terrain | null): { start: number; end: number } | null {
  const day = forecast.days.find((d) => time >= d.sunrise - 6 * HOUR && time < d.sunset + 6 * HOUR) ?? null;
  if (!day) return null;
  let start: number | null = null;
  let end: number | null = null;
  for (let t = day.sunrise; t <= day.sunset + HOUR; t += SCAN_STEP) {
    if (phaseFor(sunOnGround(forecast, t, terrain)) === 'rising') {
      start ??= t;
      end = t;
    }
  }
  return start !== null && end !== null ? { start, end } : null;
}

// Wind: thermals lead under 5 mph and fade to a nudge by 12 mph.
function againstWind(drive: number, windMph: number): Pick<ThermalState, 'pull' | 'strength' | 'drive' | 'windMph'> {
  const calm = windMph <= 5 ? 1 : windMph >= 12 ? 0.15 : 1 - ((windMph - 5) / 7) * 0.85;
  const pull = Math.max(0, Math.min(1, drive * calm));
  const strength: ThermalStrength = pull >= 0.55 ? 'strong' : pull >= 0.25 ? 'moderate' : 'weak';
  return { pull, strength, drive, windMph };
}

// The same thermals where the wind is lighter, as at a sheltered stand.
export function withWind(state: ThermalState, windMph: number): ThermalState {
  return { ...state, ...againstWind(state.drive, windMph) };
}

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// A short line for the forecast, e.g. "Falling (downhill), strong until 8:10 AM, then switching".
export function thermalSummary(state: ThermalState): string {
  const next = state.nextChange && state.nextPhase ? ` until ${clock(state.nextChange)}, then ${state.nextPhase}` : '';
  return `${PHASE_LABELS[state.phase]}, ${state.strength}${next}`;
}

// ---------- A stand's thermal day ----------

export interface ThermalDay {
  // The span shown: from before first light to after dark.
  start: number;
  end: number;
  sunrise: number;
  sunset: number;
  segments: { from: number; to: number; phase: ThermalPhase }[];
  // When this ground turns uphill and back downhill, if it does that day.
  rise: number | null;
  fall: number | null;
  advice: string[];
}

const OPPOSITE: Record<string, string> = {
  north: 'south', northeast: 'southwest', east: 'west', southeast: 'northwest',
  south: 'north', southwest: 'northeast', west: 'east', northwest: 'southeast',
};

// Rising, falling and switching through the day of `time` on this ground,
// with plain advice for getting in and out.
export function thermalDay(forecast: Forecast, time: number, terrain: Terrain | null): ThermalDay | null {
  const day = forecast.days.find((d) => time >= d.sunrise - 8 * HOUR && time < d.sunset + 8 * HOUR);
  if (!day) return null;
  const start = day.sunrise - 1.5 * HOUR;
  const end = day.sunset + HOUR;
  const segments: ThermalDay['segments'] = [];
  for (let t = start; t < end; t += SCAN_STEP) {
    const phase = phaseFor(sunOnGround(forecast, t, terrain));
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && lastSeg.phase === phase) lastSeg.to = Math.min(end, t + SCAN_STEP);
    else segments.push({ from: t, to: Math.min(end, t + SCAN_STEP), phase });
  }
  const rising = segments.filter((s) => s.phase === 'rising');
  const rise = rising[0]?.from ?? null;
  const fall = rising.length ? rising[rising.length - 1].to : null;

  const sloped = terrain && terrain.slope >= 0.05;
  const down = sloped ? FACING_WORDS[Math.round(terrain.facingDeg / 45) % 8] : null;
  const up = down ? OPPOSITE[down] : null;
  const advice: string[] = [];
  if (!sloped) {
    advice.push('Little slope here, so the wind carries your scent more than thermals do.');
  }
  if (rise !== null && fall !== null) {
    advice.push(
      down
        ? `Morning: scent drains ${down} (downhill) until about ${clock(rise)}. Be settled in before then; after the switch it lifts ${up}, uphill.`
        : `Morning: air sinks until about ${clock(rise)}, then rises.`,
    );
    advice.push(
      down
        ? `Evening: scent rises ${up} until about ${clock(fall)}, then drains ${down} again. Walking out after that, it settles into the low ground ${down} of you.`
        : `Evening: air rises until about ${clock(fall)}, then sinks again.`,
    );
  } else {
    advice.push(down ? `Too little sun reaches this slope to turn the air uphill that day; scent drains ${down} (downhill) all day.` : 'The air hardly turns uphill that day.');
  }
  return { start, end, sunrise: day.sunrise, sunset: day.sunset, segments, rise, fall, advice };
}

// ---------- The stand's slope ----------

// Slope is read across this span, so it reflects the hillside, not a single bump.
const ASPECT_SPAN_M = 40;

export function terrainAt(start: [number, number], elevationAt: ElevationAt): Terrain | null {
  const mPerLng = 111_320 * Math.cos((start[1] * Math.PI) / 180);
  const mPerLat = 110_540;
  const h = ASPECT_SPAN_M / 2;
  const at = (dx: number, dy: number) => elevationAt(start[0] + dx / mPerLng, start[1] + dy / mPerLat);
  const [e, w, n, s] = [at(h, 0), at(-h, 0), at(0, h), at(0, -h)];
  if (e === null || w === null || n === null || s === null) return null;
  const gx = (e - w) / ASPECT_SPAN_M;
  const gy = (n - s) / ASPECT_SPAN_M;
  const slope = Math.hypot(gx, gy);
  // Facing = the downhill direction.
  const facingDeg = ((Math.atan2(-gx, -gy) / RAD) + 360) % 360;
  return { slope, facingDeg };
}

const FACING_WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

// e.g. " East-facing slope: rising here 7:50 AM to 4:05 PM." for the stand's note.
export function slopeTimesNote(forecast: Forecast, time: number, terrain: Terrain | null): string {
  if (!terrain || terrain.slope < 0.05) return '';
  const facing = FACING_WORDS[Math.round(terrain.facingDeg / 45) % 8];
  const window = risingWindow(forecast, time, terrain);
  const ground = `${facing[0].toUpperCase()}${facing.slice(1)}-facing slope`;
  return window ? ` ${ground}: rising here ${clock(window.start)} to ${clock(window.end)}.` : ` ${ground}: too shaded to turn uphill that day.`;
}

// ---------- Shelter from the wind ----------

// How far upwind the ground is checked, and how steeply it must rise above
// the stand (rise over distance) to block the wind fully. About 9°: a ridge
// 25 m higher 150 m away, or a hollow wall 8 m up 50 m away.
const SHELTER_REACH_M = 300;
const SHELTER_STEP_M = 15;
const FULL_SHELTER_RISE = 0.16;
// Rises smaller than this are bumps, not shelter.
const SHELTER_MIN_RISE_M = 2;
// At full shelter the stand feels this share of the forecast wind.
const SHELTERED_WIND_SHARE = 0.25;

export interface Shelter {
  // 0 open to the wind, 1 fully sheltered.
  amount: number;
  // How much higher the sheltering ground is, meters, and which way it lies.
  riseM: number;
  toward: string;
}

const COMPASS_WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassIndex = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;

// Looks upwind from the stand (straight into the wind and 25° either side) for
// ground higher than the stand that would block the wind: a ridge between
// the stand and the wind, or the wall of a hollow it sits in.
export function shelterAt(start: [number, number], windFromDeg: number, elevationAt: ElevationAt): Shelter | null {
  const base = elevationAt(start[0], start[1]);
  if (base === null) return null;
  const mPerLng = 111_320 * Math.cos((start[1] * Math.PI) / 180);
  const mPerLat = 110_540;
  let total = 0;
  let rays = 0;
  let bestRise = 0;
  for (const spread of [-25, 0, 25]) {
    const rad = ((windFromDeg + spread) * Math.PI) / 180;
    let steepest = 0;
    for (let d = SHELTER_STEP_M; d <= SHELTER_REACH_M; d += SHELTER_STEP_M) {
      const e = elevationAt(start[0] + (Math.sin(rad) * d) / mPerLng, start[1] + (Math.cos(rad) * d) / mPerLat);
      if (e === null) break;
      const rise = e - base - SHELTER_MIN_RISE_M;
      if (rise > 0 && rise / d > steepest) steepest = rise / d;
      if (spread === 0 && e - base > bestRise) bestRise = e - base;
    }
    total += steepest;
    rays++;
  }
  const amount = Math.max(0, Math.min(1, total / rays / FULL_SHELTER_RISE));
  return { amount, riseM: bestRise, toward: COMPASS_WORDS[compassIndex(windFromDeg)] };
}

// The wind a stand feels after its shelter.
export function shelteredWind(windMph: number, shelter: Pick<Shelter, 'amount'> | null): number {
  return windMph * (1 - (1 - SHELTERED_WIND_SHARE) * (shelter?.amount ?? 0));
}

// A line about shelter for the stand's note, or '' when the wind is too light to matter.
export function shelterNote(shelter: Shelter | null, windFromDeg: number, windMph: number): string {
  if (!shelter || windMph < 5) return '';
  const wind = COMPASS_SHORT[compassIndex(windFromDeg)];
  if (shelter.amount >= 0.5) return ` Sheltered from the ${wind} wind by higher ground to the ${shelter.toward}, so thermals still lead here.`;
  if (shelter.amount >= 0.2) return ` Partly sheltered from the ${wind} wind.`;
  return windMph >= 8 ? ` Open to the ${wind} wind, which leads here.` : '';
}

// ---------- Following the land ----------

// Elevation in meters at a point, or null off the grid / no data.
export type ElevationAt = (lng: number, lat: number) => number | null;

export interface ThermalPath {
  // From the stand outward, [lng, lat].
  points: [number, number][];
  // Where the scent ends up: 'pools' in a low spot, 'ridge' at a high one, or still moving at the end.
  ends: 'pools' | 'ridge' | 'open';
  // Elevation change along the path, meters (negative = downhill).
  dropM: number;
}

const STEP_M = 8;
// Slope is measured across this distance, so lidar bumps (logs, brush piles) don't steer it.
const SLOPE_SPAN_M = 12;
// How far the path is followed.
const MAX_PATH_M = 320;
// Flatter than this, the slope stops steering the air.
const FLAT_SLOPE = 0.025;
// Scent has settled once it stops getting lower (falling) or higher (rising)
// by at least this much over this many steps: it pools in the low spot, or
// tops out, instead of the path wandering over flat ground.
const SETTLE_STEPS = 5;
const SETTLE_M = 0.5;

// Traces where scent goes from a stand: down the steepest slope when falling,
// up it when rising, bent by the wind as much as the wind outweighs the
// thermals. `windFromDeg` is where the wind comes from.
export function traceThermalPath(start: [number, number], state: ThermalState, windFromDeg: number, elevationAt: ElevationAt): ThermalPath | null {
  if (state.phase === 'switching') return null;
  const lat0 = start[1];
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mPerLat = 110_540;
  const toLngLat = (x: number, y: number): [number, number] => [start[0] + x / mPerLng, start[1] + y / mPerLat];
  const elev = (x: number, y: number) => {
    const [lng, lat] = toLngLat(x, y);
    return elevationAt(lng, lat);
  };
  const startElevation = elev(0, 0);
  if (startElevation === null) return null;

  // Downwind, as an east/north unit vector.
  const down = ((windFromDeg + 180) * Math.PI) / 180;
  const wind = [Math.sin(down), Math.cos(down)];
  const sign = state.phase === 'falling' ? -1 : 1;

  const points: [number, number][] = [start];
  let x = 0;
  let y = 0;
  let travelled = 0;
  let ends: ThermalPath['ends'] = 'open';
  let heading: number[] | null = null;
  const heights: number[] = [startElevation];
  while (travelled < MAX_PATH_M) {
    const h = SLOPE_SPAN_M / 2;
    const east = elev(x + h, y);
    const west = elev(x - h, y);
    const north = elev(x, y + h);
    const south = elev(x, y - h);
    if (east === null || west === null || north === null || south === null) break;
    // Uphill direction and how steep (rise over run).
    const gx = (east - west) / SLOPE_SPAN_M;
    const gy = (north - south) / SLOPE_SPAN_M;
    const slope = Math.hypot(gx, gy);
    if (slope < FLAT_SLOPE) {
      ends = state.phase === 'falling' ? 'pools' : 'ridge';
      break;
    }
    // The way the thermal pushes: down or up the slope, stronger on steeper ground.
    const steer = Math.min(1, slope / 0.08);
    const tx = (sign * gx) / slope;
    const ty = (sign * gy) / slope;
    const tw = state.pull * steer;
    const ww = 1 - state.pull;
    let dx = tx * tw + wind[0] * ww;
    let dy = ty * tw + wind[1] * ww;
    // Doubling back means it's reached the bottom (or top) of the slope.
    if (heading && (dx * heading[0] + dy * heading[1]) / (Math.hypot(dx, dy) || 1) < -0.3) {
      ends = state.phase === 'falling' ? 'pools' : 'ridge';
      break;
    }
    // Ease into turns so the path flows rather than zigzags.
    if (heading) {
      dx = heading[0] * 0.5 + dx * 0.5;
      dy = heading[1] * 0.5 + dy * 0.5;
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) break;
    heading = [dx / len, dy / len];
    x += heading[0] * STEP_M;
    y += heading[1] * STEP_M;
    travelled += STEP_M;
    points.push(toLngLat(x, y));
    const here = elev(x, y);
    if (here === null) break;
    heights.push(here);
    // Settled: hasn't gone further down (or up) lately. Cut the wandering
    // back to the lowest (or highest) point and end there.
    if (heights.length > SETTLE_STEPS && sign * (here - heights[heights.length - 1 - SETTLE_STEPS]) < SETTLE_M) {
      const recent = heights.slice(-SETTLE_STEPS - 1);
      const best = sign < 0 ? Math.min(...recent) : Math.max(...recent);
      const keep = heights.length - 1 - SETTLE_STEPS + recent.indexOf(best);
      points.length = keep + 1;
      heights.length = keep + 1;
      ends = state.phase === 'falling' ? 'pools' : 'ridge';
      break;
    }
  }
  // Settled at once (a bench or bowl right at the stand): it pools around the stand.
  if (points.length < 2) {
    if (ends === 'open') return null;
    points.push(points[0]);
  }
  const endElevation = heights[heights.length - 1] ?? startElevation;
  return { points, ends, dropM: endElevation - startElevation };
}

// Compass words for a direction from the stand, e.g. "northeast".
const WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export function directionWord(from: [number, number], to: [number, number]): string {
  const x = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const y = to[1] - from[1];
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return WORDS[Math.round(deg / 45) % 8];
}

// One line for a stand, e.g. "Thermals (strong) drain your scent 18 ft down to the northeast and pool there."
export function thermalReason(state: ThermalState, path: ThermalPath | null): string {
  if (state.phase === 'switching') return 'Thermals are switching, so scent may swirl around the stand.';
  if (!path) return state.phase === 'falling' ? 'Thermals are falling, but the ground here is flat.' : 'Thermals are rising, but the ground here is flat.';
  const feet = Math.round(Math.abs(path.dropM) * 3.281);
  // Barely moved: settles right around the stand.
  const lengthM = (path.points.length - 1) * STEP_M;
  if (lengthM <= 3 * STEP_M || feet < 3) {
    return state.phase === 'falling'
      ? `Thermals (${state.strength}) let your scent settle and pool right around the stand.`
      : `Thermals (${state.strength}) hold your scent near the stand; there's little slope above it.`;
  }
  const where = directionWord(path.points[0], path.points[path.points.length - 1]);
  const verb = state.phase === 'falling' ? `drain your scent ${feet} ft down to the ${where}` : `lift your scent ${feet} ft up to the ${where}`;
  const end = path.ends === 'pools' ? ' and pool there' : path.ends === 'ridge' ? ' onto the high ground' : '';
  return `Thermals (${state.strength}) ${verb}${end}.`;
}

// ---------- Rating stands with thermals ----------

// Thermals on their own: good (carrying scent clear), swirling (switching, so
// scent wanders), bad (into bedding), or weak (the wind leads; no say).
export type ThermalRating = 'good' | 'swirl' | 'bad' | 'weak';

export const THERMAL_RATING_LABELS: Record<ThermalRating, string> = {
  good: 'Good',
  swirl: 'Swirling',
  bad: 'Bad',
  weak: 'Weak',
};

export interface StandThermal {
  reason: string;
  rating: ThermalRating;
  // This stand's own phase (its slope's sun), and where its scent ends up.
  phase: ThermalPhase;
  ends: ThermalPath['ends'] | null;
  // How strongly thermals steer the scent here, 0-1 (weaker spreads wider).
  pull: number;
  // 0 open to the wind, 1 fully sheltered.
  shelter: number;
  path: [number, number][] | null;
  // Bedding areas and sanctuaries the thermal path runs into.
  into: string[];
}

// How much thermals must lead before scent they carry into bedding makes a stand Bad.
export const BAD_PULL = 0.35;
// Below this the wind leads and thermals only bend the scent.
export const WEAK_PULL = 0.25;

export function thermalRating(phase: ThermalPhase, pull: number, intoSomething: boolean): ThermalRating {
  if (intoSomething && pull >= BAD_PULL) return 'bad';
  if (pull < WEAK_PULL) return 'weak';
  return phase === 'switching' ? 'swirl' : 'good';
}

// Adds each stand's thermal path and note, and marks a stand Bad when
// thermals strong enough to matter carry its scent into bedding.
export function withThermals<T extends { stand: { lng: number; lat: number }; rating: string; windRating?: string; reason: string }>(
  rated: T[],
  forecast: Forecast | null,
  time: number,
  elevationAt: ElevationAt,
  intersects: (path: [number, number][]) => string[],
): (T & { thermal?: StandThermal })[] {
  if (!forecast || forecast.hours.length === 0) return rated;
  const windFromDeg = weatherAt(forecast, time).windFromDeg;
  return rated.map((r) => {
    // No lidar here yet (still loading, or offline without saved maps).
    if (elevationAt(r.stand.lng, r.stand.lat) === null) {
      return { ...r, thermal: { reason: 'Thermals: terrain is still loading (needs internet or saved maps).', rating: 'weak', shelter: 0, phase: 'switching', ends: null, pull: 0, path: null, into: [] } };
    }
    const start: [number, number] = [r.stand.lng, r.stand.lat];
    // This stand's own timing, from the sun on its slope.
    const terrain = terrainAt(start, elevationAt);
    const state = thermalAt(forecast, time, terrain);
    if (!state) return r;
    const shelter = shelterAt(start, windFromDeg, elevationAt);
    const local = withWind(state, shelteredWind(state.windMph, shelter));
    const path = traceThermalPath(start, local, windFromDeg, elevationAt);
    const into = path ? intersects(path.points) : [];
    const rating = thermalRating(local.phase, local.pull, into.length > 0);
    const thermal: StandThermal = {
      rating,
      reason:
        thermalReason(local, path) +
        (local.phase === 'switching' ? '' : shelterNote(shelter, windFromDeg, state.windMph)) +
        slopeTimesNote(forecast, time, terrain),
      shelter: shelter?.amount ?? 0,
      phase: local.phase,
      ends: path?.ends ?? null,
      pull: local.pull,
      path: path?.points ?? null,
      into,
    };
    if (rating === 'bad' && r.rating !== 'unset') {
      return { ...r, rating: 'bad', reason: `Thermals carry scent into ${into.join(' and ')}.`, thermal };
    }
    // A good wind doesn't help while the air is turning over: scent wanders.
    if (rating === 'swirl' && r.rating === 'good') {
      return { ...r, rating: 'ok', reason: 'Good wind, but thermals are switching, so scent may swirl around the stand.', thermal };
    }
    return { ...r, thermal };
  });
}
