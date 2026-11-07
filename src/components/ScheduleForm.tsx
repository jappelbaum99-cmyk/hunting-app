import { useState } from 'react';

import { todayDate } from '@/lib/plotLog';
import { MONTH_NAMES, SCHEDULE_WORK } from '@/lib/schedules';
import type { ScheduleWork, WorkSchedule } from '@/types/models';

const CADENCES = [1, 2, 3, 5];
const WORKS = Object.keys(SCHEDULE_WORK) as ScheduleWork[];

// Adds a schedule (schedule is null) or changes one.
export function ScheduleForm({ schedule, onSave, onCancel }: { schedule: WorkSchedule | null; onSave(saved: WorkSchedule): void; onCancel(): void }) {
  const [work, setWork] = useState<ScheduleWork>(schedule?.work ?? 'burn');
  const [detail, setDetail] = useState(schedule?.detail ?? '');
  const [everyYears, setEveryYears] = useState(schedule?.everyYears ?? 1);
  const [startMonth, setStartMonth] = useState(schedule?.startMonth ?? SCHEDULE_WORK.burn.start);
  const [endMonth, setEndMonth] = useState(schedule?.endMonth ?? SCHEDULE_WORK.burn.end);
  const [lastDoneInput, setLastDoneInput] = useState(schedule?.lastDone ?? '');
  const valid = everyYears >= 1 && (work !== 'other' || detail.trim() !== '');

  const save = () => {
    if (!valid) return;
    const lastDone = lastDoneInput || null;
    onSave({
      id: schedule?.id ?? crypto.randomUUID(),
      work,
      detail: detail.trim() || null,
      everyYears: Math.round(everyYears),
      startMonth,
      endMonth,
      lastDone,
      // Correcting the last done date starts the count again from that date.
      handledSeason: schedule && schedule.lastDone === lastDone ? (schedule.handledSeason ?? null) : null,
      createdAt: schedule?.createdAt ?? new Date().toISOString(),
      deletedAt: null,
    });
  };

  return (
    <div className="plot-form schedule-form">
      <div className="plot-fields">
        <select
          value={work}
          onChange={(e) => {
            const next = e.target.value as ScheduleWork;
            setWork(next);
            setStartMonth(SCHEDULE_WORK[next].start);
            setEndMonth(SCHEDULE_WORK[next].end);
          }}
          aria-label="What needs doing"
        >
          {WORKS.map((w) => (
            <option key={w} value={w}>
              {SCHEDULE_WORK[w].label}
            </option>
          ))}
        </select>
        <select value={CADENCES.includes(everyYears) ? everyYears : 'custom'} onChange={(e) => setEveryYears(e.target.value === 'custom' ? 4 : Number(e.target.value))} aria-label="How often">
          {CADENCES.map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'Every year' : `Every ${n} years`}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>
      {!CADENCES.includes(everyYears) && (
        <label className="schedule-inline">
          <span>Every</span>
          <input type="number" min={1} max={50} value={everyYears || ''} onChange={(e) => setEveryYears(Number(e.target.value))} aria-label="Years between" />
          <span>years</span>
        </label>
      )}
      {(work === 'plant' || work === 'other') && (
        <input
          type="text"
          placeholder={work === 'plant' ? 'What to plant (optional)' : 'What needs doing'}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          aria-label={work === 'plant' ? 'What to plant' : 'Name of the work'}
        />
      )}
      <label className="schedule-inline">
        <span>In</span>
        <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))} aria-label="From month">
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <span>to</span>
        <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))} aria-label="To month">
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="schedule-last">
        <span className="muted">Last done (optional)</span>
        <input type="date" max={todayDate()} value={lastDoneInput} onChange={(e) => setLastDoneInput(e.target.value)} />
      </label>
      <div className="plot-form-actions">
        <button className="primary" disabled={!valid} onClick={save}>
          Save schedule
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
