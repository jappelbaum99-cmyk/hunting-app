import { useState } from 'react';

import { PlanCard, STATUS_ORDER } from '@/components/PlanEditor';
import { PLAN_KINDS, placeOfPlan, type PlanPlace } from '@/lib/plans';
import type { MapArea, Plan, PlanKind, Section } from '@/types/models';

interface AreaPlansPanelProps {
  sections: Section[];
  areas: MapArea[];
  plans: Plan[];
  onAddPlan(place: PlanPlace, kind: PlanKind): void;
  // Opens the plan in the detail panel, with its place selected on the map.
  onOpenPlan(plan: Plan): void;
  onClose(): void;
}

const placeKey = (p: PlanPlace) => `${p.kind}:${p.id}`;

// Land Management › Area Plans: every burn, timber, habitat or other plan for
// the sections and areas, and a quick way to start one for any of them.
export function AreaPlansPanel(props: AreaPlansPanelProps) {
  const places: (PlanPlace & { name: string })[] = [
    ...props.sections.map((s) => ({ kind: 'section' as const, id: s.id, name: s.name || 'Unnamed section' })),
    ...props.areas.map((a) => ({ kind: 'area' as const, id: a.id, name: a.name || 'Unnamed area' })),
  ];
  const nameOf = new Map(places.map((p) => [placeKey(p), p.name]));
  const [placeChoice, setPlaceChoice] = useState('');
  const [showDone, setShowDone] = useState(false);

  const live = props.plans.filter((p) => !p.deletedAt && placeOfPlan(p) && nameOf.has(placeKey(placeOfPlan(p) as PlanPlace)));
  const doneCount = live.filter((p) => p.status === 'done').length;
  const shown = live
    .filter((p) => showDone || p.status !== 'done')
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') ||
        a.title.localeCompare(b.title),
    );
  const chosen = places.find((p) => placeKey(p) === placeChoice) ?? null;

  return (
    <div className="forecast land-panel">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>Area Plans</h2>
      </div>

      <section className="sidebar-section">
        <h3 className="area-plans-heading">Start a plan</h3>
        {places.length === 0 ? (
          <p className="hint">Draw a section or an area on the map first, then plan its work here.</p>
        ) : (
          <div className="area-plans-new">
            <select value={placeChoice} onChange={(e) => setPlaceChoice(e.target.value)} aria-label="Section or area">
              <option value="">Pick a section or area…</option>
              {(['section', 'area'] as const).map((kind) => {
                const group = places.filter((p) => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
                return group.length === 0 ? null : (
                  <optgroup key={kind} label={kind === 'section' ? 'Sections' : 'Areas'}>
                    {group.map((p) => (
                      <option key={p.id} value={placeKey(p)}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <div className="add-plan">
              {(Object.keys(PLAN_KINDS) as PlanKind[]).map((kind) => (
                <button key={kind} disabled={!chosen} onClick={() => chosen && props.onAddPlan(chosen, kind)}>
                  + {PLAN_KINDS[kind].label.replace(' plan', '')}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="sidebar-section">
        <h3 className="area-plans-heading">
          Plans <span className="muted">· {live.length - doneCount} open</span>
        </h3>
        {shown.length === 0 ? (
          <p className="hint">{live.length ? 'Every plan is done.' : 'No plans yet. Pick a section or area above and start one.'}</p>
        ) : (
          <ul className="plan-list">
            {shown.map((plan) => (
              <li key={plan.id}>
                <PlanCard plan={plan} place={nameOf.get(placeKey(placeOfPlan(plan) as PlanPlace))} onOpen={() => props.onOpenPlan(plan)} />
              </li>
            ))}
          </ul>
        )}
        {doneCount > 0 && (
          <button className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide done plans' : `Show ${doneCount} done`}
          </button>
        )}
        <p className="hint">Plans with a date also show on the Action Board under Coming up.</p>
      </section>
    </div>
  );
}
