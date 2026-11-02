import { acresOf, formatAcres, pointsToPolygon } from '@/lib/geo';
import { formatDistance, lineLengthM } from '@/lib/trails';
import type { Position } from 'geojson';

interface DrawBarProps {
  kind: 'draw' | 'place';
  title: string;
  points: Position[];
  onUndo(): void;
  onCancel(): void;
  onFinish(): void;
  // 2 for a line (trail), 3 for a closed shape.
  minPoints?: number;
}

export function DrawBar({ kind, title, points, onUndo, onCancel, onFinish, minPoints = 3 }: DrawBarProps) {
  const line = minPoints === 2;
  if (kind === 'place') {
    return (
      <div className="draw-bar">
        <span>
          Click the map to place the <strong>{title}</strong>.
        </span>
        <button onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  const canFinish = points.length >= minPoints;
  return (
    <div className="draw-bar">
      <span>
        Drawing <strong>{title}</strong>: {line ? 'click along it.' : 'click each corner.'}
        {canFinish && <> · {line ? formatDistance(lineLengthM(points)) : formatAcres(acresOf(pointsToPolygon(points)))}</>}
      </span>
      <button onClick={onUndo} disabled={points.length === 0} title="Backspace">
        Undo
      </button>
      <button onClick={onCancel} title="Esc">
        Cancel
      </button>
      <button className="primary" onClick={onFinish} disabled={!canFinish} title="Enter">
        Done
      </button>
    </div>
  );
}

// Shown while reshaping a saved shape.
export function EditBar(props: {
  title: string;
  line: boolean;
  rings: Position[][];
  canUndo: boolean;
  onUndo(): void;
  onCancel(): void;
  onDone(): void;
}) {
  const size = props.line
    ? formatDistance(lineLengthM(props.rings[0] ?? []))
    : formatAcres(props.rings.reduce((t, ring) => t + (ring.length >= 3 ? acresOf(pointsToPolygon(ring)) : 0), 0));
  return (
    <div className="draw-bar">
      <span>
        Editing <strong>{props.title}</strong>: drag corners, click + to add one, right-click a corner to remove it. · {size}
      </span>
      <button onClick={props.onUndo} disabled={!props.canUndo} title="Ctrl+Z">
        Undo
      </button>
      <button onClick={props.onCancel} title="Esc">
        Cancel
      </button>
      <button className="primary" onClick={props.onDone} title="Enter">
        Done
      </button>
    </div>
  );
}
