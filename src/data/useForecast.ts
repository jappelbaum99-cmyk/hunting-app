import { useCallback, useEffect, useRef, useState } from 'react';

import type { ForecastState } from '@/components/ForecastPanel';
import { fetchForecast } from '@/lib/weather';

// Older forecasts are fetched again the next time they're needed.
const STALE_MS = 30 * 60_000;

// Loads the forecast for a location, again whenever the location changes or
// `refresh` is called, and when it has gone stale and `active` turns on.
export function useForecast(location: [number, number], active: boolean): [ForecastState, () => void] {
  const [state, setState] = useState<ForecastState>({ status: 'loading' });
  const [requestId, setRequestId] = useState(0);
  const [lng, lat] = location;
  // Round so tiny location changes (e.g. editing a property line) don't refetch.
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const fetchedAt = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchForecast(lat, lng, controller.signal)
      .then((forecast) => {
        fetchedAt.current = forecast.fetchedAt;
        setState({ status: 'ready', forecast });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
    // lat/lng are captured through `key` so equal locations don't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, requestId]);

  useEffect(() => {
    if (active && fetchedAt.current !== null && Date.now() - fetchedAt.current > STALE_MS) {
      setRequestId((n) => n + 1);
    }
  }, [active]);

  const refresh = useCallback(() => setRequestId((n) => n + 1), []);
  return [state, refresh];
}
