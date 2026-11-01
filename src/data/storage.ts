import type { HubData } from '@/types/models';

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
    settings: {
      markerStyles: {},
      areaColors: {},
      areaIcons: {},
      customAreaTypes: [],
      propertyLineColor: null,
      snapping: DEFAULT_SNAPPING,
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
  const json = JSON.stringify(data, null, 2);
  if (window.hub) {
    await window.hub.saveData(json);
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY, json);
  }
}
