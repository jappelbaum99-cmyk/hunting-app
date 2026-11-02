import type { PointerEvent } from 'react';

import { DISTANCE_BANDS, kindInfo, whereLabel } from '@/lib/reports';
import type { Sighting } from '@/types/models';

type Where = NonNullable<Sighting['fromStand']>;

// Ring radius (in the picker's own units) for each distance band.
const BAND_RADIUS: Record<number, number> = { 50: 42, 100: 74, 200: 104, 300: 122 };
const OUTER = 126;
// Taps this close to the middle clear the spot.
const CENTER = 16;
// Half the drawing's width: the target plus room for N/E/S/W outside it.
const SIZE = OUTER + 20;

function spotOf(where: Where): [number, number] {
  const r = BAND_RADIUS[where.yards] ?? OUTER;
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
              <circle key={s.id} cx={x} cy={y} r={5} fill={color} className="where-logged" />
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
