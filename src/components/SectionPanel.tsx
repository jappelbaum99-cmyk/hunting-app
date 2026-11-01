import { useState, type ReactNode } from 'react';

import { acresOf, formatAcres } from '@/lib/geo';
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
  type Section,
  type TimberDetails,
  type TimberPractice,
} from '@/types/models';

interface SectionPanelProps {
  section: Section;
  plans: Plan[];
  propertyName: string | null;
  forecast: Forecast | null;
  openPlanId: string | null;
  onChange(section: Section): void;
  onDelete(): void;
  onZoom(): void;
  onClose(): void;
  onAddPlan(kind: PlanKind): void;
  onOpenPlan(id: string | null): void;
  onChangePlan(plan: Plan): void;
  onDeletePlan(id: string): void;
}

const STATUS_ORDER: PlanStatus[] = ['idea', 'planned', 'in_progress', 'done'];

function formatDate(date: string | null): string {
  if (!date) return '';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SectionPanel(props: SectionPanelProps) {
  const plan = props.plans.find((p) => p.id === props.openPlanId);
  if (plan) return <PlanEditor {...props} plan={plan} />;
  const { section, plans, onChange } = props;
  const sorted = [...plans].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <h2>Section</h2>
        <button className="icon" onClick={props.onClose} title="Close (Esc)">
          ✕
        </button>
      </header>

      <div className="detail-body">
        <Field label="Name">
          <input type="text" value={section.name} onChange={(e) => onChange({ ...section, name: e.target.value })} />
        </Field>
        <Field label="Size">
          <span>{formatAcres(acresOf(section.geometry))}</span>
          {props.propertyName && <span className="muted"> · on {props.propertyName}</span>}
        </Field>

        <Field label="Plans">
          {sorted.length === 0 ? (
            <p className="hint">No plans yet. Add a burn, timber or habitat plan for this section.</p>
          ) : (
            <ul className="plan-list">
              {sorted.map((p) => {
                const done = p.tasks.filter((t) => t.done).length;
                return (
                  <li key={p.id}>
                    <button className="plan-card" onClick={() => props.onOpenPlan(p.id)}>
                      <span className="plan-icon" aria-hidden>
                        {PLAN_KINDS[p.kind].icon}
                      </span>
                      <span className="plan-text">
                        <span className="row-title">{p.title}</span>
                        <span className="row-detail">
                          {[formatDate(p.targetDate), p.tasks.length ? `${done}/${p.tasks.length} done` : ''].filter(Boolean).join(' · ') ||
                            PLAN_KINDS[p.kind].label}
                        </span>
                      </span>
                      <span className={`status-pill status-${p.status}`}>{PLAN_STATUSES[p.status]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="add-plan">
            {(Object.keys(PLAN_KINDS) as PlanKind[]).map((kind) => (
              <button key={kind} onClick={() => props.onAddPlan(kind)}>
                + {PLAN_KINDS[kind].label.replace(' plan', '')}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes">
          <textarea rows={4} value={section.notes ?? ''} onChange={(e) => onChange({ ...section, notes: e.target.value || null })} />
        </Field>
      </div>

      <footer className="detail-footer">
        <button onClick={props.onZoom}>Zoom to</button>
        <button
          className="danger"
          onClick={() => {
            const extra = plans.length ? ` and its ${plans.length} plan${plans.length === 1 ? '' : 's'}` : '';
            if (window.confirm(`Delete "${section.name}"${extra}?`)) props.onDelete();
          }}
        >
          Delete
        </button>
      </footer>
    </aside>
  );
}

function PlanEditor(props: SectionPanelProps & { plan: Plan }) {
  const { plan, section, onChangePlan } = props;
  const set = (patch: Partial<Plan>) => onChangePlan({ ...plan, ...patch });

  return (
    <aside className="detail-panel">
      <header className="detail-header plan-header">
        <button className="back" onClick={() => props.onOpenPlan(null)}>
          ‹ {section.name}
        </button>
        <button className="icon" onClick={props.onClose} title="Close (Esc)">
          ✕
        </button>
      </header>

      <div className="detail-body">
        <div className="plan-title">
          <span className="plan-icon" aria-hidden>
            {PLAN_KINDS[plan.kind].icon}
          </span>
          <input
            type="text"
            value={plan.title}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Plan name"
          />
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
        <button onClick={props.onZoom}>Zoom to section</button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(`Delete "${plan.title}"?`)) {
              props.onDeletePlan(plan.id);
              props.onOpenPlan(null);
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
              ✕
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
