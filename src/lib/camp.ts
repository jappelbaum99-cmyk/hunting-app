// Camp sync: phones send their hunts and GPS pins to a shared "camp" in
// Firebase, and the hub publishes its stand list there for the phones.
// A camp is one Firestore document whose id is the camp code; knowing the
// code is what lets someone join. Everyone signs in anonymously, so nobody
// needs a Google account (Google sign-in is unreliable in iPhone home-screen apps).
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';

import { CAMP_SYNC_AVAILABLE, FIREBASE_CONFIG } from '@/lib/firebaseConfig';
import type { CampLink, CompassPoint, CustomPinType, FieldPin, HuntReport } from '@/types/models';

export { CAMP_SYNC_AVAILABLE };
export type { CampLink };

export interface CampStand {
  id: string;
  name: string;
  lat: number;
  lng: number;
  goodWinds: CompassPoint[];
  updatedAt: string;
  deletedAt: string | null;
}

type Kind = 'hunts' | 'pins' | 'stands';

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

// The camp's shared pin types, now and whenever they change.
export function watchPinTypes(camp: CampLink, onTypes: (types: CustomPinType[]) => void, onError: (message: string) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  userId()
    .then(() => {
      if (stopped) return;
      stop = onSnapshot(
        doc(firebase().db, 'camps', camp.code),
        (snap) => onTypes(((snap.get('pinTypes') as CustomPinType[] | undefined) ?? []).filter((t) => !t.deletedAt)),
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
export const sendStand = (camp: CampLink, stand: CampStand) => put(camp, 'stands', stand.id, stand);

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
export const watchStands = (camp: CampLink, on: (s: CampStand[]) => void, onError: (m: string) => void) => watch(camp, 'stands', on, onError);
