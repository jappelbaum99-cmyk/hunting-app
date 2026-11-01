// Rates stands against a forecast hour using each stand's "good winds".
import { COMPASS_POINTS, type CompassPoint, type MapMarker } from '@/types/models';
import type { Forecast, ForecastHour } from '@/lib/weather';

export type StandRating = 'good' | 'ok' | 'bad' | 'unset';

export interface RatedStand {
  stand: MapMarker;
  rating: StandRating;
  reason: string;
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

export function rateStand(stand: MapMarker, hour: ForecastHour): RatedStand {
  const wind = compassPointOf(hour.windFromDeg);
  if (stand.goodWinds.length === 0) {
    return { stand, rating: 'unset', reason: 'Pick its good winds to rate it.' };
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
  return { stand, rating, reason };
}

const ORDER: Record<StandRating, number> = { good: 0, ok: 1, bad: 2, unset: 3 };

export function rateStands(stands: MapMarker[], hour: ForecastHour): RatedStand[] {
  return stands
    .map((s) => rateStand(s, hour))
    .sort((a, b) => ORDER[a.rating] - ORDER[b.rating] || a.stand.name.localeCompare(b.stand.name, undefined, { numeric: true }));
}

export interface Sit {
  id: string;
  label: string;
  // The hour used to rate stands.
  time: number;
}

const HOUR = 3600_000;

// Morning and evening sits for the forecast days, plus "Now". A morning sit is
// rated at sunrise; an evening sit 2 hours before sunset, when deer start moving.
export function sitsFor(forecast: Forecast, now: number): Sit[] {
  const sits: Sit[] = [{ id: 'now', label: 'Now', time: now }];
  const lastHour = forecast.hours[forecast.hours.length - 1]?.time ?? now;
  forecast.days.forEach((day, i) => {
    const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day.sunrise).toLocaleDateString(undefined, { weekday: 'long' });
    const morning = day.sunrise;
    const evening = day.sunset - 2 * HOUR;
    if (morning > now && morning <= lastHour) sits.push({ id: `${day.date}-am`, label: `${dayName} AM`, time: morning });
    if (evening > now && evening <= lastHour) sits.push({ id: `${day.date}-pm`, label: `${dayName} PM`, time: evening });
  });
  return sits;
}
