// Camp sync: phones send their hunts and GPS pins to a shared "camp" in
// Firebase, and the hub publishes its stand list there for the phones.
// A camp is one Firestore document whose id is the camp code; knowing the
// code is what lets someone join. Everyone signs in anonymously, so nobody
// needs a Google account (Google sign-in is unreliable in iPhone home-screen apps).
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import type { CampPlot } from '@/lib/actionBoard';
import { CAMP_SYNC_AVAILABLE, FIREBASE_CONFIG } from '@/lib/firebaseConfig';
import type { SharedDoc } from '@/lib/partnerSync';
import type { CampLink, CompassPoint, CustomPinType, FieldNote, FieldPin, FieldTrack, HuntReport } from '@/types/models';

export { CAMP_SYNC_AVAILABLE };
export type { CampLink };

export interface CampStand {
  id: string;
  name: string;
  lat: number;
  lng: number;
  goodWinds: CompassPoint[];
  // The section it's in, else the property (worked out by the hub).
  place?: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

type Kind = 'hunts' | 'pins' | 'stands' | 'tracks' | 'notes';

let services: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

function firebase() {
  if (!CAMP_SYNC_AVAILABLE) throw new Error('Camp sync is not set up in this version of the app.');
  if (!services) {
    const app = initializeApp(FIREBASE_CONFIG);
    services = { app, auth: getAuth(app), db: initializeFirestore(app, { ignoreUndefinedProperties: true }) };
  }
  return services;
}

// Signs in once per device; the sign-in is remembered, so it works offline after that.
async function userId(): Promise<string> {
  const { auth } = firebase();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  return (await signInAnonymously(auth)).user.uid;
}

// No 0/O or 1/I/L, so codes are easy to read out loud.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

// Who this device is signed in as, to find it in the camp's list of partners.
export const campUserId = userId;

export function normalizeCode(text: string): string {
  const letters = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.length === 12 ? [0, 4, 8].map((i) => letters.slice(i, i + 4)).join('-') : text.trim().toUpperCase();
}

export async function createCamp(name: string, hunter: string): Promise<CampLink> {
  const uid = await userId();
  const code = newCode();
  await setDoc(doc(firebase().db, 'camps', code), {
    name,
    ownerUid: uid,
    members: [uid],
    names: { [uid]: hunter },
    createdAt: new Date().toISOString(),
  });
  return { code, name, hunter, isOwner: true };
}

export async function joinCamp(codeText: string, hunter: string): Promise<CampLink> {
  const uid = await userId();
  const code = normalizeCode(codeText);
  const ref = doc(firebase().db, 'camps', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('No camp has that code. Check it with whoever runs the hub.');
  await updateDoc(ref, { members: arrayUnion(uid), [`names.${uid}`]: hunter });
  return { code, name: String(snap.get('name') ?? 'Camp'), hunter, isOwner: snap.get('ownerUid') === uid };
}

// A hub that joined asks to be a partner; a partner's hub approves it.
export async function requestPartner(camp: CampLink): Promise<void> {
  const uid = await userId();
  await updateDoc(doc(firebase().db, 'camps', camp.code), { [`partnerRequests.${uid}`]: camp.hunter });
}

export async function answerPartnerRequest(camp: CampLink, uid: string, approve: boolean): Promise<void> {
  await userId();
  await updateDoc(doc(firebase().db, 'camps', camp.code), {
    [`partnerRequests.${uid}`]: deleteField(),
    ...(approve ? { partners: arrayUnion(uid) } : {}),
  });
}

export async function removePartner(camp: CampLink, uid: string): Promise<void> {
  await userId();
  await updateDoc(doc(firebase().db, 'camps', camp.code), { partners: arrayRemove(uid) });
}

// Sends changed records to the other partners. Resolves once Firebase has them; while offline it waits.
export async function sendShared(camp: CampLink, docs: SharedDoc[]): Promise<void> {
  const uid = await userId();
  const batch = writeBatch(firebase().db);
  for (const { id, collection: kind, updatedAt, data } of docs) {
    batch.set(doc(firebase().db, 'camps', camp.code, 'shared', id), { collection: kind, updatedAt, data, createdBy: uid, syncedAt: serverTimestamp() });
  }
  await batch.commit();
}

// What other partners have sent since `since`, now and whenever more arrives.
// Only changes are read. It starts a little early so nothing arriving around
// the last look can be missed; anything read twice is simply ignored.
export function watchShared(camp: CampLink, since: string | null, onDocs: (docs: SharedDoc[]) => void, onError: (message: string) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  userId()
    .then(() => {
      if (stopped) return;
      const shared = collection(firebase().db, 'camps', camp.code, 'shared');
      stop = onSnapshot(
        since ? query(shared, where('syncedAt', '>', Timestamp.fromMillis(Date.parse(since) - 60_000))) : shared,
        (snap) => {
          const docs = snap
            .docChanges()
            // Our own write shows here before Firebase has it; it comes back once it does.
            .filter((change) => change.type !== 'removed' && !change.doc.metadata.hasPendingWrites)
            .map(({ doc: d }) => ({
              id: d.id,
              collection: d.get('collection') as SharedDoc['collection'],
              updatedAt: String(d.get('updatedAt')),
              data: String(d.get('data')),
              syncedAt: (d.get('syncedAt') as Timestamp | null)?.toDate().toISOString() ?? null,
            }));
          if (docs.length > 0) onDocs(docs);
        },
        (error) => onError(error.message),
      );
    })
    .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  return () => {
    stopped = true;
    stop?.();
  };
}

// Saves a record to the camp. Resolves once the server has it; while offline
// it waits, so callers can mark a record sent only when this resolves.
async function put(camp: CampLink, kind: Kind, id: string, data: object): Promise<void> {
  const uid = await userId();
  // JSON round trip drops anything Firestore can't store.
  const plain = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  await setDoc(doc(firebase().db, 'camps', camp.code, kind, id), { ...plain, createdBy: uid });
}

// The hub that started the camp shares its custom pin types so phones can drop them.
export async function publishPinTypes(camp: CampLink, pinTypes: CustomPinType[]): Promise<void> {
  await userId();
  await updateDoc(doc(firebase().db, 'camps', camp.code), { pinTypes: JSON.parse(JSON.stringify(pinTypes)) });
}

// What the hub did with phone pins and walks, so phones can tidy up: id -> 'added' or 'dismissed'.
export type Handled = Record<string, 'added' | 'dismissed'>;

export async function publishHandled(camp: CampLink, handled: Handled): Promise<void> {
  await userId();
  // Merged, because each partner's hub only knows what it has taken in so far.
  await setDoc(doc(firebase().db, 'camps', camp.code), { handled }, { merge: true });
}

// The list of food plots, for phones to log work on. The Action Board stays with
// partners, so this also clears the copy that older versions put here for phones.
export async function publishPlots(camp: CampLink, plots: CampPlot[]): Promise<void> {
  await userId();
  await updateDoc(doc(firebase().db, 'camps', camp.code), { plots, board: deleteField() });
}

// The camp map for the phones' Map tab, packed as text (src/lib/campMap.ts).
export async function publishMap(camp: CampLink, mapText: string): Promise<void> {
  await userId();
  await updateDoc(doc(firebase().db, 'camps', camp.code), { map: mapText });
}

export interface CampInfo {
  pinTypes: CustomPinType[];
  // The camp map as packed text, if a partner's hub has published one.
  map: string | null;
  handled: Handled;
  plots: CampPlot[];
  ownerUid: string | null;
  partners: string[];
  partnerRequests: Record<string, string>;
  names: Record<string, string>;
}

// The camp's shared pin types and plots, what's been handled, and who's a partner, now and whenever they change.
export function watchCampInfo(camp: CampLink, onInfo: (info: CampInfo) => void, onError: (message: string) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  userId()
    .then(() => {
      if (stopped) return;
      stop = onSnapshot(
        doc(firebase().db, 'camps', camp.code),
        (snap) =>
          onInfo({
            pinTypes: ((snap.get('pinTypes') as CustomPinType[] | undefined) ?? []).filter((t) => !t.deletedAt),
            handled: (snap.get('handled') as Handled | undefined) ?? {},
            plots: (snap.get('plots') as CampPlot[] | undefined) ?? [],
            map: (snap.get('map') as string | undefined) ?? null,
            ownerUid: (snap.get('ownerUid') as string | undefined) ?? null,
            partners: (snap.get('partners') as string[] | undefined) ?? [],
            partnerRequests: (snap.get('partnerRequests') as Record<string, string> | undefined) ?? {},
            names: (snap.get('names') as Record<string, string> | undefined) ?? {},
          }),
        (error) => onError(error.message),
      );
    })
    .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  return () => {
    stopped = true;
    stop?.();
  };
}

export const sendHunt = (camp: CampLink, report: HuntReport) => put(camp, 'hunts', report.id, report);
export const sendPin = (camp: CampLink, pin: FieldPin) => put(camp, 'pins', pin.id, pin);
export const sendTrack = (camp: CampLink, track: FieldTrack) => put(camp, 'tracks', track.id, track);
export const sendStand = (camp: CampLink, stand: CampStand) => put(camp, 'stands', stand.id, stand);
export const sendNote = (camp: CampLink, note: FieldNote) => put(camp, 'notes', note.id, note);

// Calls back with every record of a kind now, and again whenever one changes.
function watch<T>(camp: CampLink, kind: Kind, onRecords: (records: T[]) => void, onError: (message: string) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  userId()
    .then(() => {
      if (stopped) return;
      stop = onSnapshot(
        collection(firebase().db, 'camps', camp.code, kind),
        (snap) => {
          onRecords(
            snap.docs.map((d) => {
              const { createdBy: _createdBy, ...record } = d.data();
              return record as T;
            }),
          );
        },
        (error) => onError(error.message),
      );
    })
    .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  return () => {
    stopped = true;
    stop?.();
  };
}

export const watchHunts = (camp: CampLink, on: (r: HuntReport[]) => void, onError: (m: string) => void) => watch(camp, 'hunts', on, onError);
export const watchPins = (camp: CampLink, on: (p: FieldPin[]) => void, onError: (m: string) => void) => watch(camp, 'pins', on, onError);
export const watchTracks = (camp: CampLink, on: (t: FieldTrack[]) => void, onError: (m: string) => void) => watch(camp, 'tracks', on, onError);
export const watchStands = (camp: CampLink, on: (s: CampStand[]) => void, onError: (m: string) => void) => watch(camp, 'stands', on, onError);
export const watchNotes = (camp: CampLink, on: (n: FieldNote[]) => void, onError: (m: string) => void) => watch(camp, 'notes', on, onError);
