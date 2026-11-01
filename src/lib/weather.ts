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
  cloudCover: number;
  pressureHpa: number;
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

const FORECAST_DAYS = 4;

interface OpenMeteoResponse {
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    precipitation_probability: (number | null)[];
    cloud_cover: number[];
    pressure_msl: number[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

export async function fetchForecast(lat: number, lng: number, signal?: AbortSignal): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,cloud_cover,pressure_msl',
    daily: 'sunrise,sunset',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  });
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
      cloudCover: h.cloud_cover[i],
      pressureHpa: h.pressure_msl[i],
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
