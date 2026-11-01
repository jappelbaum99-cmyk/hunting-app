// What the phone keeps: its own pins and hunt reports, plus the stands sent
// over from the hub. Stored in the phone browser, so it all works with no signal.
import type { CompassPoint, FieldPin, HuntReport } from '@/types/models';

export interface FieldStand {
  id: string;
  name: string;
  lat: number;
  lng: number;
  goodWinds: CompassPoint[];
}

export interface FieldData {
  pins: FieldPin[];
  reports: HuntReport[];
  stands: FieldStand[];
  standsUpdatedAt: string | null;
  // The report being logged right now, if any.
  activeReportId: string | null;
}

const KEY = 'hunting-hub-field';

export function loadFieldData(): FieldData {
  const empty: FieldData = { pins: [], reports: [], stands: [], standsUpdatedAt: null, activeReportId: null };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<FieldData>) } : empty;
  } catch {
    return empty;
  }
}

export function saveFieldData(data: FieldData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: nothing useful to do on a phone in the woods.
  }
}

// Files passed between the phone and the hub.
export const PHONE_FILE_KIND = 'hunting-hub-phone';
export const STANDS_FILE_KIND = 'hunting-hub-stands';

export interface PhoneFile {
  kind: typeof PHONE_FILE_KIND;
  version: 1;
  exportedAt: string;
  pins: FieldPin[];
  reports: HuntReport[];
}

export interface StandsFile {
  kind: typeof STANDS_FILE_KIND;
  version: 1;
  exportedAt: string;
  stands: FieldStand[];
}

export function appleMapsUrl(stand: Pick<FieldStand, 'lat' | 'lng' | 'name'>): string {
  // Apple Maps opens at the spot with a dropped pin named after the stand.
  return `https://maps.apple.com/?ll=${stand.lat},${stand.lng}&q=${encodeURIComponent(stand.name)}`;
}

// Saves a JSON file: the share sheet on phones (AirDrop, Mail, Files...),
// otherwise a normal download.
export async function shareJsonFile(fileName: string, data: unknown): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], fileName, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') throw error;
      // Fall back to a download below.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
