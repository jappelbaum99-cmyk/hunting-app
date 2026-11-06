import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '@/components/Icon';
import {
  cameraPlace,
  expectedPath,
  parsePlaceValue,
  placeChoices,
  placeFolder,
  placeLabel,
  placeOf,
  placeValue,
  propertyKey,
  propertyName,
  samePlace,
  spotKey,
  spotName,
  type Places,
} from '@/lib/photoPlaces';
import { ANIMAL_SCORE, EMPTY_BELOW, importPhotos, judge, kindsOf, photoUrl, sameTally, TALLY_PRESETS, tallyOf, type ImportFile, type ImportProgress } from '@/lib/photos';
import { DEER_KINDS } from '@/lib/reports';
import type { CameraPhoto, DeerKind, MapMarker, PhotoPlace, PhotoTally } from '@/types/models';

interface CameraViewProps {
  photos: CameraPhoto[];
  cameras: MapMarker[];
  // Properties, sections and areas, for filing photos by where they were taken.
  places: Places;
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

// Which photos the grid shows: a property, a section or area in it, a camera there.
interface PlaceFilter {
  property?: string;
  spot?: string;
  cameraId?: string;
}

interface Counts {
  total: number;
  fresh: number;
}

interface SpotNode extends Counts {
  key: string;
  name: string | null;
  cameras: Map<string, Counts>;
}

interface PropertyNode extends Counts {
  key: string;
  name: string;
  spots: Map<string, SpotNode>;
}

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
  const [filter, setFilter] = useState<PlaceFilter>(props.initialCamera ? { cameraId: props.initialCamera } : {});
  const [status, setStatus] = useState<StatusFilter>(props.initialCamera ? 'all' : 'new');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerIds, setViewerIds] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [importing, setImporting] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Each photo's place, worked out once.
  const placeById = useMemo(() => new Map(props.photos.map((p) => [p.id, placeOf(p, props.places, props.cameras)])), [props.photos, props.places, props.cameras]);
  const placeFor = (photo: CameraPhoto) => placeById.get(photo.id) ?? placeOf(photo, props.places, props.cameras);
  const matches = (photo: CameraPhoto, f: PlaceFilter) => {
    const place = placeFor(photo);
    return (!f.property || propertyKey(place) === f.property) && (!f.spot || spotKey(place) === f.spot) && (!f.cameraId || photo.cameraId === f.cameraId);
  };

  // Property › section or area › camera, with photo counts. Cameras with no
  // photos yet show under where they are now.
  const tree = useMemo(() => {
    const nodes = new Map<string, PropertyNode>();
    const add = (place: PhotoPlace, cameraId: string, photo: CameraPhoto | null) => {
      const pk = propertyKey(place);
      const property = nodes.get(pk) ?? { key: pk, name: propertyName(props.places, place), total: 0, fresh: 0, spots: new Map() };
      nodes.set(pk, property);
      const sk = spotKey(place);
      const spot = property.spots.get(sk) ?? { key: sk, name: spotName(props.places, place), total: 0, fresh: 0, cameras: new Map() };
      property.spots.set(sk, spot);
      const camera = spot.cameras.get(cameraId) ?? { total: 0, fresh: 0 };
      spot.cameras.set(cameraId, camera);
      if (!photo) return;
      for (const c of [property, spot, camera]) {
        c.total += 1;
        if (photo.status === 'new') c.fresh += 1;
      }
    };
    for (const p of props.photos) add(placeById.get(p.id)!, p.cameraId, p);
    for (const c of props.cameras) if (!props.photos.some((p) => p.cameraId === c.id)) add(cameraPlace(props.places, c), c.id, null);
    return [...nodes.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name)));
  }, [props.photos, props.cameras, props.places, placeById]);

  const shown = useMemo(
    () => props.photos.filter((p) => matches(p, filter) && (status === 'all' || p.status === status)).sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [props.photos, filter, status, placeById],
  );
  const choices = useMemo(() => placeChoices(props.places), [props.places]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageItems = shown.slice(page * PAGE, page * PAGE + PAGE);
  const selected = props.photos.find((p) => p.id === selectedId) ?? null;
  const cameraName = (id: string) => props.cameras.find((c) => c.id === id)?.name ?? 'Removed camera';

  useEffect(() => setPage(0), [filter, status]);

  // The photos being looked through, fixed when one is opened. A photo tagged
  // while reviewing leaves To review but stays here, so you can go back and change it.
  const viewerAt = selected ? viewerIds.indexOf(selected.id) : -1;
  const step = (by: number) => {
    const next = viewerIds[viewerAt + by];
    if (next) setSelectedId(next);
  };
  // Changing a photo; when reviewing "new" photos, move on to the next one.
  const update = (photo: CameraPhoto, patch: Partial<CameraPhoto>, advance = false) => {
    props.onSavePhotos([{ ...photo, ...patch }]);
    if (advance) setSelectedId(viewerIds[viewerIds.indexOf(photo.id) + 1] ?? null);
  };
  // Counts per kind ("2 does, 1 buck"); any count makes it an animal photo.
  const setTally = (photo: CameraPhoto, tally: PhotoTally[], advance = false) => {
    const kept = tally.filter((t) => t.count > 0);
    update(photo, { tally: kept, kinds: kindsOf(kept), status: kept.length ? 'animal' : photo.status }, advance);
  };
  const markEmpty = (photo: CameraPhoto) => update(photo, { status: 'empty', kinds: [], tally: [] }, status === 'new');
  // Sets the photo's tags to a preset. Pressing the one already set clears it.
  const applyPreset = (photo: CameraPhoto, index: number) => {
    const { tally } = TALLY_PRESETS[index];
    if (sameTally(tallyOf(photo), tally)) setTally(photo, []);
    else setTally(photo, tally, status === 'new');
  };
  const addOne = (photo: CameraPhoto, kind: DeerKind) => {
    const tally = tallyOf(photo);
    const i = tally.findIndex((t) => t.kind === kind && !t.buckName);
    setTally(photo, i >= 0 ? tally.map((t, n) => (n === i ? { ...t, count: t.count + 1 } : t)) : [...tally, { kind, count: 1, buckName: null }]);
  };

  // Keys while a photo is open: E empty, A animal, 1-5 presets, B/D/F/T add one, arrows to move.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (event: KeyboardEvent) => {
    if (!selected || (event.target as HTMLElement).closest('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (key === 'arrowright' || key === 'arrowdown') step(1);
    else if (key === 'arrowleft' || key === 'arrowup') step(-1);
    else if (key === 'e') markEmpty(selected);
    else if (key === 'a') update(selected, { status: 'animal' }, status === 'new');
    else if (key === 'escape') setSelectedId(null);
    else if (TALLY_PRESETS[Number(key) - 1]) applyPreset(selected, Number(key) - 1);
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

  // Photos not in the folder they belong in: empties go to their camera's Empty
  // folder, and photos whose place changed (or that came in before places) go
  // under <Property>/<Section or area>/<Camera>. Each one records where it went.
  const misplaced = props.photos
    .map((p) => ({ photo: p, to: expectedPath(p, props.places, props.cameras) }))
    .filter((m): m is { photo: CameraPhoto; to: string } => !!m.to && m.to !== m.photo.file);
  const organize = async () => {
    const hub = window.hub;
    if (!hub) return;
    const moves = misplaced;
    setBusy(`Moving ${moves.length} photos…`);
    const moved: CameraPhoto[] = [];
    for (const { photo, to } of moves) {
      try {
        await hub.moveLibraryPhoto(photo.file, to);
        // Pin down its place too, so moving the camera later doesn't move it again.
        moved.push({ ...photo, file: to, place: placeFor(photo) });
      } catch {
        // Leave it where it is; it'll be tried again next time.
      }
      if (moved.length % 50 === 0) setBusy(`Moving photos… ${moved.length} of ${moves.length}`);
    }
    props.onSavePhotos(moved);
    setBusy(moved.length === moves.length ? null : `Moved ${moved.length} of ${moves.length}. The rest are open elsewhere or missing.`);
  };
  const emptiesToMove = misplaced.filter((m) => m.photo.status === 'empty' && !m.photo.file.includes('/Empty/')).length;

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

          <h3>Places</h3>
          <ul className="camera-list">
            <PlaceRow label="All photos" counts={{ total: props.photos.length, fresh: 0 }} depth={0} filter={{}} current={filter} onPick={setFilter} />
            {tree.map((property) => (
              <PlaceGroup key={property.key} property={property} cameraName={cameraName} current={filter} onPick={setFilter} />
            ))}
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

          {misplaced.length > 0 && (
            <>
              <button className="camera-organize" onClick={() => void organize()} disabled={!!busy}>
                Move {misplaced.length} photo{misplaced.length === 1 ? '' : 's'} into their folders
              </button>
              <p className="hint">
                {emptiesToMove > 0 && `${emptiesToMove} empty to Empty folders. `}
                {misplaced.length > emptiesToMove && `${misplaced.length - emptiesToMove} into folders for their property, section or area.`}
              </p>
            </>
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
              places={props.places}
              choices={choices}
              newRecord={props.newRecord}
              onPinNewCamera={props.onPinNewCamera}
              onImported={(records, cameraId) => {
                props.onSavePhotos(records);
                setFilter({ cameraId });
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
                  {filter.cameraId && (
                    <>
                      {' '}
                      ·{' '}
                      <button className="link-button" onClick={() => props.onShowCamera(filter.cameraId!)}>
                        show camera on map
                      </button>
                    </>
                  )}
                </span>
              </div>
              {status === 'new' && shown.length > 0 && (
                <p className="hint camera-keys">
                  Click a photo to open it full size. Keys: <kbd>E</kbd> empty · <kbd>A</kbd> animal · <kbd>1</kbd>–<kbd>5</kbd> quick tags · <kbd>B</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>T</kbd> add a buck, doe, fawn or turkey · arrows to move.
                </p>
              )}
              {shown.length === 0 ? (
                <p className="camera-empty">{props.photos.length ? 'Nothing here.' : 'No photos yet. Use Import photos to bring in a card.'}</p>
              ) : (
                <div className="photo-grid">
                  {pageItems.map((p) => (
                    <button key={p.id} className={`photo-tile ${p.status}${p.id === selectedId ? ' selected' : ''}`} onClick={() => {
                        setViewerIds(shown.map((s) => s.id));
                        setSelectedId(p.id);
                      }}>
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

        {selected &&
          !importing &&
          createPortal(
            <div className="photo-viewer" role="dialog" aria-label="Photo">
              <PhotoFrame key={selected.id} photo={selected} alt={`Photo from ${cameraName(selected.cameraId)}`} />

              <div className="viewer-bar viewer-top">
                <div className="viewer-info">
                  <strong>{placeLabel(props.places, placeFor(selected))}</strong>
                  <span className="muted">
                    {cameraName(selected.cameraId)} · {new Date(selected.takenAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div className="viewer-nav">
                  <button onClick={() => step(-1)} disabled={viewerAt <= 0} title="Left arrow">
                    Previous
                  </button>
                  <span className="muted">
                    {viewerAt + 1} of {viewerIds.length}
                  </span>
                  <button onClick={() => step(1)} disabled={viewerAt >= viewerIds.length - 1} title="Right arrow">
                    Next
                  </button>
                  <button className={detailsOpen ? 'active' : ''} onClick={() => setDetailsOpen(!detailsOpen)}>
                    Details
                  </button>
                  <button className="icon" onClick={() => setSelectedId(null)} aria-label="Close photo" title="Esc">
                    <Icon name="close" size={18} />
                  </button>
                </div>
              </div>

              <div className="viewer-bar viewer-bottom">
                <div className="viewer-tags">{tallySummary(tallyOf(selected)) || (selected.status === 'empty' ? 'Empty' : 'Nothing tagged')}</div>
                <div className="viewer-presets">
                  <button className={selected.status === 'empty' ? 'active' : ''} onClick={() => markEmpty(selected)}>
                    Empty <kbd>E</kbd>
                  </button>
                  <button className={selected.status === 'animal' && tallyOf(selected).length === 0 ? 'active' : ''} onClick={() => update(selected, { status: 'animal' }, status === 'new')}>
                    Animal <kbd>A</kbd>
                  </button>
                  <span className="line-edit-divider" />
                  {TALLY_PRESETS.map((preset, i) => (
                    <button key={preset.label} className={sameTally(tallyOf(selected), preset.tally) ? 'active' : ''} onClick={() => applyPreset(selected, i)}>
                      {preset.label} <kbd>{i + 1}</kbd>
                    </button>
                  ))}
                </div>
              </div>

              {detailsOpen && (
                <aside className="viewer-details">
                  <TallyEditor tally={tallyOf(selected)} buckNames={props.buckNames} onChange={(t) => setTally(selected, t)} />
                  <PlacePicker
                    photo={selected}
                    place={placeFor(selected)}
                    choices={choices}
                    others={props.photos.filter((p) => p.batchId === selected.batchId && p.id !== selected.id && !samePlace(placeFor(p), placeFor(selected)))}
                    onChange={(list, place) => props.onSavePhotos(list.map((p) => ({ ...p, place })))}
                  />
                  <textarea rows={2} placeholder="Notes (e.g. big 8, same buck as last week)" value={selected.notes ?? ''} onChange={(e) => update(selected, { notes: e.target.value || null })} />
                  <p className="hint photo-file" title={selected.file}>
                    {selected.file} · from {selected.originalName}
                  </p>
                  <button onClick={() => void window.hub?.openLibraryFolder(selected.file.split('/').slice(0, -1).join('/'))}>Show in folder</button>
                </aside>
              )}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}

// The photo as large as the window allows, with MegaDetector's boxes on it.
function PhotoFrame({ photo, alt }: { photo: CameraPhoto; alt: string }) {
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <div className="viewer-stage">
      <div className="photo-frame" style={{ width: `min(100vw, calc(100vh * ${ratio}))`, aspectRatio: ratio }}>
        <img src={photoUrl(photo.file)} alt={alt} onLoad={(e) => e.currentTarget.naturalHeight > 0 && setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
        {(photo.detections ?? []).filter((d) => d.score >= EMPTY_BELOW).map((d, i) => (
          <span
            key={i}
            className={`photo-box ${d.label}${d.score < ANIMAL_SCORE ? ' weak' : ''}`}
            style={{ left: `${d.box[0] * 100}%`, top: `${d.box[1] * 100}%`, width: `${d.box[2] * 100}%`, height: `${d.box[3] * 100}%` }}
          >
            <span>
              {d.label} {Math.round(d.score * 100)}%
            </span>
          </span>
        ))}
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
            void window.hub
              ?.pickFolder('library')
              .then((dir) => {
                if (dir) void use(dir);
              })
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
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
  // place: where to file them; null means where the camera is.
  | { step: 'camera'; source: string; files: ImportFile[]; cameraId: string | null; newName: string; place: PhotoPlace | null }
  | { step: 'sorting'; source: string; files: ImportFile[]; cameraId: string; progress: ImportProgress }
  | { step: 'done'; cameraId: string; place: PhotoPlace; progress: ImportProgress };

// Import: pick the card's folder, say which camera, then sort.
function ImportFlow(props: {
  state: ImportState;
  setState(next: ImportState | null): void;
  cameras: MapMarker[];
  photos: CameraPhoto[];
  newCameraId: string | null;
  places: Places;
  choices: { place: PhotoPlace; label: string }[];
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
      setState({ ...state, cameraId: props.newCameraId, place: null });
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
              try {
                const dir = await window.hub!.pickFolder('source');
                if (!dir) return;
                const files = await window.hub!.listPhotos(dir);
                if (files.length === 0) return setError('No photos (JPG) found in that folder or its subfolders.');
                setState({ step: 'camera', source: dir, files, cameraId: null, newName: '', place: null });
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
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
    const chosen = props.cameras.find((c) => c.id === state.cameraId) ?? null;
    const where = state.place ?? (chosen ? cameraPlace(props.places, chosen) : null);
    const startSort = async (cameraId: string) => {
      const camera = props.cameras.find((c) => c.id === cameraId)!;
      const place = state.place ?? cameraPlace(props.places, camera);
      cancel.current = false;
      const batchId = crypto.randomUUID();
      let progress: ImportProgress = { done: 0, total: state.files.length, imported: 0, skipped: 0, failed: 0 };
      setState({ step: 'sorting', source: state.source, files: state.files, cameraId, progress });
      const records = await importPhotos({
        source: state.source,
        files: state.files,
        camera,
        folder: placeFolder(props.places, place, camera),
        place,
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
      setState({ step: 'done', cameraId, place, progress });
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
                <input type="radio" name="camera" checked={state.cameraId === c.id} onChange={() => setState({ ...state, cameraId: c.id, place: null })} />
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
        {where && (
          <div className="import-place">
            <h3>Where were they taken?</h3>
            <p className="hint">Photos are filed by place first, then camera. This is where the camera is on the map; change it if these came from somewhere else.</p>
            <PlaceSelect place={where} choices={props.choices} onChange={(place) => setState({ ...state, place })} />
          </div>
        )}
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
        Filed <strong>{p.imported}</strong> photo{p.imported === 1 ? '' : 's'} under {placeLabel(props.places, state.place)} › {name}, each stamped with the camera's location.
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

function countText(c: Counts): string {
  return c.total ? `${c.total}${c.fresh ? ` · ${c.fresh} new` : ''}` : 'no photos';
}

function PlaceRow(props: { label: string; counts: Counts; depth: number; filter: PlaceFilter; current: PlaceFilter; onPick(filter: PlaceFilter): void }) {
  const f = props.filter;
  const c = props.current;
  const selected = f.property === c.property && f.spot === c.spot && f.cameraId === c.cameraId;
  return (
    <li className={`depth-${props.depth}`}>
      <button className={`row${selected ? ' selected' : ''}`} onClick={() => props.onPick(f)}>
        <span className="row-title">{props.label}</span>
        <span className="row-detail">{countText(props.counts)}</span>
      </button>
    </li>
  );
}

// One property, its sections and areas, and the cameras in each.
function PlaceGroup(props: { property: PropertyNode; cameraName(id: string): string; current: PlaceFilter; onPick(filter: PlaceFilter): void }) {
  const { property } = props;
  const spots = [...property.spots.values()].sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name)));
  return (
    <>
      <PlaceRow label={property.name} counts={property} depth={0} filter={{ property: property.key }} current={props.current} onPick={props.onPick} />
      {spots.map((spot) => {
        const at = { property: property.key, spot: spot.key };
        return [
          <PlaceRow
            key={spot.key}
            label={spot.name ?? (property.key === 'none' ? 'Anywhere' : 'Rest of the property')}
            counts={spot}
            depth={1}
            filter={at}
            current={props.current}
            onPick={props.onPick}
          />,
          ...[...spot.cameras.entries()].map(([id, counts]) => (
            <PlaceRow key={spot.key + ':' + id} label={props.cameraName(id)} counts={counts} depth={2} filter={{ ...at, cameraId: id }} current={props.current} onPick={props.onPick} />
          )),
        ];
      })}
    </>
  );
}

function PlaceSelect({ place, choices, onChange }: { place: PhotoPlace; choices: { place: PhotoPlace; label: string }[]; onChange(place: PhotoPlace): void }) {
  const value = placeValue(place);
  const known = choices.some((c) => placeValue(c.place) === value);
  return (
    <select className="place-select" value={value} onChange={(e) => onChange(parsePlaceValue(e.target.value))}>
      {!known && <option value={value}>(a place that was removed)</option>}
      {choices.map((c) => (
        <option key={placeValue(c.place)} value={placeValue(c.place)}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

// Where a photo was taken, with a way to set the same for the rest of its import.
function PlacePicker(props: {
  photo: CameraPhoto;
  place: PhotoPlace;
  choices: { place: PhotoPlace; label: string }[];
  others: CameraPhoto[];
  onChange(photos: CameraPhoto[], place: PhotoPlace): void;
}) {
  return (
    <div className="photo-place">
      <span className="hint">Where it was taken</span>
      <PlaceSelect place={props.place} choices={props.choices} onChange={(place) => props.onChange([props.photo], place)} />
      {props.others.length > 0 && (
        <button className="link-button" onClick={() => props.onChange(props.others, props.place)}>
          Same for the other {props.others.length} from this import
        </button>
      )}
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
  // A buck being named has a name of '' until it's typed, so it isn't counted here.
  const isPlain = (t: PhotoTally, kind: DeerKind) => t.kind === kind && !(kind === 'buck' && t.buckName != null);
  const countOf = (kind: DeerKind) => tally.filter((t) => isPlain(t, kind)).reduce((n, t) => n + t.count, 0);
  const setCount = (kind: DeerKind, count: number) => {
    const rest = tally.filter((t) => !isPlain(t, kind));
    onChange(count > 0 ? [...rest, { kind, count }] : rest);
  };
  const named = tally.filter((t) => t.kind === 'buck' && t.buckName != null);
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
