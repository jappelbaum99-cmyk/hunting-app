import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { HARVEST_KIND_ORDER, HARVEST_KINDS, numberOrNull, speciesOf, WEAPONS } from '@/lib/harvests';
import { fromDateTimeInputs, sightingLabel, toDateInput, toTimeInput } from '@/lib/reports';
import type { Harvest, HarvestWeapon, Sighting } from '@/types/models';

// One deer or turkey taken, on a hunt report.
export function HarvestCard(props: { harvest: Harvest; sightings: Sighting[]; onChange(patch: Partial<Harvest>): void; onRemove(): void }) {
  const { harvest: h, onChange } = props;
  const species = speciesOf(h);
  const date = toDateInput(h.time);
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <li className="sighting harvest">
      <div className="sighting-top">
        <div className="kind-chips">
          {HARVEST_KIND_ORDER.map((kind) => (
            <button
              key={kind}
              className={h.kind === kind ? 'active' : ''}
              onClick={() =>
                onChange({
                  kind,
                  ...(kind !== 'buck' ? { points: null, spreadIn: null, buckName: null } : {}),
                  ...(HARVEST_KINDS[kind].species === 'deer' ? { beardIn: null, spurIn: null } : { points: null, spreadIn: null, buckName: null }),
                })
              }
            >
              {HARVEST_KINDS[kind].label}
            </button>
          ))}
        </div>
        <button
          className="icon"
          title="Remove"
          aria-label="Remove harvest"
          onClick={() => {
            if (window.confirm('Remove this harvest?')) props.onRemove();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="range-row">
        <label>
          <span className="field-label">Date</span>
          <input type="date" value={date} onChange={(e) => e.target.value && onChange({ time: fromDateTimeInputs(e.target.value, toTimeInput(h.time)) })} />
        </label>
        <label>
          <span className="field-label">Time</span>
          <input type="time" value={toTimeInput(h.time)} onChange={(e) => e.target.value && onChange({ time: fromDateTimeInputs(date, e.target.value) })} />
        </label>
      </div>

      <div className="range-row">
        <label>
          <span className="field-label">Hunter</span>
          <input type="text" value={h.hunter ?? ''} placeholder="Who took it" onChange={(e) => onChange({ hunter: e.target.value || null })} />
        </label>
        <label>
          <span className="field-label">Weapon</span>
          <select value={h.weapon ?? ''} onChange={(e) => onChange({ weapon: (e.target.value || null) as HarvestWeapon | null })}>
            <option value="">Not set</option>
            {WEAPONS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {props.sightings.length > 0 && (
        <label>
          <span className="field-label">Which sighting it was</span>
          <select
            value={h.sightingId ?? ''}
            onChange={(e) => {
              const s = props.sightings.find((x) => x.id === e.target.value) ?? null;
              if (!s) return onChange({ sightingId: null });
              onChange({
                sightingId: s.id,
                time: s.time,
                fromStand: s.fromStand ?? null,
                ...(h.kind === 'buck' && s.kind === 'buck' ? { points: h.points ?? s.antlerPoints, buckName: h.buckName ?? s.buckName } : {}),
              });
            }}
          >
            <option value="">Not one of them</option>
            {props.sightings.map((s) => (
              <option key={s.id} value={s.id}>
                {clock(s.time)} · {sightingLabel(s)}
                {s.buckName ? ` (${s.buckName})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {h.kind === 'buck' && (
        <div className="range-row">
          <NumberBox label="Points" value={h.points} step={1} onChange={(points) => onChange({ points: points === null ? null : Math.round(points) })} />
          <NumberBox label="Spread (in)" value={h.spreadIn} step={0.25} onChange={(spreadIn) => onChange({ spreadIn })} />
        </div>
      )}
      {h.kind === 'buck' && (
        <label>
          <span className="field-label">Which buck</span>
          <input type="text" value={h.buckName ?? ''} placeholder="Name, if he had one" onChange={(e) => onChange({ buckName: e.target.value || null })} />
        </label>
      )}
      {species === 'turkey' && (
        <div className="range-row">
          <NumberBox label="Beard (in)" value={h.beardIn} step={0.25} onChange={(beardIn) => onChange({ beardIn })} />
          <NumberBox label="Spurs (in)" value={h.spurIn} step={0.125} onChange={(spurIn) => onChange({ spurIn })} />
        </div>
      )}
      <div className="range-row">
        <NumberBox label="Weight (lb)" value={h.weightLb} step={1} onChange={(weightLb) => onChange({ weightLb })} />
        <label>
          <span className="field-label">Check-in number</span>
          <input type="text" value={h.checkNumber ?? ''} placeholder="Telecheck" onChange={(e) => onChange({ checkNumber: e.target.value || null })} />
        </label>
      </div>
      <label>
        <span className="field-label">Note</span>
        <input type="text" value={h.notes ?? ''} placeholder="e.g. tracked 80 yd" onChange={(e) => onChange({ notes: e.target.value || null })} />
      </label>
    </li>
  );
}

// A number box that keeps what's typed (e.g. "10.") until it's a number.
function NumberBox(props: { label: string; value: number | null; step: number; onChange(next: number | null): void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label>
      <span className="field-label">{props.label}</span>
      <input
        type="number"
        min={0}
        step={props.step}
        inputMode="decimal"
        value={text ?? (props.value === null ? '' : String(props.value))}
        onChange={(e) => {
          setText(e.target.value);
          const n = numberOrNull(e.target.value);
          if (e.target.value === '' || n !== null) props.onChange(n);
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}
