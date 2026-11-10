import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

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
  outlineLook,
  propertyColor,
  type AreaTypeView,
} from '@/lib/styles';
import { LINE_PATTERNS, LINE_THICKNESS, TRAIL_KINDS, trailTypeStyle } from '@/lib/trails';
import { DEFAULT_OFFLINE_RADIUS_M, OFFLINE_RADII } from '@/map/offline';
import { autoOfflineText, type AutoOfflineStatus } from '@/map/useAutoOffline';
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
  autoOffline: AutoOfflineStatus;
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

export function SettingsPanel({ settings, onChange, onClose, onImportPhone, onSendStands, update, campPartners, autoOffline }: SettingsPanelProps) {
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

      <section className="sidebar-section look-defaults">
        <h2>Default looks</h2>
        <p className="hint">
          These set how each kind of thing looks everywhere on the map and on posters. To change just one pin, area, trail or property, open it and change it there; that
          one keeps its own look.
        </p>
      </section>

      <SettingsGroup title="Pins" summary={`${pinTypeList(settings.customPinTypes).length} types`}>
        <p className="hint">Each pin type's color, shape and size, or add your own types. Slide size all the way down for a tiny dot.</p>
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
      </SettingsGroup>

      <SettingsGroup title="Trails" summary={`${Object.keys(TRAIL_KINDS).length} types`}>
        <p className="hint">The color, pattern, thickness and outline for each type of trail.</p>
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
      </SettingsGroup>

      <SettingsGroup title="Areas" summary={`${areaTypeList(settings).length} types`}>
        <p className="hint">Each area type's color and icon, or add your own types.</p>
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
      </SettingsGroup>

      <SettingsGroup title="Property lines">
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
        <OutlineControls kind="property" settings={settings} onChange={onChange} />
      </SettingsGroup>

      <SettingsGroup title="Section lines">
        <OutlineControls kind="section" settings={settings} onChange={onChange} />
      </SettingsGroup>

      <button
        className="reset-look"
        onClick={() => {
          if (window.confirm('Put every color, shape and size back to the defaults? Colors set on single stands and properties stay.')) {
            onChange({ ...settings, markerStyles: {}, areaColors: {}, areaIcons: {}, propertyLineColor: null, propertyLook: null, sectionLook: null });
          }
        }}
      >
        Reset look to defaults
      </button>

      <SavedMaps settings={settings} onChange={onChange} auto={autoOffline} />
      <UpdateSettings updater={update} />
    </div>
  );
}

const OPEN_GROUPS_KEY = 'hunting-hub-settings-open';

// A Settings group that folds open from its heading. Shut by default, so the
// look settings don't make one long list; which are open is remembered.
function SettingsGroup({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '[]') as string[]).includes(title);
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      const list = (JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '[]') as string[]).filter((t) => t !== title);
      localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(open ? list : [...list, title]));
    } catch {
      // Only a convenience.
    }
  };
  return (
    <section className="sidebar-section settings-group">
      <button className="section-toggle" onClick={toggle} aria-expanded={open}>
        <h2>
          {title} {summary && <span className="count">{summary}</span>}
        </h2>
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="settings-group-body">{children}</div>}
    </section>
  );
}

// Border pattern, width and opacity, and how strong the shading inside is, for property or section outlines.
function OutlineControls({ kind, settings, onChange }: { kind: 'property' | 'section'; settings: HubSettings; onChange(s: HubSettings): void }) {
  const look = outlineLook(kind, settings);
  const key = kind === 'property' ? 'propertyLook' : 'sectionLook';
  const set = (patch: Partial<typeof look>) => onChange({ ...settings, [key]: { ...look, ...patch } });
  return (
    <div className="outline-controls">
      <label className="outline-row">
        <span>Border</span>
        <select value={look.pattern} onChange={(e) => set({ pattern: e.target.value as LinePattern })} aria-label={`${kind} border pattern`}>
          {(Object.keys(LINE_PATTERNS) as LinePattern[]).map((pattern) => (
            <option key={pattern} value={pattern}>
              {LINE_PATTERNS[pattern]}
            </option>
          ))}
        </select>
      </label>
      <label className="outline-row">
        <span>Width</span>
        <input type="range" min={1} max={8} step={0.5} value={look.width} onChange={(e) => set({ width: Number(e.target.value) })} aria-label={`${kind} border width`} />
        <span className="muted">{look.width} px</span>
      </label>
      <label className="outline-row">
        <span>Line</span>
        <input type="range" min={0.1} max={1} step={0.05} value={look.lineOpacity} onChange={(e) => set({ lineOpacity: Number(e.target.value) })} aria-label={`${kind} border opacity`} />
        <span className="muted">{Math.round(look.lineOpacity * 100)}%</span>
      </label>
      <label className="outline-row">
        <span>Shading</span>
        <input type="range" min={0} max={0.6} step={0.01} value={look.fillOpacity} onChange={(e) => set({ fillOpacity: Number(e.target.value) })} aria-label={`${kind} shading`} />
        <span className="muted">{Math.round(look.fillOpacity * 100)}%</span>
      </label>
    </div>
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

// Keeping properties' maps saved in the background, how many map tiles the
// desktop app has saved, and a way to clear them.
function SavedMaps({ settings, onChange, auto }: { settings: HubSettings; onChange(settings: HubSettings): void; auto: AutoOfflineStatus }) {
  const [info, setInfo] = useState<{ count: number; bytes: number } | null>(null);
  const finished = auto.finishedAt;
  useEffect(() => {
    window.hub?.tileCacheInfo().then(setInfo).catch(() => setInfo(null));
  }, [finished]);
  if (!window.hub) return null;
  const on = settings.offlineAuto !== false;
  return (
    <section className="sidebar-section">
      <h2>Saved maps</h2>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => onChange({ ...settings, offlineAuto: e.target.checked })} />
        <span>Keep my properties' maps saved on this PC</span>
      </label>
      {on && (
        <>
          <label className="setting-row">
            <span>Around each property</span>
            <select value={settings.offlineRadiusM ?? DEFAULT_OFFLINE_RADIUS_M} onChange={(e) => onChange({ ...settings, offlineRadiusM: Number(e.target.value) })}>
              {OFFLINE_RADII.map((r) => (
                <option key={r.meters} value={r.meters}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{autoOfflineText(auto)}</p>
        </>
      )}
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
