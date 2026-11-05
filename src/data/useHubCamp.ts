import { useEffect, useRef, useState } from 'react';

import type { BoardCard, CampPlot } from '@/lib/actionBoard';
import { publishBoard, publishHandled, publishPinTypes, sendStand, type Handled, watchHunts, watchNotes, watchPins, watchStands, watchTracks, type CampStand } from '@/lib/camp';
import type { CampLink, CustomPinType, FieldNote, FieldPin, FieldTrack, HuntReport } from '@/types/models';

// Wait for edits to settle before publishing stands.
const PUBLISH_DELAY_MS = 1500;

// The hub's side of camp sync: hunts and pins from phones come in through
// onIncoming, and (on the hub that started the camp) the stand list goes out.
export function useHubCamp(
  camp: CampLink | null,
  stands: CampStand[],
  onIncoming: (incoming: { reports: HuntReport[]; pins: FieldPin[]; tracks: FieldTrack[]; notes: FieldNote[] }) => void,
  pinTypes: CustomPinType[] = [],
  // Phone pins, walks and notes this hub has taken in or dismissed.
  handled: Handled = {},
  // What phones show of the Action Board, and the food plots they can log work on.
  board: BoardCard[] = [],
  plots: CampPlot[] = [],
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
      watchHunts(camp, (reports) => (ok(), incoming.current({ reports, pins: [], tracks: [], notes: [] })), setError),
      watchPins(camp, (pins) => (ok(), incoming.current({ reports: [], pins, tracks: [], notes: [] })), setError),
      watchTracks(camp, (tracks) => (ok(), incoming.current({ reports: [], pins: [], tracks, notes: [] })), setError),
      watchNotes(camp, (notes) => (ok(), incoming.current({ reports: [], pins: [], tracks: [], notes })), setError),
    ];
    if (camp.isOwner) stops.push(watchStands(camp, (list) => setPublished(new Map(list.map((s) => [s.id, s]))), setError));
    return () => {
      stops.forEach((stop) => stop());
      setPublished(null);
    };
  }, [camp?.code, camp?.isOwner]);

  // Publishes stands that are new or changed, and marks removed ones deleted.
  const key = stands.map((s) => `${s.id}@${s.updatedAt}@${s.place ?? ''}`).join(',');
  useEffect(() => {
    if (!camp?.isOwner || !published) return;
    const timer = setTimeout(() => {
      const now = new Date().toISOString();
      const wanted = new Map(stands.map((s) => [s.id, s]));
      const changes: CampStand[] = [
        // Sent again only when something about it changed.
        ...stands.filter((s) => {
          const pub = published.get(s.id);
          return !pub || pub.updatedAt !== s.updatedAt || (pub.place ?? null) !== (s.place ?? null) || (pub.deletedAt ?? null) !== (s.deletedAt ?? null);
        }),
        ...[...published.values()].filter((s) => !s.deletedAt && !wanted.has(s.id)).map((s) => ({ ...s, deletedAt: now, updatedAt: now })),
      ];
      for (const stand of changes) {
        const tag = `${stand.id}@${stand.updatedAt}@${stand.deletedAt ?? ''}@${stand.place ?? ''}`;
        if (inFlight.current.has(tag)) continue;
        inFlight.current.add(tag);
        sendStand(camp, stand)
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => inFlight.current.delete(tag));
      }
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, camp?.isOwner, published, key]);

  // Custom pin types, so phones can drop them too.
  const typesKey = JSON.stringify(pinTypes);
  useEffect(() => {
    if (!camp?.isOwner) return;
    const timer = setTimeout(() => {
      publishPinTypes(camp, JSON.parse(typesKey) as CustomPinType[]).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, camp?.isOwner, typesKey]);

  // Tell phones which of their pins and walks are done with, so they can clear them.
  const handledKey = JSON.stringify(handled);
  useEffect(() => {
    if (!camp?.isOwner) return;
    const timer = setTimeout(() => {
      publishHandled(camp, JSON.parse(handledKey) as Handled).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, camp?.isOwner, handledKey]);

  // The board and food plots, for the phones' Notes tab.
  const boardKey = JSON.stringify({ board, plots });
  useEffect(() => {
    if (!camp?.isOwner) return;
    const timer = setTimeout(() => {
      const next = JSON.parse(boardKey) as { board: BoardCard[]; plots: CampPlot[] };
      publishBoard(camp, next.board, next.plots).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, camp?.isOwner, boardKey]);

  return { error };
}
