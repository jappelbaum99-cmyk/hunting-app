import { useEffect, useRef, useState } from 'react';

import { sendShared, watchShared } from '@/lib/camp';
import { changesToSend, chunkDocs, incomingChanges, markAlreadySent, packTypes, type SharedRecords, type SharedTypes } from '@/lib/partnerSync';
import type { CampLink, CustomAreaType, CustomPinType } from '@/types/models';

// Wait for edits to settle, so typing a name sends once rather than per letter.
const SEND_DELAY_MS = 3000;
const RETRY_MS = 30_000;

function friendly(message: string): string {
  return /permission/i.test(message) ? 'Map sharing was refused. This hub may not be a partner, or the new camp rules may not be in Firebase yet.' : message;
}

// Keeps this hub's map, plans, logs and board in step with the camp's other
// partners. Everything is still saved on this PC first. Only changes are sent,
// and only changes come back, so nothing moves unless something changed.
export function usePartnerSync(options: {
  camp: CampLink | null;
  // Whether this hub is a partner in the camp right now.
  manager: boolean;
  data: SharedRecords | null;
  pinTypes: CustomPinType[];
  areaTypes: CustomAreaType[];
  mergeRecords(records: SharedRecords, areaTypes?: CustomAreaType[], pinTypes?: CustomPinType[]): unknown;
  patchCamp(patch: Partial<CampLink>): void;
  onNotice(message: string): void;
}): { error: string | null; waiting: boolean } {
  const { camp, manager, data, pinTypes, areaTypes } = options;
  const active = !!camp?.sharing && manager;
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  // Bumped to look again after a send finishes or fails.
  const [tick, setTick] = useState(0);
  const latest = useRef(options);
  latest.current = options;
  // Versions that came from a partner, so they aren't sent straight back.
  const seen = useRef(new Map<string, string>());
  const seeded = useRef(false);
  const sending = useRef(false);
  const lastTypes = useRef<string | null>(null);

  // Take in what partners send.
  useEffect(() => {
    // What's known to be shared belongs to one camp, and sharing may have been off a while.
    seen.current = new Map();
    seeded.current = false;
    lastTypes.current = null;
    setError(null);
    if (!active || !camp) return;
    return watchShared(
      camp,
      camp.cursor ?? null,
      (docs) => {
        for (const doc of docs) if (doc.collection !== 'types' && (seen.current.get(doc.id) ?? '') < doc.updatedAt) seen.current.set(doc.id, doc.updatedAt);
        const now = latest.current;
        const { records, count, types, cursor } = incomingChanges(docs, now.data ?? {});
        if (types) lastTypes.current = JSON.stringify(types);
        if (count > 0 || types) now.mergeRecords(records, (types as SharedTypes | null)?.areaTypes ?? [], (types as SharedTypes | null)?.pinTypes ?? []);
        if (cursor) now.patchCamp({ cursor });
        if (count > 0) now.onNotice(`${count} change${count === 1 ? '' : 's'} from your partner.`);
        setError(null);
      },
      (message) => setError(friendly(message)),
    );
  }, [active, camp?.code]);

  // Send what changed here, once edits settle.
  useEffect(() => {
    if (!active || !camp || !data || sending.current) return;
    const timer = setTimeout(() => {
      const now = latest.current;
      const link = now.camp;
      if (!link || !now.data || sending.current) return;
      // Taken before looking, so an edit made during the send goes out next time.
      const startedAt = new Date().toISOString();
      if (!seeded.current) {
        markAlreadySent(now.data, link.pushedAt ?? null, seen.current);
        seeded.current = true;
      }
      const docs = changesToSend(now.data, seen.current);
      if (docs.length === 0) return;
      const { batches, tooBig } = chunkDocs(docs);
      sending.current = true;
      setWaiting(true);
      (async () => {
        for (const batch of batches) await sendShared(link, batch);
      })()
        .then(() => {
          for (const doc of docs) seen.current.set(doc.id, doc.updatedAt);
          latest.current.patchCamp({ pushedAt: startedAt });
          setError(tooBig.length > 0 ? `${tooBig.length} record${tooBig.length === 1 ? ' is' : 's are'} too large to share, usually a very detailed shape.` : null);
          sending.current = false;
          setWaiting(false);
          setTick((n) => n + 1);
        })
        .catch((e: unknown) => {
          setError(friendly(e instanceof Error ? e.message : String(e)));
          sending.current = false;
          setWaiting(false);
          setTimeout(() => setTick((n) => n + 1), RETRY_MS);
        });
    }, SEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, camp?.code, data, tick]);

  // Custom pin and area types, so shared pins and areas look right on the other PC.
  const typesDoc = packTypes(pinTypes, areaTypes, '');
  useEffect(() => {
    if (!active || !camp || typesDoc.data === lastTypes.current || (pinTypes.length === 0 && areaTypes.length === 0)) return;
    const timer = setTimeout(() => {
      lastTypes.current = typesDoc.data;
      sendShared(camp, [{ ...typesDoc, updatedAt: new Date().toISOString() }]).catch((e: unknown) => setError(friendly(e instanceof Error ? e.message : String(e))));
    }, SEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, camp?.code, typesDoc.data]);

  return { error, waiting };
}
