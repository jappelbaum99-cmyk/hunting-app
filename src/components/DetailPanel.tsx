import { useState, type ReactNode } from 'react';

import { MARKER_TYPES, WIND_MARKER_TYPES } from '@/lib/featureTypes';
import { acresOf, formatAcres, formatLatLng } from '@/lib/geo';
import { controlPointErrorsFeet } from '@/lib/georef';
import { COLOR_SWATCHES, type AreaTypeView } from '@/lib/styles';
import {
  COMPASS_POINTS,
  type AreaType,
  type CompassPoint,
  type MapArea,
  type MapImageOverlay,
  type MapMarker,
  type MarkerType,
  type Property,
} from '@/types/models';

interface Common {
  propertyName: string | null;
  // The color this item gets when it has none of its own (from Settings).
  defaultColor?: string;
  onZoom(): void;
  onDelete(): void;
  onClose(): void;
}

type DetailPanelProps =
  | ({ kind: 'property'; record: Property; onChange(p: Property): void; offlineField: ReactNode; onShare(): void } & Common)
  | ({ kind: 'area'; record: MapArea; onChange(a: MapArea): void; areaTypes: AreaTypeView[] } & Common)
  | ({ kind: 'marker'; record: MapMarker; onChange(m: MapMarker): void; onLogHunt?: () => void; history?: ReactNode } & Common)
  | ({ kind: 'overlay'; record: MapImageOverlay; onChange(o: MapImageOverlay): void; onRealign(): void } & Common);

function headingFor(props: DetailPanelProps): string {
  switch (props.kind) {
    case 'property':
      return 'Property';
    case 'area':
      return props.areaTypes.find((t) => t.id === props.record.type)?.label ?? 'Area';
    case 'marker':
      return MARKER_TYPES[props.record.type].label;
    case 'overlay':
      return 'Map image';
  }
}

export function DetailPanel(props: DetailPanelProps) {
  const { kind, propertyName, onZoom, onDelete, onClose } = props;
  const heading = headingFor(props);

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <h2>{heading}</h2>
        <button className="icon" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </header>

      <div className="detail-body">
        {props.kind === 'property' && (
          <>
            <PropertyFields record={props.record} onChange={props.onChange} />
            <ColorField
              label="Line color"
              value={props.record.color ?? null}
              fallback={props.defaultColor ?? '#ffd400'}
              onChange={(color) => props.onChange({ ...props.record, color })}
            />
            <Field label="Offline maps">{props.offlineField}</Field>
          </>
        )}
        {props.kind === 'area' && <AreaFields record={props.record} onChange={props.onChange} areaTypes={props.areaTypes} />}
        {props.kind === 'marker' && (
          <>
            <MarkerFields record={props.record} onChange={props.onChange} />
            {props.onLogHunt && (
              <button className="primary log-hunt" onClick={props.onLogHunt}>
                Log a hunt here
              </button>
            )}
            {props.history}
            <ColorField
              label="Color"
              value={props.record.color ?? null}
              fallback={props.defaultColor ?? MARKER_TYPES[props.record.type].color}
              onChange={(color) => props.onChange({ ...props.record, color })}
            />
          </>
        )}
        {props.kind === 'overlay' && (
          <OverlayFields record={props.record} onChange={props.onChange} onRealign={props.onRealign} />
        )}

        {(kind === 'area' || kind === 'marker') && (
          <Field label="Property">
            <span className="muted">{propertyName ?? 'Not inside a saved property'}</span>
          </Field>
        )}
      </div>

      <footer className="detail-footer">
        <button onClick={onZoom}>Zoom to</button>
        {props.kind === 'property' && (
          <button onClick={props.onShare} title="Save this property with its stands, areas, sections, plans, hunts and map images as one file to send">
            Share
          </button>
        )}
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

function OverlayFields(props: { record: MapImageOverlay; onChange(o: MapImageOverlay): void; onRealign(): void }) {
  const { record, onChange, onRealign } = props;
  const errors = controlPointErrorsFeet(record.controlPoints);
  const worst = Math.max(...errors);
  return (
    <>
      <TextField label="Name" value={record.name} onChange={(name) => onChange({ ...record, name })} />
      <Field label="Show on map">
        <label className="check">
          <input type="checkbox" checked={record.visible} onChange={(e) => onChange({ ...record, visible: e.target.checked })} />
          Visible
        </label>
      </Field>
      <Field label="See-through">
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={record.opacity}
          onChange={(e) => onChange({ ...record, opacity: Number(e.target.value) })}
        />
      </Field>
      <Field
        label="Alignment"
        hint={
          record.controlPoints.length >= 3
            ? `${record.controlPoints.length} points, worst one off by ${Math.round(worst)} ft.`
            : `${record.controlPoints.length} points. Add a third to see how accurate it is.`
        }
      >
        <button onClick={onRealign}>Adjust points</button>
      </Field>
      <p className="hint">
        To trace from it, use <strong>Draw property</strong> and click along the lines in the image.
      </p>
    </>
  );
}

function AreaFields({ record, onChange, areaTypes }: { record: MapArea; onChange(a: MapArea): void; areaTypes: AreaTypeView[] }) {
  // Keep a removed custom type selectable for an area that still uses it.
  const options = areaTypes.some((t) => t.id === record.type) ? areaTypes : [...areaTypes, { id: record.type, label: 'Removed type' }];
  return (
    <>
      <Field label="Type">
        <select value={record.type} onChange={(e) => onChange({ ...record, type: e.target.value as AreaType })}>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
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

// An item's own color: quick swatches, a full picker, or back to the default.
function ColorField(props: { label: string; value: string | null; fallback: string; onChange(color: string | null): void }) {
  const { label, value, fallback, onChange } = props;
  const current = value ?? fallback;
  return (
    <Field label={label} hint={value ? 'Its own color.' : 'Using the default from Settings.'}>
      <div className="color-field">
        {COLOR_SWATCHES.map((color) => (
          <button
            key={color}
            className={`color-swatch${current.toLowerCase() === color ? ' active' : ''}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
            title={color}
            aria-label={`Color ${color}`}
          />
        ))}
        <input type="color" className="color-input" value={current} onChange={(e) => onChange(e.target.value)} aria-label="Pick any color" />
        {value && (
          <button className="link" onClick={() => onChange(null)}>
            Use default
          </button>
        )}
      </div>
    </Field>
  );
}
