import { useEffect, useRef, useState } from 'react';

import { sendStand, watchHunts, watchPins, watchStands, type CampStand } from '@/lib/camp';
import type { CampLink, FieldPin, HuntReport } from '@/types/models';

// Wait for edits to settle before publishing stands.
const PUBLISH_DELAY_MS = 1500;

// The hub's side of camp sync: hunts and pins from phones come in through
// onIncoming, and (on the hub that started the camp) the stand list goes out.
export function useHubCamp(
  camp: CampLink | null,
  stands: CampStand[],
  onIncoming: (incoming: { reports: HuntReport[]; pins: FieldPin[] }) => void,
): { error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<Map<string, CampStand> | null>(null);
  const incoming = useRef(onIncoming);
  incoming.current = onIncoming;
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!camp) return;
    const ok = () => setError(null);
    const stops = [
      watchHunts(camp, (reports) => (ok(), incoming.current({ reports, pins: [] })), setError),
      watchPins(camp, (pins) => (ok(), incoming.current({ reports: [], pins })), setError),
    ];
    if (camp.isOwner) stops.push(watchStands(camp, (list) => setPublished(new Map(list.map((s) => [s.id, s]))), setError));
    return () => {
      stops.forEach((stop) => stop());
      setPublished(null);
    };
  }, [camp?.code, camp?.isOwner]);

  // Publishes stands that are new or changed, and marks removed ones deleted.
  const key = stands.map((s) => `${s.id}@${s.updatedAt}`).join(',');
  useEffect(() => {
    if (!camp?.isOwner || !published) return;
    const timer = setTimeout(() => {
      const now = new Date().toISOString();
      const wanted = new Map(stands.map((s) => [s.id, s]));
      const changes: CampStand[] = [
        ...stands.filter((s) => published.get(s.id)?.updatedAt !== s.updatedAt || published.get(s.id)?.deletedAt),
        ...[...published.values()].filter((s) => !s.deletedAt && !wanted.has(s.id)).map((s) => ({ ...s, deletedAt: now, updatedAt: now })),
      ];
      for (const stand of changes) {
        const tag = `${stand.id}@${stand.updatedAt}@${stand.deletedAt ?? ''}`;
        if (inFlight.current.has(tag)) continue;
        inFlight.current.add(tag);
        sendStand(camp, stand)
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => inFlight.current.delete(tag));
      }
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, camp?.isOwner, published, key]);

  return { error };
}
