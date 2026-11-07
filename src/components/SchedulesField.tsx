import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { ScheduleForm } from '@/components/ScheduleForm';
import { formatPlotDate, todayDate } from '@/lib/plotLog';
import { cadenceLabel, isOverdue, liveSchedules, nextDue, scheduleTitle, windowLabel } from '@/lib/schedules';
import type { WorkSchedule } from '@/types/models';

// Work that repeats on this area or section. Each one puts a To do card on the
// Action Board as it comes due.
export function SchedulesField({ schedules, onChange }: { schedules: WorkSchedule[] | undefined; onChange(schedules: WorkSchedule[]): void }) {
  // The schedule being changed, or 'new' while adding one.
  const [editing, setEditing] = useState<WorkSchedule | 'new' | null>(null);
  const today = todayDate();
  const list = liveSchedules({ schedules });

  return (
    <div className="field">
      <div className="field-label">Schedule</div>
      {list.length > 0 && (
        <ul className="plot-log schedule-list">
          {list.map((s) => {
            const due = nextDue(s, today);
            return (
              <li key={s.id}>
                <div className="plot-log-text">
                  <span className="row-title">{scheduleTitle(s)}</span>
                  <span className="row-detail">
                    {cadenceLabel(s)} · {windowLabel(s)}
                  </span>
                  <span className={`plot-log-notes${isOverdue(due.end, today) ? ' schedule-overdue' : ''}`}>
                    {isOverdue(due.end, today) ? 'Overdue' : 'Next'}: {due.label}
                    {s.lastDone ? ` · last done ${formatPlotDate(s.lastDone)}` : ''}
                  </span>
                </div>
                <button className="link" onClick={() => setEditing(s)}>
                  Edit
                </button>
                <button
                  className="icon"
                  title="Remove"
                  aria-label={`Remove ${scheduleTitle(s)} schedule`}
                  onClick={() => {
                    if (window.confirm(`Stop the "${scheduleTitle(s)}" schedule? Cards already on the Action Board stay there.`)) {
                      onChange((schedules ?? []).map((other) => (other.id === s.id ? { ...other, deletedAt: new Date().toISOString() } : other)));
                      if (editing !== 'new' && editing?.id === s.id) setEditing(null);
                    }
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing === null ? (
        <button className="schedule-add" onClick={() => setEditing('new')}>
          + Add a schedule
        </button>
      ) : (
        <ScheduleForm
          key={editing === 'new' ? 'new' : editing.id}
          schedule={editing === 'new' ? null : editing}
          onSave={(saved) => {
            onChange(editing === 'new' ? [...(schedules ?? []), saved] : (schedules ?? []).map((s) => (s.id === saved.id ? saved : s)));
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
