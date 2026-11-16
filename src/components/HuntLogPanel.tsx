import { useState, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';
import { allHarvests, harvestCounts, harvestDetail, harvestLine, harvestTitle } from '@/lib/harvests';
import { daySummary, huntsByDay, huntSeason, isLive } from '@/lib/huntStats';
import { huntPlaceName, sightingSummary } from '@/lib/reports';
import type { HuntReport, MapMarker } from '@/types/models';

const DAYS_SHOWN = 14;
const TAB_KEY = 'hunting-hub-hunt-log-tab';

type Tab = 'hunts' | 'harvests';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// Hunt Log: every hunt report and every harvest, opened from its card like the
// Action Board and Land Management.
export function HuntLogPanel(props: {
  reports: HuntReport[];
  markers: MapMarker[];
  selectedId: string | null;
  onPick(id: string): void;
  onLogHunt(): void;
  // Logging a harvest: pick the hunt it was taken on (or make one for it).
  picking: boolean;
  onPicking(on: boolean): void;
  onAddHarvestTo(reportId: string): void;
  onNewHuntWithHarvest(): void;
  onClose(): void;
}) {
  const { reports, markers } = props;
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === 'harvests' ? 'harvests' : 'hunts';
    } catch {
      return 'hunts';
    }
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Only remembers the tab; the panel works without it.
    }
  };
  const [showAll, setShowAll] = useState(false);
  const [pickAll, setPickAll] = useState(false);
  const place = (r: HuntReport) => huntPlaceName(r, markers);
  const live = reports.filter((r) => isLive(r)).sort((a, b) => a.start.localeCompare(b.start));
  const days = huntsByDay(reports.filter((r) => !isLive(r)));
  const shownDays = showAll ? days : days.slice(0, DAYS_SHOWN);
  const harvests = allHarvests(reports);
  const seasons = [...new Set(harvests.map((x) => huntSeason(x.harvest.time)))];
  const hunts = reports.filter((r) => !r.harvestOnly).length;
  const huntsNewest = reports.filter((r) => !r.deletedAt).sort((a, b) => b.start.localeCompare(a.start));

  const row = (r: HuntReport, swatch: ReactNode, title: string, detail: string) => (
    <li key={r.id}>
      <button className={`row${props.selectedId === r.id ? ' selected' : ''}`} onClick={() => props.onPick(r.id)}>
        {swatch}
        <span className="row-title">{title}</span>
        <span className="row-detail">{detail}</span>
      </button>
    </li>
  );

  return (
    <div className="forecast hunt-log">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>Hunt Log</h2>
      </div>

      <div className="log-hunt-row">
        <button className="log-hunt" onClick={props.onLogHunt}>
          + Log a hunt
        </button>
        <button className={`log-hunt${props.picking ? ' active' : ''}`} onClick={() => props.onPicking(!props.picking)} title="A deer or turkey taken, on one of your hunts">
          + Log a harvest
        </button>
      </div>

      {props.picking && (
        <section className="sidebar-section harvest-pick">
          <h3 className="summary-subhead">Which hunt was it taken on?</h3>
          <ul>
            {(pickAll ? huntsNewest : huntsNewest.slice(0, 8)).map((r) =>
              <li key={r.id}>
                <button className="row" onClick={() => props.onAddHarvestTo(r.id)}>
                  <span className="swatch report">
                    <Icon name="track" size={16} />
                  </span>
                  <span className="row-title">{place(r)}</span>
                  <span className="row-detail">
                    {[`${day(r.start)} · ${clock(r.start)}`, r.loggedBy, harvestLine(r)].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>,
            )}
          </ul>
          {huntsNewest.length > 8 && (
            <button className="link-button show-older" onClick={() => setPickAll(!pickAll)}>
              {pickAll ? 'Show fewer' : `Show ${huntsNewest.length - 8} older hunts`}
            </button>
          )}
          <div className="log-hunt-row">
            <button className="log-hunt" onClick={props.onNewHuntWithHarvest} title="Not logged yet: make the hunt, then set its stand, date and times">
              + New hunt for it
            </button>
            <button className="log-hunt" onClick={() => props.onPicking(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {live.length > 0 && (
        <section className="sidebar-section">
          <h3 className="summary-subhead">In the stand now</h3>
          <ul className="live-hunts">
            {live.map((r) =>
              row(r, <span className="live-dot" title="In the stand now" />, `${r.loggedBy ? `${r.loggedBy} · ` : ''}${place(r)}`, `In since ${clock(r.start)} · ${sightingSummary(r)}`),
            )}
          </ul>
        </section>
      )}

      <div className="hunt-log-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'hunts'} className={tab === 'hunts' ? 'active' : ''} onClick={() => setTab('hunts')}>
          Hunt reports <span className="count">{hunts}</span>
        </button>
        <button role="tab" aria-selected={tab === 'harvests'} className={tab === 'harvests' ? 'active' : ''} onClick={() => setTab('harvests')}>
          Harvest reports <span className="count">{harvests.length}</span>
        </button>
      </div>

      {tab === 'hunts' && (
        <section className="sidebar-section">
          {days.length === 0 && <p className="hint">No hunts logged yet. Log one here, or from a stand's panel; hunts from the phones come in on their own.</p>}
          {shownDays.map((d) => (
            <div key={d.key} className="hunt-day">
              <div className="hunt-day-head">
                <span>{d.label}</span>
                <span className="muted">{daySummary(d)}</span>
              </div>
              <ul>
                {d.reports.map((r) =>
                  row(
                    r,
                    <span className="swatch report">
                      <Icon name="track" size={16} />
                    </span>,
                    r.harvestOnly ? `Harvest · ${place(r)}` : place(r),
                    [`${clock(r.start)}${r.loggedBy ? ` · ${r.loggedBy}` : ''}`, r.harvestOnly ? null : sightingSummary(r), harvestLine(r)].filter(Boolean).join(' · '),
                  ),
                )}
              </ul>
            </div>
          ))}
          {days.length > DAYS_SHOWN && (
            <button className="link-button show-older" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer days' : `Show ${days.length - DAYS_SHOWN} older days`}
            </button>
          )}
        </section>
      )}

      {tab === 'harvests' && (
        <section className="sidebar-section">
          {harvests.length === 0 && <p className="hint">No harvests yet. Use “We got one” in a hunt (here or on the phone), or Log a harvest for one taken without a hunt logged.</p>}
          {seasons.map((season) => {
            const list = harvests.filter((x) => huntSeason(x.harvest.time) === season);
            return (
              <div key={season} className="hunt-day">
                <div className="hunt-day-head">
                  <span>{season} season</span>
                  <span className="muted">{harvestCounts(list.map((x) => x.harvest))}</span>
                </div>
                <ul>
                  {list.map(({ harvest: h, report: r }) => (
                    <li key={h.id}>
                      <button className={`row${props.selectedId === r.id ? ' selected' : ''}`} onClick={() => props.onPick(r.id)}>
                        <span className="swatch harvest-swatch" aria-hidden />
                        <span className="row-title">{harvestTitle(h)}</span>
                        <span className="row-detail">
                          {[`${day(h.time)}`, `${r.harvestOnly ? '' : `${clock(r.start)} hunt at `}${place(r)}`, h.hunter, harvestDetail(h) || null].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
