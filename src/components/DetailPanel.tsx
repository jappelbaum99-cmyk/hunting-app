import { useState, type CSSProperties, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';
import { SchedulesField } from '@/components/SchedulesField';
import { SoilTestsField } from '@/components/SoilTestsField';

import { FOOD_PLOT_CROPS, isPlotType, pinTypeInfo, type PinTypeView } from '@/lib/featureTypes';
import { acresOf, formatAcres, formatLatLng } from '@/lib/geo';
import { controlPointErrorsFeet } from '@/lib/georef';
import { entryTitle, formatPlotDate, PLOT_ACTIONS, plotEntries, removeEntry, saveEntry, todayDate } from '@/lib/plotLog';
import { COLOR_SWATCHES, type AreaTypeView } from '@/lib/styles';
import { formatDistance, LINE_PATTERNS, LINE_THICKNESS, TRAIL_KINDS, trailKindInfo, trailLengthM, trailStyle } from '@/lib/trails';
import {
  COMPASS_POINTS,
  type AreaType,
  type CompassPoint,
  type HubSettings,
  type LinePattern,
  type LineThickness,
  type MapArea,
  type MapImageOverlay,
  type MapMarker,
  type MapTrail,
  type MarkerType,
  type PlotAction,
  type PlotEntry,
  type Property,
  type TrailKind,
} from '@/types/models';

interface Common {
  propertyName: string | null;
  // Reshape the outline (property, area) or line (trail).
  onEditShape?: () => void;
  // The color this item gets when it has none of its own (from Settings).
  defaultColor?: string;
  onZoom(): void;
  onDelete(): void;
  onClose(): void;
}

type DetailPanelProps =
  | ({ kind: 'property'; record: Property; onChange(p: Property): void; offlineField: ReactNode; onShare(): void } & Common)
  | ({ kind: 'area'; record: MapArea; onChange(a: MapArea): void; areaTypes: AreaTypeView[]; onAddTask(text: string): void; soilSamples: MapMarker[]; onOpenSoilTests(testId: string | null): void } & Common)
  | ({ kind: 'marker'; record: MapMarker; onChange(m: MapMarker): void; onLogHunt?: () => void; history?: ReactNode; pinTypes: PinTypeView[]; unlocked: boolean; onToggleLock(): void } & Common)
  | ({ kind: 'overlay'; record: MapImageOverlay; onChange(o: MapImageOverlay): void; onRealign(): void } & Common)
  | ({ kind: 'trail'; record: MapTrail; onChange(t: MapTrail): void; trailStyles: HubSettings['trailStyles'] } & Common);

function headingFor(props: DetailPanelProps): string {
  switch (props.kind) {
    case 'property':
      return 'Property';
    case 'area':
      return props.areaTypes.find((t) => t.id === props.record.type)?.label ?? 'Area';
    case 'marker':
      return props.pinTypes.find((t) => t.id === props.record.type)?.label ?? pinTypeInfo(props.record.type).label;
    case 'overlay':
      return 'Map image';
    case 'trail':
      return trailKindInfo(props.record.kind).label;
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
          <Icon name="close" size={16} />
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
        {props.kind === 'area' && <AreaFields record={props.record} onChange={props.onChange} areaTypes={props.areaTypes} onAddTask={props.onAddTask} soilSamples={props.soilSamples} onOpenSoilTests={props.onOpenSoilTests} />}
        {props.kind === 'marker' && (
          <>
            <MarkerFields record={props.record} onChange={props.onChange} pinTypes={props.pinTypes} unlocked={props.unlocked} onToggleLock={props.onToggleLock} />
            {props.onLogHunt && (
              <button className="primary log-hunt" onClick={props.onLogHunt}>
                Log a hunt here
              </button>
            )}
            {props.history}
            <ColorField
              label="Color"
              value={props.record.color ?? null}
              fallback={props.defaultColor ?? pinTypeInfo(props.record.type).color}
              onChange={(color) => props.onChange({ ...props.record, color })}
            />
          </>
        )}
        {props.kind === 'overlay' && (
          <OverlayFields record={props.record} onChange={props.onChange} onRealign={props.onRealign} />
        )}
        {props.kind === 'trail' && (
          <>
            <TrailFields record={props.record} onChange={props.onChange} trailStyles={props.trailStyles} />
            <ColorField
              label="Line color"
              value={props.record.color ?? null}
              fallback={props.defaultColor ?? trailKindInfo(props.record.kind).color}
              onChange={(color) => props.onChange({ ...props.record, color })}
            />
          </>
        )}

        {(kind === 'area' || kind === 'marker' || kind === 'trail') && (
          <Field label="Property">
            <span className="muted">{propertyName ?? 'Not inside a saved property'}</span>
          </Field>
        )}
      </div>

      <footer className="detail-footer">
        <button onClick={onZoom}>Zoom to</button>
        {props.onEditShape && (
          <button onClick={props.onEditShape} title={props.kind === 'trail' ? 'Reshape, split, join, combine or delete part of the line' : 'Drag corners to reshape it'}>
            {props.kind === 'area' ? 'Edit shape' : 'Edit line'}
          </button>
        )}
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

function AreaFields({
  record,
  onChange,
  areaTypes,
  onAddTask,
  soilSamples,
  onOpenSoilTests,
}: {
  record: MapArea;
  onChange(a: MapArea): void;
  areaTypes: AreaTypeView[];
  onAddTask(text: string): void;
  soilSamples: MapMarker[];
  onOpenSoilTests(testId: string | null): void;
}) {
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
      {isPlotType(record.type, options.find((t) => t.id === record.type)?.label ?? '') && (
        <PlotLog key={record.id} record={record} onChange={onChange} />
      )}
      {/* Food plots, and any field with soil sample pins or tests in it. */}
      {(isPlotType(record.type, options.find((t) => t.id === record.type)?.label ?? '') || soilSamples.length > 0 || (record.soilTests ?? []).some((t) => !t.deletedAt)) && (
        <SoilTestsField key={`soil-${record.id}`} record={record} onChange={onChange} onAddTask={onAddTask} samples={soilSamples} onOpenWindow={onOpenSoilTests} />
      )}
      <SchedulesField key={`schedules-${record.id}`} schedules={record.schedules} onChange={(schedules) => onChange({ ...record, schedules })} />
      <NotesField value={record.notes} onChange={(notes) => onChange({ ...record, notes })} />
    </>
  );
}

// What's planted now, a form to save what was done, and everything saved so far.
function PlotLog({ record, onChange }: { record: MapArea; onChange(a: MapArea): void }) {
  const blank = { id: null as string | null, action: 'planted' as PlotAction, what: '', date: todayDate(), notes: '' };
  const [draft, setDraft] = useState(blank);
  const [saved, setSaved] = useState(false);
  const entries = plotEntries(record);
  const set = (patch: Partial<typeof blank>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const missing = !draft.date || (draft.action === 'planted' && !draft.what.trim());

  const save = () => {
    if (missing) return;
    const existing = entries.find((e) => e.id === draft.id);
    const entry: PlotEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      action: draft.action,
      what: draft.action === 'planted' ? draft.what.trim() : null,
      date: draft.date,
      notes: draft.notes.trim() || null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      deletedAt: null,
      fromPhone: existing?.fromPhone,
      loggedBy: existing?.loggedBy,
    };
    onChange(saveEntry(record, entry));
    setDraft(blank);
    setSaved(true);
  };

  return (
    <>
      <Field label="Planted now">
        <span>{record.planted || 'Nothing saved yet'}</span>
        {record.planted && record.plantedOn && <span className="muted"> · {formatPlotDate(record.plantedOn)}</span>}
      </Field>

      <Field label={draft.id ? 'Edit entry' : 'Add to the plot log'}>
        <div className="plot-form">
          <div className="plot-fields">
            <select value={draft.action} onChange={(e) => set({ action: e.target.value as PlotAction })} aria-label="What was done">
              {(Object.keys(PLOT_ACTIONS) as PlotAction[]).map((action) => (
                <option key={action} value={action}>
                  {PLOT_ACTIONS[action]}
                </option>
              ))}
            </select>
            <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
          </div>
          {draft.action === 'planted' && (
            <>
              <input
                type="text"
                list="food-plot-crops"
                placeholder="What you planted, e.g. Clover and chicory"
                value={draft.what}
                onChange={(e) => set({ what: e.target.value })}
                aria-label="What you planted"
              />
              <datalist id="food-plot-crops">
                {FOOD_PLOT_CROPS.map((crop) => (
                  <option key={crop} value={crop} />
                ))}
              </datalist>
            </>
          )}
          <textarea rows={2} placeholder="Notes, like seed rate or how it went" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Entry notes" />
          <div className="plot-form-actions">
            <button className="primary" disabled={missing} onClick={save}>
              Save
            </button>
            {draft.id && (
              <button
                onClick={() => {
                  setDraft(blank);
                  setSaved(false);
                }}
              >
                Cancel
              </button>
            )}
            {saved && <span className="muted">Saved</span>}
          </div>
        </div>
      </Field>

      {entries.length > 0 && (
        <Field label="Plot log">
          <ul className="plot-log">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className="plot-log-text">
                  <span className="row-title">{entryTitle(entry)}</span>
                  <span className="row-detail">{[formatPlotDate(entry.date), entry.loggedBy].filter(Boolean).join(' · ')}</span>
                  {entry.notes && <span className="plot-log-notes">{entry.notes}</span>}
                </div>
                <button
                  className="link"
                  onClick={() => {
                    setDraft({ id: entry.id, action: entry.action, what: entry.what ?? '', date: entry.date, notes: entry.notes ?? '' });
                    setSaved(false);
                  }}
                >
                  Edit
                </button>
                <button
                  className="icon"
                  title="Remove"
                  aria-label={`Remove ${entryTitle(entry)}`}
                  onClick={() => {
                    if (draft.id === entry.id) setDraft(blank);
                    onChange(removeEntry(record, entry.id));
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </Field>
      )}
    </>
  );
}

function TrailFields({ record, onChange, trailStyles }: { record: MapTrail; onChange(t: MapTrail): void; trailStyles: HubSettings['trailStyles'] }) {
  const style = trailStyle(record, trailStyles);
  const lineColor = style.color;
  return (
    <>
      <Field label="Type">
        <select value={record.kind} onChange={(e) => onChange({ ...record, kind: e.target.value as TrailKind })}>
          {(Object.keys(TRAIL_KINDS) as TrailKind[]).map((k) => (
            <option key={k} value={k}>
              {TRAIL_KINDS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <TextField label="Name" value={record.name} onChange={(name) => onChange({ ...record, name })} />
      <Field label="Length">
        <span>
          {formatDistance(trailLengthM(record))}
          <span className="muted">{record.source === 'walked' ? ' · walked with a phone' : ''}</span>
        </span>
      </Field>
      <Field label="Line pattern">
        <div className="line-style" role="radiogroup" aria-label="Line pattern">
          {(Object.keys(LINE_PATTERNS) as LinePattern[]).map((pattern) => (
            <button key={pattern} role="radio" aria-checked={style.pattern === pattern} className={style.pattern === pattern ? 'active' : ''} onClick={() => onChange({ ...record, pattern })}>
              <span className={`swatch line ${pattern}`} style={{ '--line': lineColor } as CSSProperties} />
              {LINE_PATTERNS[pattern]}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Line thickness">
        <div className="line-style" role="radiogroup" aria-label="Line thickness">
          {(Object.keys(LINE_THICKNESS) as LineThickness[]).map((thickness) => (
            <button key={thickness} role="radio" aria-checked={style.thickness === thickness} className={style.thickness === thickness ? 'active' : ''} onClick={() => onChange({ ...record, thickness })}>
              <span className="swatch line" style={{ '--line': lineColor, borderTopWidth: LINE_THICKNESS[thickness].px } as CSSProperties} />
              {LINE_THICKNESS[thickness].label}
            </button>
          ))}
        </div>
        <label className="trail-outline">
          <input type="checkbox" checked={style.outline} onChange={(e) => onChange({ ...record, outline: e.target.checked })} />
          Black outline
        </label>
        {(record.pattern || record.thickness || record.outline != null) && (
          <button className="link line-style-default" onClick={() => onChange({ ...record, pattern: null, thickness: null, outline: null })}>
            Use this type's style from Settings
          </button>
        )}
      </Field>
      <NotesField value={record.notes} onChange={(notes) => onChange({ ...record, notes })} />
    </>
  );
}

function MarkerFields({ record, onChange, pinTypes, unlocked, onToggleLock }: { record: MapMarker; onChange(m: MapMarker): void; pinTypes: PinTypeView[]; unlocked: boolean; onToggleLock(): void }) {
  // Keep a removed custom type selectable for a pin that still uses it.
  const options = pinTypes.some((t) => t.id === record.type) ? pinTypes : [...pinTypes, { ...pinTypeInfo(record.type), label: 'Removed type' }];
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
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <TextField label="Name" value={record.name} onChange={(name) => onChange({ ...record, name })} />

      {options.find((t) => t.id === record.type)?.huntingSpot && (
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

      <Field
        label="Location"
        hint={unlocked ? 'Drag the pin on the map to move it. It locks again when you press Lock or click away.' : 'Locked so it can\'t be moved by accident. Unlock it to drag it on the map.'}
      >
        <button className={`pin-lock${unlocked ? ' unlocked' : ''}`} onClick={onToggleLock} aria-pressed={unlocked}>
          {unlocked ? 'Lock' : 'Unlock to move'}
        </button>
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
