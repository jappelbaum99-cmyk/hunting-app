import { COMBINE_DISTANCES_FT, DEFAULT_COMBINE_FT } from '@/lib/combineTrails';
import { acresOf, formatAcres, pointsToPolygon } from '@/lib/geo';
import { formatDistance, lineLengthM } from '@/lib/trails';
import type { Position } from 'geojson';
import { useState } from 'react';

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

// Everything for changing a saved line, in one menu.
export function LineEditBar(props: {
  title: string;
  parts: Position[][];
  canUndo: boolean;
  onUndo(): void;
  onCancel(): void;
  onDone(): void;
  onPick(action: 'split' | 'join' | 'trim'): void;
  onCombine(feet: number): void;
}) {
  const [feet, setFeet] = useState(DEFAULT_COMBINE_FT);
  return (
    <div className="draw-bar line-edit">
      <div className="line-edit-title">
        Editing <strong>{props.title}</strong> · {formatDistance(props.parts.reduce((total, part) => total + lineLengthM(part), 0))}: drag corners, click + to add one, right-click a corner to remove it, or click another line to join it.
      </div>
      <div className="line-edit-tools">
        <button onClick={() => props.onPick('split')} title="Cut this line in two where you click">
          Split
        </button>
        <button onClick={() => props.onPick('join')} title="Click another line, then press Join. They become one line with this line's name and look, even if they meet at a T.">
          Join
        </button>
        <button onClick={() => props.onPick('trim')} title="Remove the stretch between two spots you click">
          Delete part
        </button>
        <span className="line-edit-divider" />
        <select value={feet} onChange={(e) => setFeet(Number(e.target.value))} aria-label="How close counts">
          {COMBINE_DISTANCES_FT.map((ft) => (
            <option key={ft} value={ft}>
              Within {ft} ft
            </option>
          ))}
        </select>
        <button onClick={() => props.onCombine(feet)} title="Keeps this line, removes where it doubles back on itself, and folds in overlapping lines of the same type. Parts that carry on past its ends make it longer, and turn-offs stay as branches.">
          Combine
        </button>
        <span className="line-edit-divider" />
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
    </div>
  );
}

// Shown while reshaping a saved shape.
export function EditBar(props: {
  title: string;
  rings: Position[][];
  canUndo: boolean;
  onUndo(): void;
  onCancel(): void;
  onDone(): void;
}) {
  const size = formatAcres(props.rings.reduce((t, ring) => t + (ring.length >= 3 ? acresOf(pointsToPolygon(ring)) : 0), 0));
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
