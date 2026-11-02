import { useEffect, useState } from 'react';

import { fetchForecast, type Forecast } from '@/lib/weather';

const KEY = 'hunting-hub-field-weather';
// Refresh after this long, or when the spot moves this far.
const STALE_MS = 30 * 60 * 1000;
const MOVED_DEG = 0.02;

interface Saved {
  lat: number;
  lng: number;
  forecast: Forecast;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

// The forecast for a spot (free from Open-Meteo). Needs signal to refresh;
// the last one is kept so it still shows in the woods.
export function useFieldWeather(spot: { lat: number; lng: number } | null): { forecast: Forecast | null; offline: boolean } {
  const [saved, setSaved] = useState<Saved | null>(load);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const lat = spot ? Math.round(spot.lat * 100) / 100 : null;
  const lng = spot ? Math.round(spot.lng * 100) / 100 : null;
  useEffect(() => {
    if (lat === null || lng === null || !online) return;
    const current = load();
    const moved = !current || Math.abs(current.lat - lat) > MOVED_DEG || Math.abs(current.lng - lng) > MOVED_DEG;
    if (!moved && Date.now() - current.forecast.fetchedAt < STALE_MS) return;
    const controller = new AbortController();
    fetchForecast(lat, lng, controller.signal)
      .then((forecast) => {
        const next = { lat, lng, forecast };
        setSaved(next);
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          // Storage full: it still shows until the page closes.
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [lat, lng, online]);

  return { forecast: saved?.forecast ?? null, offline: !online };
}
