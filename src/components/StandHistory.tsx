import { daySummary, isLive, otherAnimals, standStats } from '@/lib/huntStats';
import { DEER_KINDS, sightingLabel, sightingSummary } from '@/lib/reports';
import type { HuntReport } from '@/types/models';

// Shown on a stand's card: what hunting it has produced, and which way deer go.
export function StandHistory({ reports, onPickReport }: { reports: HuntReport[]; onPickReport(id: string): void }) {
  if (reports.length === 0) {
    return (
      <section className="stand-history">
        <h3>Hunt history</h3>
        <p className="muted">No hunts logged here yet.</p>
      </section>
    );
  }

  const stats = standStats(reports);
  const most = Math.max(1, ...stats.headings.map((h) => h.count));
  const recent = [...reports].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 5);
  const perHunt = (deer: number, hunts: number) => (hunts ? (deer / hunts).toFixed(1) : '–');

  return (
    <section className="stand-history">
      <h3>Hunt history</h3>
      <div className="stat-tiles">
        <div className="stat-tile">
          <strong>{stats.hunts}</strong>
          <span>hunt{stats.hunts === 1 ? '' : 's'}</span>
        </div>
        <div className="stat-tile">
          <strong>{Math.round(stats.hours)}</strong>
          <span>hours</span>
        </div>
        <div className="stat-tile">
          <strong>{stats.deer}</strong>
          <span>deer seen</span>
        </div>
        <div className="stat-tile">
          <strong>{perHunt(stats.deer, stats.hunts)}</strong>
          <span>per hunt</span>
        </div>
      </div>

      {stats.byKind.length > 0 && (
        <ul className="kind-totals">
          {stats.byKind
            .filter(({ kind }) => DEER_KINDS[kind].deer)
            .map(({ kind, count }) => (
              <li key={kind}>
                <span className="type-dot" style={{ background: DEER_KINDS[kind].color }} />
                {sightingLabel({ kind, count, notes: null })}
              </li>
            ))}
          {otherAnimals(reports) && <li className="muted">Also seen: {otherAnimals(reports)}</li>}
        </ul>
      )}

      <h4>
        Which way deer travel
        {stats.mainHeading && <span className="muted"> · mostly {stats.mainHeading}</span>}
      </h4>
      {stats.headings.some((h) => h.count > 0) ? (
        <ul className="heading-bars" aria-label="Deer seen heading each direction">
          {stats.headings.map((h) => (
            <li key={h.point} title={`${h.count} deer heading ${h.point}`}>
              <span className="heading-label">
                <span className="heading-arrow" style={{ transform: `rotate(${h.deg}deg)` }} aria-hidden>
                  ↑
                </span>
                {h.point}
              </span>
              <span className="heading-track">
                {h.count > 0 && <span className="heading-bar" style={{ width: `${(h.count / most) * 100}%` }} />}
              </span>
              <span className="heading-count">{h.count || ''}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Log which way deer were heading to see their travel pattern here.</p>
      )}

      <h4>When and in which wind</h4>
      <table className="stand-table">
        <tbody>
          {stats.morning.hunts > 0 && (
            <tr>
              <th>Mornings</th>
              <td>{daySummary({ reports: new Array(stats.morning.hunts), deer: stats.morning.deer, bucks: 0 })}</td>
              <td className="muted">{perHunt(stats.morning.deer, stats.morning.hunts)}/hunt</td>
            </tr>
          )}
          {stats.evening.hunts > 0 && (
            <tr>
              <th>Evenings</th>
              <td>{daySummary({ reports: new Array(stats.evening.hunts), deer: stats.evening.deer, bucks: 0 })}</td>
              <td className="muted">{perHunt(stats.evening.deer, stats.evening.hunts)}/hunt</td>
            </tr>
          )}
          {stats.byWind.map((w) => (
            <tr key={w.point}>
              <th>{w.point} wind</th>
              <td>{daySummary({ reports: new Array(w.hunts), deer: w.deer, bucks: 0 })}</td>
              <td className="muted">{perHunt(w.deer, w.hunts)}/hunt</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Recent hunts</h4>
      <ul className="recent-hunts">
        {recent.map((r) => (
          <li key={r.id}>
            <button className="row" onClick={() => onPickReport(r.id)}>
              <span className="row-title">
                {new Date(r.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                {isLive(r) && <span className="live-dot" title="In the stand now" />}
              </span>
              <span className="row-detail">
                {r.loggedBy ? `${r.loggedBy} · ` : ''}
                {sightingSummary(r)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
