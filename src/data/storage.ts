import { DEFAULT_LEAD_DAYS } from '@/lib/schedules';
import type { HubData, PhotoDetection } from '@/types/models';

// Provided by electron/preload.cjs when running as the desktop app.
interface HubBridge {
  loadData(): Promise<string | null>;
  saveData(json: string): Promise<void>;
  dataPath(): Promise<string>;
  showDataFolder(): Promise<string>;
  saveImage(name: string, bytes: Uint8Array): Promise<void>;
  loadImage(name: string): Promise<Uint8Array>;
  // Map tile from the on-disk cache, fetched and saved first if needed.
  // With cacheOnly, returns null instead of fetching.
  getTile(url: string, options?: { cacheOnly?: boolean }): Promise<{ bytes: Uint8Array; cached: boolean } | null>;
  tileCacheInfo(): Promise<{ count: number; bytes: number }>;
  clearTileCache(): Promise<void>;
  // Trail camera photos (see electron/main.cjs). Reads only from folders picked
  // in the folder dialog; writes only inside the photo library.
  pickFolder(purpose: 'source' | 'library'): Promise<string | null>;
  defaultPhotoLibrary(): Promise<string>;
  setPhotoLibrary(dir: string): Promise<string>;
  listPhotos(dir: string): Promise<{ rel: string; size: number; mtimeMs: number }[]>;
  readSourcePhoto(dir: string, rel: string): Promise<Uint8Array>;
  libraryPhotoExists(rel: string): Promise<boolean>;
  writeLibraryPhoto(rel: string, bytes: Uint8Array): Promise<boolean>;
  moveLibraryPhoto(from: string, to: string): Promise<void>;
  openLibraryFolder(rel?: string): Promise<string>;
  // Finding animals in photos (MegaDetector, downloaded once on first use).
  detectorStatus(): Promise<{ name: string; ready: boolean; bytes: number }>;
  downloadDetector(): Promise<{ name: string; ready: boolean; bytes: number }>;
  onDetectorProgress(callback: (received: number, total: number) => void): () => void;
  detectPhoto(rel: string): Promise<{ detections: PhotoDetection[]; ms: number; model: string }>;
  // Updates: the newest published version on GitHub, downloading and installing it.
  checkForUpdate(): Promise<UpdateInfo>;
  downloadUpdate(): Promise<void>;
  downloadUpdateInBrowser(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  openReleaseNotes(): Promise<void>;
}

export type UpdateStatus = { state: 'idle' | 'ready' | 'error' } | { state: 'downloading'; percent: number };

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  publishedAt: string | null;
  notes: string;
}

declare global {
  interface Window {
    hub?: HubBridge;
  }
}

const LOCAL_STORAGE_KEY = 'hunting-hub-data';

export const DEFAULT_SNAPPING = { enabled: true, distancePx: 14 };

export const isDesktop = typeof window !== 'undefined' && window.hub !== undefined;

export function emptyHubData(): HubData {
  return {
    schemaVersion: 1,
    properties: [],
    markers: [],
    areas: [],
    overlays: [],
    sections: [],
    plans: [],
    reports: [],
    fieldPins: [],
    trails: [],
    fieldTracks: [],
    photos: [],
    actionItems: [],
    settings: {
      markerStyles: {},
      areaColors: {},
      areaIcons: {},
      customAreaTypes: [],
      customPinTypes: [],
      propertyLineColor: null,
      snapping: DEFAULT_SNAPPING,
      hiddenLabels: [],
      hiddenTypeLabels: [],
      trailStyles: {},
      scheduleLeadDays: DEFAULT_LEAD_DAYS,
    },
  };
}

// The desktop app stores data in Documents\Hunting Hub\hub-data.json.
// In a plain browser (dev only) it falls back to localStorage.
export async function loadHubData(): Promise<HubData> {
  const json = window.hub ? await window.hub.loadData() : localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!json) return emptyHubData();
  const parsed = JSON.parse(json) as Partial<HubData>;
  const empty = emptyHubData();
  return { ...empty, ...parsed, settings: { ...empty.settings, ...parsed.settings }, schemaVersion: 1 };
}

export async function saveHubData(data: HubData): Promise<void> {
  // No indenting: with thousands of photos it adds a lot and only helps someone reading the file.
  const json = JSON.stringify(data);
  if (window.hub) {
    await window.hub.saveData(json);
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY, json);
  }
}
