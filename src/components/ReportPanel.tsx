import { useState, type CSSProperties, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';
import { compassPointOf } from '@/lib/standRating';
import { DEER_KINDS, fromDateTimeInputs, MAX_YARDS, whereLabel, HEADINGS, newSighting, sightingSummary, toDateInput, toTimeInput } from '@/lib/reports';
import type { DeerKind, HuntReport, MapMarker, Sighting } from '@/types/models';

interface ReportPanelProps {
  report: HuntReport;
  stands: MapMarker[];
  // 'loading' while weather is being fetched; an error message if it failed.
  weatherStatus: 'idle' | 'loading' | string;
  onChange(report: HuntReport): void;
  onFillWeather(): void;
  onPlaceSighting(sightingId: string): void;
  onDelete(): void;
  onZoom(): void;
  onClose(): void;
}

export function ReportPanel(props: ReportPanelProps) {
  const { report, stands, onChange } = props;
  const set = (patch: Partial<HuntReport>) => onChange({ ...report, ...patch });
  const setSighting = (id: string, patch: Partial<Sighting>) =>
    set({ sightings: report.sightings.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const date = toDateInput(report.start);
  const w = report.weather;

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <h2>Hunt report</h2>
        <button className="icon" onClick={props.onClose} title="Close (Esc)">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="detail-body">
        <Field label="Stand">
          <select value={report.standId ?? ''} onChange={(e) => set({ standId: e.target.value || null })}>
            <option value="">No stand (still hunting, walking…)</option>
            {stands.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="range-row">
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) =>
                set({
                  start: fromDateTimeInputs(e.target.value, toTimeInput(report.start)),
                  end: report.end ? fromDateTimeInputs(e.target.value, toTimeInput(report.end)) : null,
                })
              }
            />
          </Field>
        </div>
        <div className="range-row">
          <Field label="In">
            <input type="time" value={toTimeInput(report.start)} onChange={(e) => set({ start: fromDateTimeInputs(date, e.target.value) })} />
          </Field>
          <Field label="Out">
            <input
              type="time"
              value={report.end ? toTimeInput(report.end) : ''}
              onChange={(e) => set({ end: e.target.value ? fromDateTimeInputs(date, e.target.value) : null })}
            />
          </Field>
        </div>

        <Field label="Weather when you went in">
          {w ? (
            <div className="report-weather">
              <span>
                {compassPointOf(w.windFromDeg)} wind {w.windMph} mph (gusts {w.gustMph})
              </span>
              <span className="muted">
                {w.tempF}°F · {w.precipChance}% rain
                {w.pressureInHg ? ` · ${w.pressureInHg.toFixed(2)} inHg${w.pressureTrend ? `, ${w.pressureTrend}` : ''}` : ''}
              </span>
            </div>
          ) : (
            <p className="hint">Not filled in yet.</p>
          )}
          <button onClick={props.onFillWeather} disabled={props.weatherStatus === 'loading'}>
            {props.weatherStatus === 'loading' ? 'Getting weather…' : w ? 'Refresh weather' : 'Fill in weather'}
          </button>
          {props.weatherStatus !== 'idle' && props.weatherStatus !== 'loading' && <p className="hint warn">{props.weatherStatus}</p>}
        </Field>

        <Field label={`Seen · ${sightingSummary(report)}`}>
          <ul className="sightings">
            {report.sightings.map((s) => (
              <SightingCard
                key={s.id}
                sighting={s}
                onChange={(patch) => setSighting(s.id, patch)}
                onPlace={() => props.onPlaceSighting(s.id)}
                onRemove={() => set({ sightings: report.sightings.filter((x) => x.id !== s.id) })}
              />
            ))}
          </ul>
          <button
            className="primary"
            onClick={() => set({ sightings: [...report.sightings, newSighting(new Date(Math.min(Date.now(), Date.parse(report.end ?? report.start) || Date.now())).toISOString())] })}
          >
            + Add deer
          </button>
        </Field>

        <Field label="Notes">
          <textarea rows={4} value={report.notes ?? ''} onChange={(e) => set({ notes: e.target.value || null })} />
        </Field>
        {report.source === 'phone' && <p className="hint">Logged on the phone{report.loggedBy ? ` by ${report.loggedBy}` : ''}.</p>}
      </div>

      <footer className="detail-footer">
        <button onClick={props.onZoom}>Zoom to</button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm('Delete this hunt report?')) props.onDelete();
          }}
        >
          Delete
        </button>
      </footer>
    </aside>
  );
}

function SightingCard(props: { sighting: Sighting; onChange(patch: Partial<Sighting>): void; onPlace(): void; onRemove(): void }) {
  // What's typed in the distance box, kept while editing so it can be cleared and retyped.
  const [yardsText, setYardsText] = useState<string | null>(null);
  const { sighting: s, onChange } = props;
  const date = toDateInput(s.time);
  return (
    <li className="sighting">
      <div className="sighting-top">
        <div className="kind-chips">
          {(Object.keys(DEER_KINDS) as DeerKind[]).map((kind) => (
            <button
              key={kind}
              className={s.kind === kind ? 'active' : ''}
              style={{ '--deer': DEER_KINDS[kind].color } as CSSProperties}
              onClick={() => onChange({ kind, ...(kind !== 'buck' ? { buckName: null, antlerPoints: null } : {}), ...(kind !== 'other' && s.kind === 'other' ? { notes: null } : {}) })}
            >
              {!DEER_KINDS[kind].deer && <Icon name={DEER_KINDS[kind].icon} size={14} />}
              {DEER_KINDS[kind].label}
            </button>
          ))}
        </div>
        <button className="icon" title="Remove" aria-label="Remove sighting" onClick={props.onRemove}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="range-row">
        <label className="count">
          <span className="field-label">How many</span>
          <span className="stepper">
            <button onClick={() => onChange({ count: Math.max(1, s.count - 1) })} aria-label="Fewer">
              <Icon name="minus" size={14} />
            </button>
            <strong>{s.count}</strong>
            <button onClick={() => onChange({ count: s.count + 1 })} aria-label="More">
              <Icon name="plus" size={14} />
            </button>
          </span>
        </label>
        <label>
          <span className="field-label">Time</span>
          <input type="time" value={toTimeInput(s.time)} onChange={(e) => onChange({ time: fromDateTimeInputs(date, e.target.value) })} />
        </label>
      </div>

      {s.kind === 'other' && (
        <label>
          <span className="field-label">What was it</span>
          <input type="text" placeholder="e.g. coyote" value={s.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value || null })} />
        </label>
      )}

      {s.kind === 'buck' && (
        <div className="range-row">
          <label>
            <span className="field-label">Which buck</span>
            <input type="text" placeholder="e.g. Big 8" value={s.buckName ?? ''} onChange={(e) => onChange({ buckName: e.target.value || null })} />
          </label>
          <label className="points">
            <span className="field-label">Points</span>
            <input
              type="number"
              min={0}
              value={s.antlerPoints ?? ''}
              onChange={(e) => onChange({ antlerPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </div>
      )}

      <div className="field-label">Heading</div>
      <div className="wind-picker heading-picker">
        {HEADINGS.map((h) => (
          <button
            key={h.point}
            className={`wind wind-${h.point}${s.headingDeg === h.deg ? ' active' : ''}`}
            onClick={() => onChange({ headingDeg: s.headingDeg === h.deg ? null : h.deg })}
            title={`Heading ${h.point}`}
          >
            {h.point}
          </button>
        ))}
        <span className="heading-center" title={s.headingDeg === null ? 'Not moving / unknown' : undefined}>
          {s.headingDeg === null ? (
            '•'
          ) : (
            <span style={{ display: 'inline-grid', transform: `rotate(${s.headingDeg}deg)` }}>
              <Icon name="arrow" size={18} />
            </span>
          )}
        </span>
      </div>

      <div className="field-label">Where they were from the stand</div>
      <div className="range-row from-stand">
        <label>
          <span className="field-label">Distance (yd)</span>
          <input
            type="number"
            min={1}
            max={MAX_YARDS}
            placeholder="e.g. 140"
            value={yardsText ?? (s.fromStand ? String(Math.round(s.fromStand.yards)) : '')}
            onChange={(e) => {
              setYardsText(e.target.value);
              const yards = Number(e.target.value);
              if (e.target.value === '' || !(yards >= 1)) return;
              onChange({ fromStand: { bearingDeg: s.fromStand?.bearingDeg ?? 0, yards: Math.min(MAX_YARDS, Math.round(yards)) }, lat: null, lng: null });
            }}
            onBlur={() => setYardsText(null)}
          />
        </label>
        <label>
          <span className="field-label">Direction</span>
          <select
            value={s.fromStand ? String(Math.round(s.fromStand.bearingDeg / 45) * 45 % 360) : ''}
            onChange={(e) =>
              onChange(
                e.target.value === ''
                  ? { fromStand: null }
                  : { fromStand: { bearingDeg: Number(e.target.value), yards: s.fromStand?.yards ?? 100 }, lat: null, lng: null },
              )
            }
          >
            <option value="">At the stand</option>
            {HEADINGS.map((h) => (
              <option key={h.point} value={h.deg}>
                {h.point}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sighting-where">
        <span className="muted">{s.lat !== null ? 'Placed on the map (overrides distance)' : whereLabel(s) ? `${whereLabel(s)} of the stand` : 'Shown at the stand'}</span>
        <button className="link" onClick={props.onPlace}>
          {s.lat !== null ? 'Move on map' : 'Place on map'}
        </button>
        {s.lat !== null && (
          <button className="link" onClick={() => onChange({ lat: null, lng: null })}>
            Back to stand
          </button>
        )}
      </div>
    </li>
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
