import { useEffect, useState, type CSSProperties } from 'react';

import { AREA_TYPES, MARKER_TYPES } from '@/lib/featureTypes';
import {
  areaColor,
  categoryStyle,
  MARKER_SHAPES,
  MAX_MARKER_SIZE,
  MIN_MARKER_SIZE,
  propertyColor,
} from '@/lib/styles';
import type { AreaType, HubSettings, MarkerShape, MarkerStyle, MarkerType } from '@/types/models';

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

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const setMarker = (type: MarkerType, patch: Partial<MarkerStyle>) =>
    onChange({ ...settings, markerStyles: { ...settings.markerStyles, [type]: { ...settings.markerStyles[type], ...patch } } });
  const setArea = (type: AreaType, color: string) => onChange({ ...settings, areaColors: { ...settings.areaColors, [type]: color } });

  return (
    <div className="forecast settings">
      <div className="forecast-header">
        <button className="back" onClick={onClose}>
          ‹ Back
        </button>
        <h2>Settings</h2>
      </div>

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
        <ul className="settings-list">
          {(Object.keys(AREA_TYPES) as AreaType[]).map((type) => (
            <li key={type} className="setting-row">
              <span className="swatch" style={{ background: areaColor(type, settings) }} />
              <span className="row-title">{AREA_TYPES[type].label}</span>
              <input
                type="color"
                className="color-input"
                value={areaColor(type, settings)}
                onChange={(e) => setArea(type, e.target.value)}
                aria-label={`${AREA_TYPES[type].label} color`}
              />
            </li>
          ))}
        </ul>
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
            onChange({ markerStyles: {}, areaColors: {}, propertyLineColor: null });
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
