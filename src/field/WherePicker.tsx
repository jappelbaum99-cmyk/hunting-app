import type { PointerEvent } from 'react';

import { Icon } from '@/components/Icon';

import { DISTANCE_BANDS, kindInfo, MAX_YARDS, whereLabel } from '@/lib/reports';
import type { Sighting } from '@/types/models';

type Where = NonNullable<Sighting['fromStand']>;

// Ring radius (in the picker's own units) for each distance band.
const BAND_RADIUS: Record<number, number> = { 50: 42, 100: 74, 200: 104, 300: 122 };
const OUTER = 126;
// Taps this close to the middle clear the spot.
const CENTER = 16;
// Half the drawing's width: the target plus room for N/E/S/W outside it.
const SIZE = OUTER + 20;

// Ring radius for any distance: straight between the rings, capped at the edge.
function radiusFor(yards: number): number {
  const stops: [number, number][] = [[0, 0], ...DISTANCE_BANDS.map((b) => [b, BAND_RADIUS[b]] as [number, number])];
  for (let i = 1; i < stops.length; i++) {
    const [y0, r0] = stops[i - 1];
    const [y1, r1] = stops[i];
    if (yards <= y1) return r0 + ((yards - y0) / (y1 - y0)) * (r1 - r0);
  }
  return OUTER;
}

function spotOf(where: Where): [number, number] {
  const r = radiusFor(where.yards);
  const rad = (where.bearingDeg * Math.PI) / 180;
  return [Math.sin(rad) * r, -Math.cos(rad) * r];
}

// "Where did you see them?": a north-up target around the stand. One tap picks
// a compass direction and a rough distance, which is all a sighting stores.
export function WherePicker(props: { value: Where | null; onChange(value: Where | null): void; logged: Sighting[] }) {
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 2 * SIZE - SIZE;
    const y = ((event.clientY - box.top) / box.height) * 2 * SIZE - SIZE;
    const r = Math.hypot(x, y);
    if (r < CENTER) return props.onChange(null);
    const bearingDeg = (Math.round(((Math.atan2(x, -y) * 180) / Math.PI + 360) / 45) * 45) % 360;
    // Each band covers the space up to halfway to the next ring.
    const yards = DISTANCE_BANDS.find((band, i) => {
      const next = DISTANCE_BANDS[i + 1];
      return next === undefined || r < (BAND_RADIUS[band] + BAND_RADIUS[next]) / 2;
    })!;
    props.onChange({ bearingDeg, yards });
  };

  const label = props.value ? whereLabel({ fromStand: props.value }) : null;

  return (
    <div className="where-picker">
      <div className="where-head">
        <span>Where were they?</span>
        <span className="muted">{label ? `${label} of you` : 'Tap the spot · north is up'}</span>
      </div>
      <div className="where-yards-row">
        <label>
          <span>Distance</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_YARDS}
            placeholder={props.value ? '' : 'tap first'}
            disabled={!props.value}
            value={props.value ? Math.round(props.value.yards) : ''}
            onChange={(e) => {
              if (!props.value || e.target.value === '') return;
              props.onChange({ ...props.value, yards: Math.min(MAX_YARDS, Math.max(1, Number(e.target.value))) });
            }}
            aria-label="Yards from the stand"
          />
          <span>yd</span>
        </label>
        {props.value && (
          <button className="where-clear" onClick={() => props.onChange(null)} aria-label="Clear where they were">
            <Icon name="close" size={16} /> Clear
          </button>
        )}
      </div>
      <svg viewBox={`${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}`} onPointerDown={pick} role="img" aria-label={label ? `Seen ${label} of the stand` : 'Pick where they were'}>
        <circle r={OUTER} className="where-outer" />
        {[0, 45, 90, 135].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          return <line key={deg} x1={-Math.sin(rad) * OUTER} y1={Math.cos(rad) * OUTER} x2={Math.sin(rad) * OUTER} y2={-Math.cos(rad) * OUTER} className="where-spoke" />;
        })}
        {DISTANCE_BANDS.slice(0, -1).map((band) => (
          <g key={band}>
            <circle r={BAND_RADIUS[band]} className="where-ring" />
            <text x={4} y={-BAND_RADIUS[band] + 11} className="where-yards">
              {band}
            </text>
          </g>
        ))}
        {(['N', 'E', 'S', 'W'] as const).map((p, i) => {
          const rad = (i * 90 * Math.PI) / 180;
          return (
            <text key={p} x={Math.sin(rad) * (OUTER + 11)} y={-Math.cos(rad) * (OUTER + 11) + 4} className="where-compass">
              {p}
            </text>
          );
        })}

        {/* Sightings already logged in this hunt */}
        {props.logged
          .filter((s) => s.fromStand)
          .map((s) => {
            const [x, y] = spotOf(s.fromStand!);
            const color = kindInfo(s.kind).color;
            return s.headingDeg === null ? (
              <rect key={s.id} x={x - 5} y={y - 10} width={10} height={20} rx={5} fill={color} className="where-logged" />
            ) : (
              <g key={s.id} transform={`translate(${x} ${y}) rotate(${s.headingDeg})`} className="where-logged">
                <rect x={-5} y={-10} width={10} height={20} rx={5} fill={color} />
                <path d="M-2.8 -3.8 0 -6.6 2.8 -3.8" className="where-chevron" />
              </g>
            );
          })}

        <circle r={9} className="where-stand" />
        {props.value && (() => {
          const [x, y] = spotOf(props.value);
          return <circle cx={x} cy={y} r={9} className="where-pick" />;
        })()}
      </svg>
    </div>
  );
}
