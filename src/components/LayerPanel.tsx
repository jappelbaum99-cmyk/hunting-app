import {
  BASE_MAPS,
  CONTOUR_OPTIONS,
  LIDAR_STYLES,
  type ContourInterval,
  type LidarStyleId,
  type MapLayersState,
} from '@/map/layers';

interface LayerPanelProps {
  layers: MapLayersState;
  onChange(layers: MapLayersState): void;
}

export function LayerPanel({ layers, onChange }: LayerPanelProps) {
  const set = (patch: Partial<MapLayersState>) => onChange({ ...layers, ...patch });
  const showsLidar = layers.base === 'lidar' || layers.lidarBlend > 0;

  return (
    <div className="layer-panel">
      <div className="segmented">
        {BASE_MAPS.map((b) => (
          <button key={b.id} className={layers.base === b.id ? 'active' : ''} onClick={() => set({ base: b.id })}>
            {b.label}
          </button>
        ))}
      </div>

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
    </div>
  );
}
