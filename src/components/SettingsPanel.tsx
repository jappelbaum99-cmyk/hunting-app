import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { AreaBadge } from '@/components/AreaBadge';
import { CampSettings, type CampPartners } from '@/components/CampSettings';
import { MapLabelToggles } from '@/components/MapLabelToggles';
import { FIELD_PAGE_URL } from '@/lib/site';
import { Icon } from '@/components/Icon';
import { UpdateSettings, type Updater } from '@/components/UpdateBanner';
import { pinTypeList } from '@/lib/featureTypes';
import { AREA_ICON_NAMES } from '@/lib/icons';
import {
  areaTypeList,
  categoryStyle,
  MARKER_SHAPES,
  MAX_MARKER_SIZE,
  MIN_MARKER_SIZE,
  propertyColor,
  type AreaTypeView,
} from '@/lib/styles';
import { LINE_PATTERNS, LINE_THICKNESS, TRAIL_KINDS, trailTypeStyle } from '@/lib/trails';
import type { CustomAreaType, CustomPinType, HubSettings, LinePattern, LineThickness, MarkerShape, MarkerStyle, MarkerType, TrailKind } from '@/types/models';

interface SettingsPanelProps {
  settings: HubSettings;
  onChange(settings: HubSettings): void;
  onClose(): void;
  // Phone files, for phones not in a camp (or with no signal at all).
  onImportPhone(file: File): void;
  onSendStands(): void;
  update: Updater;
  campPartners: CampPartners;
}

// A pin drawn the same way as on the map, for previews.
export function PinPreview({ style }: { style: MarkerStyle }) {
  return (
    <span className="pin-preview" style={{ '--pin-color': style.color, '--pin-size': `${style.size}px` } as CSSProperties}>
      <span className={`map-pin-dot shape-${style.shape}`} />
    </span>
  );
}

// The area's badge; clicking it opens a grid of icons to choose from.
function IconPicker({ type, onPick }: { type: AreaTypeView; onPick(icon: string): void }) {
  return (
    <details className="icon-picker">
      <summary title="Change icon" aria-label={`${type.label} icon`}>
        <AreaBadge type={type} size={30} />
      </summary>
      <div className="icon-grid">
        {AREA_ICON_NAMES.map((icon) => (
          <button
            key={icon}
            className={icon === type.icon ? 'active' : ''}
            onClick={(e) => {
              e.currentTarget.closest('details')?.removeAttribute('open');
              onPick(icon);
            }}
            aria-label={icon}
          >
            <Icon name={icon} size={22} />
          </button>
        ))}
      </div>
    </details>
  );
}

export function SettingsPanel({ settings, onChange, onClose, onImportPhone, onSendStands, update, campPartners }: SettingsPanelProps) {
  const setMarker = (type: MarkerType, patch: Partial<MarkerStyle>) =>
    onChange({ ...settings, markerStyles: { ...settings.markerStyles, [type]: { ...settings.markerStyles[type], ...patch } } });
  const setPinType = (id: string, patch: Partial<CustomPinType>) =>
    onChange({ ...settings, customPinTypes: settings.customPinTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const setCustom = (id: string, patch: Partial<CustomAreaType>) =>
    onChange({ ...settings, customAreaTypes: settings.customAreaTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  return (
    <div className="forecast settings">
      <div className="forecast-header">
        <button className="back" onClick={onClose}>
          ‹ Back
        </button>
        <h2>Settings</h2>
      </div>

      <CampSettings camp={settings.camp ?? null} partners={campPartners} onChange={(camp) => onChange({ ...settings, camp })} />
      <PhoneFiles onImportPhone={onImportPhone} onSendStands={onSendStands} />

      <section className="sidebar-section">
        <h2>Drawing</h2>
        <ul className="settings-list">
          <li className="setting-row">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.snapping.enabled}
                onChange={(e) => onChange({ ...settings, snapping: { ...settings.snapping, enabled: e.target.checked } })}
              />
              <span>Snap to property and section lines</span>
            </label>
          </li>
          {settings.snapping.enabled && (
            <li className="setting-row">
              <span className="row-title">How close</span>
              <input
                type="range"
                min={6}
                max={30}
                step={2}
                value={settings.snapping.distancePx}
                onChange={(e) => onChange({ ...settings, snapping: { ...settings.snapping, distancePx: Number(e.target.value) } })}
                aria-label="Snap distance"
              />
              <span className="muted">{settings.snapping.distancePx} px</span>
            </li>
          )}
        </ul>
        <p className="hint">
          While drawing a section or area, a click near the property line (or another section) lands exactly on it, and on its corners
          first. An orange ring shows when it will snap.
        </p>
      </section>

      <section className="sidebar-section">
        <h2>Schedules</h2>
        <ul className="settings-list">
          <li className="setting-row">
            <span className="row-title">Add to To do</span>
            <input
              type="range"
              min={7}
              max={180}
              step={1}
              value={settings.scheduleLeadDays}
              onChange={(e) => onChange({ ...settings, scheduleLeadDays: Number(e.target.value) })}
              aria-label="Days ahead a scheduled card appears"
            />
            <span className="muted">{settings.scheduleLeadDays} days ahead</span>
          </li>
        </ul>
        <p className="hint">How long before a schedule's months a card appears on the Action Board. Set schedules on an area or section.</p>
      </section>

      <section className="sidebar-section">
        <h2>Map labels</h2>
        <MapLabelToggles settings={settings} onChange={onChange} />
      </section>

      <section className="sidebar-section">
        <h2>Pins</h2>
        <p className="hint">Each type's color, shape and size, or add your own types. Slide size all the way down for a tiny dot. A single stand or pin can still get its own color.</p>
        <ul className="settings-list">
          {pinTypeList(settings.customPinTypes).map(({ id: type, label, custom }) => {
            const style = categoryStyle(type, settings);
            return (
              <li key={type} className="pin-setting">
                <div className="setting-row">
                  <PinPreview style={style} />
                  {custom ? (
                    <input type="text" className="inline-name" value={label} onChange={(e) => setPinType(type, { label: e.target.value })} aria-label="Pin type name" />
                  ) : (
                    <span className="row-title">{label}</span>
                  )}
                  <input
                    type="color"
                    className="color-input"
                    value={style.color}
                    onChange={(e) => (custom ? setPinType(type, { color: e.target.value }) : setMarker(type, { color: e.target.value }))}
                    aria-label={`${label} color`}
                  />
                </div>
                <div className="setting-row">
                  <div className="shape-picker" role="radiogroup" aria-label={`${label} shape`}>
                    {MARKER_SHAPES.map((shape) => (
                      <button
                        key={shape.id}
                        role="radio"
                        aria-checked={style.shape === shape.id}
                        className={style.shape === shape.id ? 'active' : ''}
                        title={shape.label}
                        onClick={() => setMarker(type, { shape: shape.id as MarkerShape })}
                      >
                        <PinPreview style={{ color: 'currentColor', shape: shape.id, size: 12 }} />
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={MIN_MARKER_SIZE}
                    max={MAX_MARKER_SIZE}
                    step={2}
                    value={style.size}
                    onChange={(e) => setMarker(type, { size: Number(e.target.value) })}
                    aria-label={`${label} size`}
                    title={`Size ${style.size}px`}
                  />
                </div>
                {custom && (
                  <div className="setting-row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={settings.customPinTypes.find((t) => t.id === type)?.huntingSpot === true}
                        onChange={(e) => setPinType(type, { huntingSpot: e.target.checked })}
                      />
                      <span>Hunting location (winds, scent cones, hunts)</span>
                    </label>
                    <button
                      className="link remove-type"
                      onClick={() => {
                        if (window.confirm(`Remove the "${label}" pin type? Pins already using it keep their look.`)) {
                          setPinType(type, { deletedAt: new Date().toISOString() });
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button
          className="add-type"
          onClick={() =>
            onChange({
              ...settings,
              customPinTypes: [...settings.customPinTypes, { id: `pin-${crypto.randomUUID()}`, label: 'New pin type', color: '#d4b04a', deletedAt: null }],
            })
          }
        >
          + Add pin type
        </button>
      </section>

      <section className="sidebar-section">
        <h2>Trails</h2>
        <p className="hint">The color, pattern, thickness and outline for each type of trail. A single trail can still have its own.</p>
        <ul className="settings-list">
          {(Object.keys(TRAIL_KINDS) as TrailKind[]).map((kind) => {
            const style = trailTypeStyle(kind, settings.trailStyles);
            const label = TRAIL_KINDS[kind].label;
            const setStyle = (patch: NonNullable<HubSettings['trailStyles'][TrailKind]>) =>
              onChange({ ...settings, trailStyles: { ...settings.trailStyles, [kind]: { ...settings.trailStyles[kind], ...patch } } });
            return (
              <li key={kind} className="pin-setting">
                <div className="setting-row">
                  <span className={`swatch line ${style.pattern}`} style={{ '--line': style.color, borderTopWidth: style.px } as CSSProperties} />
                  <span className="row-title">{label}</span>
                  <input type="color" className="color-input" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} aria-label={`${label} color`} />
                </div>
                <div className="setting-row trail-style-row">
                  <select value={style.pattern} onChange={(e) => setStyle({ pattern: e.target.value as LinePattern })} aria-label={`${label} pattern`}>
                    {(Object.keys(LINE_PATTERNS) as LinePattern[]).map((p) => (
                      <option key={p} value={p}>
                        {LINE_PATTERNS[p]}
                      </option>
                    ))}
                  </select>
                  <select value={style.thickness} onChange={(e) => setStyle({ thickness: e.target.value as LineThickness })} aria-label={`${label} thickness`}>
                    {(Object.keys(LINE_THICKNESS) as LineThickness[]).map((t) => (
                      <option key={t} value={t}>
                        {LINE_THICKNESS[t].label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="trail-outline">
                  <input type="checkbox" checked={style.outline} onChange={(e) => setStyle({ outline: e.target.checked })} />
                  Black outline
                </label>
              </li>
            );
          })}
        </ul>
        {Object.keys(settings.trailStyles).length > 0 && (
          <button className="link" onClick={() => onChange({ ...settings, trailStyles: {} })}>
            Back to the built-in looks
          </button>
        )}
      </section>

      <section className="sidebar-section">
        <h2>Areas</h2>
        <p className="hint">Change any area type's color and icon, or add your own types.</p>
        <ul className="settings-list">
          {areaTypeList(settings).map((type) => (
            <li key={type.id} className="pin-setting">
              <div className="setting-row">
                <IconPicker
                  type={type}
                  onPick={(icon) =>
                    type.custom ? setCustom(type.id, { icon }) : onChange({ ...settings, areaIcons: { ...settings.areaIcons, [type.id]: icon } })
                  }
                />
                {type.custom ? (
                  <input
                    type="text"
                    className="inline-name"
                    value={type.label}
                    onChange={(e) => setCustom(type.id, { label: e.target.value })}
                    aria-label="Area type name"
                  />
                ) : (
                  <span className="row-title">{type.label}</span>
                )}
                <input
                  type="color"
                  className="color-input"
                  value={type.color}
                  onChange={(e) =>
                    type.custom
                      ? setCustom(type.id, { color: e.target.value })
                      : onChange({ ...settings, areaColors: { ...settings.areaColors, [type.id]: e.target.value } })
                  }
                  aria-label={`${type.label} color`}
                />
              </div>
              {type.custom && (
                <div className="setting-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={type.scentSensitive}
                      onChange={(e) => setCustom(type.id, { scentSensitive: e.target.checked })}
                    />
                    <span>Deer bed here (warn about scent)</span>
                  </label>
                  <button
                    className="link remove-type"
                    onClick={() => {
                      if (window.confirm(`Remove the "${type.label}" area type? Areas already using it keep their look.`)) {
                        setCustom(type.id, { deletedAt: new Date().toISOString() });
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button
          className="add-type"
          onClick={() =>
            onChange({
              ...settings,
              customAreaTypes: [
                ...settings.customAreaTypes,
                { id: `custom-${crypto.randomUUID()}`, label: 'New area type', color: '#d4b04a', icon: 'pin', scentSensitive: false, deletedAt: null },
              ],
            })
          }
        >
          + Add area type
        </button>
      </section>

      <section className="sidebar-section">
        <h2>Property lines</h2>
        <ul className="settings-list">
          <li className="setting-row">
            <span className="swatch outline" style={{ '--line': propertyColor(null, settings) } as CSSProperties} />
            <span className="row-title">Default line color</span>
            <input
              type="color"
              className="color-input"
              value={propertyColor(null, settings)}
              onChange={(e) => onChange({ ...settings, propertyLineColor: e.target.value })}
              aria-label="Property line color"
            />
          </li>
        </ul>
      </section>

      <button
        className="reset-look"
        onClick={() => {
          if (window.confirm('Put every color, shape and size back to the defaults? Colors set on single stands and properties stay.')) {
            onChange({ ...settings, markerStyles: {}, areaColors: {}, areaIcons: {}, propertyLineColor: null });
          }
        }}
      >
        Reset look to defaults
      </button>

      <SavedMaps />
      <UpdateSettings updater={update} />
    </div>
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

// How many map tiles the desktop app has saved, with a way to clear them.
function SavedMaps() {
  const [info, setInfo] = useState<{ count: number; bytes: number } | null>(null);
  useEffect(() => {
    window.hub?.tileCacheInfo().then(setInfo).catch(() => setInfo(null));
  }, []);
  if (!window.hub) return null;
  return (
    <section className="sidebar-section">
      <h2>Saved maps</h2>
      <p className="hint">
        {info ? `${info.count.toLocaleString()} map tiles saved on this PC (${formatMb(info.bytes)}).` : 'Counting saved map tiles…'} They're
        reused instead of downloading again, and let downloaded properties work offline.
      </p>
      <button
        onClick={() => {
          if (!window.confirm('Delete all saved map tiles? Properties you downloaded for offline will need downloading again.')) return;
          void window.hub
            ?.clearTileCache()
            .then(() => window.hub?.tileCacheInfo())
            .then((next) => setInfo(next ?? null));
        }}
      >
        Clear saved maps
      </button>
    </section>
  );
}

// Moving pins, hunts and walks by file, for a phone that isn't in the camp.
function PhoneFiles({ onImportPhone, onSendStands }: { onImportPhone(file: File): void; onSendStands(): void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="sidebar-section">
      <h2>Phone files</h2>
      <p className="hint">For a phone that isn't in the camp. The phone's Send tab saves a file; email or AirDrop it here.</p>
      <div className="phone-buttons">
        <button onClick={() => input.current?.click()} title="Bring in pins, hunts and walks sent from a phone">
          Import from phone
        </button>
        <button onClick={onSendStands} title="Make the file a phone loads for its stand list and Apple Maps buttons">
          Send stands to phone
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImportPhone(file);
        }}
      />
      <p className="hint">
        Phone page: <code>{FIELD_PAGE_URL.replace('https://', '')}</code>
      </p>
    </section>
  );
}
