import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { MapLabelToggles } from '@/components/MapLabelToggles';
import type { HubSettings } from '@/types/models';

import {
  BASE_MAPS,
  CONTOUR_OPTIONS,
  LIDAR_STYLES,
  type BaseMapId,
  type ContourInterval,
  type LidarStyleId,
  type MapLayersState,
} from '@/map/layers';

interface LayerPanelProps {
  layers: MapLayersState;
  onChange(layers: MapLayersState): void;
  settings: HubSettings;
  onChangeSettings(settings: HubSettings): void;
}

// Preview pictures for the map chooser: one USGS tile over Salem, MO
// (zoom 13, x 2013, y 3170) from each source.
const TILE_BBOX = '-10189972.3,4525071.3,-10185080.3,4529963.3';
const THUMBNAILS: Record<BaseMapId, string> = {
  satellite: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/13/3170/2013',
  topo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/13/3170/2013',
  lidar: `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${TILE_BBOX}&bboxSR=3857&imageSR=3857&size=160,160&format=png&f=image&renderingRule=${encodeURIComponent('{"rasterFunction":"Hillshade Gray-Stretch"}')}`,
};

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2.5 8 12 13l9.5-5L12 3Z" />
      <path d="m2.5 12.5 9.5 5 9.5-5" />
      <path d="m2.5 16.5 9.5 5 9.5-5" opacity="0.6" />
    </svg>
  );
}

function Thumbnail({ id }: { id: BaseMapId }) {
  // The lidar server is often slow; fall back to a plain tile rather than a broken image.
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="tile-fallback" />;
  return <img src={THUMBNAILS[id]} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function LayerPanel({ layers, onChange, settings, onChangeSettings }: LayerPanelProps) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<MapLayersState>) => onChange({ ...layers, ...patch });
  const showsLidar = layers.base === 'lidar' || layers.lidarBlend > 0;

  return (
    <div className="map-buttons">
      <button
        className={`layer-button${open ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Choose map"
        aria-expanded={open}
      >
        <LayersIcon />
      </button>

      {open && (
        <div className="layer-card">
          <div className="layer-card-header">
            <h3>Choose Map</h3>
            <button className="icon" onClick={() => setOpen(false)} title="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="map-tiles">
            {BASE_MAPS.map((b) => (
              <button key={b.id} className={`map-tile${layers.base === b.id ? ' active' : ''}`} onClick={() => set({ base: b.id })}>
                <Thumbnail id={b.id} />
                {b.label}
              </button>
            ))}
          </div>

          {layers.base === 'satellite' && (
            <>
              <label className="layer-row">
                <span>Close-up photos</span>
                <select
                  value={settings.aerialPhotos ?? 'leafOff'}
                  onChange={(e) => onChangeSettings({ ...settings, aerialPhotos: e.target.value as 'leafOff' | 'leafOn' })}
                  aria-label="Close-up photos"
                >
                  <option value="leafOff">Leaf-off (winter)</option>
                  <option value="leafOn">Leaf-on (summer)</option>
                </select>
              </label>
              <p className="hint">
                {(settings.aerialPhotos ?? 'leafOff') === 'leafOff'
                  ? "Missouri's 6 inch winter photos, where a property's maps are saved; summer photos elsewhere."
                  : 'Summer NAIP photos with the trees leafed out.'}
              </p>
            </>
          )}

          {layers.base !== 'lidar' && (
            <label className="layer-row">
              <span>Lidar shading</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layers.lidarBlend}
                onChange={(e) => set({ lidarBlend: Number(e.target.value) })}
              />
            </label>
          )}

          {showsLidar && (
            <label className="layer-row">
              <span>Lidar style</span>
              <select value={layers.lidarStyle} onChange={(e) => set({ lidarStyle: e.target.value as LidarStyleId })}>
                {LIDAR_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="layer-row">
            <span>Contours</span>
            <select value={layers.contours} onChange={(e) => set({ contours: e.target.value as ContourInterval })}>
              {CONTOUR_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {layers.contours !== 'off' && <p className="hint">Contours show when zoomed in close.</p>}

          <label className="check">
            <input type="checkbox" checked={layers.terrain} onChange={(e) => set({ terrain: e.target.checked })} />
            <span>3D terrain</span>
          </label>
          {layers.terrain && (
            <label className="layer-row">
              <span>Hill height {layers.terrainHeight}×</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.5}
                value={layers.terrainHeight}
                onChange={(e) => set({ terrainHeight: Number(e.target.value) })}
              />
            </label>
          )}
          {layers.terrain && <p className="hint">Tilt and turn with the right mouse button (or Ctrl + drag). Turn it off to go back to flat.</p>}

          <label className="check">
            <input type="checkbox" checked={layers.sightings} onChange={(e) => set({ sightings: e.target.checked })} />
            <span>Deer sightings from hunt reports</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={layers.huntSpots} onChange={(e) => set({ huntSpots: e.target.checked })} />
            <span>New spots hunted (not stands)</span>
          </label>

          <details className="layer-labels">
            <summary>Map labels</summary>
            <MapLabelToggles settings={settings} onChange={onChangeSettings} />
          </details>
        </div>
      )}
    </div>
  );
}
