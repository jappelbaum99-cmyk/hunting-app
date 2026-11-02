import { useState, type CSSProperties } from 'react';

import { AreaBadge } from '@/components/AreaBadge';
import { isPlotType, pinTypeInfo, isHuntingSpot } from '@/lib/featureTypes';
import { acresOf, formatAcres } from '@/lib/geo';
import { deerCount, otherAnimals } from '@/lib/huntStats';
import { areaTypeInfo } from '@/lib/styles';
import { formatDistance, lineLengthM, TRAIL_KINDS } from '@/lib/trails';
import type { HubSettings, HuntReport, MapArea, MapMarker, MapTrail, Property, Section, TrailKind } from '@/types/models';

interface SummaryPanelProps {
  properties: Property[];
  areas: MapArea[];
  markers: MapMarker[];
  trails: MapTrail[];
  sections: Section[];
  reports: HuntReport[];
  settings: HubSettings;
  onPickStand(id: string): void;
  onClose(): void;
}

// A season runs July through June, so one fall's hunting stays together: "2026–27".
function seasonOf(iso: string): string {
  const d = new Date(iso);
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}–${String(start + 1).slice(-2)}`;
}

// Months in season order, July first.
const SEASON_MONTHS = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The whole place at a glance: land, hunting locations, trails, and what the hunting has produced.
export function SummaryPanel(props: SummaryPanelProps) {
  const [propertyId, setPropertyId] = useState<string>('');
  const onProperty = <T extends { propertyId: string | null }>(r: T) => !propertyId || r.propertyId === propertyId;

  const properties = props.properties.filter((p) => !propertyId || p.id === propertyId);
  const areas = props.areas.filter(onProperty);
  const markers = props.markers.filter(onProperty);
  const trails = props.trails.filter(onProperty);
  const sections = props.sections.filter(onProperty);
  const standIds = new Set(markers.map((m) => m.id));
  const reports = props.reports.filter((r) => !propertyId || r.propertyId === propertyId || (r.standId !== null && standIds.has(r.standId)));

  // Land
  const totalAcres = properties.reduce((t, p) => t + acresOf(p.boundary), 0);
  const plots = areas.filter((a) => isPlotType(a.type, areaTypeInfo(a.type, props.settings).label));
  const plotAcres = plots.reduce((t, a) => t + acresOf(a.geometry), 0);
  const plantings = new Map<string, number>();
  for (const a of plots) plantings.set(a.planted?.trim() || 'Not set', (plantings.get(a.planted?.trim() || 'Not set') ?? 0) + acresOf(a.geometry));
  const byAreaType = new Map<string, { acres: number; count: number }>();
  for (const a of areas) {
    const entry = byAreaType.get(a.type) ?? { acres: 0, count: 0 };
    entry.acres += acresOf(a.geometry);
    entry.count += 1;
    byAreaType.set(a.type, entry);
  }

  // Hunting locations and pins
  const custom = props.settings.customPinTypes;
  const countBy = (list: MapMarker[]) => {
    const counts = new Map<string, number>();
    for (const m of list) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  const spots = markers.filter((m) => isHuntingSpot(m.type, custom));
  const pins = markers.filter((m) => !isHuntingSpot(m.type, custom));

  // Trails
  const trailMeters = new Map<TrailKind, number>();
  for (const t of trails) trailMeters.set(t.kind, (trailMeters.get(t.kind) ?? 0) + lineLengthM(t.line.coordinates));
  const totalTrail = [...trailMeters.values()].reduce((a, b) => a + b, 0);

  // Hunting, by season
  const seasons = [...new Set(reports.map((r) => seasonOf(r.start)))].sort().reverse();
  const [seasonPick, setSeasonPick] = useState<string | null>(null);
  const season = seasonPick && seasons.includes(seasonPick) ? seasonPick : seasons[0] ?? null;
  const seasonReports = season ? reports.filter((r) => seasonOf(r.start) === season) : [];
  const hours = seasonReports.reduce((t, r) => t + (r.end ? Math.max(0, Date.parse(r.end) - Date.parse(r.start)) / 3_600_000 : 0), 0);
  const deer = deerCount(seasonReports);
  const bucks = deerCount(seasonReports, 'buck');
  const others = otherAnimals(seasonReports);

  const months = SEASON_MONTHS.map((m) => {
    const list = seasonReports.filter((r) => new Date(r.start).getMonth() === m);
    return { month: m, hunts: list.length, deer: deerCount(list), bucks: deerCount(list, 'buck') };
  });
  // Show from the first month with a hunt to the last.
  const first = months.findIndex((m) => m.hunts > 0);
  const last = months.length - 1 - [...months].reverse().findIndex((m) => m.hunts > 0);
  const shownMonths = first === -1 ? [] : months.slice(first, last + 1);

  // Best day: the most deer seen in one day (bucks break ties).
  const days = new Map<string, HuntReport[]>();
  for (const r of seasonReports) {
    const key = new Date(r.start).toDateString();
    days.set(key, [...(days.get(key) ?? []), r]);
  }
  const bestDay = [...days.values()]
    .map((list) => ({ list, deer: deerCount(list), bucks: deerCount(list, 'buck') }))
    .filter((d) => d.deer > 0)
    .sort((a, b) => b.deer - a.deer || b.bucks - a.bucks)[0];
  const bestDayStands = bestDay
    ? [...new Set(bestDay.list.map((r) => props.markers.find((m) => m.id === r.standId)?.name ?? 'No stand'))].join(', ')
    : '';
  const half = (morning: boolean) => {
    const list = seasonReports.filter((r) => new Date(r.start).getHours() < 12 === morning);
    return { hunts: list.length, deer: deerCount(list) };
  };
  const mornings = half(true);
  const evenings = half(false);

  // Best stands this season: most deer per hunt, with at least two hunts.
  const standRows = spots
    .map((s) => {
      const list = seasonReports.filter((r) => r.standId === s.id);
      return { stand: s, hunts: list.length, deer: deerCount(list) };
    })
    .filter((r) => r.hunts >= 2)
    .sort((a, b) => b.deer / b.hunts - a.deer / a.hunts)
    .slice(0, 3);

  return (
    <div className="forecast summary">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>Summary</h2>
      </div>

      {props.properties.length > 1 && (
        <select className="summary-filter" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property">
          <option value="">All properties</option>
          {props.properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      <div className="stat-tiles summary-tiles">
        <Tile value={formatAcres(totalAcres).replace(' ac', '')} label="acres" />
        <Tile value={formatAcres(plotAcres).replace(' ac', '')} label="food plot ac" />
        <Tile value={String(spots.length)} label="hunting spots" />
        <Tile value={totalTrail ? formatDistance(totalTrail).replace(/ (yd|mi)$/, '') : '0'} label={totalTrail >= 1609 ? 'trail mi' : 'trail yd'} />
      </div>

      <section className="sidebar-section">
        <h2>Land</h2>
        <ul className="summary-list">
          <li>
            <span>Property</span>
            <strong>{formatAcres(totalAcres)}</strong>
          </li>
          {[...byAreaType.entries()].map(([type, v]) => {
            const info = areaTypeInfo(type, props.settings);
            return (
              <li key={type}>
                <span className="summary-label">
                  <AreaBadge type={info} size={18} /> {info.label}
                  <span className="muted"> · {v.count}</span>
                </span>
                <strong>{formatAcres(v.acres)}</strong>
              </li>
            );
          })}
          {sections.length > 0 && (
            <li>
              <span>Sections</span>
              <strong>{sections.length}</strong>
            </li>
          )}
        </ul>
        {plots.length > 0 && (
          <p className="hint">
            Planted: {[...plantings.entries()].map(([crop, acres]) => `${crop} ${formatAcres(acres)}`).join(' · ')}
          </p>
        )}
      </section>

      <section className="sidebar-section">
        <h2>Hunting locations and pins</h2>
        <ul className="summary-list">
          {countBy(spots).map(([type, n]) => (
            <li key={type}>
              <span className="summary-label">
                <span className="swatch round" style={{ background: pinTypeInfo(type, custom).color }} /> {pinTypeInfo(type, custom).label}
              </span>
              <strong>{n}</strong>
            </li>
          ))}
          {countBy(pins).map(([type, n]) => (
            <li key={type} className="muted-row">
              <span className="summary-label">
                <span className="swatch round" style={{ background: pinTypeInfo(type, custom).color }} /> {pinTypeInfo(type, custom).label}
              </span>
              <strong>{n}</strong>
            </li>
          ))}
          {markers.length === 0 && <li className="muted">No pins yet.</li>}
        </ul>
      </section>

      {trails.length > 0 && (
        <section className="sidebar-section">
          <h2>Trails</h2>
          <ul className="summary-list">
            {[...trailMeters.entries()].map(([kind, meters]) => (
              <li key={kind}>
                <span className="summary-label">
                  <span className={`swatch line${TRAIL_KINDS[kind].dashed ? ' dashed' : ''}`} style={{ '--line': TRAIL_KINDS[kind].color } as CSSProperties} />{' '}
                  {TRAIL_KINDS[kind].label}
                </span>
                <strong>{formatDistance(meters)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sidebar-section">
        <h2 className="group-head">
          <span>Hunting</span>
          {seasons.length > 1 && (
            <select className="season-select" value={season ?? ''} onChange={(e) => setSeasonPick(e.target.value)} aria-label="Season">
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s} season
                </option>
              ))}
            </select>
          )}
          {seasons.length === 1 && <span className="muted">{season} season</span>}
        </h2>
        {seasonReports.length === 0 ? (
          <p className="hint">No hunts logged yet.</p>
        ) : (
          <>
            <div className="stat-tiles summary-tiles">
              <Tile value={String(seasonReports.length)} label="hunts" />
              <Tile value={String(Math.round(hours))} label="hours" />
              <Tile value={String(deer)} label="deer seen" />
              <Tile value={String(bucks)} label="bucks" />
            </div>
            <p className="hint">
              {(deer / seasonReports.length).toFixed(1)} deer per hunt{hours >= 1 ? ` · ${(deer / hours).toFixed(1)} per hour` : ''}
              {others ? ` · also ${others}` : ''}
            </p>
            {bestDay && (
              <div className="best-day">
                <span className="best-day-label">Best day</span>
                <strong>{new Date(bestDay.list[0].start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                <span>
                  {bestDay.deer} deer{bestDay.bucks ? ` (${bestDay.bucks} buck${bestDay.bucks === 1 ? '' : 's'})` : ''} · {bestDayStands}
                </span>
              </div>
            )}
            {mornings.hunts > 0 && evenings.hunts > 0 && (
              <p className="hint">
                Mornings {(mornings.deer / mornings.hunts).toFixed(1)} deer a hunt ({mornings.hunts}) · evenings {(evenings.deer / evenings.hunts).toFixed(1)} (
                {evenings.hunts})
              </p>
            )}
            {shownMonths.length > 0 && <MonthChart months={shownMonths} />}
            {standRows.length > 0 && (
              <>
                <h3 className="summary-subhead">Best stands this season</h3>
                <ul className="summary-list">
                  {standRows.map((r) => (
                    <li key={r.stand.id}>
                      <button className="link-button" onClick={() => props.onPickStand(r.stand.id)}>
                        {r.stand.name}
                      </button>
                      <strong>
                        {(r.deer / r.hunts).toFixed(1)} <span className="muted">deer/hunt · {r.hunts} hunts</span>
                      </strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

// Deer seen each month of the season: one bar per month, the busiest labeled,
// and the details on hover.
function MonthChart({ months }: { months: { month: number; hunts: number; deer: number; bucks: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const most = Math.max(1, ...months.map((m) => m.deer));
  const top = months.reduce((a, b) => (b.deer > a.deer ? b : a));
  const shown = hover === null ? null : months[hover];
  return (
    <figure className="month-chart">
      <figcaption>
        <span className="chart-title">Deer seen by month</span>
        <span className="chart-range">
          {shown ? `${MONTH_NAMES[shown.month]}: ${shown.deer} deer · ${shown.bucks} bucks · ${shown.hunts} hunts` : `Most in ${MONTH_NAMES[top.month]}`}
        </span>
      </figcaption>
      <div className="month-bars" onPointerLeave={() => setHover(null)}>
        {months.map((m, i) => (
          <div key={m.month} className={`month${hover === i ? ' active' : ''}`} onPointerEnter={() => setHover(i)} title={`${MONTH_NAMES[m.month]}: ${m.deer} deer in ${m.hunts} hunts`}>
            <span className="month-value">{m === top && m.deer > 0 ? m.deer : ''}</span>
            <span className="month-track">
              <span className="month-bar" style={{ height: `${(m.deer / most) * 100}%` }} />
            </span>
            <span className="month-name">{MONTH_NAMES[m.month]}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
