import { useEffect, useRef, useState, type CSSProperties } from 'react';

import {
  appleMapsUrl,
  loadFieldData,
  PHONE_FILE_KIND,
  saveFieldData,
  shareJsonFile,
  STANDS_FILE_KIND,
  type FieldData,
  type PhoneFile,
  type StandsFile,
} from '@/field/fieldData';
import { Icon } from '@/components/Icon';
import { useCampSync, type CampStatus } from '@/field/useCampSync';
import { CAMP_SYNC_AVAILABLE, joinCamp } from '@/lib/camp';
import { pinTypeInfo } from '@/lib/featureTypes';
import type { IconName } from '@/lib/icons';
import { daySummary, huntsByDay, isLive, otherAnimals, standStats, type StandStats } from '@/lib/huntStats';
import { useFieldWeather } from '@/field/useFieldWeather';
import { WalkCard } from '@/field/WalkCard';
import { WherePicker } from '@/field/WherePicker';
import { lineLengthM, metersBetween, packPoints, simplifyLine } from '@/lib/trails';
import { compassPointOf } from '@/lib/standRating';
import { formatPressure, pressureAt, weatherAt, type Forecast } from '@/lib/weather';
import { DEER_KINDS, HEADINGS, kindInfo, newSighting, sightingLabel, sightingSummary, whereLabel } from '@/lib/reports';
import type { CustomPinType, DeerKind, FieldPin, FieldTrack, HuntReport, MarkerType, Sighting } from '@/types/models';

type Tab = 'pin' | 'hunt' | 'stands' | 'send';

const PIN_TYPES: MarkerType[] = ['stand', 'blind', 'camera', 'scrape', 'rub', 'trail', 'water', 'parking', 'other'];

interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  at: number;
}

// Follows the phone's GPS while `on`. Works with no cell signal: GPS comes
// from satellites, not the network.
function useGps(on: boolean): { fix: Fix | null; error: string | null } {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    if (!navigator.geolocation) {
      setError('This browser has no GPS access.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: p.timestamp });
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location is turned off for this page. Allow it in Settings › Safari › Location.' : e.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);
  return { fix, error };
}

function record<T extends object>(fields: T) {
  const at = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: at, updatedAt: at, deletedAt: null, ...fields };
}

// A walk adds a point every this many meters, from fixes at least this good.
const WALK_STEP_M = 8;
const WALK_MAX_ACCURACY_M = 30;

// Days of hunts listed before "Show older".
const DAYS_SHOWN = 7;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function FieldApp() {
  const [data, setData] = useState<FieldData>(loadFieldData);
  const [tab, setTab] = useState<Tab>(data.activeReportId ? 'hunt' : 'pin');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => saveFieldData(data), [data]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  // GPS runs on the Pin and Hunt tabs, and the whole time a walk is recorded.
  const gps = useGps(tab === 'pin' || tab === 'hunt' || data.activeWalk !== null);
  const sync = useCampSync(data, setData);

  // While walking, add a point every ~8 m, skipping fixes rougher than 30 m.
  const fix = gps.fix;
  useEffect(() => {
    if (!fix || !data.activeWalk || fix.accuracyM > WALK_MAX_ACCURACY_M) return;
    const here: [number, number] = [fix.lng, fix.lat];
    setData((d) => {
      if (!d.activeWalk) return d;
      const last = d.activeWalk.points[d.activeWalk.points.length - 1];
      if (last && metersBetween(last, here) < WALK_STEP_M) return d;
      return { ...d, activeWalk: { ...d.activeWalk, points: [...d.activeWalk.points, here] } };
    });
  }, [fix, data.activeWalk !== null]);
  const active = data.reports.find((r) => r.id === data.activeReportId) ?? null;
  // With a camp, what's still waiting for signal; without one, everything on the phone.
  const unsent = data.camp ? sync.waiting : data.pins.length + data.reports.length + data.tracks.length;
  const loggedBy = data.camp?.hunter ?? null;
  // Everyone else's hunts in the camp; this phone's own come from data.reports.
  const mine = new Set(data.reports.map((r) => r.id));
  const campHunts = data.camp ? data.campHunts.filter((r) => !mine.has(r.id)) : [];
  // Weather for the stand being hunted, else the first stand, else where the phone is.
  const activeStand = data.stands.find((s) => s.id === active?.standId);
  const weather = useFieldWeather(activeStand ?? data.stands[0] ?? gps.fix);

  const saveReport = (report: HuntReport) =>
    setData((d) => ({ ...d, reports: d.reports.map((r) => (r.id === report.id ? { ...report, updatedAt: new Date().toISOString() } : r)) }));

  return (
    <div className="field-app">
      <header className="field-header">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
        <h1>Hunting Hub</h1>
        <span className={`gps-badge${gps.fix ? ' ok' : ''}`}>
          {gps.fix ? `GPS ±${Math.round(gps.fix.accuracyM)} m` : tab === 'pin' || tab === 'hunt' ? 'Finding GPS…' : 'GPS off'}
        </span>
      </header>

      <main className="field-main">
        {gps.error && (tab === 'pin' || tab === 'hunt') && <p className="field-warn">{gps.error}</p>}
        {tab === 'pin' && (
          <WalkCard
            walk={data.activeWalk}
            tracks={data.tracks}
            gpsReady={gps.fix !== null}
            onStart={() => setData((d) => ({ ...d, activeWalk: { id: crypto.randomUUID(), startedAt: new Date().toISOString(), points: [] } }))}
            onStop={() => {
              const walk = data.activeWalk;
              if (!walk || walk.points.length < 2) return;
              const ended = new Date();
              const started = new Date(walk.startedAt);
              const track: FieldTrack = record({
                name: `Walk ${started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
                coords: packPoints(simplifyLine(walk.points)),
                startedAt: walk.startedAt,
                endedAt: ended.toISOString(),
                lengthM: Math.round(lineLengthM(walk.points)),
                loggedBy,
                status: 'new' as const,
                trailId: null,
              });
              setData((d) => ({ ...d, tracks: [track, ...d.tracks], activeWalk: null }));
              setMessage(data.camp ? 'Walk saved. It goes to camp as soon as you have signal.' : 'Walk saved. Send it to the hub from the Send tab.');
            }}
            onDiscard={() => setData((d) => ({ ...d, activeWalk: null }))}
            onDeleteTrack={(id) => setData((d) => ({ ...d, tracks: d.tracks.filter((t) => t.id !== id) }))}
          />
        )}
        {tab === 'pin' && <PinTab fix={gps.fix} pinTypes={data.pinTypes} pins={data.pins} onAdd={(pin) => setData((d) => ({ ...d, pins: [{ ...pin, loggedBy }, ...d.pins] }))} onMessage={setMessage} />}
        {tab === 'hunt' && <WeatherNow forecast={weather.forecast} offline={weather.offline} />}
        {tab === 'hunt' && (
          <HuntTab
            data={data}
            active={active}
            fix={gps.fix}
            onStart={(standId) => {
              const report: HuntReport = record({
                standId,
                propertyId: null,
                start: new Date().toISOString(),
                end: null,
                weather: null,
                sightings: [],
                notes: null,
                source: 'phone' as const,
                loggedBy,
              });
              setData((d) => ({ ...d, reports: [report, ...d.reports], activeReportId: report.id }));
            }}
            campHunts={campHunts}
            onChange={saveReport}
            onEnd={(report) => {
              saveReport({ ...report, end: new Date().toISOString() });
              setData((d) => ({ ...d, activeReportId: null }));
              setMessage(data.camp ? 'Hunt saved. It goes to camp as soon as you have signal.' : 'Hunt saved. Send it to the hub from the Send tab.');
            }}
          />
        )}
        {tab === 'stands' && <StandsTab data={data} reports={[...data.reports, ...campHunts]} />}
        {tab === 'send' && <SendTab data={data} sync={sync} onData={setData} onMessage={setMessage} />}
      </main>

      {message && <div className="field-toast">{message}</div>}

      <nav className="field-tabs">
        {(
          [
            ['pin', data.activeWalk ? 'track' : 'pin', data.activeWalk ? 'Walking' : 'Pin'],
            ['hunt', 'track', active ? 'Hunting' : 'Hunt'],
            ['stands', 'stand', 'Stands'],
            ['send', data.camp ? 'camp' : 'send', `${data.camp ? 'Camp' : 'Send'}${unsent ? ` (${unsent})` : ''}`],
          ] as const satisfies readonly (readonly [Tab, IconName, string])[]
        ).map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon name={icon} size={24} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function PinTab(props: { fix: Fix | null; pinTypes: CustomPinType[]; pins: FieldPin[]; onAdd(pin: FieldPin): void; onMessage(m: string): void }) {
  const [type, setType] = useState<MarkerType>('stand');
  const [note, setNote] = useState('');
  const { fix } = props;
  // A fix older than a minute may be from somewhere else; wait for a fresh one.
  const fresh = fix && Date.now() - fix.at < 60_000;

  return (
    <section className="field-card">
      <h2>Drop a pin where you're standing</h2>
      <div className="type-grid">
        {[...PIN_TYPES, ...props.pinTypes.map((t) => t.id)].map((t) => (
          <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>
            <span className="type-dot" style={{ background: pinTypeInfo(t, props.pinTypes).color }} />
            {pinTypeInfo(t, props.pinTypes).label}
          </button>
        ))}
      </div>
      <input type="text" placeholder="Note (optional), e.g. big rub line" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        className="big-button"
        disabled={!fresh}
        onClick={() => {
          if (!fix) return;
          props.onAdd(record({ lat: fix.lat, lng: fix.lng, accuracyM: Math.round(fix.accuracyM), type, note: note.trim() || null, status: 'new' as const, markerId: null }));
          setNote('');
          props.onMessage(`${pinTypeInfo(type, props.pinTypes).label} pin saved (±${Math.round(fix.accuracyM)} m).`);
        }}
      >
        {fresh ? `Drop ${pinTypeInfo(type, props.pinTypes).label.toLowerCase()} pin` : 'Waiting for GPS…'}
      </button>
      {fix && fix.accuracyM > 25 && <p className="field-hint">GPS is rough right now (±{Math.round(fix.accuracyM)} m). Give it a minute in the open for a better fix.</p>}

      {props.pins.length > 0 && (
        <>
          <h3>Saved pins</h3>
          <ul className="field-list">
            {props.pins.map((p) => (
              <li key={p.id}>
                <span className="type-dot" style={{ background: pinTypeInfo(p.type, props.pinTypes).color }} />
                <span>
                  {pinTypeInfo(p.type, props.pinTypes).label}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                <span className="muted">{clock(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// Temperature, wind and barometric pressure right now, from the last forecast saved.
function WeatherNow({ forecast, offline }: { forecast: Forecast | null; offline: boolean }) {
  if (!forecast) {
    return offline ? null : <p className="field-hint weather-now">Getting the weather…</p>;
  }
  const now = Date.now();
  const hour = weatherAt(forecast, now);
  const pressure = pressureAt(forecast, now);
  const ageMin = Math.round((now - forecast.fetchedAt) / 60_000);
  return (
    <section className="field-card weather-now">
      <div className="weather-now-main">
        <strong>{Math.round(hour.tempF)}°F</strong>
        <span>
          {compassPointOf(hour.windFromDeg)} wind {Math.round(hour.windMph)} mph
          <span className="muted"> · gusts {Math.round(hour.gustMph)}</span>
        </span>
      </div>
      <div className="weather-now-pressure">
        <span className={`pressure-trend ${pressure.trend}`} aria-hidden>
          {pressure.trend === 'steady' ? (
            <Icon name="steady" size={14} />
          ) : (
            <span style={{ display: 'inline-grid', transform: pressure.trend === 'falling' ? 'rotate(180deg)' : undefined }}>
              <Icon name="arrow" size={14} />
            </span>
          )}
        </span>
        Pressure {formatPressure(pressure)}
        <span className="muted"> ({pressure.changeInHg >= 0 ? '+' : ''}{pressure.changeInHg.toFixed(2)} in 3 h)</span>
      </div>
      <p className="muted weather-age">
        {offline ? 'No signal · ' : ''}
        Forecast from {ageMin < 2 ? 'just now' : ageMin < 120 ? `${ageMin} min ago` : new Date(forecast.fetchedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
      </p>
    </section>
  );
}

function HuntTab(props: {
  data: FieldData;
  active: HuntReport | null;
  fix: Fix | null;
  // Hunts from the rest of the camp (not this phone's own).
  campHunts: HuntReport[];
  onStart(standId: string | null): void;
  onChange(report: HuntReport): void;
  onEnd(report: HuntReport): void;
}) {
  const { data, active, campHunts } = props;
  const [standId, setStandId] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const standName = (id: string | null) => data.stands.find((s) => s.id === id)?.name ?? 'No stand';

  // Suggest the closest stand from GPS.
  useEffect(() => {
    if (standId || !props.fix || data.stands.length === 0) return;
    const { lat, lng } = props.fix;
    const closest = [...data.stands].sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng))[0];
    setStandId(closest.id);
  }, [props.fix, data.stands, standId]);

  if (active) {
    return (
      <QuickLog
        key={active.id}
        report={active}
        standName={standName(active.standId)}
        onChange={props.onChange}
        doneLabel="Done hunting"
        onDone={() => props.onEnd(active)}
      />
    );
  }

  const editing = data.reports.find((r) => r.id === editingId);
  if (editing) {
    return (
      <QuickLog
        key={editing.id}
        report={editing}
        standName={standName(editing.standId)}
        past
        onChange={props.onChange}
        doneLabel="Done editing"
        onDone={() => setEditingId(null)}
      />
    );
  }

  const mine = new Set(data.reports.map((r) => r.id));
  const live = campHunts.filter((r) => isLive(r));
  const days = huntsByDay([...data.reports, ...campHunts.filter((r) => !isLive(r))]);
  const shownDays = showAll ? days : days.slice(0, DAYS_SHOWN);

  return (
    <>
      <section className="field-card">
        <h2>Start a hunt</h2>
        <select value={standId} onChange={(e) => setStandId(e.target.value)}>
          <option value="">No stand / walking</option>
          {data.stands.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {data.stands.length === 0 && (
          <p className="field-hint">
            {data.camp ? 'Stands show up here once the hub turns on camp sync.' : 'Join your camp (Camp tab) to pick a stand here.'}
          </p>
        )}
        <button className="big-button" onClick={() => props.onStart(standId || null)}>
          I'm in the stand
        </button>
      </section>

      {live.length > 0 && (
        <section className="field-card">
          <h3>In the stand now</h3>
          <ul className="field-list">
            {live.map((r) => (
              <li key={r.id}>
                <span className="live-dot" />
                <span>
                  {r.loggedBy ?? 'Someone'} · {standName(r.standId)}
                </span>
                <span className="muted">since {clock(r.start)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.length > 0 && (
        <section className="field-card">
          <h3>Hunts</h3>
          {shownDays.map((day) => (
            <div key={day.key} className="hunt-day">
              <div className="hunt-day-head">
                <span>{day.label}</span>
                <span className="muted">{daySummary(day)}</span>
              </div>
              <ul className="field-list">
                {day.reports.map((r) =>
                  mine.has(r.id) ? (
                    <li key={r.id}>
                      <button className="hunt-row" onClick={() => setEditingId(r.id)}>
                        <span className="hunt-row-text">
                          <strong>{standName(r.standId)}</strong>
                          <span className="muted">
                            {clock(r.start)} · {sightingSummary(r)}
                          </span>
                        </span>
                        <span className="edit-hint">
                          Edit <Icon name="chevron-right" size={14} />
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={r.id}>
                      <span className="hunt-row-text">
                        <strong>{standName(r.standId)}</strong>
                        <span className="muted">
                          {clock(r.start)} · {r.loggedBy ?? 'Camp'} · {sightingSummary(r)}
                        </span>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
          {days.length > DAYS_SHOWN && (
            <button className="end-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer days' : `Show ${days.length - DAYS_SHOWN} older days`}
            </button>
          )}
        </section>
      )}
    </>
  );
}

const KINDS = Object.keys(DEER_KINDS) as DeerKind[];

// Logging what you see from the stand: what, how many, which way, tap Save.
// Tap a sighting in the list to change or delete it. Also used to edit a past hunt.
function QuickLog(props: {
  report: HuntReport;
  standName: string;
  // Editing a hunt that's over: new sightings get the hunt's start time.
  past?: boolean;
  onChange(r: HuntReport): void;
  doneLabel: string;
  onDone(): void;
}) {
  const { report } = props;
  const [kind, setKind] = useState<DeerKind>('doe');
  const [count, setCount] = useState(1);
  const [heading, setHeading] = useState<number | null>(null);
  const [buckName, setBuckName] = useState('');
  const [otherName, setOtherName] = useState('');
  const [where, setWhere] = useState<Sighting['fromStand']>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const notes = useRef<HTMLTextAreaElement>(null);

  const reset = () => {
    setEditingId(null);
    setCount(1);
    setHeading(null);
    setBuckName('');
    setOtherName('');
    setWhere(null);
  };

  const startEditing = (s: Sighting) => {
    setEditingId(s.id);
    setKind(s.kind);
    setCount(s.count);
    setHeading(s.headingDeg);
    setBuckName(s.buckName ?? '');
    setOtherName(s.kind === 'other' ? (s.notes ?? '') : '');
    setWhere(s.fromStand ?? null);
  };

  const save = () => {
    const fields = {
      kind,
      count,
      headingDeg: heading,
      buckName: kind === 'buck' ? buckName.trim() || null : null,
      notes: kind === 'other' ? otherName.trim() || null : null,
      fromStand: where,
    };
    const sightings = editingId
      ? report.sightings.map((s) => (s.id === editingId ? { ...s, ...fields } : s))
      : [...report.sightings, { ...newSighting(props.past ? report.start : new Date().toISOString()), ...fields }];
    props.onChange({ ...report, sightings });
    reset();
  };

  const remove = () => {
    props.onChange({ ...report, sightings: report.sightings.filter((s) => s.id !== editingId) });
    reset();
  };

  const info = DEER_KINDS[kind];
  const saveLabel = `${editingId ? 'Update' : 'Save'} ${sightingLabel({ kind, count, notes: kind === 'other' ? otherName : null })}`;

  return (
    <section className="field-card">
      <h2>
        {props.standName}{' '}
        <span className="muted">
          {props.past
            ? new Date(report.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
            : `since ${clock(report.start)}`}
        </span>
      </h2>
      {editingId && <p className="editing-note">Changing a sighting. Pick what's different, then tap Update.</p>}

      <div className="kind-row">
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} style={{ '--deer': DEER_KINDS[k].color } as CSSProperties} onClick={() => setKind(k)}>
            {DEER_KINDS[k].deer ? <span className="type-dot" style={{ background: DEER_KINDS[k].color }} /> : <Icon name={DEER_KINDS[k].icon} size={18} />}
            {DEER_KINDS[k].label}
          </button>
        ))}
      </div>
      {kind === 'buck' && <input type="text" placeholder="Which buck? e.g. Big 8" value={buckName} onChange={(e) => setBuckName(e.target.value)} />}
      {kind === 'other' && <input type="text" placeholder="What was it? e.g. coyote" value={otherName} onChange={(e) => setOtherName(e.target.value)} />}

      <div className="count-row">
        <button onClick={() => setCount(Math.max(1, count - 1))} aria-label="Fewer">
          <Icon name="minus" size={24} />
        </button>
        <strong>{count}</strong>
        <button onClick={() => setCount(count + 1)} aria-label="More">
          <Icon name="plus" size={24} />
        </button>
      </div>

      <WherePicker value={where ?? null} onChange={setWhere} logged={report.sightings.filter((s) => s.id !== editingId)} />

      <div className="field-heading-label">Which way were they going?</div>
      <div className="field-compass">
        {HEADINGS.map((h) => (
          <button key={h.point} className={`h-${h.point}${heading === h.deg ? ' active' : ''}`} onClick={() => setHeading(heading === h.deg ? null : h.deg)}>
            {h.point}
          </button>
        ))}
        <span className="h-C">
          {heading === null ? (
            'Still'
          ) : (
            <span style={{ display: 'inline-grid', transform: `rotate(${heading}deg)` }}>
              <Icon name="arrow" size={26} />
            </span>
          )}
        </span>
      </div>

      <button className="big-button" onClick={save} aria-label={saveLabel}>
        {saveLabel}
      </button>
      {editingId && (
        <div className="edit-actions">
          <button className="end-button" onClick={reset}>
            Cancel
          </button>
          <button className="end-button danger" onClick={remove}>
            Delete sighting
          </button>
        </div>
      )}
      {!info.deer && kind !== 'other' && <p className="field-hint">{info.label} sightings are kept apart from deer totals.</p>}

      {report.sightings.length > 0 && (
        <>
          <p className="field-hint">Tap a sighting to change or delete it.</p>
          <ul className="field-list">
            {[...report.sightings].reverse().map((s) => (
              <li key={s.id} className={s.id === editingId ? 'editing' : ''}>
                <button className="sighting-row" onClick={() => startEditing(s)}>
                  {kindInfo(s.kind).deer ? (
                    <span className="type-dot" style={{ background: kindInfo(s.kind).color }} />
                  ) : (
                    <Icon name={kindInfo(s.kind).icon} size={18} />
                  )}
                  <span className="sighting-text">
                    {sightingLabel(s)}
                    {s.buckName ? ` (${s.buckName})` : ''}
                    {s.headingDeg !== null ? ` → ${HEADINGS.find((h) => h.deg === s.headingDeg)?.point}` : ''}
                    {whereLabel(s) ? ` · ${whereLabel(s)}` : ''}
                  </span>
                  <span className="muted">{clock(s.time)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <textarea
        ref={notes}
        rows={3}
        placeholder="Notes (wind shifts, where they came from…)"
        defaultValue={report.notes ?? ''}
        onBlur={(e) => props.onChange({ ...report, notes: e.target.value || null })}
      />
      <button
        className="end-button"
        onClick={() => {
          // Keep notes typed but not yet blurred.
          if (notes.current && (notes.current.value || null) !== report.notes) props.onChange({ ...report, notes: notes.current.value || null });
          props.onDone();
        }}
      >
        {props.doneLabel}
      </button>
    </section>
  );
}

// Each stand with its Apple Maps button, plus what hunting it has produced.
function StandsTab({ data, reports }: { data: FieldData; reports: HuntReport[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (data.stands.length === 0) {
    return (
      <section className="field-card">
        <h2>Your stands</h2>
        <p className="field-hint">
          {data.camp ? 'No stands yet. They show up here once the hub turns on camp sync.' : 'No stands yet. Join your camp on the Camp tab and they show up here.'}
        </p>
      </section>
    );
  }
  return (
    <section className="field-card">
      <h2>Your stands</h2>
      <p className="field-hint">Apple Maps uses your downloaded offline maps to guide you in with no signal. Tap a stand for its hunt history.</p>
      <ul className="field-list stands">
        {data.stands.map((s) => {
          const standReports = reports.filter((r) => r.standId === s.id);
          const stats = standStats(standReports);
          const open = openId === s.id;
          return (
            <li key={s.id}>
              <button className="stand-head" onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}>
                <span>
                  <strong>{s.name}</strong>
                  {s.goodWinds.length > 0 && <span className="muted"> · good on {s.goodWinds.join(' ')}</span>}
                </span>
                <span className="muted">
                  {stats.hunts === 0
                    ? 'No hunts yet'
                    : `${stats.hunts} hunt${stats.hunts === 1 ? '' : 's'} · ${stats.deer} deer${stats.mainHeading ? ` · mostly ${stats.mainHeading}` : ''}`}
                </span>
              </button>
              {open && stats.hunts > 0 && <FieldStandHistory stats={stats} reports={standReports} />}
              <a className="maps-button" href={appleMapsUrl(s)}>
                Open in Apple Maps
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FieldStandHistory({ stats, reports }: { stats: StandStats; reports: HuntReport[] }) {
  const most = Math.max(1, ...stats.headings.map((h) => h.count));
  const other = otherAnimals(reports);
  return (
    <div className="stand-history">
      <div className="stat-tiles">
        <div>
          <strong>{stats.hunts}</strong>
          <span>hunts</span>
        </div>
        <div>
          <strong>{stats.deer}</strong>
          <span>deer</span>
        </div>
        <div>
          <strong>{stats.hunts ? (stats.deer / stats.hunts).toFixed(1) : '–'}</strong>
          <span>per hunt</span>
        </div>
      </div>
      {stats.byKind.length > 0 && (
        <p className="kind-totals">
          {stats.byKind
            .filter((k) => DEER_KINDS[k.kind].deer)
            .map((k) => sightingLabel({ kind: k.kind, count: k.count, notes: null }))
            .join(' · ')}
          {other && ` · ${other}`}
        </p>
      )}
      {stats.headings.some((h) => h.count > 0) && (
        <>
          <h4>Which way deer travel</h4>
          <ul className="heading-bars">
            {stats.headings.map((h) => (
              <li key={h.point}>
                <span className="heading-label">
                  <span style={{ display: 'inline-grid', transform: `rotate(${h.deg}deg)` }}>
                    <Icon name="arrow" size={12} />
                  </span>{' '}
                  {h.point}
                </span>
                <span className="heading-track">{h.count > 0 && <span className="heading-bar" style={{ width: `${(h.count / most) * 100}%` }} />}</span>
                <span className="heading-count">{h.count || ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(stats.morning.hunts > 0 || stats.evening.hunts > 0) && (
        <p className="field-hint">
          {stats.morning.hunts > 0 && `Mornings: ${(stats.morning.deer / stats.morning.hunts).toFixed(1)} deer a hunt. `}
          {stats.evening.hunts > 0 && `Evenings: ${(stats.evening.deer / stats.evening.hunts).toFixed(1)} deer a hunt.`}
        </p>
      )}
    </div>
  );
}

function SendTab(props: {
  data: FieldData;
  sync: CampStatus;
  onData(update: (d: FieldData) => FieldData): void;
  onMessage(m: string): void;
}) {
  const { data } = props;
  const fileInput = useRef<HTMLInputElement>(null);

  const files = (
    <>
      <h2>Send to the hub</h2>
      <p className="field-hint">
        {data.pins.length} pin{data.pins.length === 1 ? '' : 's'} and {data.reports.length} hunt{data.reports.length === 1 ? '' : 's'} on this phone.
        Send the file to your PC (email it to yourself, or save it to iCloud Drive), then use “Import from phone” in the hub.
      </p>
      <button
        className="big-button"
        disabled={data.pins.length + data.reports.length === 0}
        onClick={() => {
          const file: PhoneFile = { kind: PHONE_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), pins: data.pins, reports: data.reports, tracks: data.tracks };
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          shareJsonFile(`hunting-hub-phone-${stamp}.json`, file)
            .then(() => props.onMessage('File ready. Bring it into the hub with “Import from phone”.'))
            .catch(() => undefined);
        }}
      >
        Send pins and hunts
      </button>
      <button
        className="end-button"
        disabled={data.pins.length + data.reports.length === 0 || data.activeReportId !== null}
        onClick={() => {
          if (window.confirm('Clear the pins and hunts from this phone? Only do this after the hub has them.')) {
            props.onData((d) => ({ ...d, pins: [], reports: [] }));
          }
        }}
      >
        Clear sent items from phone
      </button>

      <h3>Stands from the hub</h3>
      <p className="field-hint">
        {data.standsUpdatedAt ? `Updated ${new Date(data.standsUpdatedAt).toLocaleDateString()}.` : 'Not loaded yet.'} In the hub, use “Send stands to
        phone”, then open that file here.
      </p>
      <button onClick={() => fileInput.current?.click()}>Load stands file</button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const parsed = JSON.parse(await file.text()) as StandsFile;
            if (parsed.kind !== STANDS_FILE_KIND) throw new Error('That is not a stands file from the hub.');
            props.onData((d) => ({ ...d, stands: parsed.stands, standsUpdatedAt: parsed.exportedAt }));
            props.onMessage(`Loaded ${parsed.stands.length} stands.`);
          } catch (error) {
            props.onMessage(error instanceof Error ? error.message : String(error));
          }
        }}
      />
    </>
  );

  if (!CAMP_SYNC_AVAILABLE) return <section className="field-card">{files}</section>;
  return (
    <>
      <CampCard data={data} sync={props.sync} onData={props.onData} onMessage={props.onMessage} />
      <section className="field-card">
        <details>
          <summary>No internet at all? Use files instead</summary>
          {files}
        </details>
      </section>
    </>
  );
}

// Join a camp, then see whether everything has gone up.
function CampCard(props: { data: FieldData; sync: CampStatus; onData(update: (d: FieldData) => FieldData): void; onMessage(m: string): void }) {
  const { data, sync } = props;
  const [hunter, setHunter] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data.camp) {
    const camp = data.camp;
    return (
      <section className="field-card">
        <h2 className="camp-heading">
          <Icon name="camp" size={22} /> {camp.name}
        </h2>
        <p className="field-hint">
          You're <strong>{camp.hunter}</strong>. Your pins and hunts go to camp on their own whenever you have signal.
        </p>
        <p className={`camp-status${sync.waiting === 0 ? ' ok' : ''}`}>
          {sync.waiting === 0 && <Icon name="check" size={18} />}
          {sync.waiting === 0
            ? 'Everything is at camp'
            : `${sync.waiting} waiting to send${sync.online ? '…' : ' (no signal yet)'}`}
        </p>
        {sync.error && sync.online && <p className="field-warn">Couldn't reach camp: {sync.error}</p>}
        <p className="field-hint">
          {data.stands.length} stand{data.stands.length === 1 ? '' : 's'} from the hub.
        </p>
        <button
          className="end-button"
          onClick={() => {
            if (window.confirm(`Leave ${camp.name}? Pins and hunts stay on this phone.`)) props.onData((d) => ({ ...d, camp: null }));
          }}
        >
          Leave camp
        </button>
      </section>
    );
  }

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const link = await joinCamp(code, hunter.trim());
      // Anything already on the phone goes up too.
      props.onData((d) => ({ ...d, camp: link, sent: {} }));
      props.onMessage(`Joined ${link.name}.`);
    } catch (e) {
      setError(navigator.onLine ? (e instanceof Error ? e.message : String(e)) : 'Joining needs signal. Try again when you have some.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="field-card">
      <h2>Join your camp</h2>
      <p className="field-hint">Get the camp code from whoever runs the hub (Settings › Camp sync). You only do this once.</p>
      <input type="text" placeholder="Your name, e.g. Dad" value={hunter} onChange={(e) => setHunter(e.target.value)} autoComplete="name" />
      <input
        type="text"
        placeholder="Camp code, e.g. ABCD-EFGH-JKMN"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      {error && <p className="field-warn">{error}</p>}
      <button className="big-button" disabled={busy || !hunter.trim() || code.replace(/[^A-Za-z0-9]/g, '').length < 12} onClick={() => void join()}>
        {busy ? 'Joining…' : 'Join camp'}
      </button>
    </section>
  );
}
