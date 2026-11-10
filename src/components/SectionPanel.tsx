import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { PlansField } from '@/components/PlanEditor';
import { SchedulesField } from '@/components/SchedulesField';

import { acresOf, formatAcres } from '@/lib/geo';
import type { Plan, PlanKind, Section } from '@/types/models';

interface SectionPanelProps {
  section: Section;
  plans: Plan[];
  propertyName: string | null;
  onChange(section: Section): void;
  onDelete(): void;
  onZoom(): void;
  // Reshape the section by dragging its corners.
  onEditShape?: () => void;
  onClose(): void;
  onAddPlan(kind: PlanKind): void;
  // A plan opens in its own panel (PlanEditor).
  onOpenPlan(id: string): void;
}

export function SectionPanel(props: SectionPanelProps) {
  const { section, plans, onChange } = props;

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <h2>Section</h2>
        <button className="icon" onClick={props.onClose} title="Close (Esc)">
          <Icon name="close" size={16} />
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

        <PlansField plans={plans} placeLabel="section" onAddPlan={props.onAddPlan} onOpenPlan={props.onOpenPlan} />

        <SchedulesField key={section.id} schedules={section.schedules} onChange={(schedules) => onChange({ ...section, schedules })} />

        <Field label="Notes">
          <textarea rows={4} value={section.notes ?? ''} onChange={(e) => onChange({ ...section, notes: e.target.value || null })} />
        </Field>
      </div>

      <footer className="detail-footer">
        <button onClick={props.onZoom}>Zoom to</button>
        {props.onEditShape && (
          <button onClick={props.onEditShape} title="Drag corners to reshape it">
            Edit shape
          </button>
        )}
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


function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}
