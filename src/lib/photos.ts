// Trail camera photos: reading when each was taken, stamping the camera's
// location into it, and filing it in the photo library as
// <Camera name>/<YYYY-MM>/<YYYY-MM-DD_HHMMSS>.jpg (empties go in <Camera name>/Empty).
import piexif from 'piexifjs';

import type { CameraPhoto, DeerKind, MapMarker, PhotoDetection, PhotoTally } from '@/types/models';

function toBinary(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return s;
}

function fromBinary(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// "2026:11:01 06:45:12" (camera clock, local time) -> Date.
function parseExifDate(text: unknown): Date | null {
  if (typeof text !== 'string') return null;
  const m = text.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
}

// When the photo was taken: the camera's own timestamp, else null.
export function takenAt(binary: string): Date | null {
  try {
    const exif = piexif.load(binary);
    return parseExifDate(exif.Exif?.[piexif.ExifIFD.DateTimeOriginal]) ?? parseExifDate(exif['0th']?.[piexif.ImageIFD.DateTime]);
  } catch {
    return null;
  }
}

// The photo with the camera's GPS location (and name) written into it, so other
// photo apps know where it was taken. If the camera wrote metadata this can't
// read, the photo is kept exactly as it was.
export function stampLocation(binary: string, camera: Pick<MapMarker, 'lat' | 'lng' | 'name'>): string {
  try {
    let exif: ReturnType<typeof piexif.load>;
    try {
      exif = piexif.load(binary);
    } catch {
      exif = { '0th': {}, Exif: {}, GPS: {} };
    }
    exif.GPS = {
      ...(exif.GPS ?? {}),
      [piexif.GPSIFD.GPSVersionID]: [2, 2, 0, 0],
      [piexif.GPSIFD.GPSLatitudeRef]: camera.lat >= 0 ? 'N' : 'S',
      [piexif.GPSIFD.GPSLatitude]: piexif.GPSHelper.degToDmsRational(Math.abs(camera.lat)),
      [piexif.GPSIFD.GPSLongitudeRef]: camera.lng >= 0 ? 'E' : 'W',
      [piexif.GPSIFD.GPSLongitude]: piexif.GPSHelper.degToDmsRational(Math.abs(camera.lng)),
    };
    exif['0th'] = { ...(exif['0th'] ?? {}), [piexif.ImageIFD.ImageDescription]: `${camera.name} (Hunting Hub)` };
    // Big embedded thumbnails sometimes won't write back; drop them rather than fail.
    exif.thumbnail = null;
    delete exif['1st'];
    return piexif.insert(piexif.dump(exif), binary);
  } catch {
    return binary;
  }
}

// A folder name for a camera: its name, minus characters Windows doesn't allow.
export function cameraFolder(camera: Pick<MapMarker, 'name' | 'id'>): string {
  const clean = camera.name.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  return clean || `Camera ${camera.id.slice(0, 6)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

// <Camera>/<YYYY-MM>/<YYYY-MM-DD_HHMMSS>.jpg, with -2, -3... added when taken the same second.
export function libraryPath(folder: string, when: Date, n = 1): string {
  const month = `${when.getFullYear()}-${pad(when.getMonth() + 1)}`;
  const stamp = `${month}-${pad(when.getDate())}_${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `${folder}/${month}/${stamp}${n > 1 ? `-${n}` : ''}.jpg`;
}

// Where an empty photo goes: <Camera>/Empty/<same file name>.
export function emptyPath(file: string): string {
  const parts = file.split('/');
  return `${parts[0]}/Empty/${parts[parts.length - 1]}`;
}

export interface ImportFile {
  rel: string;
  size: number;
  mtimeMs: number;
}

export interface ImportProgress {
  done: number;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
}

// Copies photos from a picked folder into the library for one camera. The
// originals are never changed. A photo already in the library (same camera,
// same time taken, same size) is skipped. Returns the new photo records.
export async function importPhotos(options: {
  source: string;
  files: ImportFile[];
  camera: MapMarker;
  existing: CameraPhoto[];
  batchId: string;
  newRecord(): { id: string; createdAt: string; updatedAt: string; deletedAt: null };
  onProgress(progress: ImportProgress): void;
  cancelled(): boolean;
}): Promise<CameraPhoto[]> {
  const hub = window.hub;
  if (!hub) throw new Error('Sorting photos works in the desktop app.');
  const { source, files, camera } = options;
  const folder = cameraFolder(camera);
  const seen = new Set(options.existing.filter((p) => p.cameraId === camera.id && !p.deletedAt).map((p) => `${p.takenAt}@${p.originalSize}`));
  const progress: ImportProgress = { done: 0, total: files.length, imported: 0, skipped: 0, failed: 0 };
  const records: CameraPhoto[] = [];

  for (const file of files) {
    if (options.cancelled()) break;
    try {
      const binary = toBinary(await hub.readSourcePhoto(source, file.rel));
      const when = takenAt(binary) ?? new Date(file.mtimeMs);
      const key = `${when.toISOString()}@${file.size}`;
      if (seen.has(key)) {
        progress.skipped += 1;
      } else {
        const bytes = fromBinary(stampLocation(binary, camera));
        let n = 1;
        let rel = libraryPath(folder, when, n);
        while (!(await hub.writeLibraryPhoto(rel, bytes))) rel = libraryPath(folder, when, ++n);
        seen.add(key);
        records.push({
          ...options.newRecord(),
          cameraId: camera.id,
          file: rel,
          originalName: file.rel.split(/[\\/]/).pop() ?? file.rel,
          originalSize: file.size,
          takenAt: when.toISOString(),
          status: 'new',
          kinds: [],
          notes: null,
          batchId: options.batchId,
        });
        progress.imported += 1;
      }
    } catch {
      progress.failed += 1;
    }
    progress.done += 1;
    options.onProgress({ ...progress });
  }
  return records;
}

// The address the hub's window loads a library photo (or its small preview) from.
export function photoUrl(file: string, preview = false): string {
  return `hubphoto://${preview ? 'preview' : 'photo'}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

// How MegaDetector's boxes sort a photo. Careful on purpose: only a clear
// animal counts as one, and only a photo with nothing at all counts as empty;
// everything in between is left for a person to look at.
export const ANIMAL_SCORE = 0.5;
export const EMPTY_BELOW = 0.15;

export function judge(detections: PhotoDetection[]): NonNullable<CameraPhoto['ai']> {
  const best = (label: PhotoDetection['label']) => Math.max(0, ...detections.filter((d) => d.label === label).map((d) => d.score));
  if (best('animal') >= ANIMAL_SCORE) return 'animal';
  if (best('person') >= ANIMAL_SCORE || best('vehicle') >= ANIMAL_SCORE) return 'person';
  if (Math.max(0, ...detections.map((d) => d.score)) < EMPTY_BELOW) return 'empty';
  return 'unsure';
}

// The photo's tally, or one made from older single tags.
export function tallyOf(photo: CameraPhoto): PhotoTally[] {
  return photo.tally ?? photo.kinds.map((kind) => ({ kind, count: 1, buckName: null }));
}

export function kindsOf(tally: PhotoTally[]): DeerKind[] {
  return [...new Set(tally.filter((t) => t.count > 0).map((t) => t.kind))];
}
