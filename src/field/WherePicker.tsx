import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { Icon } from '@/components/Icon';
import { StandMap, type PointKind } from '@/field/StandMap';
import type { CampMap } from '@/lib/campMap';
import { bearingAndMeters } from '@/lib/geo';
import { DISTANCE_BANDS, kindInfo, MAX_YARDS, whereLabel } from '@/lib/reports';
import { compassPointOf } from '@/lib/standRating';
import type { Sighting } from '@/types/models';

type Where = NonNullable<Sighting['fromStand']>;

// Ring radius (in the picker's own units) for each distance band. Bow range gets
// the most room; the edge is 150 yd (farther is typed in the distance box).
const BAND_RADIUS: Record<number, number> = { 25: 38, 50: 66, 100: 100, 150: 122 };
const OUTER = 126;
// A press that moves at least this far is the page scrolling, not a tap.
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

// A point on the target as "this far, this way" from the stand (clamped to the edge).
function whereOf(x: number, y: number, rotation: number): Where {
  return { bearingDeg: (Math.round(norm(angleOf(x, y) + rotation) / 5) * 5) % 360, yards: yardsFor(Math.min(OUTER, Math.hypot(x, y))) };
}

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

type Step = 'from' | 'closest' | 'went';

const STEPS: { step: Step; label: string; hint: string }[] = [
  { step: 'from', label: 'First seen', hint: 'Tap where you first saw them' },
  { step: 'closest', label: 'Closest', hint: 'Tap the closest they got to you' },
  { step: 'went', label: 'Went', hint: 'Tap where they went' },
];

// The way they were heading, from the points tapped: closest to went, else
// first seen to closest, else first seen to went.
function headingFrom(from: Where | null, closest: Where | null, went: Where | null): number | null {
  const pairs: [Where | null, Where | null][] = [
    [closest, went],
    [from, closest],
    [from, went],
  ];
  for (const [a, b] of pairs) {
    if (!a || !b) continue;
    const [ax, ay] = spotOf(a, 0);
    const [bx, by] = spotOf(b, 0);
    if (Math.hypot(bx - ax, by - ay) < 1) continue;
    return snap45(angleOf(bx - ax, by - ay));
  }
  return null;
}

// "Where were they, and which way did they go?" in three taps: where you first
// saw them, the closest they got, and where they went. Each step can be picked
// again to move it. With a stand, the taps go on the map around it (with range
// rings); with no stand, on a target around you. North is up, or, with the
// compass on, the way you're facing is up.
export function WherePicker(props: {
  where: Where | null;
  headingDeg: number | null;
  wentTo: Where | null;
  cameFrom: Where | null;
  color: string;
  onChange(next: { where: Where | null; headingDeg: number | null; wentTo: Where | null; cameFrom: Where | null }): void;
  logged: Sighting[];
  // The stand on the map, when the hunt has one.
  map?: { at: [number, number]; base: 'topo' | 'satellite' | 'lidar' | 'infrared'; campMap: CampMap | null } | null;
}) {
  const compass = useCompass();
  // Up on the target: north, or the way the phone faces.
  const rotation = compass.heading ?? 0;
  const points: Record<Step, Where | null> = { from: props.cameFrom, closest: props.where, went: props.wentTo };
  // The next tap sets this one: the first not yet set, unless one is picked to move.
  const firstOpen = STEPS.find((s) => !points[s.step])?.step ?? null;
  const [picked, setPicked] = useState<Step | null>(null);
  const step = picked ?? firstOpen;
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [yardsText, setYardsText] = useState<string | null>(null);

  const set = (next: Record<Step, Where | null>) =>
    props.onChange({ where: next.closest, cameFrom: next.from, wentTo: next.went, headingDeg: headingFrom(next.from, next.closest, next.went) });

  const toLocal = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * 2 * SIZE - SIZE, ((event.clientY - box.top) / box.height) * 2 * SIZE - SIZE];
  };

  const onDown = (event: PointerEvent<SVGSVGElement>) => {
    const [x, y] = toLocal(event);
    press.current = { x, y, moved: false };
  };
  // A finger that moves is scrolling the page, not tapping.
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const p = press.current;
    if (!p) return;
    const [x, y] = toLocal(event);
    if (Math.hypot(x - p.x, y - p.y) >= DRAG) p.moved = true;
  };
  // A tap on the map: that spot as distance and direction from the stand.
  const placeOnMap = (which: Step, p: [number, number]) => {
    if (!props.map) return;
    const { bearingDeg, meters } = bearingAndMeters(props.map.at, p);
    const yards = Math.min(MAX_YARDS, Math.max(1, Math.round(meters / 0.9144)));
    setYardsText(null);
    set({ ...points, [which]: { bearingDeg: (Math.round(bearingDeg / 5) * 5) % 360, yards } });
  };
  const tapMap = (p: [number, number]) => {
    if (!step) return;
    setPicked(null);
    placeOnMap(step, p);
  };
  // Dragging a point on the map moves just that point.
  const movePoint = (which: PointKind, p: [number, number]) => placeOnMap(which, p);

  const onUp = (event: PointerEvent<SVGSVGElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || p.moved || !step) return;
    const [x, y] = toLocal(event);
    const r = Math.hypot(x, y);
    const k = r > OUTER ? OUTER / r : 1;
    setYardsText(null);
    setPicked(null);
    set({ ...points, [step]: whereOf(x * k, y * k, rotation) });
  };

  const spot = (w: Where | null) => (w ? spotOf(w, rotation) : null);
  const fromXY = spot(props.cameFrom);
  const closestXY = spot(props.where);
  const wentXY = spot(props.wentTo);
  // The line: first seen, through the closest, to where they went.
  const line = [fromXY, closestXY, wentXY].filter((p): p is [number, number] => p !== null);
  const pillAt = closestXY ?? fromXY;
  const hint = step
    ? STEPS.find((s) => s.step === step)!.hint
    : props.map
      ? 'Drag a point to adjust it, or tap a step above and then the map.'
      : 'Tap a step above, then the target, to move it.';

  return (
    <div className="where-picker">
      <div className="where-head">
        <span>Where, and which way?</span>
        <span className="muted">{hint}</span>
      </div>

      <div className="where-steps" role="group" aria-label="Which point the next tap sets">
        {STEPS.map((s, i) => (
          <button key={s.step} className={`where-step${step === s.step ? ' on' : ''}${points[s.step] ? ' set' : ''}`} onClick={() => setPicked(step === s.step ? null : s.step)}>
            <span className="where-step-name">
              {i + 1}. {s.label}
            </span>
            <span className="where-step-value">{points[s.step] ? whereLabel({ fromStand: points[s.step] }) : '—'}</span>
          </button>
        ))}
      </div>

      {props.map ? (
        <StandMap
          at={props.map.at}
          sightings={props.logged}
          base={props.map.base}
          campMap={props.map.campMap}
          draft={{ cameFrom: props.cameFrom, fromStand: props.where, wentTo: props.wentTo, color: props.color }}
          onTap={tapMap}
          onMovePoint={movePoint}
          bearing={rotation}
        />
      ) : (
      <svg
        className={step ? 'tapping' : undefined}
        viewBox={`${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (press.current = null)}
        role="img"
        aria-label={hint}
      >
        <defs>
          <marker id="where-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className="where-arrowhead" />
          </marker>
        </defs>
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
        {DISTANCE_BANDS.map((band) => (
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
          .filter((s) => s.fromStand || s.cameFrom)
          .map((s) => {
            const pts = [s.cameFrom, s.fromStand, s.wentTo].filter((w): w is Where => !!w).map((w) => spotOf(w, rotation));
            const at = s.fromStand ? spotOf(s.fromStand, rotation) : pts[0];
            return (
              <g key={s.id}>
                {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} className="where-path faded" markerEnd={s.wentTo ? 'url(#where-arrow)' : undefined} />}
                <Pill x={at[0]} y={at[1]} heading={s.headingDeg === null ? null : s.headingDeg - rotation} color={kindInfo(s.kind).color} size={0.75} faded />
              </g>
            );
          })}

        <circle r={9} className="where-stand" />
        {line.length > 1 && <polyline points={line.map((p) => p.join(',')).join(' ')} className="where-path" markerEnd={wentXY ? 'url(#where-arrow)' : undefined} />}
        {fromXY && <circle cx={fromXY[0]} cy={fromXY[1]} r={4.5} className="where-from-dot" />}
        {pillAt && <Pill x={pillAt[0]} y={pillAt[1]} heading={props.headingDeg === null ? null : props.headingDeg - rotation} color={props.color} size={1} />}
      </svg>
      )}
      {props.map && <p className="field-hint where-map-hint">Rings are 25, 50, 100 and 150 yd from the stand. Two fingers move the map.</p>}

      <div className="where-yards-row">
        <label>
          <span>Closest</span>
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
              if (props.where && e.target.value !== '' && yards >= 1) set({ ...points, closest: { ...props.where, yards: Math.min(MAX_YARDS, Math.round(yards)) } });
            }}
            onBlur={() => setYardsText(null)}
            aria-label="Closest it got, yards from the stand"
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
        {(props.where || props.cameFrom || props.wentTo) && (
          <button
            className="where-chip"
            onClick={() => (setYardsText(null), setPicked(null), props.onChange({ where: null, headingDeg: null, wentTo: null, cameFrom: null }))}
            aria-label="Clear where and which way"
          >
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
