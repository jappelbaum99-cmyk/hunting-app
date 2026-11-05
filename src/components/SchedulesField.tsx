import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { formatPlotDate, todayDate } from '@/lib/plotLog';
import { cadenceLabel, isOverdue, liveSchedules, MONTH_NAMES, nextDue, SCHEDULE_WORK, scheduleTitle, windowLabel } from '@/lib/schedules';
import type { ScheduleWork, WorkSchedule } from '@/types/models';

const CADENCES = [1, 2, 3, 5];
const WORKS = Object.keys(SCHEDULE_WORK) as ScheduleWork[];

interface Draft {
  id: string | null;
  work: ScheduleWork;
  detail: string;
  everyYears: number;
  startMonth: number;
  endMonth: number;
  lastDone: string;
}

const blank = (work: ScheduleWork): Draft => ({ id: null, work, detail: '', everyYears: 1, startMonth: SCHEDULE_WORK[work].start, endMonth: SCHEDULE_WORK[work].end, lastDone: '' });

// Work that repeats on this area or section. Each one puts a To do card on the
// Action Board as it comes due.
export function SchedulesField({ schedules, onChange }: { schedules: WorkSchedule[] | undefined; onChange(schedules: WorkSchedule[]): void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const today = todayDate();
  const list = liveSchedules({ schedules });
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const valid = draft !== null && draft.everyYears >= 1 && (draft.work !== 'other' || draft.detail.trim() !== '');

  const save = () => {
    if (!draft || !valid) return;
    const existing = list.find((s) => s.id === draft.id);
    const lastDone = draft.lastDone || null;
    const saved: WorkSchedule = {
      id: existing?.id ?? crypto.randomUUID(),
      work: draft.work,
      detail: draft.detail.trim() || null,
      everyYears: Math.round(draft.everyYears),
      startMonth: draft.startMonth,
      endMonth: draft.endMonth,
      lastDone,
      // Correcting the last done date starts the count again from that date.
      handledSeason: existing && existing.lastDone === lastDone ? (existing.handledSeason ?? null) : null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      deletedAt: null,
    };
    onChange(existing ? (schedules ?? []).map((s) => (s.id === saved.id ? saved : s)) : [...(schedules ?? []), saved]);
    setDraft(null);
  };

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
                <button
                  className="link"
                  onClick={() => setDraft({ id: s.id, work: s.work, detail: s.detail ?? '', everyYears: s.everyYears, startMonth: s.startMonth, endMonth: s.endMonth, lastDone: s.lastDone ?? '' })}
                >
                  Edit
                </button>
                <button
                  className="icon"
                  title="Remove"
                  aria-label={`Remove ${scheduleTitle(s)} schedule`}
                  onClick={() => {
                    if (window.confirm(`Stop the "${scheduleTitle(s)}" schedule? Cards already on the Action Board stay there.`)) {
                      onChange((schedules ?? []).map((other) => (other.id === s.id ? { ...other, deletedAt: new Date().toISOString() } : other)));
                      if (draft?.id === s.id) setDraft(null);
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

      {draft === null ? (
        <button className="schedule-add" onClick={() => setDraft(blank('burn'))}>
          + Add a schedule
        </button>
      ) : (
        <div className="plot-form schedule-form">
          <div className="plot-fields">
            <select
              value={draft.work}
              onChange={(e) => {
                const work = e.target.value as ScheduleWork;
                set({ work, startMonth: SCHEDULE_WORK[work].start, endMonth: SCHEDULE_WORK[work].end });
              }}
              aria-label="What needs doing"
            >
              {WORKS.map((w) => (
                <option key={w} value={w}>
                  {SCHEDULE_WORK[w].label}
                </option>
              ))}
            </select>
            <select value={CADENCES.includes(draft.everyYears) ? draft.everyYears : 'custom'} onChange={(e) => set({ everyYears: e.target.value === 'custom' ? 4 : Number(e.target.value) })} aria-label="How often">
              {CADENCES.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'Every year' : `Every ${n} years`}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
          {!CADENCES.includes(draft.everyYears) && (
            <label className="schedule-inline">
              <span>Every</span>
              <input type="number" min={1} max={50} value={draft.everyYears || ''} onChange={(e) => set({ everyYears: Number(e.target.value) })} aria-label="Years between" />
              <span>years</span>
            </label>
          )}
          {(draft.work === 'plant' || draft.work === 'other') && (
            <input
              type="text"
              placeholder={draft.work === 'plant' ? 'What to plant (optional)' : 'What needs doing'}
              value={draft.detail}
              onChange={(e) => set({ detail: e.target.value })}
              aria-label={draft.work === 'plant' ? 'What to plant' : 'Name of the work'}
            />
          )}
          <label className="schedule-inline">
            <span>In</span>
            <select value={draft.startMonth} onChange={(e) => set({ startMonth: Number(e.target.value) })} aria-label="From month">
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <span>to</span>
            <select value={draft.endMonth} onChange={(e) => set({ endMonth: Number(e.target.value) })} aria-label="To month">
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="schedule-last">
            <span className="muted">Last done (optional)</span>
            <input type="date" max={today} value={draft.lastDone} onChange={(e) => set({ lastDone: e.target.value })} />
          </label>
          <div className="plot-form-actions">
            <button className="primary" disabled={!valid} onClick={save}>
              Save schedule
            </button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
