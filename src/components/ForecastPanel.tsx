import { compassPointOf, RATING_LABELS, type RatedStand, type Sit, type StandRating } from '@/lib/standRating';
import { hourAt, type Forecast } from '@/lib/weather';
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
  selectedTime: number;
  ratedStands: RatedStand[];
  onPropertyChange(id: string | null): void;
  onTimeChange(time: number): void;
  onPickStand(id: string): void;
  onRefresh(): void;
  onClose(): void;
}

const HOURS_SHOWN = 36;
const HOUR = 3600_000;
const GROUPS: StandRating[] = ['good', 'ok', 'bad', 'unset'];

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
  const { state, properties, propertyId, sits, selectedTime, ratedStands } = props;

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
      {state.status === 'ready' && <ReadyForecast {...props} forecast={state.forecast} sits={sits} selectedTime={selectedTime} ratedStands={ratedStands} />}
    </div>
  );
}

function ReadyForecast(props: ForecastPanelProps & { forecast: Forecast }) {
  const { forecast, sits, selectedTime, ratedStands } = props;
  const hour = hourAt(forecast, selectedTime);
  const threeHoursBefore = hourAt(forecast, hour.time - 3 * HOUR);
  const pressureChange = hour.pressureHpa - threeHoursBefore.pressureHpa;
  const pressureTrend = pressureChange > 0.7 ? 'rising' : pressureChange < -0.7 ? 'falling' : 'steady';
  const day = forecast.days.find((d) => d.sunrise - 6 * HOUR <= hour.time && hour.time < d.sunset + 6 * HOUR);
  const now = Date.now();
  const hours = forecast.hours.filter((h) => h.time >= now - HOUR).slice(0, HOURS_SHOWN);
  const selectedSit = sits.find((s) => hourAt(forecast, s.time).time === hour.time);
  const updatedMinutes = Math.round((now - forecast.fetchedAt) / 60_000);

  return (
    <>
      <div className="sit-chips">
        {sits.map((sit) => (
          <button key={sit.id} className={selectedSit?.id === sit.id ? 'active' : ''} onClick={() => props.onTimeChange(sit.time)}>
            {sit.label}
          </button>
        ))}
      </div>

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
          <span>{hour.precipChance}% rain</span>
          <span>{hour.cloudCover}% clouds</span>
          <span>Pressure {pressureTrend}</span>
          {day && <span>Sunrise {formatClock(day.sunrise)}</span>}
          {day && <span>Sunset {formatClock(day.sunset)}</span>}
        </div>
      </div>

      <div className="hour-strip" role="list">
        {hours.map((h) => (
          <button
            key={h.time}
            role="listitem"
            className={`hour${h.time === hour.time ? ' active' : ''}`}
            onClick={() => props.onTimeChange(h.time)}
            title={`${compassPointOf(h.windFromDeg)} ${Math.round(h.windMph)} mph`}
          >
            <span className="hour-time">{formatHour(h.time)}</span>
            <WindArrow fromDeg={h.windFromDeg} />
            <span className="hour-wind">{Math.round(h.windMph)}</span>
          </button>
        ))}
      </div>

      {ratedStands.length === 0 ? (
        <p className="empty">Add stands with their good winds to get recommendations.</p>
      ) : (
        GROUPS.map((group) => {
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
                    <button className="row rated" onClick={() => props.onPickStand(r.stand.id)}>
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
        })
      )}

      <p className="hint forecast-source">
        Forecast from Open-Meteo, updated {updatedMinutes < 1 ? 'just now' : `${updatedMinutes} min ago`}.{' '}
        <button className="link" onClick={props.onRefresh}>
          Refresh
        </button>
      </p>
    </>
  );
}
