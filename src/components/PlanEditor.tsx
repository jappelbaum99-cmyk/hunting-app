// Plans for a section or an area (burn, timber, habitat...): the list on the
// place's panel, and the editor a plan opens in.
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

import { burnProblem, burnWindows, PLAN_KINDS, PLAN_STATUSES, TIMBER_PRACTICES } from '@/lib/plans';
import { compassPointOf } from '@/lib/standRating';
import type { Forecast } from '@/lib/weather';
import {
  COMPASS_POINTS,
  type BurnDetails,
  type CompassPoint,
  type Plan,
  type PlanKind,
  type PlanStatus,
  type TimberDetails,
  type TimberPractice,
} from '@/types/models';

export const STATUS_ORDER: PlanStatus[] = ['idea', 'planned', 'in_progress', 'done'];

export function formatPlanDate(date: string | null): string {
  if (!date) return '';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// One plan as a card: icon, name, date and checklist progress, and its status.
export function PlanCard({ plan, place, onOpen }: { plan: Plan; place?: string; onOpen(): void }) {
  const done = plan.tasks.filter((t) => t.done).length;
  const detail = [place, formatPlanDate(plan.targetDate), plan.tasks.length ? `${done}/${plan.tasks.length} done` : ''].filter(Boolean).join(' · ') || PLAN_KINDS[plan.kind].label;
  return (
    <button className="plan-card" onClick={onOpen}>
      <span className="plan-icon" aria-hidden>
        <Icon name={PLAN_KINDS[plan.kind].icon} size={22} />
      </span>
      <span className="plan-text">
        <span className="row-title">{plan.title}</span>
        <span className="row-detail">{detail}</span>
      </span>
      <span className={`status-pill status-${plan.status}`}>{PLAN_STATUSES[plan.status]}</span>
    </button>
  );
}

// A place's plans and the buttons that start a new one.
export function PlansField({ plans, placeLabel, onAddPlan, onOpenPlan }: { plans: Plan[]; placeLabel: string; onAddPlan(kind: PlanKind): void; onOpenPlan(id: string): void }) {
  const sorted = [...plans].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return (
    <Field label="Plans">
      {sorted.length === 0 ? (
        <p className="hint">No plans yet. Add a burn, timber or habitat plan for this {placeLabel}.</p>
      ) : (
        <ul className="plan-list">
          {sorted.map((p) => (
            <li key={p.id}>
              <PlanCard plan={p} onOpen={() => onOpenPlan(p.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="add-plan">
        {(Object.keys(PLAN_KINDS) as PlanKind[]).map((kind) => (
          <button key={kind} onClick={() => onAddPlan(kind)}>
            + {PLAN_KINDS[kind].label.replace(' plan', '')}
          </button>
        ))}
      </div>
    </Field>
  );
}

interface PlanEditorProps {
  plan: Plan;
  // The section or area it's for, e.g. "North Ridge".
  placeName: string;
  // "section" or "area", for the zoom button.
  placeLabel: string;
  forecast: Forecast | null;
  onChange(plan: Plan): void;
  onDelete(id: string): void;
  // Back to the place's panel.
  onBack(): void;
  onClose(): void;
  onZoom(): void;
}

export function PlanEditor(props: PlanEditorProps) {
  const { plan } = props;
  const set = (patch: Partial<Plan>) => props.onChange({ ...plan, ...patch });

  return (
    <aside className="detail-panel">
      <header className="detail-header plan-header">
        <button className="back" onClick={props.onBack}>
          ‹ {props.placeName}
        </button>
        <button className="icon" onClick={props.onClose} title="Close (Esc)">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="detail-body">
        <div className="plan-title">
          <span className="plan-icon" aria-hidden>
            <Icon name={PLAN_KINDS[plan.kind].icon} size={22} />
          </span>
          <input type="text" value={plan.title} onChange={(e) => set({ title: e.target.value })} aria-label="Plan name" />
        </div>

        <Field label="Status">
          <div className="status-chips">
            {STATUS_ORDER.map((s) => (
              <button key={s} className={plan.status === s ? `active status-${s}` : ''} onClick={() => set({ status: s })}>
                {PLAN_STATUSES[s]}
              </button>
            ))}
          </div>
        </Field>

        <Field label={plan.kind === 'burn' ? 'Planned burn date' : 'Target date'}>
          <input type="date" value={plan.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || null })} />
        </Field>

        {plan.burn && <BurnFields burn={plan.burn} forecast={props.forecast} onChange={(burn) => set({ burn })} />}
        {plan.timber && <TimberFields timber={plan.timber} onChange={(timber) => set({ timber })} />}

        <Checklist plan={plan} onChange={(tasks) => set({ tasks })} />

        <Field label="Notes">
          <textarea rows={4} value={plan.notes ?? ''} onChange={(e) => set({ notes: e.target.value || null })} />
        </Field>
      </div>

      <footer className="detail-footer">
        <button onClick={props.onZoom}>Zoom to {props.placeLabel}</button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(`Delete "${plan.title}"?`)) {
              props.onDelete(plan.id);
              props.onBack();
            }
          }}
        >
          Delete plan
        </button>
      </footer>
    </aside>
  );
}

function BurnFields({ burn, forecast, onChange }: { burn: BurnDetails; forecast: Forecast | null; onChange(b: BurnDetails): void }) {
  const set = (patch: Partial<BurnDetails>) => onChange({ ...burn, ...patch });
  const toggleWind = (point: CompassPoint) => {
    const goodWinds = burn.goodWinds.includes(point)
      ? burn.goodWinds.filter((w) => w !== point)
      : COMPASS_POINTS.filter((p) => p === point || burn.goodWinds.includes(p));
    set({ goodWinds });
  };

  return (
    <>
      <Field label="Burn season">
        <div className="range-row">
          <input type="date" value={burn.windowStart ?? ''} onChange={(e) => set({ windowStart: e.target.value || null })} aria-label="Season starts" />
          <span className="muted">to</span>
          <input type="date" value={burn.windowEnd ?? ''} onChange={(e) => set({ windowEnd: e.target.value || null })} aria-label="Season ends" />
        </div>
      </Field>

      <Field label="Safe wind directions" hint="Winds that push fire and smoke away from roads, houses and timber you want to keep. None picked = any.">
        <div className="wind-picker">
          {COMPASS_POINTS.map((point) => (
            <button
              key={point}
              className={`wind wind-${point}${burn.goodWinds.includes(point) ? ' active' : ''}`}
              onClick={() => toggleWind(point)}
            >
              {point}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Wind speed (mph)">
        <NumberRange low={burn.minWindMph} high={burn.maxWindMph} onChange={(minWindMph, maxWindMph) => set({ minWindMph, maxWindMph })} />
      </Field>
      <Field label="Humidity (%)" hint="Starting points are common prescribed-fire limits. Follow your own burn plan and local rules.">
        <NumberRange low={burn.minHumidity} high={burn.maxHumidity} onChange={(minHumidity, maxHumidity) => set({ minHumidity, maxHumidity })} />
      </Field>

      <BurnDays burn={burn} forecast={forecast} />
    </>
  );
}

// Hours in the forecast that meet the plan, grouped into windows.
function BurnDays({ burn, forecast }: { burn: BurnDetails; forecast: Forecast | null }) {
  if (!forecast) return <Field label="Burn days in the forecast"><p className="hint">The forecast isn't loaded (it needs internet).</p></Field>;
  const windows = burnWindows(forecast, burn);
  const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric' });

  let body: ReactNode;
  if (windows.length === 0) {
    // Say what's most often in the way during daylight.
    const counts = new Map<string, number>();
    for (const hour of forecast.hours) {
      const day = forecast.days.find((d) => hour.time >= d.sunrise && hour.time < d.sunset);
      const problem = day && hour.time > Date.now() ? burnProblem(hour, burn) : null;
      if (problem) counts.set(problem, (counts.get(problem) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    body = <p className="hint">No good burn hours in the next 4 days{top ? `: mostly ${top}` : ''}.</p>;
  } else {
    body = (
      <ul className="burn-windows">
        {windows.map((w) => {
          const range = (values: number[]) => {
            const [lo, hi] = [Math.round(Math.min(...values)), Math.round(Math.max(...values))];
            return lo === hi ? `${lo}` : `${lo}–${hi}`;
          };
          return (
            <li key={w.start}>
              <strong>
                {new Date(w.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, {clock(w.start)}–{clock(w.end)}
              </strong>
              <span className="muted">
                {compassPointOf(w.hours[0].windFromDeg)} {range(w.hours.map((h) => h.windMph))} mph · humidity{' '}
                {range(w.hours.map((h) => h.humidity))}%
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return <Field label="Burn days in the forecast">{body}</Field>;
}

function TimberFields({ timber, onChange }: { timber: TimberDetails; onChange(t: TimberDetails): void }) {
  const set = (patch: Partial<TimberDetails>) => onChange({ ...timber, ...patch });
  const money = (value: string) => (value === '' ? null : Math.max(0, Number(value)));
  return (
    <>
      <Field label="Practice">
        <select value={timber.practice} onChange={(e) => set({ practice: e.target.value as TimberPractice })}>
          {(Object.keys(TIMBER_PRACTICES) as TimberPractice[]).map((p) => (
            <option key={p} value={p}>
              {TIMBER_PRACTICES[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contractor / forester">
        <input type="text" value={timber.contractor ?? ''} onChange={(e) => set({ contractor: e.target.value || null })} />
      </Field>
      <div className="range-row">
        <Field label="Est. cost ($)">
          <input type="number" min={0} value={timber.estimatedCost ?? ''} onChange={(e) => set({ estimatedCost: money(e.target.value) })} />
        </Field>
        <Field label="Est. income ($)">
          <input type="number" min={0} value={timber.estimatedIncome ?? ''} onChange={(e) => set({ estimatedIncome: money(e.target.value) })} />
        </Field>
      </div>
    </>
  );
}

function Checklist({ plan, onChange }: { plan: Plan; onChange(tasks: Plan['tasks']): void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...plan.tasks, { id: crypto.randomUUID(), text, done: false }]);
    setDraft('');
  };
  const done = plan.tasks.filter((t) => t.done).length;
  return (
    <Field label={plan.tasks.length ? `Checklist · ${done} of ${plan.tasks.length} done` : 'Checklist'}>
      <ul className="checklist">
        {plan.tasks.map((task) => (
          <li key={task.id} className={task.done ? 'done' : ''}>
            <label className="check">
              <input
                type="checkbox"
                checked={task.done}
                onChange={(e) => onChange(plan.tasks.map((t) => (t.id === task.id ? { ...t, done: e.target.checked } : t)))}
              />
              <span>{task.text}</span>
            </label>
            <button className="icon" title="Remove" onClick={() => onChange(plan.tasks.filter((t) => t.id !== task.id))}>
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        placeholder="Add a step and press Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
        }}
      />
    </Field>
  );
}

function NumberRange({ low, high, onChange }: { low: number; high: number; onChange(low: number, high: number): void }) {
  return (
    <div className="range-row">
      <input type="number" min={0} value={low} onChange={(e) => onChange(Number(e.target.value), high)} aria-label="Minimum" />
      <span className="muted">to</span>
      <input type="number" min={0} value={high} onChange={(e) => onChange(low, Number(e.target.value))} aria-label="Maximum" />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
