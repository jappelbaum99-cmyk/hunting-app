import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { ScheduleForm } from '@/components/ScheduleForm';
import { PLAN_STATUSES } from '@/lib/plans';
import { todayDate } from '@/lib/plotLog';
import { isOverdue, nextDue, type SchedulePlace } from '@/lib/schedules';
import { moveKey, orderRows, upcomingRows, type PlanRow, type UpcomingRow } from '@/lib/upcoming';
import type { ActionItem, Plan, PlanStatus, WorkSchedule } from '@/types/models';

const STATUSES = Object.keys(PLAN_STATUSES) as PlanStatus[];

export interface ComingUpProps {
  places: SchedulePlace[];
  // Board cards, so work already on To do isn't listed twice.
  items: ActionItem[];
  plans: Plan[];
  // Row keys in the order they were put in. Empty means soonest first.
  order: string[];
  onOrderChange(order: string[]): void;
  onSaveSchedules(place: SchedulePlace, schedules: WorkSchedule[]): void;
  onSavePlan(plan: Plan): void;
  onRemovePlan(id: string): void;
  onOpenPlace(place: SchedulePlace): void;
}

// Rows still ahead: repeating work not yet on To do, and dated section plans.
export function comingUpRows(places: SchedulePlace[], plans: Plan[], items: ActionItem[], order: string[], today = todayDate()): UpcomingRow[] {
  const carded = new Set(items.filter((i) => !i.deletedAt && i.schedule).map((i) => i.id));
  const rows = upcomingRows(places, plans, today).filter((r) => r.type !== 'schedule' || !carded.has(`schedule-${r.schedule.id}-${nextDue(r.schedule, today).season}`));
  return orderRows(rows, order);
}

// The Action Board's Coming up list: everything scheduled, in any order, and
// each one can be changed or removed. When work comes due it moves to To do.
export function ComingUpList(props: ComingUpProps) {
  const today = todayDate();
  const rows = comingUpRows(props.places, props.plans, props.items, props.order, today);
  const keys = rows.map((r) => r.key);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const moveTo = (key: string, index: number) => props.onOrderChange(moveKey(keys, key, index));

  const stopDrag = () => {
    setDragging(null);
    setOver(null);
  };

  const remove = (row: UpcomingRow) => {
    if (row.type === 'plan') {
      if (window.confirm(`Delete the plan "${row.title}"?`)) props.onRemovePlan(row.plan.id);
    } else if (window.confirm(`Stop the "${row.title}" schedule on ${row.placeName}? Cards already on the Action Board stay there.`)) {
      const stopped = (row.place.schedules ?? []).map((s) => (s.id === row.schedule.id ? { ...s, deletedAt: new Date().toISOString() } : s));
      props.onSaveSchedules(row.place, stopped);
    }
  };

  return (
    <>
      {rows.length === 0 ? (
        <p className="hint">Nothing scheduled. Add a schedule on an area or section (burn every 3 years, plant every fall), or give a section's plan a date.</p>
      ) : (
        <>
          <div className="schedules-tools">
            <span className="muted">Drag or use the arrows to change the order.</span>
            {props.order.length > 0 && (
              <button className="link" onClick={() => props.onOrderChange([])}>
                Sort by date
              </button>
            )}
          </div>
          <ul className="board-list">
            {rows.map((row, index) => {
              const isEditing = editing === row.key;
              const overdue = isOverdue(row.end, today);
              const dropClass = over === row.key && dragging !== row.key ? (keys.indexOf(dragging ?? '') < index ? ' drop-after' : ' drop-before') : '';
              return (
                <li
                  key={row.key}
                  className={`board-card schedule-row${dragging === row.key ? ' dragging' : ''}${dropClass}`}
                  draggable={!isEditing}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    // Some browsers won't start a drag without data.
                    e.dataTransfer.setData('text/plain', row.title);
                    setDragging(row.key);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    setOver(row.key);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging && dragging !== row.key) moveTo(dragging, index);
                    stopDrag();
                  }}
                  onDragEnd={stopDrag}
                >
                  <div className="schedule-row-main">
                    <div className="schedule-move">
                      <button className="icon" title="Move up" aria-label={`Move ${row.title} up`} disabled={index === 0} onClick={() => moveTo(row.key, index - 1)}>
                        ▲
                      </button>
                      <button className="icon" title="Move down" aria-label={`Move ${row.title} down`} disabled={index === rows.length - 1} onClick={() => moveTo(row.key, index + 1)}>
                        ▼
                      </button>
                    </div>
                    <div className="plot-log-text">
                      <span className="row-title">
                        {row.title}: {row.placeName}
                      </span>
                      <span className={overdue ? 'board-due overdue' : 'board-due'}>
                        {overdue ? 'Overdue: ' : ''}
                        {row.when}
                      </span>
                      <span className="row-detail">{row.detail}</span>
                    </div>
                    <button
                      className="icon"
                      title="Remove"
                      aria-label={`Remove ${row.title}`}
                      onClick={() => remove(row)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>

                  {isEditing ? (
                    row.type === 'schedule' ? (
                      <ScheduleForm
                        schedule={row.schedule}
                        onSave={(saved) => {
                          props.onSaveSchedules(row.place, (row.place.schedules ?? []).map((s) => (s.id === saved.id ? saved : s)));
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <PlanForm
                        row={row}
                        onSave={(plan) => {
                          props.onSavePlan(plan);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    )
                  ) : (
                    <div className="board-actions">
                      <button onClick={() => setEditing(row.key)}>Edit</button>
                      <button onClick={() => props.onOpenPlace(row.place)}>Open {row.place.kind}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

// The parts of a plan that decide when it happens. The rest is on its section.
function PlanForm({ row, onSave, onCancel }: { row: PlanRow; onSave(plan: Plan): void; onCancel(): void }) {
  const { plan } = row;
  const [title, setTitle] = useState(plan.title);
  const [date, setDate] = useState(plan.targetDate ?? '');
  const [status, setStatus] = useState(plan.status);

  return (
    <div className="plot-form schedule-form">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Plan name" />
      <label className="schedule-last">
        <span className="muted">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} aria-label="Status">
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {PLAN_STATUSES[s]}
          </option>
        ))}
      </select>
      <div className="plot-form-actions">
        <button className="primary" disabled={!title.trim()} onClick={() => onSave({ ...plan, title: title.trim(), targetDate: date || null, status })}>
          Save plan
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
