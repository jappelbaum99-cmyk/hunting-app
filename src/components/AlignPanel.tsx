import { ImagePointPicker } from '@/components/ImagePointPicker';
import { controlPointErrorsFeet } from '@/lib/georef';
import type { ControlPoint } from '@/types/models';

// A control point that has its image spot but is still waiting for the map spot.
export interface PendingPoint {
  image: [number, number];
  map: [number, number] | null;
}

export interface AlignDraft {
  overlayId: string;
  isNew: boolean;
  name: string;
  url: string;
  width: number;
  height: number;
  points: PendingPoint[];
  opacity: number;
}

export function completePoints(points: PendingPoint[]): ControlPoint[] {
  return points.filter((p): p is ControlPoint => p.map !== null);
}

interface AlignPanelProps {
  draft: AlignDraft;
  saving: boolean;
  onChange(draft: AlignDraft): void;
  onSave(): void;
  onCancel(): void;
}

export function AlignPanel({ draft, saving, onChange, onSave, onCancel }: AlignPanelProps) {
  const complete = completePoints(draft.points);
  const errors = controlPointErrorsFeet(complete);
  // Errors line up with complete points; map them back onto every point.
  const errorByPoint: (number | null)[] = [];
  for (let i = 0, next = 0; i < draft.points.length; i++) {
    errorByPoint.push(draft.points[i].map ? errors[next++] : null);
  }
  const waiting = draft.points.findIndex((p) => p.map === null);

  const pickImage = (image: [number, number]) => {
    const points = [...draft.points];
    // Clicking the image again before matching it on the map moves that point.
    if (waiting !== -1) points[waiting] = { image, map: null };
    else points.push({ image, map: null });
    onChange({ ...draft, points });
  };

  let step: string;
  if (waiting !== -1) step = `Now click the same spot as point ${waiting + 1} on the map.`;
  else if (complete.length < 2) step = `Click a spot on the image you can also find on the map (point ${complete.length + 1}).`;
  else step = 'Lined up. Add more points to fine-tune, or save.';

  return (
    <aside className="align-panel">
      <header className="detail-header">
        <h2>Line up map image</h2>
        <button className="icon" onClick={onCancel} title="Cancel">
          ✕
        </button>
      </header>

      <ImagePointPicker
        src={draft.url}
        width={draft.width}
        height={draft.height}
        points={draft.points.map((p) => p.image)}
        activeIndex={waiting === -1 ? null : waiting}
        onPick={pickImage}
      />

      <div className="align-controls">
        <p className="align-step">{step}</p>
        <p className="hint">
          Use spots that are easy to find on both: road intersections, section corners, building or pond corners. Spread
          them out across the image. Two points work; 3–4 are more accurate.
        </p>

        {draft.points.length > 0 && (
          <ol className="point-list">
            {draft.points.map((p, i) => (
              <li key={i}>
                <span className="point-number">{i + 1}</span>
                <span className="point-status">
                  {p.map === null
                    ? 'waiting for map click'
                    : complete.length >= 3
                      ? `off by ${Math.round(errorByPoint[i] ?? 0)} ft`
                      : 'matched'}
                </span>
                <button
                  className="icon"
                  title="Remove point"
                  onClick={() => onChange({ ...draft, points: draft.points.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        {complete.length >= 3 && Math.max(...errors) > 30 && (
          <p className="hint warn">One point is far off the others. Check that it's the same spot, or remove it.</p>
        )}

        <label className="layer-row">
          <span>Name</span>
          <input type="text" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </label>
        <label className="layer-row">
          <span>See-through</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={draft.opacity}
            onChange={(e) => onChange({ ...draft, opacity: Number(e.target.value) })}
          />
        </label>

        <div className="align-buttons">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={complete.length < 2 || saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </aside>
  );
}
