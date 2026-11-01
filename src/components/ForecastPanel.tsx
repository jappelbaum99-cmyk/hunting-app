import { useEffect, useState } from 'react';

import { AreaChart } from '@/components/AreaChart';
import { compassPointOf, RATING_LABELS, type RatedStand, type Sit, type StandRating } from '@/lib/standRating';
import { hourAt, hoursBetween, weatherAt, type Forecast, type ForecastHour } from '@/lib/weather';
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
  onPropertyChange(id: string | null): void;
  onSitChange(sit: Sit): void;
  // Slider moved within the current sit. Must be a stable function.
  onTimeChange(time: number): void;
  // A single hour picked from the strip, leaving the sit.
  onHourPick(time: number): void;
  onPickStand(id: string): void;
  onRefresh(): void;
  onClose(): void;
}

const HOURS_SHOWN = 36;
const HOUR = 3600_000;
const SLIDER_STEP = 15 * 60_000;
const PLAY_INTERVAL_MS = 350;
const GROUPS: StandRating[] = ['good', 'ok', 'bad', 'unset'];

// Chart hues, checked for contrast and color-blind separation on the dark panels.
const TEMP_COLOR = '#d96f17';
const WIND_COLOR = '#1f97c9';
const RAIN_COLOR = '#9a7af5';

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
      <div className="sit-chips">
        {sits.map((s) => (
          <button key={s.id} className={s.id === sitId ? 'active' : ''} onClick={() => props.onSitChange(s)}>
            {s.label}
          </button>
        ))}
      </div>

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

      <StandList ratedStands={ratedStands} time={selectedTime} onPickStand={props.onPickStand} />

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

  // Play steps the slider through the sit, then stops at the end.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const next = selectedTime + SLIDER_STEP;
      if (next > sit.end) setPlaying(false);
      else onTimeChange(next);
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, selectedTime, sit.end, onTimeChange]);

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
      </dl>

      <AreaChart title="Temperature" points={toChart((h) => h.tempF)} color={TEMP_COLOR} format={(v) => `${Math.round(v)}°F`} markerTime={selectedTime} />
      <AreaChart
        title="Wind speed"
        points={toChart((h) => h.windMph)}
        color={WIND_COLOR}
        format={(v) => `${Math.round(v)} mph`}
        domain={[0, Math.max(10, Math.ceil(Math.max(...hours.map((h) => h.gustMph)) / 5) * 5)]}
        markerTime={selectedTime}
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
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={sit.start}
          max={sit.end}
          step={SLIDER_STEP}
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
        <span className="muted"> · drag to watch the scent cones move</span>
      </p>
    </div>
  );
}

// A single hour picked from the strip.
function HourWeather({ forecast, hour }: { forecast: Forecast; hour: ForecastHour }) {
  const threeHoursBefore = hourAt(forecast, hour.time - 3 * HOUR);
  const pressureChange = hour.pressureHpa - threeHoursBefore.pressureHpa;
  const pressureTrend = pressureChange > 0.7 ? 'rising' : pressureChange < -0.7 ? 'falling' : 'steady';
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
        <span>Pressure {pressureTrend}</span>
        {day && <span>Sunrise {formatClock(day.sunrise)}</span>}
        {day && <span>Sunset {formatClock(day.sunset)}</span>}
      </div>
    </div>
  );
}

function StandList({ ratedStands, time, onPickStand }: { ratedStands: RatedStand[]; time: number; onPickStand(id: string): void }) {
  if (ratedStands.length === 0) return <p className="empty">Add stands with their good winds to get recommendations.</p>;
  return (
    <>
      <p className="hint stands-at">Stand picks for {formatClock(time)}</p>
      {GROUPS.map((group) => {
        const items = ratedStands.filter((r) => r.rating === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="sidebar-section">
            <h2>
              {RATING_LABELS[group]} <span className="count">{items.length}</span>
            </h2>
            <ul>
              {items.map((r) => (
                <li key={r.stand.id}>
                  <button className="row rated" onClick={() => onPickStand(r.stand.id)}>
                    <span className={`swatch rating-${r.rating}`} />
                    <span className="rated-text">
                      <span className="row-title">{r.stand.name}</span>
                      <span className="row-detail">{r.reason}</span>
                    </span>
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
