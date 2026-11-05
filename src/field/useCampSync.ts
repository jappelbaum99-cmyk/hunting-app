import { useEffect, useRef, useState } from 'react';

import type { FieldData } from '@/field/fieldData';
import { sendHunt, sendNote, sendPin, sendTrack, watchHunts, watchCampInfo, watchStands } from '@/lib/camp';

const RETRY_MS = 30_000;

export interface CampStatus {
  online: boolean;
  // Pins and hunts the camp doesn't have yet (or has an older version of).
  waiting: number;
  error: string | null;
}

// Keeps the phone and its camp in step: every pin and hunt goes up as soon as
// there's signal (or the next time the page opens), and the stand list comes down.
export function useCampSync(data: FieldData, setData: (update: (d: FieldData) => FieldData) => void): CampStatus {
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  // Versions being sent right now, so each one goes up once.
  const inFlight = useRef(new Map<string, string>());
  // Bumped to try failed sends again.
  const [retry, setRetry] = useState(0);
  const camp = data.camp;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Stands published by the hub.
  useEffect(() => {
    if (!camp) return;
    return watchStands(
      camp,
      (stands) => {
        const live = stands.filter((s) => !s.deletedAt).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setData((d) => ({
          ...d,
          stands: live.map(({ id, name, lat, lng, goodWinds, place }) => ({ id, name, lat, lng, goodWinds, place: place ?? null })),
          standsUpdatedAt: new Date().toISOString(),
        }));
        setError(null);
      },
      setError,
    );
  }, [camp?.code]);

  // Pin types added in the hub's Settings, which pins, walks and notes the hub has
  // handled, and the board. A note the hub has is done with on this phone.
  useEffect(() => {
    if (!camp) return;
    return watchCampInfo(
      camp,
      ({ pinTypes, handled, board, plots }) => setData((d) => ({ ...d, pinTypes, handled, board, plots, notes: d.notes.filter((n) => !handled[n.id]) })),
      setError,
    );
  }, [camp?.code]);

  // Everyone's hunts, for the day summaries, who's in the stand, and stand history.
  useEffect(() => {
    if (!camp) return;
    return watchHunts(
      camp,
      (hunts) => {
        setData((d) => ({ ...d, campHunts: hunts.filter((h) => !h.deletedAt) }));
        setError(null);
      },
      setError,
    );
  }, [camp?.code]);

  const pending = camp
    ? [
        ...data.pins.map((p) => ({ id: p.id, version: p.updatedAt, send: () => sendPin(camp, p) })),
        ...data.tracks.map((t) => ({ id: t.id, version: t.updatedAt, send: () => sendTrack(camp, t) })),
        ...data.reports.map((r) => ({ id: r.id, version: r.updatedAt, send: () => sendHunt(camp, r) })),
        ...data.notes.map((n) => ({ id: n.id, version: n.updatedAt, send: () => sendNote(camp, n) })),
      ].filter((item) => data.sent[item.id] !== item.version)
    : [];

  useEffect(() => {
    if (!camp || !online) return;
    for (const item of pending) {
      if (inFlight.current.get(item.id) === item.version) continue;
      inFlight.current.set(item.id, item.version);
      item
        .send()
        .then(() => {
          setData((d) => ({ ...d, sent: { ...d.sent, [item.id]: item.version } }));
          setError(null);
        })
        .then(
          () => inFlight.current.delete(item.id),
          (e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
            // Wait a bit before trying this one again.
            setTimeout(() => {
              inFlight.current.delete(item.id);
              setRetry((n) => n + 1);
            }, RETRY_MS);
          },
        );
    }
  }, [camp, online, pending.map((p) => `${p.id}@${p.version}`).join(','), retry]);

  return { online, waiting: pending.length, error };
}
