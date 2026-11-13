import { useEffect, useRef, useState } from 'react';

import type { CampPlot } from '@/lib/actionBoard';
import { MAX_CAMP_MAP_CHARS } from '@/lib/campMap';
import { campUserId, publishHandled, publishMap, publishPinTypes, publishPlots, sendStand, type CampInfo, type Handled, watchCampInfo, watchHunts, watchNotes, watchPins, watchStands, watchTracks, type CampStand } from '@/lib/camp';
import type { CampLink, CustomPinType, FieldNote, FieldPin, FieldTrack, HuntReport } from '@/types/models';

// Wait for edits to settle before publishing stands.
const PUBLISH_DELAY_MS = 1500;

// The hub's side of camp sync: hunts and pins from phones come in through
// onIncoming, and (on a partner's hub) the stand list goes out.
export function useHubCamp(
  camp: CampLink | null,
  stands: CampStand[],
  onIncoming: (incoming: { reports: HuntReport[]; pins: FieldPin[]; tracks: FieldTrack[]; notes: FieldNote[] }) => void,
  pinTypes: CustomPinType[] = [],
  // Phone pins, walks and notes this hub has taken in or dismissed.
  handled: Handled = {},
  // The food plots phones can log work on.
  plots: CampPlot[] = [],
  // The camp map for the phones (packed text), or null to leave it alone.
  mapText: string | null = null,
): { error: string | null; manager: boolean; uid: string | null; info: CampInfo | null } {
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<Map<string, CampStand> | null>(null);
  const [info, setInfo] = useState<CampInfo | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const incoming = useRef(onIncoming);
  incoming.current = onIncoming;
  const inFlight = useRef(new Set<string>());
  // A partner runs the camp: the hub that started it, or one that was approved.
  const manager = !!camp && (!!camp.isOwner || (uid !== null && info !== null && (info.ownerUid === uid || info.partners.includes(uid))));

  useEffect(() => {
    if (!camp) {
      setInfo(null);
      return;
    }
    void campUserId().then(setUid, () => undefined);
    return watchCampInfo(camp, setInfo, setError);
  }, [camp?.code]);

  useEffect(() => {
    if (!camp) return;
    const ok = () => setError(null);
    const stops = [
      watchHunts(camp, (reports) => (ok(), incoming.current({ reports, pins: [], tracks: [], notes: [] })), setError),
      watchPins(camp, (pins) => (ok(), incoming.current({ reports: [], pins, tracks: [], notes: [] })), setError),
      watchTracks(camp, (tracks) => (ok(), incoming.current({ reports: [], pins: [], tracks, notes: [] })), setError),
      watchNotes(camp, (notes) => (ok(), incoming.current({ reports: [], pins: [], tracks: [], notes })), setError),
    ];
    if (manager) stops.push(watchStands(camp, (list) => setPublished(new Map(list.map((s) => [s.id, s]))), setError));
    return () => {
      stops.forEach((stop) => stop());
      setPublished(null);
    };
  }, [camp?.code, manager]);

  // Publishes stands that are new or changed, and marks removed ones deleted.
  const key = stands.map((s) => `${s.id}@${s.updatedAt}@${s.place ?? ''}`).join(',');
  useEffect(() => {
    if (!manager || !camp || !published) return;
    const timer = setTimeout(() => {
      const now = new Date().toISOString();
      const wanted = new Map(stands.map((s) => [s.id, s]));
      const changes: CampStand[] = [
        // Sent again only when something about it changed. With partners, another
        // hub may have published a newer version than this one has heard about.
        ...stands.filter((s) => {
          const pub = published.get(s.id);
          return !pub || s.updatedAt > pub.updatedAt || (s.updatedAt === pub.updatedAt && ((pub.place ?? null) !== (s.place ?? null) || (pub.deletedAt ?? null) !== (s.deletedAt ?? null)));
        }),
        // A stand this hub hasn't got could just be a partner's new one, so only a lone hub clears them.
        ...(camp.sharing ? [] : [...published.values()].filter((s) => !s.deletedAt && !wanted.has(s.id)).map((s) => ({ ...s, deletedAt: now, updatedAt: now }))),
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
  }, [camp?.code, manager, published, key]);

  // Custom pin types, so phones can drop them too.
  const typesKey = JSON.stringify(pinTypes);
  useEffect(() => {
    if (!manager || !camp) return;
    const timer = setTimeout(() => {
      publishPinTypes(camp, JSON.parse(typesKey) as CustomPinType[]).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, manager, typesKey]);

  // Tell phones which of their pins and walks are done with, so they can clear them.
  const handledKey = JSON.stringify(handled);
  useEffect(() => {
    if (!manager || !camp) return;
    const timer = setTimeout(() => {
      publishHandled(camp, JSON.parse(handledKey) as Handled).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, manager, handledKey]);

  // The food plots, for the phones' Notes tab.
  const plotsKey = JSON.stringify(plots);
  useEffect(() => {
    if (!manager || !camp) return;
    const timer = setTimeout(() => {
      publishPlots(camp, JSON.parse(plotsKey) as CampPlot[]).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, manager, plotsKey]);

  // The map the phones draw. Sent when this hub's map changes and the camp's
  // copy differs, so an idle hub writes nothing, and two partners with
  // different maps don't keep overwriting each other.
  const campMap = info?.map ?? null;
  const lastMap = useRef<string | null>(null);
  useEffect(() => {
    if (!manager || !camp || !info || !mapText || mapText === campMap || mapText === lastMap.current) return;
    const timer = setTimeout(() => {
      if (mapText.length > MAX_CAMP_MAP_CHARS) {
        setError('The map is too big to send to phones. Simplify a very detailed boundary or trail.');
        return;
      }
      lastMap.current = mapText;
      publishMap(camp, mapText).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [camp?.code, manager, info !== null, mapText, campMap]);

  return { error, manager, uid, info };
}
