import { CONTOUR_COLORS } from '@/map/layers';

// Contour line color: the original look, White, Black, Brown, or any color.
export function ContourColorPicker({ value, onChange }: { value: string | null; onChange(color: string | null): void }) {
  const preset = value === null || CONTOUR_COLORS.some((c) => c.color === value);
  return (
    <div className="contour-colors" role="radiogroup" aria-label="Contour line color">
      <button
        role="radio"
        aria-checked={value === null}
        className={`contour-swatch original${value === null ? ' on' : ''}`}
        onClick={() => onChange(null)}
        title="Original: black lines, lightened over satellite"
      >
        Auto
      </button>
      {CONTOUR_COLORS.map((c) => (
        <button
          key={c.color}
          role="radio"
          aria-checked={value === c.color}
          className={`contour-swatch${value === c.color ? ' on' : ''}`}
          style={{ background: c.color }}
          onClick={() => onChange(c.color)}
          title={c.label}
          aria-label={c.label}
        />
      ))}
      <label className={`contour-swatch custom${!preset ? ' on' : ''}`} title="Pick any color" style={!preset && value ? { background: value } : undefined}>
        <input type="color" value={!preset && value ? value : '#e0b14a'} onChange={(e) => onChange(e.target.value)} aria-label="Custom contour color" />
        {preset && <span aria-hidden>+</span>}
      </label>
    </div>
  );
}
