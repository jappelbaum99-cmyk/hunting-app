// Hourly forecast from Open-Meteo: free, no account or key (non-commercial use).
// https://open-meteo.com/en/docs

export interface ForecastHour {
  // Epoch milliseconds for the start of the hour.
  time: number;
  tempF: number;
  windMph: number;
  gustMph: number;
  // Meteorological: the direction the wind blows FROM, 0 = north.
  windFromDeg: number;
  precipChance: number;
  // Rain expected in this hour, inches.
  precipIn: number;
  humidity: number;
  cloudCover: number;
  pressureHpa: number;
  // Sunshine reaching flat ground, W/m², averaged over the hour before: all of
  // it, the direct beam, and the part scattered by cloud and sky. Missing from
  // forecasts saved before these were fetched.
  sunWm2?: number;
  directWm2?: number;
  diffuseWm2?: number;
}

export interface ForecastDay {
  // Local date, e.g. '2026-11-01'.
  date: string;
  sunrise: number;
  sunset: number;
}

export interface Forecast {
  fetchedAt: number;
  lat: number;
  lng: number;
  hours: ForecastHour[];
  days: ForecastDay[];
}

// Today and the next 10 days (Open-Meteo goes to 16).
const FORECAST_DAYS = 11;

interface OpenMeteoResponse {
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    relative_humidity_2m: number[];
    cloud_cover: number[];
    pressure_msl: number[];
    shortwave_radiation?: (number | null)[];
    direct_radiation?: (number | null)[];
    diffuse_radiation?: (number | null)[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

// The next few days, or (with `days`) a given range of local dates,
// e.g. { start: '2026-10-28', end: '2026-10-28' }. The service covers about
// the last three months and the next two weeks.
export async function fetchForecast(
  lat: number,
  lng: number,
  signal?: AbortSignal,
  days?: { start: string; end: string },
  // With the next few days: this many past days too (the deer activity score
  // compares the forecast with the last few days' temperatures).
  pastDays = 0,
): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly: [
      'temperature_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'precipitation_probability',
      'precipitation',
      'relative_humidity_2m',
      'cloud_cover',
      'pressure_msl',
      // Sunshine, for when slopes warm enough to turn thermals uphill.
      'shortwave_radiation',
      'direct_radiation',
      'diffuse_radiation',
    ].join(','),
    daily: 'sunrise,sunset',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });
  if (days) {
    params.set('start_date', days.start);
    params.set('end_date', days.end);
  } else {
    params.set('forecast_days', String(FORECAST_DAYS));
    if (pastDays > 0) params.set('past_days', String(pastDays));
  }
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!response.ok) throw new Error(`Weather service answered ${response.status}`);
  const data = (await response.json()) as OpenMeteoResponse;

  // Times come back in the property's local time with no offset attached.
  const offsetMs = data.utc_offset_seconds * 1000;
  const toEpoch = (local: string) => Date.parse(`${local}Z`) - offsetMs;

  const h = data.hourly;
  return {
    fetchedAt: Date.now(),
    lat,
    lng,
    hours: h.time.map((t, i) => ({
      time: toEpoch(t),
      tempF: h.temperature_2m[i],
      windMph: h.wind_speed_10m[i],
      gustMph: h.wind_gusts_10m[i],
      windFromDeg: h.wind_direction_10m[i],
      precipChance: h.precipitation_probability[i] ?? 0,
      precipIn: h.precipitation[i] ?? 0,
      humidity: h.relative_humidity_2m[i],
      cloudCover: h.cloud_cover[i],
      pressureHpa: h.pressure_msl[i],
      sunWm2: h.shortwave_radiation?.[i] ?? undefined,
      directWm2: h.direct_radiation?.[i] ?? undefined,
      diffuseWm2: h.diffuse_radiation?.[i] ?? undefined,
    })),
    days: data.daily.time.map((date, i) => ({
      date,
      sunrise: toEpoch(data.daily.sunrise[i]),
      sunset: toEpoch(data.daily.sunset[i]),
    })),
  };
}

// The hour that contains `time`, or the nearest one.
export function hourAt(forecast: Forecast, time: number): ForecastHour {
  let best = forecast.hours[0];
  for (const hour of forecast.hours) {
    if (Math.abs(hour.time - time) < Math.abs(best.time - time)) best = hour;
  }
  return best;
}

const HOUR_MS = 3600_000;

// Weather at any moment, blended between the two nearest forecast hours, so
// things like the scent cones move smoothly as a time slider is dragged.
export function weatherAt(forecast: Forecast, time: number): ForecastHour {
  const hours = forecast.hours;
  const first = hours[0];
  const last = hours[hours.length - 1];
  if (time <= first.time) return { ...first, time };
  if (time >= last.time) return { ...last, time };
  const i = Math.min(hours.length - 2, Math.floor((time - first.time) / HOUR_MS));
  const [a, b] = [hours[i], hours[i + 1]];
  const k = (time - a.time) / (b.time - a.time);
  const mix = (x: number, y: number) => x + (y - x) * k;
  // Wind direction wraps around 360, so blend along the shorter way round.
  const turn = ((b.windFromDeg - a.windFromDeg + 540) % 360) - 180;
  return {
    time,
    tempF: mix(a.tempF, b.tempF),
    windMph: mix(a.windMph, b.windMph),
    gustMph: mix(a.gustMph, b.gustMph),
    windFromDeg: (a.windFromDeg + turn * k + 360) % 360,
    precipChance: mix(a.precipChance, b.precipChance),
    precipIn: mix(a.precipIn, b.precipIn),
    humidity: mix(a.humidity, b.humidity),
    cloudCover: mix(a.cloudCover, b.cloudCover),
    pressureHpa: mix(a.pressureHpa, b.pressureHpa),
    sunWm2: a.sunWm2 !== undefined && b.sunWm2 !== undefined ? mix(a.sunWm2, b.sunWm2) : undefined,
    directWm2: a.directWm2 !== undefined && b.directWm2 !== undefined ? mix(a.directWm2, b.directWm2) : undefined,
    diffuseWm2: a.diffuseWm2 !== undefined && b.diffuseWm2 !== undefined ? mix(a.diffuseWm2, b.diffuseWm2) : undefined,
  };
}

// Forecast hours from `start` to `end`, with blended points added at both ends.
export function hoursBetween(forecast: Forecast, start: number, end: number): ForecastHour[] {
  const inside = forecast.hours.filter((h) => h.time > start && h.time < end);
  return [weatherAt(forecast, start), ...inside, weatherAt(forecast, end)];
}

function localDate(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Barometric pressure. Forecasts give hectopascals; hunters read inches of mercury.
export function inHg(hpa: number): number {
  return hpa * 0.02953;
}

export type PressureTrend = 'rising' | 'falling' | 'steady';

export interface Pressure {
  inHg: number;
  // Change over the 3 hours before, inHg.
  changeInHg: number;
  trend: PressureTrend;
}

// A change under about 0.02 inHg (0.7 hPa) in 3 hours counts as steady.
export function pressureAt(forecast: Forecast, time: number): Pressure {
  const now = weatherAt(forecast, time).pressureHpa;
  const before = weatherAt(forecast, time - 3 * HOUR_MS).pressureHpa;
  const change = now - before;
  return { inHg: inHg(now), changeInHg: inHg(change), trend: change > 0.7 ? 'rising' : change < -0.7 ? 'falling' : 'steady' };
}

// "30.12 inHg, falling".
export function formatPressure(p: Pick<Pressure, 'inHg' | 'trend'>): string {
  return `${p.inHg.toFixed(2)} inHg, ${p.trend}`;
}

// The weather at one place and moment, for filling in a hunt report.
// Uses the PC's local date, which matches the property's for local hunts;
// starts a few hours earlier so the pressure trend can be worked out.
export async function weatherFor(lat: number, lng: number, time: number): Promise<{ hour: ForecastHour; pressure: Pressure }> {
  const forecast = await fetchForecast(lat, lng, undefined, { start: localDate(time - 6 * HOUR_MS), end: localDate(time) });
  return { hour: weatherAt(forecast, time), pressure: pressureAt(forecast, time) };
}
