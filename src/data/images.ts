// Stores map images. The desktop app writes them to Documents\Hunting Hub\images;
// a plain browser (dev only) keeps them in IndexedDB, since they are too big
// for localStorage.

const DB_NAME = 'hunting-hub';
const STORE = 'images';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';

export function imageFileName(id: string, sourceName: string): string {
  const extension = sourceName.split('.').pop()?.toLowerCase() ?? '';
  return `${id}.${extension in MIME_BY_EXTENSION ? extension : 'png'}`;
}

function mimeOf(fileName: string): string {
  return MIME_BY_EXTENSION[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveImage(fileName: string, file: Blob): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (window.hub) await window.hub.saveImage(fileName, bytes);
  else await idb('readwrite', (store) => store.put(bytes, fileName));
}

// The stored bytes of an image, or null when it is missing.
export async function loadImageBytes(fileName: string): Promise<Uint8Array | null> {
  try {
    const bytes = window.hub
      ? await window.hub.loadImage(fileName)
      : await idb<Uint8Array | undefined>('readonly', (store) => store.get(fileName));
    return bytes ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

const urlCache = new Map<string, Promise<string>>();

// Returns a blob: URL for a stored image. URLs are cached for the session.
export function imageUrl(fileName: string): Promise<string> {
  let url = urlCache.get(fileName);
  if (!url) {
    url = (async () => {
      const bytes = window.hub
        ? await window.hub.loadImage(fileName)
        : await idb<Uint8Array | undefined>('readonly', (store) => store.get(fileName));
      if (!bytes) throw new Error(`Image ${fileName} is missing`);
      return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeOf(fileName) }));
    })();
    url.catch(() => urlCache.delete(fileName));
    urlCache.set(fileName, url);
  }
  return url;
}

export function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('That file is not an image this app can read.'));
    img.src = url;
  });
}
