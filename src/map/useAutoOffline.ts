// Keeps every property's maps saved on this PC without being asked: the same
// tiles as "Download for offline", for each property plus a radius around it.
// Runs in the desktop app only, a few seconds after opening and again after a
// property, the lidar style or the contours change. Tiles already saved are only
// checked for, so a run with nothing new is quick and sends nothing.
import { useEffect, useRef, useState } from 'react';

import type { MapLayersState } from '@/map/layers';
import { DEFAULT_OFFLINE_RADIUS_M, planDownload, runDownload } from '@/map/offline';
import type { Property } from '@/types/models';

// Wait this long after a change before starting, so edits can settle.
const START_DELAY_MS = 5000;
// Two tiles at a time: the map in front gets the rest of the connection.
const BACKGROUND_CONCURRENCY = 2;
// Tiles that failed (a busy USGS server, no internet) get another go after this.
const RETRY_AFTER_MS = 10 * 60 * 1000;
// Progress shows at most this often, so the app isn't redrawn for every tile.
const PROGRESS_EVERY_MS = 500;

export interface AutoOfflineStatus {
  state: 'off' | 'waiting' | 'running' | 'done';
  done: number;
  total: number;
  failed: number;
  // Tiles that had to be fetched this run.
  fetched: number;
  // Properties too big to save (over the tile limit).
  skipped: string[];
  finishedAt: string | null;
}

// One line on the background download, for Settings and a property's panel.
export function autoOfflineText(auto: AutoOfflineStatus): string {
  const skipped = auto.skipped.length ? ` Too big to save: ${auto.skipped.join(', ')} (draw a smaller property or section).` : '';
  if (auto.state === 'waiting') return 'Checking your properties’ maps shortly…';
  if (auto.state === 'running') return `Saving maps around your properties in the background: ${auto.done.toLocaleString()} of ${auto.total.toLocaleString()} tiles.${skipped}`;
  if (auto.state === 'done') {
    const failed = auto.failed ? ` ${auto.failed.toLocaleString()} couldn’t be fetched (the USGS server was busy); they’ll be tried again in a few minutes.` : '';
    return `${(auto.total - auto.failed).toLocaleString()} map tiles around your properties are saved, with lidar, 3D terrain and the closest zoom. Lidar styles and contours you switch to are saved too.${failed}${skipped}`;
  }
  return '';
}

const IDLE: AutoOfflineStatus = { state: 'off', done: 0, total: 0, failed: 0, fetched: 0, skipped: [], finishedAt: null };

export function useAutoOffline(options: { properties: Property[]; layers: MapLayersState; enabled: boolean; radiusM?: number }): AutoOfflineStatus {
  const { properties, layers, enabled } = options;
  const radiusM = options.radiusM ?? DEFAULT_OFFLINE_RADIUS_M;
  const [status, setStatus] = useState<AutoOfflineStatus>(IDLE);
  const [retryTick, setRetryTick] = useState(0);
  const latest = useRef({ properties, layers });
  latest.current = { properties, layers };

  // Only what changes the tile list starts a new run.
  const key = enabled && window.hub
    ? JSON.stringify([radiusM, layers.lidarStyle, layers.contours, properties.map((p) => [p.id, JSON.stringify(p.boundary)])])
    : null;

  useEffect(() => {
    if (key === null) {
      setStatus(IDLE);
      return;
    }
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    setStatus((s) => ({ ...s, state: 'waiting' }));
    const start = setTimeout(() => {
      const { properties: props, layers: current } = latest.current;
      const urls = new Set<string>();
      const skipped: string[] = [];
      for (const property of props) {
        const plan = planDownload(property.boundary, current, radiusM);
        if (plan.tooBig) skipped.push(property.name);
        else for (const url of plan.urls) urls.add(url);
      }
      let shownAt = 0;
      setStatus({ state: 'running', done: 0, total: urls.size, failed: 0, fetched: 0, skipped, finishedAt: null });
      void runDownload(
        { urls: [...urls] },
        (p) => {
          const now = Date.now();
          if (now - shownAt < PROGRESS_EVERY_MS) return;
          shownAt = now;
          setStatus((s) => ({ ...s, done: p.done, failed: p.failed, fetched: p.fetched ?? 0 }));
        },
        controller.signal,
        BACKGROUND_CONCURRENCY,
      )
        .then((p) => {
          if (controller.signal.aborted) return;
          setStatus({ state: 'done', done: p.done, total: p.total, failed: p.failed, fetched: p.fetched ?? 0, skipped, finishedAt: new Date().toISOString() });
          if (p.failed > 0) retry = setTimeout(() => setRetryTick((n) => n + 1), RETRY_AFTER_MS);
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus((s) => ({ ...s, state: 'done', finishedAt: new Date().toISOString() }));
        });
    }, START_DELAY_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(retry);
      controller.abort();
    };
  }, [key, retryTick]);

  return status;
}
