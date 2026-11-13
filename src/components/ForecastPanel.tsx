import { useEffect, useRef, useState } from 'react';
import { thermalSummary, type ThermalState } from '@/lib/thermals';
import { Icon } from '@/components/Icon';

import { AreaChart } from '@/components/AreaChart';
import { DEFAULT_RUT_PEAK, drivers, rutPhase, type Opportunity, type WindowScore } from '@/lib/deerActivity';
import { compassPointOf, RATING_LABELS, todayIndex, type RatedStand, type Sit, type StandRating } from '@/lib/standRating';
import { hourAt, hoursBetween, weatherAt, type Forecast, type ForecastHour, formatPressure, inHg, pressureAt } from '@/lib/weather';
import type { Property } from '@/types/models';

export type ForecastState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; forecast: Forecast };

interface ForecastPanelProps {
  state: ForecastState;
  properties: Property[];
  // null = all stands.
  propertyId: string | null;
  sits: Sit[];
  // The picked sit, or null when a single hour was picked from the strip.
  sitId: string | null;
  // Where the time slider is (or the picked hour).
  selectedTime: number;
  ratedStands: RatedStand[];
  // Rating groups whose cones are shown on the map.
  coneGroups: StandRating[];
  onToggleCones(group: StandRating): void;
  // Every group's cones on at once, or all off.
  onSetConeGroups(groups: StandRating[]): void;
  // Thermals at the picked time, and whether their scent paths show on the map.
  thermal: ThermalState | null;
  showThermals: boolean;
  onToggleThermals(): void;
  onPropertyChange(id: string | null): void;
  onSitChange(sit: Sit): void;
  // Slider moved within the current sit. Must be a stable function.
  onTimeChange(time: number): void;
  // A single hour picked from the strip, leaving the sit.
  onHourPick(time: number): void;
  onPickStand(id: string): void;
  onRefresh(): void;
  onClose(): void;
  // Deer activity for each morning and evening sit, by sit id.
  activity: Record<string, WindowScore>;
  // Hunting Opportunity for each stand in the picked sit, by stand id.
  opportunities: Record<string, Opportunity>;
  // Camera evidence for the activity card.
  evidence: { daylightBucks: number; newest: number | null; taggedOnly: boolean } | null;
  rutPeak: string | undefined;
  onRutPeakChange(peak: string): void;
}

const HOURS_SHOWN = 36;
const HOUR = 3600_000;
// Play glides through the whole sit in this long, whatever its length.
const PLAY_DURATION_MS = 14_000;
// How often play moves the time: about 30 a second keeps the cones and paths
// fluid without redrawing the map more than it can keep up with.
const PLAY_FRAME_MS = 33;
const GROUPS: StandRating[] = ['good', 'ok', 'bad', 'unset'];

// Chart hues, checked for contrast and color-blind separation on the dark panels.
const TEMP_COLOR = '#d96f17';
const WIND_COLOR = '#1f97c9';
const RAIN_COLOR = '#9a7af5';
const PRESSURE_COLOR = '#199e70';

function formatHour(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric' });
}

function formatClock(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Small arrow pointing where the wind blows to.
function WindArrow({ fromDeg, size = 16 }: { fromDeg: number; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="wind-mini" aria-hidden>
      <g transform={`rotate(${fromDeg + 180} 12 12)`}>
        <path d="M12 3 18 15h-4.5V21h-3V15H6Z" fill="currentColor" />
      </g>
    </svg>
  );
}

export function ForecastPanel(props: ForecastPanelProps) {
  const { state, properties, propertyId } = props;

  return (
    <div className="forecast">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>Hunt Forecast</h2>
      </div>

      {properties.length > 1 && (
        <select
          className="forecast-property"
          value={propertyId ?? ''}
          onChange={(e) => props.onPropertyChange(e.target.value || null)}
          aria-label="Property"
        >
          <option value="">All stands</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {state.status === 'loading' && <p className="empty">Getting the forecast…</p>}
      {state.status === 'error' && (
        <div className="forecast-error">
          <p className="empty">Couldn't get the forecast: {state.message}. The weather needs an internet connection.</p>
          <button onClick={props.onRefresh}>Try again</button>
        </div>
      )}
      {state.status === 'ready' && <ReadyForecast {...props} forecast={state.forecast} />}
    </div>
  );
}

function ReadyForecast(props: ForecastPanelProps & { forecast: Forecast }) {
  const { forecast, sits, sitId, selectedTime, ratedStands } = props;
  const sit = sits.find((s) => s.id === sitId) ?? null;
  const now = Date.now();
  const strip = forecast.hours.filter((h) => h.time >= now - HOUR).slice(0, HOURS_SHOWN);
  const updatedMinutes = Math.round((now - forecast.fetchedAt) / 60_000);
  const stripHour = sit ? null : hourAt(forecast, selectedTime).time;

  return (
    <>
      <DayCards forecast={forecast} sits={sits} sitId={sitId} activity={props.activity} onSitChange={props.onSitChange} />

      {sit && props.activity[sit.id] && (
        <ActivityCard score={props.activity[sit.id]} sit={sit} evidence={props.evidence} rutPeak={props.rutPeak} onRutPeakChange={props.onRutPeakChange} />
      )}

      {sit ? (
        <SitWeather forecast={forecast} sit={sit} selectedTime={selectedTime} onTimeChange={props.onTimeChange} />
      ) : (
        <HourWeather forecast={forecast} hour={hourAt(forecast, selectedTime)} />
      )}

      <div className="hour-strip" role="list" aria-label="Hourly wind">
        {strip.map((h) => (
          <button
            key={h.time}
            role="listitem"
            className={`hour${h.time === stripHour ? ' active' : ''}`}
            onClick={() => props.onHourPick(h.time)}
            title={`${compassPointOf(h.windFromDeg)} ${Math.round(h.windMph)} mph`}
          >
            <span className="hour-time">{formatHour(h.time)}</span>
            <WindArrow fromDeg={h.windFromDeg} />
            <span className="hour-wind">{Math.round(h.windMph)}</span>
          </button>
        ))}
      </div>

      {props.thermal && <ThermalCard thermal={props.thermal} show={props.showThermals} onToggle={props.onToggleThermals} />}

      <StandList ratedStands={ratedStands} time={selectedTime} onPickStand={props.onPickStand} coneGroups={props.coneGroups} onToggleCones={props.onToggleCones} onSetConeGroups={props.onSetConeGroups} opportunities={props.opportunities} />

      <p className="hint forecast-source">
        Forecast from Open-Meteo, updated {updatedMinutes < 1 ? 'just now' : `${updatedMinutes} min ago`}.{' '}
        <button className="link" onClick={props.onRefresh}>
          Refresh
        </button>
      </p>
    </>
  );
}

// The whole sit: ranges, area graphs, and a slider that moves the scent cones.
function SitWeather({
  forecast,
  sit,
  selectedTime,
  onTimeChange,
}: {
  forecast: Forecast;
  sit: Sit;
  selectedTime: number;
  onTimeChange(time: number): void;
}) {
  const [playing, setPlaying] = useState(false);
  const hours = hoursBetween(forecast, sit.start, sit.end);
  const at = weatherAt(forecast, selectedTime);
  const temps = hours.map((h) => h.tempF);
  const speeds = hours.map((h) => h.windMph);
  const firstWind = compassPointOf(hours[0].windFromDeg);
  const lastWind = compassPointOf(hours[hours.length - 1].windFromDeg);
  const maxGust = Math.max(...hours.map((h) => h.gustMph));
  const maxRain = Math.max(...hours.map((h) => h.precipChance));
  // Whole forecast hours inside the sit, so blended end points aren't counted twice.
  const rainInches = forecast.hours.filter((h) => h.time >= sit.start && h.time < sit.end).reduce((t, h) => t + h.precipIn, 0);
  const day = forecast.days.find((d) => d.sunrise - 6 * HOUR <= sit.peak && sit.peak < d.sunset + 6 * HOUR);
  const pressure = pressureAt(forecast, sit.start);
  const pressureEnd = pressureAt(forecast, sit.end);

  // Play glides the time through the sit, then stops at the end. It runs on
  // the screen's frames and moves by the real time since the last one, so it
  // keeps an even pace however busy the PC is.
  const timeRef = useRef(selectedTime);
  timeRef.current = selectedTime;
  useEffect(() => {
    if (!playing) return;
    const perMs = (sit.end - sit.start) / PLAY_DURATION_MS;
    let frame = 0;
    let last = performance.now();
    let sent = last;
    let time = timeRef.current;
    const tick = (now: number) => {
      time += (now - last) * perMs;
      last = now;
      if (time >= sit.end) {
        onTimeChange(sit.end);
        setPlaying(false);
        return;
      }
      if (now - sent >= PLAY_FRAME_MS) {
        sent = now;
        onTimeChange(time);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, sit.start, sit.end, onTimeChange]);

  // Dragging on any chart moves the time, the same as the slider.
  const scrub = (time: number) => {
    setPlaying(false);
    onTimeChange(Math.min(sit.end, Math.max(sit.start, time)));
  };

  const toChart = (pick: (h: ForecastHour) => number) => hours.map((h) => ({ time: h.time, value: pick(h) }));

  return (
    <div className="weather-card">
      <div className="sit-title">
        <span>{formatClock(sit.start)} – {formatClock(sit.end)}</span>
        {day && (
          <span className="muted">
            Sunrise {formatClock(day.sunrise)} · Sunset {formatClock(day.sunset)}
          </span>
        )}
      </div>

      <dl className="sit-stats">
        <div>
          <dt>Temp</dt>
          <dd>
            {Math.round(Math.min(...temps))}° – {Math.round(Math.max(...temps))}°F
          </dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>
            {firstWind === lastWind ? firstWind : `${firstWind} → ${lastWind}`} · {Math.round(Math.min(...speeds))}–
            {Math.round(Math.max(...speeds))} mph
          </dd>
        </div>
        <div>
          <dt>Gusts</dt>
          <dd>up to {Math.round(maxGust)} mph</dd>
        </div>
        <div>
          <dt>Rain</dt>
          <dd>
            {Math.round(maxRain)}% · {rainInches < 0.01 ? 'none expected' : `${rainInches.toFixed(2)} in`}
          </dd>
        </div>
        <div>
          <dt>Pressure</dt>
          <dd>
            {pressure.inHg.toFixed(2)} → {pressureEnd.inHg.toFixed(2)} inHg · {pressure.trend}
          </dd>
        </div>
      </dl>

      <AreaChart title="Temperature" points={toChart((h) => h.tempF)} color={TEMP_COLOR} format={(v) => `${Math.round(v)}°F`} markerTime={selectedTime} onScrub={scrub} />
      <AreaChart
        title="Wind speed"
        points={toChart((h) => h.windMph)}
        color={WIND_COLOR}
        format={(v) => `${Math.round(v)} mph`}
        domain={[0, Math.max(10, Math.ceil(Math.max(...hours.map((h) => h.gustMph)) / 5) * 5)]}
        markerTime={selectedTime}
        onScrub={scrub}
      />
      <div className="wind-track" aria-label="Wind direction through the sit">
        {hours.map((h) => (
          <span key={h.time} title={`${formatClock(h.time)}: ${compassPointOf(h.windFromDeg)}`}>
            <WindArrow fromDeg={h.windFromDeg} size={14} />
          </span>
        ))}
      </div>
      <AreaChart
        title="Rain chance"
        points={toChart((h) => h.precipChance)}
        color={RAIN_COLOR}
        format={(v) => `${Math.round(v)}%`}
        domain={[0, 100]}
        markerTime={selectedTime}
        onScrub={scrub}
      />
      <AreaChart
        title="Pressure"
        points={toChart((h) => inHg(h.pressureHpa))}
        color={PRESSURE_COLOR}
        format={(v) => `${v.toFixed(2)} inHg`}
        minPad={0.02}
        markerTime={selectedTime}
        onScrub={scrub}
      />

      <div className="sit-slider">
        <button
          className="play"
          onClick={() => {
            if (!playing && selectedTime >= sit.end) onTimeChange(sit.start);
            setPlaying(!playing);
          }}
          aria-label={playing ? 'Pause' : 'Play through the sit'}
          title={playing ? 'Pause' : 'Play through the sit'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <input
          type="range"
          min={sit.start}
          max={sit.end}
          step={60_000}
          value={Math.min(sit.end, Math.max(sit.start, selectedTime))}
          onChange={(e) => {
            setPlaying(false);
            onTimeChange(Number(e.target.value));
          }}
          aria-label="Time during the sit"
        />
      </div>
      <p className="slider-readout">
        <strong>{formatClock(selectedTime)}</strong> · {compassPointOf(at.windFromDeg)} {Math.round(at.windMph)} mph ·{' '}
        {Math.round(at.tempF)}°F
        <span className="muted"> · drag here or on any chart to move the time</span>
      </p>
    </div>
  );
}

// A single hour picked from the strip.
function HourWeather({ forecast, hour }: { forecast: Forecast; hour: ForecastHour }) {
  const pressure = pressureAt(forecast, hour.time);
  const day = forecast.days.find((d) => d.sunrise - 6 * HOUR <= hour.time && hour.time < d.sunset + 6 * HOUR);
  return (
    <div className="weather-card">
      <div className="weather-main">
        <WindArrow fromDeg={hour.windFromDeg} size={40} />
        <div>
          <div className="weather-wind">
            {compassPointOf(hour.windFromDeg)} wind · {Math.round(hour.windMph)} mph
          </div>
          <div className="muted">
            Gusts {Math.round(hour.gustMph)} mph · {new Date(hour.time).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })}
          </div>
        </div>
      </div>
      <div className="weather-grid">
        <span>{Math.round(hour.tempF)}°F</span>
        <span>{Math.round(hour.precipChance)}% rain</span>
        <span>{Math.round(hour.humidity)}% humidity</span>
        <span>{formatPressure(pressure)}</span>
        {day && <span>Sunrise {formatClock(day.sunrise)}</span>}
        {day && <span>Sunset {formatClock(day.sunset)}</span>}
      </div>
    </div>
  );
}

function StandList({
  ratedStands,
  time,
  onPickStand,
  coneGroups,
  onToggleCones,
  onSetConeGroups,
  opportunities,
}: {
  ratedStands: RatedStand[];
  time: number;
  onPickStand(id: string): void;
  coneGroups: StandRating[];
  onToggleCones(group: StandRating): void;
  onSetConeGroups(groups: StandRating[]): void;
  opportunities: Record<string, Opportunity>;
}) {
  if (ratedStands.length === 0) return <p className="empty">Add stands with their good winds to get recommendations.</p>;
  return (
    <>
      <div className="stands-at-row">
        <p className="hint stands-at">Stand picks for {formatClock(time)}. Click a stand to see its scent cone, or turn on Cones for a group.</p>
        <AllConesToggle ratedStands={ratedStands} coneGroups={coneGroups} onSetConeGroups={onSetConeGroups} />
      </div>
      {GROUPS.map((group) => {
        const items = ratedStands.filter((r) => r.rating === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="sidebar-section">
            <h2 className="group-head">
              <span>
                {RATING_LABELS[group]} <span className="count">{items.length}</span>
              </span>
              <button
                className={`cone-toggle${coneGroups.includes(group) ? ' on' : ''}`}
                aria-pressed={coneGroups.includes(group)}
                onClick={() => onToggleCones(group)}
                title={`Show scent cones for every ${RATING_LABELS[group].toLowerCase()} stand`}
              >
                Cones
              </button>
            </h2>
            <ul>
              {items.map((r) => (
                <li key={r.stand.id}>
                  <button className="row rated" onClick={() => onPickStand(r.stand.id)}>
                    <span className={`swatch rating-${r.rating}`} />
                    <span className="rated-text">
                      <span className="row-title">{r.stand.name}</span>
                      <span className="row-detail">{r.reason}</span>
                      {r.thermal && !r.reason.startsWith('Thermals') && <span className="row-detail thermal-note">{r.thermal.reason}</span>}
                    </span>
                    {opportunities[r.stand.id] && (
                      <span className={`opportunity score-${scoreTone(opportunities[r.stand.id].score)}`} title={`Hunting Opportunity: ${opportunities[r.stand.id].label}${opportunities[r.stand.id].why ? ` (${opportunities[r.stand.id].why})` : ''}`}>
                        {opportunities[r.stand.id].score}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// Low, moderate, high or very high, for colors.
function scoreTone(score: number): string {
  return score >= 75 ? 'vhigh' : score >= 55 ? 'high' : score >= 35 ? 'mid' : 'low';
}

const DAYS_SHOWN = 10;

// The next ten days as little calendar pages, each with its morning and evening sit.
function DayCards({
  forecast,
  sits,
  sitId,
  activity,
  onSitChange,
}: {
  forecast: Forecast;
  sits: Sit[];
  sitId: string | null;
  activity: Record<string, WindowScore>;
  onSitChange(sit: Sit): void;
}) {
  const now = Date.now();
  const first = todayIndex(forecast, now);
  const days = forecast.days.slice(first, first + DAYS_SHOWN);
  const nowSit = sits.find((s) => s.id === 'now');
  return (
    <div className="day-pick">
      {nowSit && (
        <button className={`now-chip${sitId === 'now' ? ' active' : ''}`} onClick={() => onSitChange(nowSit)}>
          Right now
        </button>
      )}
      <div className="day-cards">
        {days.map((day, i) => {
          const date = new Date(day.sunrise);
          const halves = (['am', 'pm'] as const).map((half) => ({ half, sit: sits.find((s) => s.id === `${day.date}-${half}`) ?? null }));
          const scores = halves.map((h) => (h.sit ? activity[h.sit.id] : undefined)).filter((x): x is WindowScore => Boolean(x));
          const best = scores.length ? Math.max(...scores.map((x) => x.score)) : null;
          const picked = halves.some((h) => h.sit?.id === sitId);
          return (
            <div key={day.date} className={`day-card${picked ? ' active' : ''}`}>
              <div className="day-card-head">
                <span className="day-card-name">{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="day-card-date">
                  <small>{date.toLocaleDateString(undefined, { month: 'short' })}</small>
                  {date.getDate()}
                </span>
              </div>
              <div className="day-card-best" title="The day's best window">
                {best === null ? '–' : best}
                <small>{best === null ? '' : 'day'}</small>
              </div>
              {halves.map(({ half, sit }) => {
                const score = sit ? activity[sit.id] : undefined;
                return (
                  <button
                    key={half}
                    className={`day-half${sit && sit.id === sitId ? ' active' : ''}${score ? ` score-${scoreTone(score.score)}` : ''}`}
                    disabled={!sit}
                    onClick={() => sit && onSitChange(sit)}
                    title={sit ? `${sit.label}: ${score ? `deer activity ${score.score} (${score.label})` : ''}` : 'Already past'}
                  >
                    <span>{half.toUpperCase()}</span>
                    <strong>{sit ? (score ? score.score : '·') : 'past'}</strong>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The picked sit's Deer Activity Projection: score, confidence, why, and the rut setting.
function ActivityCard({
  score,
  sit,
  evidence,
  rutPeak,
  onRutPeakChange,
}: {
  score: WindowScore;
  sit: Sit;
  evidence: { daylightBucks: number; newest: number | null; taggedOnly: boolean } | null;
  rutPeak: string | undefined;
  onRutPeakChange(peak: string): void;
}) {
  const [editingPeak, setEditingPeak] = useState(false);
  const peak = rutPeak ?? DEFAULT_RUT_PEAK;
  const [month, day] = peak.split('-').map(Number);
  const { up, down } = drivers(score);
  const phase = rutPhase(sit.peak, peak);
  const ageHours = evidence?.newest ? Math.round((Date.now() - evidence.newest) / 3600_000) : null;
  return (
    <div className={`activity-card score-${scoreTone(score.score)}`}>
      <div className="activity-head">
        <div>
          <div className="activity-title">Deer activity · {sit.label}</div>
          <div className="activity-score">
            {score.score}
            <small> / 100 · {score.label}</small>
          </div>
        </div>
        <span className={`confidence confidence-${score.confidence.toLowerCase()}`} title={score.confidenceWhy}>
          {score.confidence} confidence
        </span>
      </div>
      <div className="activity-bar">
        <span style={{ width: `${score.score}%` }} />
      </div>

      <div className="activity-why">
        {up.length > 0 && (
          <ul className="drivers up">
            {up.map((p) => (
              <li key={p.part}>
                <strong>{p.name}</strong> {p.why}
              </li>
            ))}
          </ul>
        )}
        {down.length > 0 && (
          <ul className="drivers down">
            {down.map((p) => (
              <li key={p.part}>
                <strong>{p.name}</strong> {p.why}
              </li>
            ))}
          </ul>
        )}
        {score.missing.map((m) => (
          <p key={m.name} className="hint">
            <strong>{m.name}</strong> left out: {m.why}
          </p>
        ))}
      </div>

      {evidence && evidence.newest !== null && (
        <p className="hint">
          {evidence.daylightBucks > 0 ? `Your cameras caught ${evidence.daylightBucks} daylight buck visit${evidence.daylightBucks === 1 ? '' : 's'} in the last 48 hours. ` : ''}
          Newest camera photo: {ageHours! < 1 ? 'under an hour' : ageHours! < 48 ? `${ageHours} hours` : `${Math.round(ageHours! / 24)} days`} old.
          {!evidence.taggedOnly && ' No photos tagged as deer yet, so animal photos are counted.'}
        </p>
      )}

      <div className="rut-row">
        <span>
          {phase.name} · rut peak {MONTHS[month - 1]} {day}
        </span>
        {editingPeak ? (
          <input
            type="date"
            aria-label="Rut peak date"
            defaultValue={`${new Date().getFullYear()}-${peak}`}
            onChange={(e) => {
              if (e.target.value) {
                onRutPeakChange(e.target.value.slice(5));
                setEditingPeak(false);
              }
            }}
            onBlur={() => setEditingPeak(false)}
            autoFocus
          />
        ) : (
          <button className="link" onClick={() => setEditingPeak(true)} title="The local peak of breeding; the score's season curve centers on it">
            Change
          </button>
        )}
      </div>
      <p className="hint activity-note">An estimate of how active deer are likely to be, not the chance of seeing one. It uses the internet weather forecast and the rut date only, not your cameras or hunt logs. Stand numbers below are Hunting Opportunity: activity plus wind, scent and conditions at that stand.</p>
    </div>
  );
}

// Every stand's scent cone on the map at once, or all of them off.
function AllConesToggle({ ratedStands, coneGroups, onSetConeGroups }: { ratedStands: RatedStand[]; coneGroups: StandRating[]; onSetConeGroups(groups: StandRating[]): void }) {
  const present = GROUPS.filter((g) => ratedStands.some((r) => r.rating === g));
  const allOn = present.length > 0 && present.every((g) => coneGroups.includes(g));
  return (
    <button
      className={`cone-toggle all-cones${allOn ? ' on' : ''}`}
      aria-pressed={allOn}
      onClick={() => onSetConeGroups(allOn ? [] : present)}
      title={allOn ? 'Hide every scent cone' : 'Show the scent cone for every stand'}
    >
      All cones
    </button>
  );
}

// Which way thermals run at the picked time, and a switch for their scent paths on the map.
function ThermalCard({ thermal, show, onToggle }: { thermal: ThermalState; show: boolean; onToggle(): void }) {
  const advice =
    thermal.phase === 'switching'
      ? 'Air is changing direction; scent swirls around the stand for a while.'
      : thermal.strength === 'weak'
        ? 'The wind is carrying most of the scent; thermals only bend it.'
        : thermal.phase === 'falling'
          ? 'Scent sinks and drains downhill into draws and bottoms. Hunt above where deer travel.'
          : 'Scent rises up the slopes toward the ridges. Hunt below where deer travel.';
  return (
    <section className={`sidebar-section thermal-card thermal-${thermal.phase}`}>
      <div className="thermal-head">
        <h2>Thermals</h2>
        <button className={`cone-toggle thermal-toggle${show ? ' on' : ''}`} aria-pressed={show} onClick={onToggle} title="Show where thermals carry scent from stands with a cone on the map">
          Show paths
        </button>
      </div>
      <p className="thermal-now">{thermalSummary(thermal)}</p>
      <p className="hint">
        {advice} Strength here is for open ground; a stand tucked below a ridge or in a hollow out of the wind feels thermals more, and its note says so. Paths show for stands with a scent cone.
      </p>
    </section>
  );
}
