// What partners' hubs share through the camp, and working out what to send and
// take in. Each record is packed as text: Firestore can't hold the lists inside
// lists that shapes and trails use. Trail camera photos and map images aren't
// shared; they stay on the PC that has them.
import type { CustomAreaType, CustomPinType, HubData } from '@/types/models';

export const SHARED_COLLECTIONS = ['properties', 'markers', 'areas', 'sections', 'plans', 'trails', 'reports', 'fieldPins', 'fieldTracks', 'actionItems'] as const;
export type SharedCollection = (typeof SHARED_COLLECTIONS)[number];
export type SharedRecords = Partial<Pick<HubData, SharedCollection>>;

const TYPES_DOC = '__types';

export interface SharedDoc {
  id: string;
  collection: SharedCollection | 'types';
  updatedAt: string;
  data: string;
  // When Firebase got it. Set only on what comes back.
  syncedAt?: string | null;
}

export interface SharedTypes {
  pinTypes: CustomPinType[];
  areaTypes: CustomAreaType[];
}

// Firestore takes up to 1 MiB a document, 500 writes a batch and 10 MiB a request.
const MAX_DOC_CHARS = 900_000;
const MAX_BATCH_DOCS = 400;
const MAX_BATCH_CHARS = 4_000_000;

function packRecord(collection: SharedCollection, record: { id: string; updatedAt: string }): SharedDoc {
  // A property's offline map download belongs to the PC that made it.
  const plain = collection === 'properties' ? { ...record, offline: undefined } : record;
  return { id: `${collection}__${record.id}`, collection, updatedAt: record.updatedAt, data: JSON.stringify(plain) };
}

// On opening: everything not changed since the last send is already shared.
export function markAlreadySent(data: SharedRecords, pushedAt: string | null, seen: Map<string, string>): void {
  if (!pushedAt) return;
  for (const collection of SHARED_COLLECTIONS) {
    for (const record of data[collection] ?? []) {
      const key = `${collection}__${record.id}`;
      if (record.updatedAt <= pushedAt && (seen.get(key) ?? '') < record.updatedAt) seen.set(key, record.updatedAt);
    }
  }
}

// Records whose version isn't known to be shared. That goes by version, not by
// date, because a record brought in from a map file keeps its old date.
export function changesToSend(data: SharedRecords, seen: Map<string, string>): SharedDoc[] {
  const docs: SharedDoc[] = [];
  for (const collection of SHARED_COLLECTIONS) {
    for (const record of data[collection] ?? []) {
      const known = seen.get(`${collection}__${record.id}`);
      if (known !== undefined && known >= record.updatedAt) continue;
      docs.push(packRecord(collection, record));
    }
  }
  return docs;
}

// Splits a send into batches Firestore accepts, setting aside anything too big to store.
export function chunkDocs(docs: SharedDoc[]): { batches: SharedDoc[][]; tooBig: SharedDoc[] } {
  const batches: SharedDoc[][] = [];
  const tooBig: SharedDoc[] = [];
  let batch: SharedDoc[] = [];
  let chars = 0;
  for (const doc of docs) {
    if (doc.data.length > MAX_DOC_CHARS) {
      tooBig.push(doc);
      continue;
    }
    if (batch.length >= MAX_BATCH_DOCS || chars + doc.data.length > MAX_BATCH_CHARS) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(doc);
    chars += doc.data.length;
  }
  if (batch.length > 0) batches.push(batch);
  return { batches, tooBig };
}

// What arrived that's newer than what's here. The newest change to a record wins.
export function incomingChanges(docs: SharedDoc[], data: SharedRecords): { records: SharedRecords; count: number; types: SharedTypes | null; cursor: string | null } {
  const records: Record<string, unknown[]> = {};
  const have = new Map<string, string>();
  for (const collection of SHARED_COLLECTIONS) for (const r of data[collection] ?? []) have.set(`${collection}__${r.id}`, r.updatedAt);
  let count = 0;
  let types: SharedTypes | null = null;
  let cursor: string | null = null;
  for (const doc of docs) {
    if (doc.syncedAt && (!cursor || doc.syncedAt > cursor)) cursor = doc.syncedAt;
    try {
      if (doc.collection === 'types') {
        types = JSON.parse(doc.data) as SharedTypes;
      } else if (SHARED_COLLECTIONS.includes(doc.collection) && !((have.get(doc.id) ?? '') >= doc.updatedAt)) {
        (records[doc.collection] ??= []).push(JSON.parse(doc.data));
        count += 1;
      }
    } catch {
      // A record that can't be read stays out; everything else still comes in.
    }
  }
  return { records: records as SharedRecords, count, types, cursor };
}

// The custom pin and area types, in an order that's the same on every PC.
export function packTypes(pinTypes: CustomPinType[], areaTypes: CustomAreaType[], at: string): SharedDoc {
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  return { id: TYPES_DOC, collection: 'types', updatedAt: at, data: JSON.stringify({ pinTypes: byId(pinTypes), areaTypes: byId(areaTypes) }) };
}

// How much the first share sends, for the summary shown before it starts.
export function countShared(data: SharedRecords): Record<SharedCollection, number> {
  const counts = {} as Record<SharedCollection, number>;
  for (const collection of SHARED_COLLECTIONS) counts[collection] = (data[collection] ?? []).filter((r) => !r.deletedAt).length;
  return counts;
}
