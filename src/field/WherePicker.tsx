import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { Icon } from '@/components/Icon';
import { DISTANCE_BANDS, HEADINGS, kindInfo, MAX_YARDS, whereLabel } from '@/lib/reports';
import { compassPointOf } from '@/lib/standRating';
import type { Sighting } from '@/types/models';

type Where = NonNullable<Sighting['fromStand']>;

// Ring radius (in the picker's own units) for each distance band.
const BAND_RADIUS: Record<number, number> = { 50: 42, 100: 74, 200: 104, 300: 122 };
const OUTER = 126;
// Taps this close to the middle are "at the stand".
const CENTER = 16;
// A press that moves at least this far is a drag (sets the direction).
const DRAG = 14;
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

// The other way round: yards for a distance from the middle, to the nearest 5.
function yardsFor(r: number): number {
  const stops: [number, number][] = [[0, 0], ...DISTANCE_BANDS.map((b) => [b, BAND_RADIUS[b]] as [number, number])];
  for (let i = 1; i < stops.length; i++) {
    const [y0, r0] = stops[i - 1];
    const [y1, r1] = stops[i];
    if (r <= r1) return Math.max(5, Math.round((y0 + ((r - r0) / (r1 - r0)) * (y1 - y0)) / 5) * 5);
  }
  return DISTANCE_BANDS[DISTANCE_BANDS.length - 1];
}

// Screen angle (0 = up, clockwise) of a point in the picker's units.
const angleOf = (x: number, y: number) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
const norm = (deg: number) => ((deg % 360) + 360) % 360;
const snap45 = (deg: number) => (Math.round(norm(deg) / 45) * 45) % 360;

function spotOf(where: Where, rotation: number): [number, number] {
  const r = radiusFor(where.yards);
  const rad = ((where.bearingDeg - rotation) * Math.PI) / 180;
  return [Math.sin(rad) * r, -Math.cos(rad) * r];
}

// The phone's compass heading (0 = north), once the person turns it on. iPhones
// ask permission, which has to come from a tap.
function useCompass(): { heading: number | null; on: boolean; error: string | null; start(): void; stop(): void } {
  const [on, setOn] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const smooth = useRef<number | null>(null);

  useEffect(() => {
    if (!on) return;
    const onTurn = (event: DeviceOrientationEvent) => {
      const ios = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const raw = typeof ios === 'number' ? ios : event.absolute && event.alpha !== null ? 360 - event.alpha : null;
      if (raw === null) return;
      // Ease toward the new reading so the target doesn't jitter.
      const prev = smooth.current ?? raw;
      const delta = ((raw - prev + 540) % 360) - 180;
      smooth.current = norm(prev + delta * 0.25);
      setHeading(Math.round(smooth.current));
    };
    window.addEventListener('deviceorientationabsolute', onTurn as EventListener);
    window.addEventListener('deviceorientation', onTurn);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onTurn as EventListener);
      window.removeEventListener('deviceorientation', onTurn);
    };
  }, [on]);

  const start = () => {
    setError(null);
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof ask === 'function') {
      ask()
        .then((answer) => (answer === 'granted' ? setOn(true) : setError('Compass access was turned down. Allow Motion & Orientation for this site in Settings › Safari.')))
        .catch(() => setError("This phone didn't allow the compass."));
    } else if ('DeviceOrientationEvent' in window) {
      setOn(true);
    } else {
      setError('This browser has no compass access.');
    }
  };

  return { heading: on ? heading : null, on, error, start, stop: () => (setOn(false), (smooth.current = null)) };
}

// "Where were they, and which way were they going?" in one control: a target
// around the stand. Tap the spot; drag from it the way they went. North is up,
// or, with the compass on, the way you're facing is up.
export function WherePicker(props: {
  where: Where | null;
  headingDeg: number | null;
  color: string;
  onChange(next: { where: Where | null; headingDeg: number | null }): void;
  logged: Sighting[];
}) {
  const compass = useCompass();
  // Up on the target: north, or the way the phone faces.
  const rotation = compass.heading ?? 0;
  const press = useRef<{ x: number; y: number; rotation: number; fromStand: boolean; onSpot: boolean } | null>(null);
  const [dragHeading, setDragHeading] = useState<number | null>(null);
  const [yardsText, setYardsText] = useState<string | null>(null);

  const toLocal = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * 2 * SIZE - SIZE, ((event.clientY - box.top) / box.height) * 2 * SIZE - SIZE];
  };

  const onDown = (event: PointerEvent<SVGSVGElement>) => {
    try {
      // Keep getting moves if the finger slides off the target.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not every pointer can be captured; the press still works.
    }
    const [x, y] = toLocal(event);
    const spot = props.where ? spotOf(props.where, rotation) : null;
    press.current = {
      x,
      y,
      rotation,
      fromStand: Math.hypot(x, y) < CENTER,
      onSpot: spot !== null && Math.hypot(x - spot[0], y - spot[1]) < DRAG,
    };
  };

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const p = press.current;
    if (!p) return;
    const [x, y] = toLocal(event);
    if (Math.hypot(x - p.x, y - p.y) < DRAG) return setDragHeading(null);
    setDragHeading(snap45(angleOf(x - p.x, y - p.y) + p.rotation));
  };

  const onUp = (event: PointerEvent<SVGSVGElement>) => {
    const p = press.current;
    press.current = null;
    setDragHeading(null);
    if (!p) return;
    const [x, y] = toLocal(event);
    const dragged = Math.hypot(x - p.x, y - p.y) >= DRAG;
    const heading = dragged ? snap45(angleOf(x - p.x, y - p.y) + p.rotation) : null;
    setYardsText(null);
    // Dragging from your stand or from the spot already picked only sets the direction.
    if (dragged && (p.fromStand || p.onSpot)) return props.onChange({ where: props.where, headingDeg: heading });
    // A tap on the stand clears the spot.
    if (p.fromStand) return props.onChange({ where: null, headingDeg: props.headingDeg });
    const r = Math.min(OUTER, Math.hypot(p.x, p.y));
    const where = { bearingDeg: Math.round(norm(angleOf(p.x, p.y) + p.rotation) / 5) * 5 % 360, yards: yardsFor(r) };
    props.onChange({ where, headingDeg: dragged ? heading : null });
  };

  const label = props.where ? whereLabel({ fromStand: props.where }) : null;
  const shownHeading = dragHeading ?? props.headingDeg;
  const going = shownHeading === null ? 'not moving' : `heading ${HEADINGS.find((h) => h.deg === snap45(shownHeading))?.point}`;
  const spot = props.where ? spotOf(props.where, rotation) : null;

  return (
    <div className="where-picker">
      <div className="where-head">
        <span>Where, and which way?</span>
        <span className="muted">
          {label ? `${label} of you · ${going}` : shownHeading === null ? 'Tap the spot, drag the way they went' : `At the stand · ${going}`}
        </span>
      </div>

      <svg
        viewBox={`${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => ((press.current = null), setDragHeading(null))}
        role="img"
        aria-label={label ? `Seen ${label} of the stand, ${going}` : 'Pick where they were'}
      >
        <circle r={OUTER} className="where-outer" />
        <g transform={`rotate(${-rotation})`}>
          {[0, 45, 90, 135].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return <line key={deg} x1={-Math.sin(rad) * OUTER} y1={Math.cos(rad) * OUTER} x2={Math.sin(rad) * OUTER} y2={-Math.cos(rad) * OUTER} className="where-spoke" />;
          })}
          {(['N', 'E', 'S', 'W'] as const).map((p, i) => {
            const rad = (i * 90 * Math.PI) / 180;
            const [x, y] = [Math.sin(rad) * (OUTER + 11), -Math.cos(rad) * (OUTER + 11)];
            return (
              <text key={p} x={x} y={y + 4} transform={`rotate(${rotation} ${x} ${y})`} className={`where-compass${p === 'N' ? ' north' : ''}`}>
                {p}
              </text>
            );
          })}
        </g>
        {DISTANCE_BANDS.slice(0, -1).map((band) => (
          <g key={band}>
            <circle r={BAND_RADIUS[band]} className="where-ring" />
            <text x={4} y={-BAND_RADIUS[band] + 11} className="where-yards">
              {band}
            </text>
          </g>
        ))}
        {compass.heading !== null && <path d={`M0 ${-OUTER - 2} l-7 -10 h14 z`} className="where-facing" />}

        {/* Sightings already logged in this hunt */}
        {props.logged
          .filter((s) => s.fromStand)
          .map((s) => {
            const [x, y] = spotOf(s.fromStand!, rotation);
            return <Pill key={s.id} x={x} y={y} heading={s.headingDeg === null ? null : s.headingDeg - rotation} color={kindInfo(s.kind).color} size={0.75} faded />;
          })}

        <circle r={9} className="where-stand" />
        {spot && <Pill x={spot[0]} y={spot[1]} heading={shownHeading === null ? null : shownHeading - rotation} color={props.color} size={1} />}
        {!spot && shownHeading !== null && <Pill x={0} y={0} heading={shownHeading - rotation} color={props.color} size={1} />}
      </svg>

      <div className="where-yards-row">
        <label>
          <span>Distance</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_YARDS}
            placeholder={props.where ? '' : 'tap first'}
            disabled={!props.where}
            value={yardsText ?? (props.where ? String(Math.round(props.where.yards)) : '')}
            onChange={(e) => {
              setYardsText(e.target.value);
              const yards = Number(e.target.value);
              if (props.where && e.target.value !== '' && yards >= 1) props.onChange({ where: { ...props.where, yards: Math.min(MAX_YARDS, Math.round(yards)) }, headingDeg: props.headingDeg });
            }}
            onBlur={() => setYardsText(null)}
            aria-label="Yards from the stand"
          />
          <span>yd</span>
        </label>
        {compass.on ? (
          <button className="where-chip on" onClick={compass.stop}>
            <Icon name="arrow" size={14} /> {compass.heading === null ? 'Finding north…' : `Facing ${compassPointOf(compass.heading)}`}
          </button>
        ) : (
          <button className="where-chip" onClick={compass.start}>
            <Icon name="arrow" size={14} /> Use compass
          </button>
        )}
        {(props.where || props.headingDeg !== null) && (
          <button className="where-chip" onClick={() => (setYardsText(null), props.onChange({ where: null, headingDeg: null }))} aria-label="Clear where and which way">
            <Icon name="close" size={14} /> Clear
          </button>
        )}
      </div>
      {compass.error && <p className="field-warn">{compass.error}</p>}
      {compass.on && compass.heading !== null && <p className="field-hint">The top of the target is the way you're facing. Hold the phone flat.</p>}
    </div>
  );
}

// An animal marker: a pill pointing the way it went (chevron at the front), or upright when still.
function Pill({ x, y, heading, color, size, faded }: { x: number; y: number; heading: number | null; color: string; size: number; faded?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${heading ?? 0}) scale(${size})`} className={`where-pill${faded ? ' faded' : ''}`}>
      <rect x={-6} y={-12} width={12} height={24} rx={6} fill={color} />
      {heading !== null && <path d="M-3.4 -4.6 0 -8 3.4 -4.6" className="where-chevron" />}
    </g>
  );
}
