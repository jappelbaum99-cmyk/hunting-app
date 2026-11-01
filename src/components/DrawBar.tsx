import { acresOf, formatAcres, pointsToPolygon } from '@/lib/geo';
import type { Position } from 'geojson';

interface DrawBarProps {
  kind: 'draw' | 'place';
  title: string;
  points: Position[];
  onUndo(): void;
  onCancel(): void;
  onFinish(): void;
}

export function DrawBar({ kind, title, points, onUndo, onCancel, onFinish }: DrawBarProps) {
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

  const canFinish = points.length >= 3;
  return (
    <div className="draw-bar">
      <span>
        Drawing <strong>{title}</strong>: click each corner.
        {canFinish && <> · {formatAcres(acresOf(pointsToPolygon(points)))}</>}
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
