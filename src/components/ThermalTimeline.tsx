import type { ThermalDay } from '@/lib/thermals';

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const LABELS = { falling: 'Falling', rising: 'Rising', switching: 'Switching' } as const;

// A stand's thermal day: falling (blue), switching and rising (amber) on its
// own slope, from before first light to after dark, with the picked time marked.
export function ThermalTimeline({ day, time }: { day: ThermalDay; time: number }) {
  const span = day.end - day.start;
  const at = (t: number) => `${((t - day.start) / span) * 100}%`;
  const inside = time >= day.start && time <= day.end;
  return (
    <div className="field thermal-timeline">
      <div className="field-label">Thermals that day</div>
      <div className="thermal-bar" role="img" aria-label={day.segments.map((s) => `${LABELS[s.phase]} ${clock(s.from)} to ${clock(s.to)}`).join(', ')}>
        {day.segments.map((s) => (
          <span
            key={s.from}
            className={`thermal-seg ${s.phase}`}
            style={{ left: at(s.from), width: `${((s.to - s.from) / span) * 100}%` }}
            title={`${LABELS[s.phase]}: ${clock(s.from)} – ${clock(s.to)}`}
          />
        ))}
        {inside && <span className="thermal-now-mark" style={{ left: at(time) }} />}
      </div>
      {/* When it turns uphill and back down, then sunrise and sunset on their own row, so they never overlap. */}
      <div className="thermal-ticks">
        {day.rise !== null && <span style={{ left: at(day.rise) }}>↑ {clock(day.rise)}</span>}
        {day.fall !== null && <span style={{ left: at(day.fall) }}>↓ {clock(day.fall)}</span>}
      </div>
      <div className="thermal-ticks sun">
        <span style={{ left: at(day.sunrise) }}>☀ {clock(day.sunrise)}</span>
        <span style={{ left: at(day.sunset) }}>☾ {clock(day.sunset)}</span>
      </div>
      <div className="thermal-legend">
        <span><i className="thermal-seg falling" /> Falling (downhill)</span>
        <span><i className="thermal-seg switching" /> Switching</span>
        <span><i className="thermal-seg rising" /> Rising (uphill)</span>
      </div>
      {day.advice.map((line) => (
        <p key={line} className="hint">{line}</p>
      ))}
    </div>
  );
}
