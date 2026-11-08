import type { Position } from 'geojson';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Icon } from '@/components/Icon';
import { boundsOf } from '@/lib/geo';
import { iconSvg } from '@/lib/icons';
import { trailParts } from '@/lib/trails';
import { CONTOUR_OPTIONS, LIDAR_STYLES } from '@/map/layers';
import {
  countTiles,
  DEFAULT_POSTER,
  fitFrame,
  frameFor,
  fromPx,
  groundScale,
  labelBox,
  labelCenter,
  MAX_POSTER_PIXELS,
  MAX_POSTER_SIDE,
  MAX_POSTER_TILES,
  paperSize,
  posterBlob,
  posterLabels,
  POSTER_DPIS,
  POSTER_SIZES,
  renderPoster,
  textUnit,
  toLat,
  toLng,
  toPx,
  type Frame,
  type LineKind,
  type PosterData,
  type PosterLabel,
} from '@/map/poster';
import type { PosterLabelKind, PosterSettings } from '@/types/models';

// Each kind of thing on the map: its on/off switch, and its label switch.
const KINDS: { show: keyof PosterSettings['show']; label: PosterLabelKind; name: string }[] = [
  { show: 'properties', label: 'property', name: 'Property lines' },
  { show: 'areas', label: 'area', name: 'Areas' },
  { show: 'pins', label: 'pin', name: 'Stands and pins' },
  { show: 'trails', label: 'trail', name: 'Trails' },
  { show: 'sections', label: 'section', name: 'Sections' },
];

// A size slider for each kind of line.
const LINE_SIZES: { kind: LineKind; name: string }[] = [
  { kind: 'property', name: 'Property lines' },
  { kind: 'section', name: 'Section lines' },
  { kind: 'area', name: 'Area outlines' },
  { kind: 'trail', name: 'Trails' },
];

// Room around the paper in the preview, in screen pixels.
const STAGE_PAD = 28;

interface Props {
  data: PosterData;
  // The last poster's settings, if any.
  initial: PosterSettings | null;
  // What the main map was showing, [w, s, e, n], to frame a new poster on.
  startBounds: [number, number, number, number] | null;
  onSave(poster: PosterSettings): void;
  onClose(): void;
}

// Lays out a printed map: pick paper and map, frame it by dragging and
// scrolling, move or hide labels, then save it at full size.
export function PosterEditor({ data, initial, startBounds, onSave, onClose }: Props) {
  const [p, setP] = useState<PosterSettings>(() => {
    const base = { ...DEFAULT_POSTER, photos: data.settings.aerialPhotos ?? 'leafOff', ...initial, show: { ...DEFAULT_POSTER.show, ...initial?.show }, labels: { ...DEFAULT_POSTER.labels, ...initial?.labels } };
    if (base.center && base.metersPerInch) return base;
    const bounds = startBounds ?? [-91.54, 37.64, -91.53, 37.65];
    return { ...base, ...fitFrame(bounds, paperSize(base)) };
  });
  const paper = paperSize(p);
  const center = p.center!;
  const metersPerInch = p.metersPerInch!;

  // Save changes, but not on every mouse move of a drag.
  const dragging = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    const timer = setTimeout(() => onSave(p), 500);
    return () => clearTimeout(timer);
  }, [p, onSave]);

  const set = (patch: Partial<PosterSettings>) => setP((prev) => ({ ...prev, ...patch }));

  // ----- Preview size -----
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pxPerInch = Math.max(4, Math.min((stage.w - STAGE_PAD * 2) / paper.w, (stage.h - STAGE_PAD * 2) / paper.h));
  const view: Frame = frameFor(center, metersPerInch, paper, pxPerInch);
  // Label size on screen; pins and lines are sized inside the drawing.
  const unit = textUnit(p, view);

  // ----- Preview drawing -----
  // The canvas shows the frame as it was last drawn; while dragging or zooming
  // it's moved and scaled to match until a fresh one is drawn.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState<Frame | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Map tiles loading for the preview.
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const { labelAt: _labelAt, hiddenLabelIds: _hidden, ...look } = p;
  const lookKey = JSON.stringify({ ...look, labelsShown: p.labels });
  const viewKey = `${view.minX}|${view.maxY}|${view.mpp}|${view.width}|${view.height}`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const dpr = window.devicePixelRatio || 1;
      const target = frameFor(center, metersPerInch, paper, pxPerInch * dpr);
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      try {
        setLoading({ done: 0, total: 0 });
        const result = await renderPoster(canvas, p, target, data, {
          labels: false,
          sharp: false,
          signal: controller.signal,
          // Pick photos by what the print needs, so the preview shows the same ones.
          printMpp: frameFor(center, metersPerInch, paper, p.dpi).mpp,
          onProgress: ({ done, total }) => setLoading({ done, total }),
        });
        const shown = canvasRef.current;
        if (!shown) return;
        shown.width = canvas.width;
        shown.height = canvas.height;
        shown.getContext('2d')!.drawImage(canvas, 0, 0);
        setDrawn(view);
        setLoading(null);
        const notes: string[] = [];
        if (result.failed) notes.push(`${result.failed} map tile${result.failed === 1 ? '' : 's'} didn't load (the USGS server is busy). Move the map a little to try again.`);
        if (result.savedWanted > 0 && result.savedFound === 0) notes.push('No winter photos are saved here, so this shows summer photos. Winter photos come with a property’s saved maps (Settings, Saved maps).');
        else if (result.savedWanted > 0 && result.savedFound < result.savedWanted) notes.push('Winter photos only cover the area around your properties that’s saved; summer photos fill in the rest.');
        setStatus(notes.join(' ') || null);
      } catch {
        // Replaced by a newer drawing.
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Redraw when the frame or the look changes; labels are drawn separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, lookKey, data]);

  const canvasTransform = drawn
    ? `translate(${(drawn.minX - view.minX) / view.mpp}px, ${(view.maxY - drawn.maxY) / view.mpp}px) scale(${drawn.mpp / view.mpp})`
    : 'none';

  // ----- Panning and zooming -----
  const pan = useRef<{ x: number; y: number; center: [number, number] } | null>(null);
  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, center };
    dragging.current = true;
  };
  const onStageMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = pan.current;
    if (!start) return;
    set({ center: [start.center[0] - (e.clientX - start.x) * view.mpp, start.center[1] + (e.clientY - start.y) * view.mpp] });
  };
  const onStageUp = () => {
    pan.current = null;
    dragging.current = false;
    setP((prev) => ({ ...prev }));
  };

  const paperRef = useRef<HTMLDivElement>(null);
  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    setP((prev) => {
      const mpi = Math.min(Math.max(prev.metersPerInch! / factor, 2), 5000);
      if (!at) return { ...prev, metersPerInch: mpi };
      // Keep the spot under the cursor where it is.
      const k = mpi / prev.metersPerInch!;
      const mx = view.minX + at.x * view.mpp;
      const my = view.maxY - at.y * view.mpp;
      return { ...prev, metersPerInch: mpi, center: [mx + (prev.center![0] - mx) * k, my + (prev.center![1] - my) * k] };
    });
  };
  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ----- Labels -----
  const labels = useMemo(() => posterLabels(data, p), [data, p]);
  const allLabelCount = useMemo(() => posterLabels(data, { ...p, hiddenLabelIds: [] }).length, [data, p]);

  // ----- Single things on or off -----
  const hiddenIds = new Set(p.hiddenIds ?? []);
  const toggleItem = (id: string, on: boolean) => set({ hiddenIds: on ? (p.hiddenIds ?? []).filter((x) => x !== id) : [...(p.hiddenIds ?? []), id] });
  const viewBox: [number, number, number, number] = [toLng(view.minX), toLat(view.maxY - view.height * view.mpp), toLng(view.minX + view.width * view.mpp), toLat(view.maxY)];
  const inView = ([w, s, e, n]: [number, number, number, number]) => w < viewBox[2] && e > viewBox[0] && s < viewBox[3] && n > viewBox[1];
  const lineBox = (points: Position[]): [number, number, number, number] => [
    Math.min(...points.map((q) => q[0])),
    Math.min(...points.map((q) => q[1])),
    Math.max(...points.map((q) => q[0])),
    Math.max(...points.map((q) => q[1])),
  ];
  const itemsInView = (kind: keyof PosterSettings['show']): { id: string; name: string }[] => {
    const list =
      kind === 'properties'
        ? data.properties.filter((r) => inView(boundsOf(r.boundary)))
        : kind === 'areas'
          ? data.areas.filter((r) => inView(boundsOf(r.geometry)))
          : kind === 'sections'
            ? data.sections.filter((r) => inView(boundsOf(r.geometry)))
            : kind === 'trails'
              ? data.trails.filter((r) => inView(lineBox(trailParts(r).flat())))
              : data.markers.filter((m) => inView([m.lng, m.lat, m.lng, m.lat]));
    return list.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  };
  const labelDrag = useRef<{ id: string; x: number; y: number; from: [number, number] } | null>(null);
  const onLabelDown = (e: ReactPointerEvent<HTMLDivElement>, label: PosterLabel) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    labelDrag.current = { id: label.id, x: e.clientX, y: e.clientY, from: labelCenter(label, p, view, unit) };
    dragging.current = true;
  };
  const onLabelMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = labelDrag.current;
    if (!drag) return;
    const at = fromPx(view, drag.from[0] + e.clientX - drag.x, drag.from[1] + e.clientY - drag.y);
    setP((prev) => ({ ...prev, labelAt: { ...prev.labelAt, [drag.id]: at } }));
  };
  const onLabelUp = () => {
    labelDrag.current = null;
    dragging.current = false;
    setP((prev) => ({ ...prev }));
  };

  // ----- Saving the poster -----
  const exportFrame = frameFor(center, metersPerInch, paper, p.dpi);
  const tileCount = useMemo(() => countTiles(p, exportFrame), [p, exportFrame.minX, exportFrame.maxY, exportFrame.mpp, exportFrame.width]); // eslint-disable-line react-hooks/exhaustive-deps
  const tooBig = exportFrame.width > MAX_POSTER_SIDE || exportFrame.height > MAX_POSTER_SIDE || exportFrame.width * exportFrame.height > MAX_POSTER_PIXELS;
  const tooMuchMap = tileCount > MAX_POSTER_TILES;
  const [saving, setSaving] = useState<{ text: string; abort: AbortController } | null>(null);

  const save = async () => {
    if (tooBig || tooMuchMap || saving) return;
    const abort = new AbortController();
    setSaving({ text: 'Loading map tiles…', abort });
    const canvas = document.createElement('canvas');
    try {
      canvas.width = exportFrame.width;
      canvas.height = exportFrame.height;
      const { failed } = await renderPoster(canvas, p, exportFrame, data, {
        labels: true,
        sharp: true,
        signal: abort.signal,
        onProgress: ({ done, total }) => setSaving({ text: `Loading map tiles: ${done.toLocaleString()} of ${total.toLocaleString()}`, abort }),
      });
      if (failed && !window.confirm(`${failed} map tile${failed === 1 ? '' : 's'} didn't load (the USGS server is busy), so ${failed === 1 ? 'a patch' : 'patches'} of the map will be blank. Save anyway? Press Cancel to try again in a minute; the tiles that did load are kept.`)) return;
      setSaving({ text: 'Saving the image (a big one takes a little while)…', abort });
      const blob = await posterBlob(canvas, p);
      const name = (p.title.trim() || 'Fenceline poster').replace(/[\\/:*?"<>|]+/g, '').trim();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${name} ${paper.w}x${paper.h} in.${p.format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      setStatus(`Saved ${link.download} (${(blob.size / 1_048_576).toFixed(0)} MB).`);
    } catch (error) {
      if (!abort.signal.aborted) setStatus(`Couldn't make the poster: ${(error as Error).message}`);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      setSaving(null);
    }
  };

  // ----- Panel -----
  const presets = POSTER_SIZES.find((s) => s.id === p.size);
  const feetPerInch = (metersPerInch * groundScale(center[1])) / 0.3048;
  const scaleText = feetPerInch >= 2640 ? `1 inch = ${(feetPerInch / 5280).toFixed(2)} miles` : `1 inch = ${Math.round(feetPerInch).toLocaleString()} ft`;
  const leaders = labels.filter((l) => l.kind === 'pin' && p.labelAt[l.id]);

  return (
    <div className="poster-editor" role="dialog" aria-label="Make a poster">
      <div className="poster-stage" ref={stageRef}>
        <div
          ref={paperRef}
          className="poster-paper"
          style={{ width: view.width, height: view.height }}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={onStageUp}
        >
          <canvas ref={canvasRef} className="poster-canvas" style={{ width: drawn ? drawn.width : view.width, height: drawn ? drawn.height : view.height, transform: canvasTransform }} />
          <svg className="poster-leaders" width={view.width} height={view.height}>
            {leaders.map((l) => {
              const [ax, ay] = toPx(view, l.anchor[0], l.anchor[1]);
              const [cx, cy] = labelCenter(l, p, view, unit);
              const box = labelBox(l, unit);
              const ex = Math.max(cx - box.w / 2, Math.min(ax, cx + box.w / 2));
              const ey = Math.max(cy - box.h / 2, Math.min(ay, cy + box.h / 2));
              if (Math.hypot(ex - ax, ey - ay) < 14 * unit) return null;
              return (
                <g key={l.id}>
                  <line x1={ax} y1={ay} x2={ex} y2={ey} stroke="rgba(0,0,0,0.7)" strokeWidth={3 * unit} strokeLinecap="round" />
                  <line x1={ax} y1={ay} x2={ex} y2={ey} stroke="#fff" strokeWidth={1.2 * unit} strokeLinecap="round" />
                </g>
              );
            })}
          </svg>
          {labels.map((l) => {
            const [x, y] = labelCenter(l, p, view, unit);
            if (x < -200 || y < -50 || x > view.width + 200 || y > view.height + 50) return null;
            return (
              <div
                key={l.id}
                className={`poster-label${p.labelAt[l.id] ? ' moved' : ''}`}
                style={{
                  left: x,
                  top: y,
                  color: l.color,
                  fontSize: l.font.size * unit,
                  fontWeight: l.font.weight,
                  textTransform: l.font.upper ? 'uppercase' : undefined,
                  letterSpacing: l.font.upper ? `${0.04 * l.font.size * unit}px` : undefined,
                  gap: 4 * unit,
                }}
                onPointerDown={(e) => onLabelDown(e, l)}
                onPointerMove={onLabelMove}
                onPointerUp={onLabelUp}
                onPointerCancel={onLabelUp}
                title="Drag to move. Double-click to put it back."
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setP((prev) => {
                    const labelAt = { ...prev.labelAt };
                    delete labelAt[l.id];
                    return { ...prev, labelAt };
                  });
                }}
              >
                {l.icon && <span className="poster-label-icon" style={{ width: 15 * unit, height: 15 * unit }} dangerouslySetInnerHTML={{ __html: iconSvg(l.icon, 15 * unit) }} />}
                <span>{l.text}</span>
                <button
                  className="poster-label-hide"
                  title="Leave this label off"
                  aria-label={`Leave the ${l.text} label off`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    set({ hiddenLabelIds: [...p.hiddenLabelIds, l.id] });
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="poster-zoom">
          <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
            <Icon name="plus" size={16} />
          </button>
          <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">
            <Icon name="minus" size={16} />
          </button>
        </div>
        {loading && !saving && (
          <div className="poster-loading" role="status">
            <span className="poster-spinner" />
            {loading.total ? `Loading the map: ${loading.done} of ${loading.total} tiles` : 'Loading the map…'}
          </div>
        )}
        {(status || saving) && !(loading && !saving) && <div className="poster-status">{saving?.text ?? status}</div>}
      </div>

      <aside className="poster-panel">
        <header className="poster-panel-head">
          <h2>Make a poster</h2>
          <button className="icon" onClick={onClose} title="Close" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <p className="hint">Drag the map to move it and scroll to zoom. Drag a label to move it, double-click it to put it back, or press its × to leave it off.</p>

        <div className="poster-group">
          <div className="field-label">Paper</div>
          <div className="poster-row">
            <select
              value={p.size}
              onChange={(e) => {
                const preset = POSTER_SIZES.find((s) => s.id === e.target.value);
                set(preset ? { size: preset.id, widthIn: preset.w, heightIn: preset.h } : { size: 'custom' });
              }}
              aria-label="Paper size"
            >
              {POSTER_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value="custom">Custom size</option>
            </select>
            <div className="poster-seg">
              <button className={!p.landscape ? 'active' : ''} onClick={() => set({ landscape: false })}>
                Tall
              </button>
              <button className={p.landscape ? 'active' : ''} onClick={() => set({ landscape: true })}>
                Wide
              </button>
            </div>
          </div>
          {!presets && (
            <div className="poster-row">
              <label className="poster-num">
                <input type="number" min={4} max={120} step={0.5} value={p.widthIn} onChange={(e) => set({ widthIn: Math.max(4, Number(e.target.value) || 4) })} />
                <span>×</span>
                <input type="number" min={4} max={120} step={0.5} value={p.heightIn} onChange={(e) => set({ heightIn: Math.max(4, Number(e.target.value) || 4) })} />
                <span>inches</span>
              </label>
            </div>
          )}
          <div className="poster-row">
            <select value={p.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })} aria-label="Print quality">
              {POSTER_DPIS.map((d) => (
                <option key={d} value={d}>
                  {d} DPI{d === 150 ? ' (big posters)' : d === 300 ? ' (sharpest)' : ''}
                </option>
              ))}
            </select>
            <select value={p.format} onChange={(e) => set({ format: e.target.value as PosterSettings['format'] })} aria-label="File type">
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
            </select>
          </div>
          <div className="hint">
            {exportFrame.width.toLocaleString()} × {exportFrame.height.toLocaleString()} pixels · {scaleText}
          </div>
          {data.properties.length > 0 && (
            <div className="poster-row">
              {data.properties.map((prop) => (
                <button key={prop.id} onClick={() => set(fitFrame(boundsOf(prop.boundary), paper))} title="Frame the poster on this property">
                  Fit {prop.name || 'property'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="poster-group">
          <div className="field-label">Map</div>
          <div className="poster-seg">
            {(['satellite', 'lidar', 'topo'] as const).map((b) => (
              <button key={b} className={p.base === b ? 'active' : ''} onClick={() => set({ base: b })}>
                {b === 'satellite' ? 'Aerial' : b === 'lidar' ? 'Lidar' : 'Topo'}
              </button>
            ))}
          </div>
          {p.base === 'satellite' && (
            <>
              <div className="poster-seg">
                <button className={p.photos !== 'leafOn' ? 'active' : ''} onClick={() => set({ photos: 'leafOff' })}>
                  Leaf-off (winter)
                </button>
                <button className={p.photos === 'leafOn' ? 'active' : ''} onClick={() => set({ photos: 'leafOn' })}>
                  Leaf-on (summer)
                </button>
              </div>
              <div className="hint">
                {p.photos === 'leafOn'
                  ? 'Summer NAIP photos, trees leafed out.'
                  : window.hub
                    ? "Missouri's 6 inch winter photos where your properties' maps are saved (the sharpest); summer photos around them."
                    : 'Winter photos only come from the desktop app’s saved maps; here you’ll see summer photos.'}
              </div>
            </>
          )}
          {(p.base === 'lidar' || p.lidarBlend > 0) && (
            <select value={p.lidarStyle} onChange={(e) => set({ lidarStyle: e.target.value as PosterSettings['lidarStyle'] })} aria-label="Lidar style">
              {LIDAR_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          {p.base !== 'lidar' && (
            <label className="poster-slider">
              <span>Lidar shading</span>
              <input type="range" min={0} max={0.8} step={0.05} value={p.lidarBlend} onChange={(e) => set({ lidarBlend: Number(e.target.value) })} />
            </label>
          )}
          <label className="poster-slider">
            <span>Contours</span>
            <select value={p.contours} onChange={(e) => set({ contours: e.target.value as PosterSettings['contours'] })}>
              {CONTOUR_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="poster-group">
          <div className="field-label">On the map</div>
          {KINDS.map((k) => {
            const items = itemsInView(k.show);
            const hiddenHere = items.filter((i) => hiddenIds.has(i.id)).length;
            return (
              <details key={k.show} className="poster-kind">
                <summary>
                  <label className="check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={p.show[k.show]} onChange={(e) => set({ show: { ...p.show, [k.show]: e.target.checked } })} />
                    {k.name}
                  </label>
                  <label className="check poster-kind-labels" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" disabled={!p.show[k.show]} checked={p.labels[k.label]} onChange={(e) => set({ labels: { ...p.labels, [k.label]: e.target.checked } })} />
                    Labels
                  </label>
                  <span className="muted poster-kind-count">{items.length ? `${items.length - hiddenHere}/${items.length}` : 'none'}</span>
                </summary>
                {items.length > 0 && (
                  <ul className="poster-items">
                    {items.map((item) => {
                      const shown = !hiddenIds.has(item.id);
                      const labelId = `${k.label}:${item.id}`;
                      return (
                        <li key={item.id}>
                          <label className="check" title="Draw it on the poster">
                            <input type="checkbox" disabled={!p.show[k.show]} checked={shown} onChange={(e) => toggleItem(item.id, e.target.checked)} />
                            <span className="poster-item-name">{item.name || '(no name)'}</span>
                          </label>
                          <label className="check poster-item-label" title="Show its name">
                            <input
                              type="checkbox"
                              disabled={!shown || !p.show[k.show] || !p.labels[k.label] || !item.name}
                              checked={shown && Boolean(item.name) && !p.hiddenLabelIds.includes(labelId)}
                              onChange={(e) => set({ hiddenLabelIds: e.target.checked ? p.hiddenLabelIds.filter((x) => x !== labelId) : [...p.hiddenLabelIds, labelId] })}
                            />
                            Label
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </details>
            );
          })}
          <div className="hint">Open a row to turn single things or their labels on or off. Only what's inside the frame is listed.</div>
        </div>

        <div className="poster-group">
          <div className="field-label">Sizes</div>
          <label className="poster-slider">
            <span>Label text</span>
            <input type="range" min={0.6} max={6} step={0.05} value={p.textScale} onChange={(e) => set({ textScale: Number(e.target.value) })} />
          </label>
          <label className="poster-slider">
            <span>Pins</span>
            <input type="range" min={0.6} max={6} step={0.05} value={p.featureScale ?? p.textScale} onChange={(e) => set({ featureScale: Number(e.target.value) })} />
          </label>
          {LINE_SIZES.map((line) => (
            <label key={line.kind} className="poster-slider">
              <span>{line.name}</span>
              <input
                type="range"
                min={0.4}
                max={6}
                step={0.05}
                value={p.lineScales?.[line.kind] ?? p.lineScale ?? p.featureScale ?? p.textScale}
                onChange={(e) => set({ lineScales: { ...p.lineScales, [line.kind]: Number(e.target.value) } })}
              />
            </label>
          ))}
          <div className="poster-row">
            {p.hiddenLabelIds.length + hiddenIds.size > 0 && <button onClick={() => set({ hiddenLabelIds: [], hiddenIds: [] })}>Show everything left off</button>}
            {Object.keys(p.labelAt).length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Put every label back where it started?')) set({ labelAt: {} });
                }}
              >
                Put labels back
              </button>
            )}
          </div>
          <div className="hint">
            {labels.length} of {allLabelCount} labels shown.
          </div>
        </div>

        <div className="poster-group">
          <div className="field-label">Title</div>
          <input type="text" placeholder="Title, e.g. Possum Trot" value={p.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
          <input type="text" placeholder="Second line, e.g. Shannon County, Missouri" value={p.subtitle} onChange={(e) => set({ subtitle: e.target.value })} aria-label="Second line" />
          <label className="check">
            <input type="checkbox" checked={p.northArrow} onChange={(e) => set({ northArrow: e.target.checked })} />
            North arrow
          </label>
          <label className="check">
            <input type="checkbox" checked={p.scaleBar} onChange={(e) => set({ scaleBar: e.target.checked })} />
            Scale bar
          </label>
        </div>

        <footer className="poster-panel-foot">
          {tooBig && <div className="poster-warn">That's more pixels than one image can hold. Pick a lower DPI or a smaller size.</div>}
          {!tooBig && tooMuchMap && <div className="poster-warn">That covers too much ground to download for one poster ({tileCount.toLocaleString()} tiles). Zoom in, or pick a lower DPI.</div>}
          {saving ? (
            <button onClick={() => saving.abort.abort()}>Stop</button>
          ) : (
            <button className="primary" disabled={tooBig || tooMuchMap} onClick={() => void save()}>
              Save poster image
            </button>
          )}
          {!window.hub && <div className="hint">In the desktop app, map tiles come from the saved maps, so this is quicker.</div>}
        </footer>
      </aside>
    </div>
  );
}
