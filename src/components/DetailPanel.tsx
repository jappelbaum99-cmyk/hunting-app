import { useState, type ReactNode } from 'react';

import { AREA_TYPES, MARKER_TYPES, WIND_MARKER_TYPES } from '@/lib/featureTypes';
import { acresOf, formatAcres, formatLatLng } from '@/lib/geo';
import {
  COMPASS_POINTS,
  type AreaType,
  type CompassPoint,
  type MapArea,
  type MapMarker,
  type MarkerType,
  type Property,
} from '@/types/models';

interface Common {
  propertyName: string | null;
  onZoom(): void;
  onDelete(): void;
  onClose(): void;
}

type DetailPanelProps =
  | ({ kind: 'property'; record: Property; onChange(p: Property): void } & Common)
  | ({ kind: 'area'; record: MapArea; onChange(a: MapArea): void } & Common)
  | ({ kind: 'marker'; record: MapMarker; onChange(m: MapMarker): void } & Common);

export function DetailPanel(props: DetailPanelProps) {
  const { kind, propertyName, onZoom, onDelete, onClose } = props;
  const heading = kind === 'property' ? 'Property' : kind === 'area' ? AREA_TYPES[props.record.type].label : MARKER_TYPES[props.record.type].label;

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <h2>{heading}</h2>
        <button className="icon" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </header>

      <div className="detail-body">
        {props.kind === 'property' && <PropertyFields record={props.record} onChange={props.onChange} />}
        {props.kind === 'area' && <AreaFields record={props.record} onChange={props.onChange} />}
        {props.kind === 'marker' && <MarkerFields record={props.record} onChange={props.onChange} />}

        {kind !== 'property' && (
          <Field label="Property">
            <span className="muted">{propertyName ?? 'Not inside a saved property'}</span>
          </Field>
        )}
      </div>

      <footer className="detail-footer">
        <button onClick={onZoom}>Zoom to</button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(`Delete "${props.record.name}"?`)) onDelete();
          }}
        >
          Delete
        </button>
      </footer>
    </aside>
  );
}

function PropertyFields({ record, onChange }: { record: Property; onChange(p: Property): void }) {
  return (
    <>
      <TextField label="Name" value={record.name} onChange={(name) => onChange({ ...record, name })} />
      <TextField label="Owner" value={record.owner ?? ''} onChange={(owner) => onChange({ ...record, owner: owner || null })} />
      <Field label="Size">
        <span>{formatAcres(acresOf(record.boundary))}</span>
      </Field>
      <NotesField value={record.notes} onChange={(notes) => onChange({ ...record, notes })} />
    </>
  );
}

function AreaFields({ record, onChange }: { record: MapArea; onChange(a: MapArea): void }) {
  return (
    <>
      <Field label="Type">
        <select value={record.type} onChange={(e) => onChange({ ...record, type: e.target.value as AreaType })}>
          {(Object.keys(AREA_TYPES) as AreaType[]).map((t) => (
            <option key={t} value={t}>
              {AREA_TYPES[t].label}
            </option>
          ))}
        </select>
      </Field>
      <TextField label="Name" value={record.name} onChange={(name) => onChange({ ...record, name })} />
      <Field label="Size">
        <span>{formatAcres(acresOf(record.geometry))}</span>
      </Field>
      <NotesField value={record.notes} onChange={(notes) => onChange({ ...record, notes })} />
    </>
  );
}

function MarkerFields({ record, onChange }: { record: MapMarker; onChange(m: MapMarker): void }) {
  const [copied, setCopied] = useState(false);
  const coords = formatLatLng(record.lat, record.lng);
  const toggleWind = (point: CompassPoint) => {
    const has = record.goodWinds.includes(point);
    const goodWinds = has ? record.goodWinds.filter((w) => w !== point) : COMPASS_POINTS.filter((p) => p === point || record.goodWinds.includes(p));
    onChange({ ...record, goodWinds });
  };

  return (
    <>
      <Field label="Type">
        <select value={record.type} onChange={(e) => onChange({ ...record, type: e.target.value as MarkerType })}>
          {(Object.keys(MARKER_TYPES) as MarkerType[]).map((t) => (
            <option key={t} value={t}>
              {MARKER_TYPES[t].label}
            </option>
          ))}
        </select>
      </Field>
      <TextField label="Name" value={record.name} onChange={(name) => onChange({ ...record, name })} />

      {WIND_MARKER_TYPES.includes(record.type) && (
        <Field label="Good winds" hint="Winds that carry your scent away from where deer come in.">
          <div className="wind-picker">
            {COMPASS_POINTS.map((point) => (
              <button
                key={point}
                className={`wind wind-${point}${record.goodWinds.includes(point) ? ' active' : ''}`}
                onClick={() => toggleWind(point)}
              >
                {point}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Location" hint="Drag the pin on the map to move it.">
        <div className="coords">
          <code>{coords}</code>
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(coords)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => undefined);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Field>
      <NotesField value={record.notes} onChange={(notes) => onChange({ ...record, notes })} />
    </>
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

function TextField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return (
    <Field label={label}>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function NotesField({ value, onChange }: { value: string | null; onChange(value: string | null): void }) {
  return (
    <Field label="Notes">
      <textarea rows={5} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}
