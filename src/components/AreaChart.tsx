import { useRef, useState, type PointerEvent } from 'react';

export interface ChartPoint {
  time: number;
  value: number;
}

interface AreaChartProps {
  title: string;
  points: ChartPoint[];
  color: string;
  format(value: number): string;
  // Fixed y range, e.g. 0-100 for percentages; otherwise fitted to the data.
  domain?: [number, number];
  // The time slider's position, drawn as a vertical marker.
  markerTime: number;
}

const WIDTH = 280;
const HEIGHT = 64;
const PAD = { top: 6, right: 4, bottom: 4, left: 4 };

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A small single-series area chart: 2px line over a light wash, recessive
// baseline, crosshair + tooltip on hover.
export function AreaChart({ title, points, color, format, domain, markerTime }: AreaChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const values = points.map((p) => p.value);
  let [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  if (!domain) {
    // Pad a fitted range so a flat line doesn't hug the edges.
    const pad = Math.max(1, (hi - lo) * 0.2);
    lo -= pad;
    hi += pad;
  }
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (WIDTH - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (HEIGHT - PAD.top - PAD.bottom);
  const baseline = HEIGHT - PAD.bottom;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${baseline}L${x(t0).toFixed(1)},${baseline}Z`;

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.time) - px) < Math.abs(x(points[nearest].time) - px)) nearest = i;
    });
    setHover(nearest);
  };

  const hovered = hover === null ? null : points[hover];
  const markerInside = markerTime >= t0 && markerTime <= t1;
  const low = Math.min(...values);
  const high = Math.max(...values);

  return (
    <figure className="area-chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        <span className="chart-range">
          {low === high ? format(low) : `${format(low)} – ${format(high)}`}
        </span>
      </figcaption>
      <div className="chart-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: ${points.map((p) => `${formatTime(p.time)} ${format(p.value)}`).join(', ')}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={baseline} y2={baseline} className="chart-baseline" />
          <path d={area} fill={color} fillOpacity={0.12} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {markerInside && (
            <line x1={x(markerTime)} x2={x(markerTime)} y1={PAD.top - 4} y2={baseline} className="chart-marker" vectorEffect="non-scaling-stroke" />
          )}
          {hovered && (
            <line x1={x(hovered.time)} x2={x(hovered.time)} y1={0} y2={baseline} className="chart-crosshair" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hovered && (
          <div
            className="chart-tooltip"
            // Near either edge, pin the tooltip to that edge instead of centring
            // it on the pointer, so it never spills out of the sidebar.
            style={(() => {
              const fraction = x(hovered.time) / WIDTH;
              if (fraction < 0.25) return { left: 0, transform: 'none' };
              if (fraction > 0.75) return { right: 0, transform: 'none' };
              return { left: `${fraction * 100}%` };
            })()}
            role="status"
          >
            <strong>{format(hovered.value)}</strong>
            <span>{formatTime(hovered.time)}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
