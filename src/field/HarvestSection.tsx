import { useState } from 'react';

import { addHarvest, HARVEST_KIND_ORDER, HARVEST_KINDS, harvestDetail, harvestsOf, harvestTitle, newHarvest, numberOrNull, speciesOf, WEAPONS, withHarvest } from '@/lib/harvests';
import { sightingLabel } from '@/lib/reports';
import type { Harvest, HuntReport } from '@/types/models';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// "We got one" on the phone's hunt screen: the deer or turkeys taken on this hunt.
export function HarvestSection(props: { report: HuntReport; onChange(r: HuntReport): void }) {
  const { report } = props;
  const harvests = harvestsOf(report);
  // The harvest being filled in (a copy until Save).
  const [draft, setDraft] = useState<Harvest | null>(null);
  const isNew = draft !== null && !harvests.some((h) => h.id === draft.id);

  const save = () => {
    if (!draft) return;
    props.onChange(isNew ? addHarvest(report, draft) : withHarvest(report, draft.id, draft));
    setDraft(null);
  };

  if (draft) {
    return (
      <div className="harvest-form">
        <h3>{isNew ? 'We got one' : 'Change harvest'}</h3>
        <div className="kind-row harvest-kinds">
          {HARVEST_KIND_ORDER.map((k) => (
            <button
              key={k}
              className={draft.kind === k ? 'active' : ''}
              onClick={() =>
                setDraft({
                  ...draft,
                  kind: k,
                  ...(k !== 'buck' ? { points: null, spreadIn: null, buckName: null } : {}),
                  ...(HARVEST_KINDS[k].species === 'deer' ? { beardIn: null, spurIn: null } : {}),
                })
              }
            >
              {HARVEST_KINDS[k].label}
            </button>
          ))}
        </div>

        {report.sightings.length > 0 && (
          <label className="harvest-field">
            <span>Which sighting it was</span>
            <select
              value={draft.sightingId ?? ''}
              onChange={(e) => {
                const s = report.sightings.find((x) => x.id === e.target.value) ?? null;
                setDraft(
                  s
                    ? {
                        ...draft,
                        sightingId: s.id,
                        time: s.time,
                        fromStand: s.fromStand ?? null,
                        ...(draft.kind === 'buck' && s.kind === 'buck' ? { points: draft.points ?? s.antlerPoints, buckName: draft.buckName ?? s.buckName } : {}),
                      }
                    : { ...draft, sightingId: null },
                );
              }}
            >
              <option value="">Not one of them</option>
              {report.sightings.map((s) => (
                <option key={s.id} value={s.id}>
                  {clock(s.time)} · {sightingLabel(s)}
                  {s.buckName ? ` (${s.buckName})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="behavior-row" role="group" aria-label="Weapon">
          {WEAPONS.map((w) => (
            <button key={w.id} className={draft.weapon === w.id ? 'active' : ''} aria-pressed={draft.weapon === w.id} onClick={() => setDraft({ ...draft, weapon: draft.weapon === w.id ? null : w.id })}>
              {w.label}
            </button>
          ))}
        </div>

        <div className="harvest-grid">
          <label className="harvest-field">
            <span>Time</span>
            <input
              type="time"
              value={new Date(draft.time).toTimeString().slice(0, 5)}
              onChange={(e) => {
                if (!e.target.value) return;
                const [hh, mm] = e.target.value.split(':').map(Number);
                const d = new Date(draft.time);
                d.setHours(hh, mm, 0, 0);
                setDraft({ ...draft, time: d.toISOString() });
              }}
            />
          </label>
          <label className="harvest-field">
            <span>Hunter</span>
            <input type="text" value={draft.hunter ?? ''} placeholder="Who took it" onChange={(e) => setDraft({ ...draft, hunter: e.target.value || null })} />
          </label>
          {draft.kind === 'buck' && <NumberField label="Points" value={draft.points} onChange={(points) => setDraft({ ...draft, points: points === null ? null : Math.round(points) })} />}
          {draft.kind === 'buck' && <NumberField label="Spread (in)" value={draft.spreadIn} onChange={(spreadIn) => setDraft({ ...draft, spreadIn })} />}
          {speciesOf(draft) === 'turkey' && <NumberField label="Beard (in)" value={draft.beardIn} onChange={(beardIn) => setDraft({ ...draft, beardIn })} />}
          {speciesOf(draft) === 'turkey' && <NumberField label="Spurs (in)" value={draft.spurIn} onChange={(spurIn) => setDraft({ ...draft, spurIn })} />}
          <NumberField label="Weight (lb)" value={draft.weightLb} onChange={(weightLb) => setDraft({ ...draft, weightLb })} />
          <label className="harvest-field">
            <span>Check-in number</span>
            <input type="text" value={draft.checkNumber ?? ''} placeholder="Telecheck" onChange={(e) => setDraft({ ...draft, checkNumber: e.target.value || null })} />
          </label>
        </div>
        {draft.kind === 'buck' && <input type="text" placeholder="Which buck? e.g. Big 8" value={draft.buckName ?? ''} onChange={(e) => setDraft({ ...draft, buckName: e.target.value || null })} />}
        <input type="text" placeholder="Note (optional), e.g. tracked 80 yd" value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} />

        <button className="big-button" onClick={save}>
          Save {harvestTitle(draft).toLowerCase()}
        </button>
        <div className="edit-actions">
          <button className="end-button" onClick={() => setDraft(null)}>
            Cancel
          </button>
          {!isNew && (
            <button
              className="end-button danger"
              onClick={() => {
                if (!window.confirm('Remove this harvest?')) return;
                props.onChange(withHarvest(report, draft.id, { deletedAt: new Date().toISOString() }));
                setDraft(null);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="harvest-section">
      {harvests.length > 0 && (
        <ul className="field-list">
          {harvests.map((h) => (
            <li key={h.id}>
              <button className="sighting-row" onClick={() => setDraft(h)}>
                <span className="harvest-mark" aria-hidden />
                <span className="sighting-text">
                  {harvestTitle(h)}
                  {harvestDetail(h) && <span className="sighting-comment">{harvestDetail(h)}</span>}
                </span>
                <span className="muted">{clock(h.time)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="end-button harvest-button"
        onClick={() => {
          // The latest sighting is most likely the one, so start from it.
          const last = report.sightings[report.sightings.length - 1] ?? null;
          setDraft(newHarvest(report, { sighting: last && (last.kind === 'buck' || last.kind === 'doe' || last.kind === 'turkey') ? last : null }));
        }}
      >
        We got one
      </button>
    </div>
  );
}

function NumberField(props: { label: string; value: number | null; onChange(next: number | null): void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="harvest-field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
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
