// Rates stands against a forecast hour using each stand's "good winds", then
// checks its scent cone against bedding areas and sanctuaries.
import booleanIntersects from '@turf/boolean-intersects';
import type { Polygon } from 'geojson';

import { scentCone } from '@/lib/scent';
import { COMPASS_POINTS, type CompassPoint, type MapArea, type MapMarker } from '@/types/models';
import type { Forecast, ForecastHour } from '@/lib/weather';
import type { StandThermal } from '@/lib/thermals';

export type StandRating = 'good' | 'ok' | 'bad' | 'unset';

export interface RatedStand {
  stand: MapMarker;
  rating: StandRating;
  reason: string;
  cone: Polygon;
  // Names of bedding areas / sanctuaries the scent drifts into.
  scentInto: string[];
  // Where thermals take the scent, once lidar elevation has loaded.
  thermal?: StandThermal;
}


// Below this the wind is too light to carry scent predictably; thermals and
// swirls take over.
const CALM_MPH = 3;
// Above this, gusts make even a good wind risky.
const GUSTY_MPH = 25;

export const RATING_LABELS: Record<StandRating, string> = {
  good: 'Good',
  ok: 'Maybe',
  bad: 'Bad',
  unset: 'No winds set',
};

export function compassPointOf(deg: number): CompassPoint {
  return COMPASS_POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// How many compass steps (45° each) apart two points are, 0-4.
function stepsApart(a: CompassPoint, b: CompassPoint): number {
  const d = Math.abs(COMPASS_POINTS.indexOf(a) - COMPASS_POINTS.indexOf(b));
  return Math.min(d, 8 - d);
}

// sensitiveAreas: areas where deer bed or hide (bedding, sanctuaries, or custom
// types marked that way in Settings); scent drifting into one makes a stand Bad.
export function rateStand(stand: MapMarker, hour: ForecastHour, sensitiveAreas: MapArea[] = []): RatedStand {
  const cone = scentCone(stand.lng, stand.lat, hour);
  const scentInto = sensitiveAreas
    .filter((a) => booleanIntersects(cone, a.geometry))
    .map((a) => a.name);
  const windRating = rateWind(stand, hour);
  if (scentInto.length > 0) {
    // Scent in a bedding area outweighs a "good" wind direction.
    return { stand, cone, scentInto, rating: 'bad', reason: `Scent drifts into ${scentInto.join(' and ')}.` };
  }
  return { stand, cone, scentInto, ...windRating };
}

function rateWind(stand: MapMarker, hour: ForecastHour): { rating: StandRating; reason: string } {
  const wind = compassPointOf(hour.windFromDeg);
  if (stand.goodWinds.length === 0) {
    return { rating: 'unset', reason: 'Pick its good winds to rate it.' };
  }

  const closest = Math.min(...stand.goodWinds.map((w) => stepsApart(w, wind)));
  let rating: StandRating = closest === 0 ? 'good' : closest === 1 ? 'ok' : 'bad';
  let reason =
    closest === 0
      ? `${wind} wind is one of its good winds.`
      : closest === 1
        ? `${wind} wind is close to its good winds (${stand.goodWinds.join(', ')}).`
        : `${wind} wind is wrong for it. Good on ${stand.goodWinds.join(', ')}.`;

  if (rating !== 'bad' && hour.windMph < CALM_MPH) {
    rating = 'ok';
    reason = `Wind is only ${Math.round(hour.windMph)} mph, so scent may swirl.`;
  } else if (rating === 'good' && hour.gustMph >= GUSTY_MPH) {
    rating = 'ok';
    reason = `Right direction, but gusts to ${Math.round(hour.gustMph)} mph.`;
  }
  return { rating, reason };
}

const ORDER: Record<StandRating, number> = { good: 0, ok: 1, bad: 2, unset: 3 };

export function rateStands(stands: MapMarker[], hour: ForecastHour, sensitiveAreas: MapArea[] = []): RatedStand[] {
  return stands
    .map((s) => rateStand(s, hour, sensitiveAreas))
    .sort((a, b) => ORDER[a.rating] - ORDER[b.rating] || a.stand.name.localeCompare(b.stand.name, undefined, { numeric: true }));
}

export interface Sit {
  id: string;
  label: string;
  // The time window of the sit, epoch ms.
  start: number;
  end: number;
  // Where the time slider starts: the moment deer are most likely moving.
  peak: number;
}

const HOUR = 3600_000;

// Which of the forecast's days is today: the one whose night-to-night span holds `now`.
export function todayIndex(forecast: Forecast, now: number): number {
  const i = forecast.days.findIndex((d) => now < d.sunrise + 17 * HOUR);
  return i < 0 ? forecast.days.length - 1 : i;
}

// Morning and evening sits for the forecast days, plus "Now".
// Morning: an hour before sunrise to 3 hours after, peaking at sunrise.
// Evening: 3 hours before sunset to 30 minutes after, peaking 1 hour before sunset.
export function sitsFor(forecast: Forecast, now: number): Sit[] {
  const sits: Sit[] = [{ id: 'now', label: 'Now', start: now, end: now + 4 * HOUR, peak: now }];
  const lastHour = forecast.hours[forecast.hours.length - 1]?.time ?? now;
  // The forecast can start a few days back; count from the day we're in.
  const today = todayIndex(forecast, now);
  forecast.days.forEach((day, index) => {
    const i = index - today;
    if (i < 0) return;
    const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day.sunrise).toLocaleDateString(undefined, { weekday: 'long' });
    const morning: Sit = {
      id: `${day.date}-am`,
      label: `${dayName} AM`,
      start: day.sunrise - HOUR,
      end: day.sunrise + 3 * HOUR,
      peak: day.sunrise,
    };
    const evening: Sit = {
      id: `${day.date}-pm`,
      label: `${dayName} PM`,
      start: day.sunset - 3 * HOUR,
      end: day.sunset + HOUR / 2,
      peak: day.sunset - HOUR,
    };
    for (const sit of [morning, evening]) {
      if (sit.end > now && sit.end <= lastHour) sits.push(sit);
    }
  });
  return sits;
}
