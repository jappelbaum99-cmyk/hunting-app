import { useEffect, useRef, useState } from 'react';

import type { MapLayersState } from '@/map/layers';
import { MAX_DOWNLOAD_TILES, planDownload, runDownload, type DownloadProgress } from '@/map/offline';
import type { Property } from '@/types/models';

interface OfflineFieldProps {
  property: Property;
  layers: MapLayersState;
  // Gets only the download record, so edits made meanwhile aren't overwritten.
  onDownloaded(offline: NonNullable<Property['offline']>): void;
}

// "Download for offline" on a property: estimate first, then a progress bar.
export function OfflineField({ property, layers, onDownloaded }: OfflineFieldProps) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Stop a running download if the panel closes.
  useEffect(() => () => abort.current?.abort(), []);

  if (!window.hub) {
    return <p className="hint">Offline maps are available in the desktop app.</p>;
  }

  const plan = planDownload(property.boundary, layers);
  const layerList = plan.byLayer.map((l) => l.label.toLowerCase()).join(', ');

  const start = async () => {
    if (plan.tooBig) return;
    const controller = new AbortController();
    abort.current = controller;
    setMessage(null);
    setProgress({ done: 0, total: plan.urls.length, failed: 0 });
    try {
      const result = await runDownload(plan, setProgress, controller.signal);
      if (controller.signal.aborted) {
        setMessage('Download stopped. Tiles already saved are kept.');
      } else {
        onDownloaded({ downloadedAt: new Date().toISOString(), tileCount: result.total - result.failed, layers: layerList });
        setMessage(
          result.failed > 0
            ? `Saved ${result.total - result.failed} tiles; ${result.failed} failed (the USGS server was busy). Download again to fill them in.`
            : null,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  if (progress) {
    return (
      <div className="offline">
        <progress value={progress.done} max={progress.total} />
        <div className="offline-row">
          <span className="muted">
            Saving {progress.done} of {progress.total} tiles…
          </span>
          <button onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      </div>
    );
  }

  const saved = property.offline;
  return (
    <div className="offline">
      {saved && (
        <p className="hint">
          Saved {new Date(saved.downloadedAt).toLocaleDateString()} ({saved.tileCount} tiles: {saved.layers}).
        </p>
      )}
      {plan.tooBig ? (
        <p className="hint warn">
          This property needs {plan.urls.length.toLocaleString()} tiles, over the {MAX_DOWNLOAD_TILES.toLocaleString()} limit. Draw a
          section and download that instead.
        </p>
      ) : (
        <>
          <button onClick={() => void start()}>{saved ? 'Download again' : 'Download for offline'}</button>
          <p className="hint">
            The property plus about ¼ mile around it: {plan.urls.length.toLocaleString()} tiles, roughly {Math.max(1, Math.round(plan.estimatedMb))}{' '}
            MB ({layerList}). Maps you've already looked at are saved too.
          </p>
        </>
      )}
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
