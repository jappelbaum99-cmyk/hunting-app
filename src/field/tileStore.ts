// The phone page's saved map tiles: kept in the browser's Cache Storage, filled
// by a property's "Save for offline" on the Map tab and read before the network,
// so the map works in the woods with no signal. Property-sized only.
import { normalizeTileUrl, setBrowserTileStore } from '@/map/layers';

const CACHE = 'fenceline-field-tiles';
// Server error pages come back without an image; only real tiles are kept.
const isTile = (response: Response) => response.ok && (response.headers.get('content-type') ?? '').startsWith('image/');

let opened: Promise<Cache> | null = null;
const tiles = () => (opened ??= caches.open(CACHE));

export const tileStoreAvailable = typeof caches !== 'undefined';

export function turnOnSavedTiles(): void {
  if (!tileStoreAvailable) return;
  setBrowserTileStore({
    async get(url) {
      const hit = await (await tiles()).match(normalizeTileUrl(url));
      return hit ? hit.arrayBuffer() : null;
    },
  });
}

// Saves one tile (skipped quickly when it's already saved).
// Says what kind of image it is (Missouri's photos are blank PNGs outside the state).
export async function saveTile(url: string): Promise<{ cached: boolean; type: string }> {
  const cache = await tiles();
  const key = normalizeTileUrl(url);
  const have = await cache.match(key);
  if (have) return { cached: true, type: have.headers.get('content-type') ?? '' };
  const response = await fetch(key);
  if (!isTile(response)) throw new Error(`Tile failed (HTTP ${response.status})`);
  const type = response.headers.get('content-type') ?? '';
  await cache.put(key, response);
  return { cached: false, type };
}

export async function clearSavedTiles(): Promise<void> {
  opened = null;
  await caches.delete(CACHE);
}

// Roughly how much this site keeps on the phone, in MB (all of it, not just tiles).
export async function storageUsedMb(): Promise<number | null> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  return estimate?.usage != null ? estimate.usage / 1024 / 1024 : null;
}
