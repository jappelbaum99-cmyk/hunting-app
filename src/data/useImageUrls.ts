import { useEffect, useState } from 'react';

import { imageUrl } from '@/data/images';
import type { MapImageOverlay } from '@/types/models';

// Loads each overlay's stored image and returns fileName -> blob: URL.
export function useImageUrls(overlays: MapImageOverlay[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const wanted = overlays.map((o) => o.fileName).join('|');

  useEffect(() => {
    let cancelled = false;
    for (const fileName of wanted ? wanted.split('|') : []) {
      imageUrl(fileName)
        .then((url) => {
          if (!cancelled) setUrls((current) => (current[fileName] === url ? current : { ...current, [fileName]: url }));
        })
        .catch((error: unknown) => console.warn(`Could not load map image ${fileName}`, error));
    }
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return urls;
}
