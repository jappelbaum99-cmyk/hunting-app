import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { BOARD_LISTS, BOARD_STATUSES, NOTE_KINDS } from '@/lib/actionBoard';
import { todayDate } from '@/lib/plotLog';
import { isOverdue } from '@/lib/schedules';
import type { ActionItem, BoardStatus, NoteKind } from '@/types/models';

interface ActionBoardPanelProps {
  items: ActionItem[];
  onAdd(kind: NoteKind, text: string): void;
  onChange(item: ActionItem): void;
  onDelete(id: string): void;
  onShow(item: ActionItem): void;
  // Adds a stand at the card's spot.
  onMakeStand(item: ActionItem): void;
  onOpenStand(id: string): void;
  // Opens the area or section a scheduled card belongs to.
  onOpenPlace(item: ActionItem): void;
  onClose(): void;
}

const STATUSES = Object.keys(BOARD_STATUSES) as BoardStatus[];
const KINDS = Object.keys(NOTE_KINDS) as NoteKind[];

// Notes from phones and ideas added here, moved along from idea to to do to done.
export function ActionBoardPanel(props: ActionBoardPanelProps) {
  const [kind, setKind] = useState<NoteKind>('work');
  const [text, setText] = useState('');
  const newestFirst = [...props.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = newestFirst.filter((i) => i.status === 'done');
  const today = todayDate();
  const late = (i: ActionItem) => (i.schedule && isOverdue(i.schedule.dueEnd, today) ? 0 : 1);

  const add = () => {
    if (!text.trim()) return;
    props.onAdd(kind, text.trim());
    setText('');
  };

  return (
    <div className="forecast action-board">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>Action Board</h2>
      </div>

      <section className="sidebar-section">
        <div className="board-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} aria-label="Kind of note">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {NOTE_KINDS[k]}
              </option>
            ))}
          </select>
          <textarea rows={2} placeholder="Add an idea or something to do" value={text} onChange={(e) => setText(e.target.value)} aria-label="New card" />
          <button className="primary" disabled={!text.trim()} onClick={add}>
            Add to board
          </button>
        </div>
      </section>

      {props.items.length === 0 && <p className="hint board-empty">Nothing here yet. Notes saved on the phone's Notes tab show up here.</p>}

      {BOARD_LISTS.map(({ status, heading }) => {
        // Overdue work comes first.
        const cards = newestFirst.filter((i) => i.status === status).sort((a, b) => late(a) - late(b));
        if (cards.length === 0) return null;
        return (
          <section className="sidebar-section" key={status}>
            <h2>
              {heading} <span className="muted">· {cards.length}</span>
            </h2>
            <ul className="board-list">
              {cards.map((item) => (
                <BoardCardRow key={item.id} item={item} {...props} />
              ))}
            </ul>
          </section>
        );
      })}

      {done.length > 0 && (
        <section className="sidebar-section">
          <details className="board-done">
            <summary>
              Done <span className="muted">· {done.length}</span>
            </summary>
            <ul className="board-list">
              {done.map((item) => (
                <BoardCardRow key={item.id} item={item} {...props} />
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

function BoardCardRow({ item, ...props }: ActionBoardPanelProps & { item: ActionItem }) {
  const [editing, setEditing] = useState<string | null>(null);
  const hasSpot = item.lat !== null && item.lng !== null;
  const overdue = item.schedule && item.status !== 'done' && isOverdue(item.schedule.dueEnd, todayDate());
  const canMakeStand = item.kind === 'stand' && hasSpot && !item.markerId;
  const byline = [item.loggedBy, new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })].filter(Boolean).join(' · ');

  return (
    <li className="board-card">
      <div className="board-card-head">
        <span className="board-kind">{NOTE_KINDS[item.kind]}</span>
        <span className="muted">{byline}</span>
        <button
          className="icon"
          title="Remove"
          aria-label="Remove card"
          onClick={() => {
            const question = item.schedule && item.status !== 'done' ? 'Skip this one? It comes back when the schedule next comes due.' : 'Remove this card from the board?';
            if (window.confirm(question)) props.onDelete(item.id);
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {editing === null ? (
        <button className="board-text" title="Click to edit" onClick={() => setEditing(item.text)}>
          {item.text}
        </button>
      ) : (
        <div className="board-edit">
          <textarea rows={3} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Card text" autoFocus />
          <div className="board-actions">
            <button
              className="primary"
              disabled={!editing.trim()}
              onClick={() => {
                props.onChange({ ...item, text: editing.trim() });
                setEditing(null);
              }}
            >
              Save
            </button>
            <button onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {item.schedule && (
        <span className={overdue ? 'board-due overdue' : 'board-due'}>
          {overdue ? 'Overdue' : 'Due'}: {item.schedule.dueLabel}
        </span>
      )}

      <div className="status-chips board-status" role="radiogroup" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s} role="radio" aria-checked={item.status === s} className={item.status === s ? `active status-${s}` : ''} onClick={() => props.onChange({ ...item, status: s })}>
            {BOARD_STATUSES[s]}
          </button>
        ))}
      </div>

      {(hasSpot || item.markerId || item.schedule) && (
        <div className="board-actions">
          {item.schedule && <button onClick={() => props.onOpenPlace(item)}>Open {item.schedule.placeKind}</button>}
          {hasSpot && <button onClick={() => props.onShow(item)}>Show on map</button>}
          {canMakeStand && <button onClick={() => props.onMakeStand(item)}>Make a stand</button>}
          {item.markerId && <button onClick={() => props.onOpenStand(item.markerId as string)}>Open stand</button>}
        </div>
      )}
    </li>
  );
}
