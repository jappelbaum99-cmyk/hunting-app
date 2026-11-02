import type { CSSProperties, ReactNode } from 'react';

import { compassPointOf } from '@/lib/standRating';
import { DEER_KINDS, fromDateTimeInputs, HEADINGS, newSighting, sightingSummary, toDateInput, toTimeInput } from '@/lib/reports';
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
          ✕
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

        <Field label={`Deer seen · ${sightingSummary(report)}`}>
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
              onClick={() => onChange({ kind, ...(kind !== 'buck' ? { buckName: null, antlerPoints: null } : {}) })}
            >
              {DEER_KINDS[kind].label}
            </button>
          ))}
        </div>
        <button className="icon" title="Remove" onClick={props.onRemove}>
          ✕
        </button>
      </div>

      <div className="range-row">
        <label className="count">
          <span className="field-label">How many</span>
          <span className="stepper">
            <button onClick={() => onChange({ count: Math.max(1, s.count - 1) })} aria-label="Fewer">
              −
            </button>
            <strong>{s.count}</strong>
            <button onClick={() => onChange({ count: s.count + 1 })} aria-label="More">
              +
            </button>
          </span>
        </label>
        <label>
          <span className="field-label">Time</span>
          <input type="time" value={toTimeInput(s.time)} onChange={(e) => onChange({ time: fromDateTimeInputs(date, e.target.value) })} />
        </label>
      </div>

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
          {s.headingDeg === null ? '•' : <span style={{ transform: `rotate(${s.headingDeg}deg)` }}>↑</span>}
        </span>
      </div>

      <div className="sighting-where">
        <span className="muted">{s.lat !== null ? 'Placed on the map' : 'Shown at the stand'}</span>
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
