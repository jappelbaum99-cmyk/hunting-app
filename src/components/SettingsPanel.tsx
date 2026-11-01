import { useEffect, useState, type CSSProperties } from 'react';

import { AreaBadge } from '@/components/AreaBadge';
import { AREA_ICONS, MARKER_TYPES } from '@/lib/featureTypes';
import {
  areaTypeList,
  categoryStyle,
  MARKER_SHAPES,
  MAX_MARKER_SIZE,
  MIN_MARKER_SIZE,
  propertyColor,
  type AreaTypeView,
} from '@/lib/styles';
import type { CustomAreaType, HubSettings, MarkerShape, MarkerStyle, MarkerType } from '@/types/models';

interface SettingsPanelProps {
  settings: HubSettings;
  onChange(settings: HubSettings): void;
  onClose(): void;
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
        {AREA_ICONS.map((icon) => (
          <button
            key={icon}
            className={icon === type.icon ? 'active' : ''}
            onClick={(e) => {
              e.currentTarget.closest('details')?.removeAttribute('open');
              onPick(icon);
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    </details>
  );
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const setMarker = (type: MarkerType, patch: Partial<MarkerStyle>) =>
    onChange({ ...settings, markerStyles: { ...settings.markerStyles, [type]: { ...settings.markerStyles[type], ...patch } } });
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
        <h2>Pins</h2>
        <p className="hint">Each type's color, shape and size. A single stand or pin can still get its own color.</p>
        <ul className="settings-list">
          {(Object.keys(MARKER_TYPES) as MarkerType[]).map((type) => {
            const style = categoryStyle(type, settings);
            return (
              <li key={type} className="pin-setting">
                <div className="setting-row">
                  <PinPreview style={style} />
                  <span className="row-title">{MARKER_TYPES[type].label}</span>
                  <input
                    type="color"
                    className="color-input"
                    value={style.color}
                    onChange={(e) => setMarker(type, { color: e.target.value })}
                    aria-label={`${MARKER_TYPES[type].label} color`}
                  />
                </div>
                <div className="setting-row">
                  <div className="shape-picker" role="radiogroup" aria-label={`${MARKER_TYPES[type].label} shape`}>
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
                    aria-label={`${MARKER_TYPES[type].label} size`}
                    title={`Size ${style.size}px`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
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
                { id: `custom-${crypto.randomUUID()}`, label: 'New area type', color: '#d4b04a', icon: '📍', scentSensitive: false, deletedAt: null },
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
