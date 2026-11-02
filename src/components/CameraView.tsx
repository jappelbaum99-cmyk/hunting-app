import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Icon } from '@/components/Icon';
import { emptyPath, importPhotos, judge, kindsOf, photoUrl, tallyOf, type ImportFile, type ImportProgress } from '@/lib/photos';
import { DEER_KINDS } from '@/lib/reports';
import type { CameraPhoto, DeerKind, MapMarker, PhotoTally } from '@/types/models';

interface CameraViewProps {
  photos: CameraPhoto[];
  cameras: MapMarker[];
  library: string | null;
  onSetLibrary(dir: string): void;
  onSavePhotos(photos: CameraPhoto[]): void;
  // A camera that isn't on the map yet: close this view and pin it, then come back.
  onPinNewCamera(name: string): void;
  // Set once a new camera has been pinned, so the import can carry on with it.
  newCameraId: string | null;
  // Open on this camera's photos.
  initialCamera?: string | null;
  newRecord(): { id: string; createdAt: string; updatedAt: string; deletedAt: null };
  onShowCamera(id: string): void;
  onClose(): void;
  // Buck names used before (hunt reports and photos), offered as suggestions.
  buckNames: string[];
}

type StatusFilter = 'new' | 'animal' | 'empty' | 'all';

const PAGE = 96;
const QUICK_KINDS: { key: string; kind: DeerKind }[] = [
  { key: 'b', kind: 'buck' },
  { key: 'd', kind: 'doe' },
  { key: 'f', kind: 'fawn' },
  { key: 't', kind: 'turkey' },
];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Trail Cameras: bring photos in from a card, file them by camera with their
// location stamped in, then review them and set the empty ones aside.
export function CameraView(props: CameraViewProps) {
  const desktop = !!window.hub;
  const [cameraFilter, setCameraFilter] = useState<string>(props.initialCamera ?? 'all');
  const [status, setStatus] = useState<StatusFilter>(props.initialCamera ? 'all' : 'new');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const byCamera = useMemo(() => {
    const counts = new Map<string, { total: number; fresh: number; empty: number; last: string | null }>();
    for (const p of props.photos) {
      const c = counts.get(p.cameraId) ?? { total: 0, fresh: 0, empty: 0, last: null };
      c.total += 1;
      if (p.status === 'new') c.fresh += 1;
      if (p.status === 'empty') c.empty += 1;
      if (!c.last || p.takenAt > c.last) c.last = p.takenAt;
      counts.set(p.cameraId, c);
    }
    return counts;
  }, [props.photos]);

  const shown = useMemo(
    () =>
      props.photos
        .filter((p) => (cameraFilter === 'all' || p.cameraId === cameraFilter) && (status === 'all' || p.status === status))
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [props.photos, cameraFilter, status],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageItems = shown.slice(page * PAGE, page * PAGE + PAGE);
  const selected = props.photos.find((p) => p.id === selectedId) ?? null;
  const cameraName = (id: string) => props.cameras.find((c) => c.id === id)?.name ?? 'Removed camera';

  useEffect(() => setPage(0), [cameraFilter, status]);

  // Changing a photo; when reviewing "new" photos, move on to the next one.
  const update = (photo: CameraPhoto, patch: Partial<CameraPhoto>, advance = false) => {
    props.onSavePhotos([{ ...photo, ...patch }]);
    if (advance) {
      const i = shown.findIndex((p) => p.id === photo.id);
      const next = shown[i + 1] ?? null;
      setSelectedId(next?.id ?? null);
    }
  };
  // Counts per kind ("2 does, 1 buck"); any count makes it an animal photo.
  const setTally = (photo: CameraPhoto, tally: PhotoTally[]) => {
    const kept = tally.filter((t) => t.count > 0);
    update(photo, { tally: kept, kinds: kindsOf(kept), status: kept.length ? 'animal' : photo.status });
  };
  const addOne = (photo: CameraPhoto, kind: DeerKind) => {
    const tally = tallyOf(photo);
    const i = tally.findIndex((t) => t.kind === kind && !t.buckName);
    setTally(photo, i >= 0 ? tally.map((t, n) => (n === i ? { ...t, count: t.count + 1 } : t)) : [...tally, { kind, count: 1, buckName: null }]);
  };

  // Keys while a photo is open: E empty, A animal, B/D/F/T tag, arrows to move.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (event: KeyboardEvent) => {
    if (!selected || (event.target as HTMLElement).closest('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    const i = shown.findIndex((p) => p.id === selected.id);
    if (key === 'arrowright' || key === 'arrowdown') setSelectedId(shown[i + 1]?.id ?? selected.id);
    else if (key === 'arrowleft' || key === 'arrowup') setSelectedId(shown[i - 1]?.id ?? selected.id);
    else if (key === 'e') update(selected, { status: 'empty', kinds: [], tally: [] }, status === 'new');
    else if (key === 'a') update(selected, { status: 'animal' }, status === 'new');
    else if (key === 'escape') setSelectedId(null);
    else {
      const quick = QUICK_KINDS.find((q) => q.key === key);
      if (!quick) return;
      addOne(selected, quick.kind);
    }
    event.preventDefault();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // MegaDetector: whether the model is on this PC, its download, and a scan in progress.
  const [detector, setDetector] = useState<{ ready: boolean; bytes: number } | null>(null);
  const [download, setDownload] = useState<{ received: number; total: number } | null>(null);
  const [scan, setScan] = useState<{ done: number; total: number; animals: number; empty: number; unsure: number } | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const stopScan = useRef(false);
  useEffect(() => {
    void window.hub?.detectorStatus().then(setDetector);
  }, []);
  const unscanned = props.photos.filter((p) => p.status === 'new' && !p.detections);

  const getModel = async () => {
    const hub = window.hub!;
    setDetectError(null);
    setDownload({ received: 0, total: detector?.bytes ?? 0 });
    const stop = hub.onDetectorProgress((received, total) => setDownload({ received, total }));
    try {
      setDetector(await hub.downloadDetector());
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : String(e));
    } finally {
      stop();
      setDownload(null);
    }
  };

  // Looks at each photo not reviewed yet: clear animals and clear empties are
  // sorted; anything in between stays in To review.
  const findEmpties = async () => {
    const hub = window.hub!;
    const list = [...unscanned];
    stopScan.current = false;
    setDetectError(null);
    const tally = { done: 0, total: list.length, animals: 0, empty: 0, unsure: 0 };
    setScan({ ...tally });
    let batch: CameraPhoto[] = [];
    for (const photo of list) {
      if (stopScan.current) break;
      try {
        const result = await hub.detectPhoto(photo.file);
        const ai = judge(result.detections);
        batch.push({ ...photo, detections: result.detections, ai, status: ai === 'animal' ? 'animal' : ai === 'empty' ? 'empty' : 'new' });
        if (ai === 'animal') tally.animals += 1;
        else if (ai === 'empty') tally.empty += 1;
        else tally.unsure += 1;
      } catch (e) {
        setDetectError(e instanceof Error ? e.message : String(e));
      }
      tally.done += 1;
      setScan({ ...tally });
      if (batch.length >= 20) {
        props.onSavePhotos(batch);
        batch = [];
      }
    }
    props.onSavePhotos(batch);
    setScan({ ...tally, total: tally.done });
  };

  // Puts empty photos in each camera's Empty folder (and brings back ones no longer marked empty).
  const organize = async () => {
    const hub = window.hub;
    if (!hub) return;
    const moves = props.photos.filter((p) => (p.status === 'empty') !== p.file.includes('/Empty/'));
    setBusy(`Moving ${moves.length} photos…`);
    const moved: CameraPhoto[] = [];
    for (const p of moves) {
      try {
        if (p.status === 'empty') {
          const to = emptyPath(p.file);
          await hub.moveLibraryPhoto(p.file, to);
          moved.push({ ...p, file: to });
        } else {
          // Back to its dated folder: <Camera>/<YYYY-MM>/<name>.
          const name = p.file.split('/').pop()!;
          const to = `${p.file.split('/')[0]}/${name.slice(0, 7)}/${name}`;
          await hub.moveLibraryPhoto(p.file, to);
          moved.push({ ...p, file: to });
        }
      } catch {
        // Leave it where it is; it'll be tried again next time.
      }
    }
    props.onSavePhotos(moved);
    setBusy(moved.length === moves.length ? null : `Moved ${moved.length} of ${moves.length}. The rest are open elsewhere or missing.`);
  };
  const toMove = props.photos.filter((p) => (p.status === 'empty') !== p.file.includes('/Empty/')).length;

  if (!desktop) {
    return (
      <div className="camera-view">
        <CameraHeader onClose={props.onClose} />
        <p className="camera-empty">Sorting trail camera photos works in the desktop app, where it can read your photo folders.</p>
      </div>
    );
  }

  if (!props.library) return <LibrarySetup onSetLibrary={props.onSetLibrary} onClose={props.onClose} />;

  return (
    <div className="camera-view">
      <CameraHeader onClose={props.onClose} />
      <div className="camera-body">
        <aside className="camera-side">
          <button className="primary camera-import" onClick={() => setImporting({ step: 'pick' })} disabled={!!importing && importing.step === 'sorting'}>
            <Icon name="send" size={16} /> Import photos
          </button>

          <div className="detector-box">
            <strong>Find empties automatically</strong>
            {detector && !detector.ready && !download && (
              <>
                <span className="hint">Uses MegaDetector, a free model from Microsoft that runs on this PC. One-time download, {Math.round(detector.bytes / 1e6)} MB.</span>
                <button onClick={() => void getModel()}>Download MegaDetector</button>
              </>
            )}
            {download && (
              <>
                <span className="hint">
                  Downloading… {Math.round(download.received / 1e6)} of {Math.round(download.total / 1e6)} MB
                </span>
                <div className="import-bar">
                  <span style={{ width: `${(download.received / Math.max(1, download.total)) * 100}%` }} />
                </div>
              </>
            )}
            {detector?.ready && !scan && (
              <button className="primary" disabled={unscanned.length === 0} onClick={() => void findEmpties()}>
                {unscanned.length ? `Find empties (${unscanned.length.toLocaleString()} photos)` : 'All photos checked'}
              </button>
            )}
            {scan && (
              <>
                <div className="import-bar">
                  <span style={{ width: `${(scan.done / Math.max(1, scan.total)) * 100}%` }} />
                </div>
                <span className="hint">
                  {scan.done} of {scan.total} · {scan.animals} animals · {scan.empty} empty · {scan.unsure} not sure
                </span>
                {scan.done < scan.total ? (
                  <button onClick={() => (stopScan.current = true)}>Stop</button>
                ) : (
                  <button onClick={() => setScan(null)}>Done</button>
                )}
              </>
            )}
            {detectError && <span className="error-text">{detectError}</span>}
          </div>

          <h3>Cameras</h3>
          <ul className="camera-list">
            <li>
              <button className={`row${cameraFilter === 'all' ? ' selected' : ''}`} onClick={() => setCameraFilter('all')}>
                <span className="row-title">All cameras</span>
                <span className="row-detail">{props.photos.length}</span>
              </button>
            </li>
            {props.cameras.map((c) => {
              const n = byCamera.get(c.id);
              return (
                <li key={c.id}>
                  <button className={`row${cameraFilter === c.id ? ' selected' : ''}`} onClick={() => setCameraFilter(c.id)}>
                    <span className="row-title">{c.name}</span>
                    <span className="row-detail">
                      {n ? `${n.total}${n.fresh ? ` · ${n.fresh} new` : ''}` : 'no photos'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {props.cameras.length === 0 && <p className="hint">No trail cameras yet. Import photos and you'll be asked to pin the camera.</p>}

          <div className="camera-library">
            <span className="hint">Photos are kept in</span>
            <code title={props.library}>{props.library}</code>
            <div className="phone-buttons">
              <button onClick={() => void window.hub?.openLibraryFolder()}>Open folder</button>
              <button
                onClick={() =>
                  void window.hub?.pickFolder('library').then((dir) => {
                    if (dir) props.onSetLibrary(dir);
                  })
                }
              >
                Change
              </button>
            </div>
          </div>

          {toMove > 0 && (
            <button className="camera-organize" onClick={() => void organize()} disabled={!!busy}>
              Move {toMove} empty photo{toMove === 1 ? '' : 's'} to Empty folders
            </button>
          )}
          {busy && <p className="hint">{busy}</p>}
        </aside>

        <section className="camera-main">
          {importing ? (
            <ImportFlow
              state={importing}
              setState={setImporting}
              cameras={props.cameras}
              photos={props.photos}
              newCameraId={props.newCameraId}
              newRecord={props.newRecord}
              onPinNewCamera={props.onPinNewCamera}
              onImported={(records, cameraId) => {
                props.onSavePhotos(records);
                setCameraFilter(cameraId);
                setStatus('new');
              }}
            />
          ) : (
            <>
              <div className="camera-toolbar">
                <div className="sit-chips">
                  {(['new', 'animal', 'empty', 'all'] as StatusFilter[]).map((s) => (
                    <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                      {s === 'new' ? 'To review' : s === 'animal' ? 'Animals' : s === 'empty' ? 'Empty' : 'All'}
                    </button>
                  ))}
                </div>
                <span className="muted">
                  {shown.length} photo{shown.length === 1 ? '' : 's'}
                  {cameraFilter !== 'all' && (
                    <>
                      {' '}
                      ·{' '}
                      <button className="link-button" onClick={() => props.onShowCamera(cameraFilter)}>
                        show camera on map
                      </button>
                    </>
                  )}
                </span>
              </div>
              {status === 'new' && shown.length > 0 && (
                <p className="hint camera-keys">
                  Click a photo to look closer. Keys: <kbd>E</kbd> empty · <kbd>A</kbd> animal · <kbd>B</kbd> buck · <kbd>D</kbd> doe · <kbd>F</kbd> fawn · <kbd>T</kbd> turkey · arrows to move.
                </p>
              )}
              {shown.length === 0 ? (
                <p className="camera-empty">{props.photos.length ? 'Nothing here.' : 'No photos yet. Use Import photos to bring in a card.'}</p>
              ) : (
                <div className="photo-grid">
                  {pageItems.map((p) => (
                    <button key={p.id} className={`photo-tile ${p.status}${p.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(p.id)}>
                      <img src={photoUrl(p.file, true)} alt="" loading="lazy" decoding="async" />
                      <span className="photo-caption">
                        {shortDate(p.takenAt)}
                        {tallyOf(p).length > 0 && ` · ${tallySummary(tallyOf(p))}`}
                        {p.status === 'empty' && ' · empty'}
                        {p.status === 'new' && p.ai === 'unsure' && ' · not sure'}
                        {p.status === 'new' && p.ai === 'person' && ' · person?'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {pages > 1 && (
                <div className="camera-pages">
                  <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span className="muted">
                    Page {page + 1} of {pages}
                  </span>
                  <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {selected && !importing && (
          <aside className="photo-detail">
            <div className="photo-frame">
              <img src={photoUrl(selected.file)} alt={`Photo from ${cameraName(selected.cameraId)}`} />
              {(selected.detections ?? []).filter((d) => d.score >= 0.15).map((d, i) => (
                <span
                  key={i}
                  className={`photo-box ${d.label}${d.score < 0.5 ? ' weak' : ''}`}
                  style={{ left: `${d.box[0] * 100}%`, top: `${d.box[1] * 100}%`, width: `${d.box[2] * 100}%`, height: `${d.box[3] * 100}%` }}
                >
                  <span>
                    {d.label} {Math.round(d.score * 100)}%
                  </span>
                </span>
              ))}
            </div>
            <div className="photo-detail-info">
              <strong>{cameraName(selected.cameraId)}</strong>
              <span className="muted">{new Date(selected.takenAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            <div className="photo-actions">
              <button className={selected.status === 'empty' ? 'active' : ''} onClick={() => update(selected, { status: 'empty', kinds: [] }, status === 'new')}>
                Empty <kbd>E</kbd>
              </button>
              <button className={selected.status === 'animal' ? 'active' : ''} onClick={() => update(selected, { status: 'animal' }, status === 'new')}>
                Animal <kbd>A</kbd>
              </button>
            </div>
            <TallyEditor tally={tallyOf(selected)} buckNames={props.buckNames} onChange={(t) => setTally(selected, t)} />
            <textarea rows={2} placeholder="Notes (e.g. big 8, same buck as last week)" value={selected.notes ?? ''} onChange={(e) => update(selected, { notes: e.target.value || null })} />
            <p className="hint photo-file" title={selected.file}>
              {selected.file} · from {selected.originalName}
            </p>
            <div className="photo-actions">
              <button onClick={() => void window.hub?.openLibraryFolder(selected.file.split('/').slice(0, -1).join('/'))}>Show in folder</button>
              <button onClick={() => setSelectedId(null)}>Close</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function CameraHeader({ onClose }: { onClose(): void }) {
  return (
    <header className="camera-header">
      <h2>
        <Icon name="camera" size={22} /> Trail Cameras
      </h2>
      <button className="icon" onClick={onClose} aria-label="Close trail cameras">
        <Icon name="close" size={18} />
      </button>
    </header>
  );
}

// First run: pick where photos are kept, away from OneDrive.
function LibrarySetup({ onSetLibrary, onClose }: { onSetLibrary(dir: string): void; onClose(): void }) {
  const [suggested, setSuggested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.hub?.defaultPhotoLibrary().then(setSuggested);
  }, []);
  const use = (dir: string) =>
    window.hub
      ?.setPhotoLibrary(dir)
      .then(onSetLibrary)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <div className="camera-view">
      <CameraHeader onClose={onClose} />
      <div className="camera-setup">
        <h3>Where should photos be kept?</h3>
        <p>
          Imported photos are copied here and sorted by camera and month. Pick a folder with plenty of space. Avoid OneDrive folders like Documents or
          Pictures: the free OneDrive plan fills up fast with trail camera photos.
        </p>
        {suggested && (
          <button className="primary" onClick={() => void use(suggested)}>
            Use {suggested}
          </button>
        )}
        <button
          onClick={() =>
            void window.hub?.pickFolder('library').then((dir) => {
              if (dir) void use(dir);
            })
          }
        >
          Choose another folder…
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

type ImportState =
  | { step: 'pick' }
  | { step: 'camera'; source: string; files: ImportFile[]; cameraId: string | null; newName: string }
  | { step: 'sorting'; source: string; files: ImportFile[]; cameraId: string; progress: ImportProgress }
  | { step: 'done'; cameraId: string; progress: ImportProgress };

// Import: pick the card's folder, say which camera, then sort.
function ImportFlow(props: {
  state: ImportState;
  setState(next: ImportState | null): void;
  cameras: MapMarker[];
  photos: CameraPhoto[];
  newCameraId: string | null;
  // Open on this camera's photos.
  initialCamera?: string | null;
  newRecord(): { id: string; createdAt: string; updatedAt: string; deletedAt: null };
  onPinNewCamera(name: string): void;
  onImported(records: CameraPhoto[], cameraId: string): void;
}) {
  const { state, setState } = props;
  const cancel = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Coming back from pinning a new camera: pick it.
  useEffect(() => {
    if (props.newCameraId && state.step === 'camera' && state.cameraId !== props.newCameraId && props.cameras.some((c) => c.id === props.newCameraId)) {
      setState({ ...state, cameraId: props.newCameraId });
    }
  }, [props.newCameraId, props.cameras]);

  if (state.step === 'pick') {
    return (
      <div className="import-step">
        <h3>1. Pick the folder of photos</h3>
        <p className="hint">Usually the camera's SD card (its DCIM folder), or a folder you copied it to. The photos there are copied, never changed or deleted.</p>
        <div className="import-actions">
          <button
            className="primary"
            onClick={async () => {
              setError(null);
              const dir = await window.hub!.pickFolder('source');
              if (!dir) return;
              const files = await window.hub!.listPhotos(dir);
              if (files.length === 0) return setError('No photos (JPG) found in that folder or its subfolders.');
              setState({ step: 'camera', source: dir, files, cameraId: null, newName: '' });
            }}
          >
            Choose folder…
          </button>
          <button onClick={() => setState(null)}>Cancel</button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  if (state.step === 'camera') {
    const startSort = async (cameraId: string) => {
      const camera = props.cameras.find((c) => c.id === cameraId)!;
      cancel.current = false;
      const batchId = crypto.randomUUID();
      let progress: ImportProgress = { done: 0, total: state.files.length, imported: 0, skipped: 0, failed: 0 };
      setState({ step: 'sorting', source: state.source, files: state.files, cameraId, progress });
      const records = await importPhotos({
        source: state.source,
        files: state.files,
        camera,
        existing: props.photos,
        batchId,
        newRecord: props.newRecord,
        cancelled: () => cancel.current,
        onProgress: (p) => {
          progress = p;
          setState({ step: 'sorting', source: state.source, files: state.files, cameraId, progress: p });
        },
      });
      props.onImported(records, cameraId);
      setState({ step: 'done', cameraId, progress });
    };
    return (
      <div className="import-step">
        <h3>2. Which camera are these from?</h3>
        <p className="hint">
          Found <strong>{state.files.length}</strong> photo{state.files.length === 1 ? '' : 's'} in <code>{state.source}</code>.
        </p>
        <ul className="camera-pick">
          {props.cameras.map((c) => (
            <li key={c.id}>
              <label className="check">
                <input type="radio" name="camera" checked={state.cameraId === c.id} onChange={() => setState({ ...state, cameraId: c.id })} />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="new-camera">
          <span>New camera?</span>
          <input type="text" placeholder="Name it, e.g. Creek Crossing" value={state.newName} onChange={(e) => setState({ ...state, newName: e.target.value })} />
          <button disabled={!state.newName.trim()} onClick={() => props.onPinNewCamera(state.newName.trim())}>
            Pin it on the map
          </button>
        </div>
        <div className="import-actions">
          <button className="primary" disabled={!state.cameraId} onClick={() => state.cameraId && void startSort(state.cameraId)}>
            3. Start sort
          </button>
          <button onClick={() => setState(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  if (state.step === 'sorting') {
    const p = state.progress;
    return (
      <div className="import-step">
        <h3>Sorting photos…</h3>
        <div className="import-bar">
          <span style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} />
        </div>
        <p className="hint">
          {p.done} of {p.total} · {p.imported} filed · {p.skipped} already in the library{p.failed ? ` · ${p.failed} couldn't be read` : ''}
        </p>
        <button onClick={() => (cancel.current = true)}>Stop</button>
      </div>
    );
  }

  const p = state.progress;
  const name = props.cameras.find((c) => c.id === state.cameraId)?.name ?? 'the camera';
  return (
    <div className="import-step">
      <h3>
        <Icon name="check" size={20} /> Done
      </h3>
      <p>
        Filed <strong>{p.imported}</strong> photo{p.imported === 1 ? '' : 's'} under {name}, each stamped with the camera's location.
        {p.skipped ? ` Skipped ${p.skipped} already in the library.` : ''}
        {p.failed ? ` ${p.failed} couldn't be read.` : ''}
      </p>
      <div className="import-actions">
        <button className="primary" onClick={() => setState(null)}>
          Review them
        </button>
        <button onClick={() => setState({ step: 'pick' })}>Import another card</button>
      </div>
    </div>
  );
}

function tallySummary(tally: PhotoTally[]): string {
  return tally
    .filter((t) => t.count > 0)
    .map((t) => `${t.count} ${t.count === 1 ? DEER_KINDS[t.kind].label.toLowerCase() : DEER_KINDS[t.kind].plural}${t.buckName ? ` (${t.buckName})` : ''}`)
    .join(', ');
}

// What's in the photo: a count for each kind, and a name for each buck you know.
function TallyEditor({ tally, buckNames, onChange }: { tally: PhotoTally[]; buckNames: string[]; onChange(tally: PhotoTally[]): void }) {
  const kinds = Object.keys(DEER_KINDS) as DeerKind[];
  const countOf = (kind: DeerKind) => tally.filter((t) => t.kind === kind && !(kind === 'buck' && t.buckName)).reduce((n, t) => n + t.count, 0);
  const setCount = (kind: DeerKind, count: number) => {
    const rest = tally.filter((t) => !(t.kind === kind && !(kind === 'buck' && t.buckName)));
    onChange(count > 0 ? [...rest, { kind, count, buckName: null }] : rest);
  };
  const named = tally.filter((t) => t.kind === 'buck' && t.buckName !== null);
  return (
    <div className="tally">
      <div className="tally-head">
        <span>What's in it</span>
        <span className="muted">{tallySummary(tally) || 'Nothing tagged'}</span>
      </div>
      {kinds.map((kind) => {
        const n = countOf(kind);
        return (
          <div key={kind} className={`tally-row${n ? ' on' : ''}`} style={{ '--deer': DEER_KINDS[kind].color } as CSSProperties}>
            <span className="tally-label">
              {DEER_KINDS[kind].deer ? <span className="type-dot" style={{ background: DEER_KINDS[kind].color }} /> : <Icon name={DEER_KINDS[kind].icon} size={16} />}
              {kind === 'buck' ? 'Buck (no name)' : DEER_KINDS[kind].label}
            </span>
            <span className="stepper">
              <button onClick={() => setCount(kind, Math.max(0, n - 1))} disabled={n === 0} aria-label={`One fewer ${DEER_KINDS[kind].label}`}>
                <Icon name="minus" size={14} />
              </button>
              <strong>{n}</strong>
              <button onClick={() => setCount(kind, n + 1)} aria-label={`One more ${DEER_KINDS[kind].label}`}>
                <Icon name="plus" size={14} />
              </button>
            </span>
          </div>
        );
      })}
      {named.map((t, i) => (
        <div key={i} className="tally-row on buck-name-row" style={{ '--deer': DEER_KINDS.buck.color } as CSSProperties}>
          <input
            type="text"
            list="buck-names"
            placeholder="Buck's name, e.g. Big 8"
            value={t.buckName ?? ''}
            onChange={(e) => onChange(tally.map((x) => (x === t ? { ...x, buckName: e.target.value } : x)))}
          />
          <button className="icon" aria-label="Remove this buck" onClick={() => onChange(tally.filter((x) => x !== t))}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <button className="add-buck" onClick={() => onChange([...tally, { kind: 'buck', count: 1, buckName: '' }])}>
        <Icon name="plus" size={14} /> {named.length ? 'Another named buck' : 'Named buck'}
      </button>
      <datalist id="buck-names">
        {buckNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}
