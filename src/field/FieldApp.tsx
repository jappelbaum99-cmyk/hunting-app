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
import { takeJoinCode } from '@/lib/site';
import { QrScanner } from '@/field/QrScanner';
import { pinTypeInfo } from '@/lib/featureTypes';
import type { IconName } from '@/lib/icons';
import { daySummary, huntsByDay, isLive, otherAnimals, standStats, type StandStats } from '@/lib/huntStats';
import { NotesTab } from '@/field/NotesTab';
import { useFieldWeather } from '@/field/useFieldWeather';
import { SentBadge, SentTools, type SentStatus } from '@/field/SentTools';
import { WalkCard } from '@/field/WalkCard';
import { WherePicker } from '@/field/WherePicker';
import { lineLengthM, metersBetween, packPoints, simplifyLine } from '@/lib/trails';
import { compassPointOf } from '@/lib/standRating';
import { formatPressure, pressureAt, weatherAt, type Forecast } from '@/lib/weather';
import { BEHAVIORS, DEER_KINDS, HEADINGS, huntPlaceName, kindInfo, newSighting, sightingLabel, sightingSummary, whereLabel } from '@/lib/reports';
import type { CustomPinType, DeerBehavior, DeerKind, FieldPin, FieldTrack, HuntReport, HuntSpot, MarkerType, Sighting } from '@/types/models';

type Tab = 'pin' | 'hunt' | 'stands' | 'notes' | 'send';

const PIN_TYPES: MarkerType[] = ['stand', 'blind', 'platform', 'camera', 'scrape', 'rub', 'trail', 'water', 'parking', 'other'];

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

// A camp code from the hub's QR code (field.html?join=CODE), read once as the page opens.
const JOIN_CODE = typeof window !== 'undefined' ? takeJoinCode() : null;
const sameCode = (a: string, b: string) => a.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === b.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export function FieldApp() {
  const [data, setData] = useState<FieldData>(loadFieldData);
  // A scanned QR code opens the Camp tab with the code filled in.
  const [tab, setTab] = useState<Tab>(data.activeReportId ? 'hunt' : JOIN_CODE ? 'send' : 'pin');
  // Moving stands is off each time the page opens, so a stand can't be moved by a stray tap.
  const [movingStands, setMovingStands] = useState(false);
  const [message, setMessage] = useState<string | null>(() => {
    if (!JOIN_CODE || !data.camp) return JOIN_CODE ? 'Enter your name to join the camp.' : null;
    return sameCode(JOIN_CODE, data.camp.code)
      ? `This phone is already in ${data.camp.name}.`
      : `This phone is in ${data.camp.name}. To join the new camp, leave ${data.camp.name} below first.`;
  });

  useEffect(() => saveFieldData(data), [data]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  // GPS runs on the Pin, Hunt and Notes tabs, while moving stands, and the whole time a walk is recorded.
  const gps = useGps(tab === 'pin' || tab === 'hunt' || tab === 'notes' || (tab === 'stands' && movingStands) || data.activeWalk !== null);
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
  const unsent = data.camp ? sync.waiting : data.pins.length + data.reports.length + data.tracks.length + data.notes.length;
  const loggedBy = data.camp?.hunter ?? null;
  // Where a pin or walk stands: waiting for signal, at camp, or handled on the hub.
  const statusOf = (item: { id: string; updatedAt: string }): SentStatus => {
    if (data.handled[item.id]) return data.handled[item.id];
    if (!data.camp) return 'local';
    return data.sent[item.id] === item.updatedAt ? 'sent' : 'waiting';
  };
  // Send these again (to camp), in case the hub missed them.
  const resend = (ids: string[]) => {
    if (!data.camp) return setMessage('Not in a camp yet. Use the Send tab to make a file, or join your camp.');
    setData((d) => ({ ...d, sent: Object.fromEntries(Object.entries(d.sent).filter(([id]) => !ids.includes(id))) }));
    setMessage(`Sending ${ids.length} again as soon as there's signal.`);
  };
  // Everyone else's hunts in the camp; this phone's own come from data.reports.
  const mine = new Set(data.reports.map((r) => r.id));
  const campHunts = data.camp ? data.campHunts.filter((r) => !mine.has(r.id)) : [];
  // Weather for the stand being hunted, else the first stand, else where the phone is.
  const activeStand = data.stands.find((s) => s.id === active?.standId);
  const weather = useFieldWeather(activeStand ?? active?.spot ?? data.stands[0] ?? gps.fix);

  const saveReport = (report: HuntReport) =>
    setData((d) => ({ ...d, reports: d.reports.map((r) => (r.id === report.id ? { ...report, updatedAt: new Date().toISOString() } : r)) }));

  return (
    <div className="field-app">
      <header className="field-header">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
        <h1>Fenceline</h1>
        <span className={`gps-badge${gps.fix ? ' ok' : ''}`}>
          {gps.fix ? `GPS ±${Math.round(gps.fix.accuracyM)} m` : tab === 'pin' || tab === 'hunt' || tab === 'notes' ? 'Finding GPS…' : 'GPS off'}
        </span>
      </header>

      <main className="field-main">
        {gps.error && (tab === 'pin' || tab === 'hunt') && <p className="field-warn">{gps.error}</p>}
        {tab === 'pin' && (
          <WalkCard
            walk={data.activeWalk}
            tracks={data.tracks}
            gpsReady={gps.fix !== null}
            here={gps.fix ? [gps.fix.lng, gps.fix.lat] : null}
            onStart={(shape) => setData((d) => ({ ...d, activeWalk: { id: crypto.randomUUID(), startedAt: new Date().toISOString(), points: [], shape } }))}
            onStop={() => {
              const walk = data.activeWalk;
              if (!walk || walk.points.length < 2) return;
              const isArea = walk.shape === 'area';
              const ended = new Date();
              const started = new Date(walk.startedAt);
              const track: FieldTrack = record({
                name: `${isArea ? 'Area walk' : 'Walk'} ${started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
                shape: isArea ? ('area' as const) : ('line' as const),
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
            status={statusOf}
            onResend={() => resend(data.tracks.map((t) => t.id))}
            onClear={() => setData((d) => ({ ...d, tracks: d.tracks.filter((t) => !d.handled[t.id]) }))}
          />
        )}
        {tab === 'pin' && <PinTab
          status={statusOf}
          onResend={() => resend(data.pins.map((p) => p.id))}
          onClear={() => setData((d) => ({ ...d, pins: d.pins.filter((p) => !d.handled[p.id]) }))}
          onRemove={(id) => setData((d) => ({ ...d, pins: d.pins.filter((p) => p.id !== id) }))}
          fix={gps.fix} pinTypes={data.pinTypes} pins={data.pins} onAdd={(pin) => setData((d) => ({ ...d, pins: [{ ...pin, loggedBy }, ...d.pins] }))} onMessage={setMessage} />}
        {tab === 'hunt' && <WeatherNow forecast={weather.forecast} offline={weather.offline} />}
        {tab === 'hunt' && (
          <HuntTab
            data={data}
            active={active}
            fix={gps.fix}
            onStart={(standId, spot) => {
              const report: HuntReport = record({
                standId,
                spot,
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
        {tab === 'stands' && (
          <StandsTab
            data={data}
            reports={[...data.reports, ...campHunts]}
            moving={movingStands}
            onMoving={setMovingStands}
            fix={gps.fix}
            gpsError={gps.error}
            onMove={(pin) => setData((d) => ({ ...d, pins: [{ ...pin, loggedBy }, ...d.pins] }))}
            onMessage={setMessage}
          />
        )}
        {tab === 'notes' && (
          <NotesTab
            data={data}
            fix={gps.fix}
            gpsError={gps.error}
            status={statusOf}
            onAdd={(note) => setData((d) => ({ ...d, notes: [note, ...d.notes] }))}
            onUpdate={(note) => setData((d) => ({ ...d, notes: d.notes.map((n) => (n.id === note.id ? note : n)) }))}
            onRemove={(id) => setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }))}
            onMessage={setMessage}
          />
        )}
        {tab === 'send' && <SendTab data={data} sync={sync} joinCode={JOIN_CODE} onData={setData} onMessage={setMessage} />}
      </main>

      {message && <div className="field-toast">{message}</div>}

      <nav className="field-tabs">
        {(
          [
            ['pin', data.activeWalk ? 'track' : 'pin', data.activeWalk ? 'Walking' : 'Pin'],
            ['hunt', 'track', active ? 'Hunting' : 'Hunt'],
            ['stands', 'stand', 'Stands'],
            ['notes', 'clipboard', 'Notes'],
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

function PinTab(props: {
  status(item: { id: string; updatedAt: string }): SentStatus;
  onResend(): void;
  onClear(): void;
  onRemove(id: string): void;
  fix: Fix | null; pinTypes: CustomPinType[]; pins: FieldPin[]; onAdd(pin: FieldPin): void; onMessage(m: string): void }) {
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
          <SentTools
            items={props.pins}
            status={props.status}
            what="pin"
            onResend={props.onResend}
            onClear={props.onClear}
          />
          <ul className="field-list">
            {props.pins.map((p) => (
              <li key={p.id}>
                <span className="type-dot" style={{ background: pinTypeInfo(p.type, props.pinTypes).color }} />
                <span>
                  {pinTypeInfo(p.type, props.pinTypes).label}
                  {p.note ? ` · ${p.note}` : ''}
                  <SentBadge status={props.status(p)} />
                </span>
                <span className="muted">{clock(p.createdAt)}</span>
                <button
                  className="icon-button"
                  aria-label="Remove from this phone"
                  onClick={() => {
                    const s = props.status(p);
                    if (s === 'added' || s === 'dismissed' || window.confirm("Remove this pin from the phone? The hub doesn't have it on the map yet.")) props.onRemove(p.id);
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
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

// The hunt picker's choice for a spot that isn't a stand.
const NEW_SPOT = 'new-spot';

function HuntTab(props: {
  data: FieldData;
  active: HuntReport | null;
  fix: Fix | null;
  // Hunts from the rest of the camp (not this phone's own).
  campHunts: HuntReport[];
  onStart(standId: string | null, spot: HuntSpot | null): void;
  onChange(report: HuntReport): void;
  onEnd(report: HuntReport): void;
}) {
  const { data, active, campHunts } = props;
  const [standId, setStandId] = useState<string>('');
  const [spotName, setSpotName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const placeName = (r: HuntReport) => huntPlaceName(r, data.stands);
  const newSpot = standId === NEW_SPOT;
  const fresh = props.fix && Date.now() - props.fix.at < 60_000 ? props.fix : null;

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
        standName={placeName(active)}
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
        standName={placeName(editing)}
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
          <option value={NEW_SPOT}>New spot (a tree, a climber…)</option>
          {data.stands.map((s) => (
            <option key={s.id} value={s.id}>
              {s.place ? `${s.name} · ${s.place}` : s.name}
            </option>
          ))}
        </select>
        {newSpot && (
          <>
            <input type="text" placeholder="Name it (optional), e.g. big oak on the bench" value={spotName} onChange={(e) => setSpotName(e.target.value)} />
            <p className="field-hint">
              {fresh
                ? `Uses where you are now (GPS ±${Math.round(fresh.accuracyM)} m). The hunt is kept like any other; the hub can make the spot a stand later.`
                : 'Finding your location…'}
            </p>
          </>
        )}
        {data.stands.length === 0 && (
          <p className="field-hint">
            {data.camp ? 'Stands show up here once the hub turns on camp sync.' : 'Join your camp (Camp tab) to pick a stand here.'}
          </p>
        )}
        <button
          className="big-button"
          disabled={newSpot && !fresh}
          onClick={() => {
            if (!newSpot) return props.onStart(standId || null, null);
            if (!fresh) return;
            props.onStart(null, { lat: fresh.lat, lng: fresh.lng, accuracyM: Math.round(fresh.accuracyM), name: spotName.trim() || null });
            setSpotName('');
            setStandId('');
          }}
        >
          {newSpot ? "I'm hunting here" : "I'm in the stand"}
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
                  {r.loggedBy ?? 'Someone'} · {placeName(r)}
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
                          <strong>{placeName(r)}</strong>
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
                        <strong>{placeName(r)}</strong>
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

// The sighting being filled in, saved as it changes so a refresh doesn't lose it.
const DRAFT_KEY = 'hunting-hub-field-draft';

interface SightingDraft {
  reportId: string;
  kind: DeerKind;
  count: number;
  heading: number | null;
  buckName: string;
  otherName: string;
  where: Sighting['fromStand'];
  note: string;
  editingId: string | null;
  behavior?: DeerBehavior | null;
}

function loadDraft(reportId: string): SightingDraft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as SightingDraft | null;
    return draft?.reportId === reportId ? draft : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: SightingDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Only a convenience.
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Only a convenience.
  }
}

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
  // A sighting being filled in is kept through a refresh (only for this hunt).
  const [draft] = useState(() => loadDraft(report.id));
  const [kind, setKind] = useState<DeerKind>(draft?.kind ?? 'doe');
  const [count, setCount] = useState(draft?.count ?? 1);
  const [heading, setHeading] = useState<number | null>(draft?.heading ?? null);
  const [buckName, setBuckName] = useState(draft?.buckName ?? '');
  const [otherName, setOtherName] = useState(draft?.otherName ?? '');
  const [where, setWhere] = useState<Sighting['fromStand']>(draft?.where ?? null);
  const [note, setNote] = useState(draft?.note ?? '');
  const [behavior, setBehavior] = useState<DeerBehavior | null>(draft?.behavior ?? null);
  const [editingId, setEditingId] = useState<string | null>(draft?.editingId ?? null);
  const notes = useRef<HTMLTextAreaElement>(null);
  // The latest report, for saves that happen a moment after typing.
  const latest = useRef(report);
  latest.current = report;
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    saveDraft({ reportId: report.id, kind, count, heading, buckName, otherName, where, note, editingId, behavior });
  }, [report.id, kind, count, heading, buckName, otherName, where, note, editingId, behavior]);

  // Hunt notes save as you type (a moment after you stop), not only when you tap away.
  const saveNotes = (value: string) => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      if ((value || null) !== latest.current.notes) props.onChange({ ...latest.current, notes: value || null });
    }, 600);
  };
  useEffect(() => () => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
  }, []);

  const reset = () => {
    setEditingId(null);
    setCount(1);
    setHeading(null);
    setBuckName('');
    setOtherName('');
    setWhere(null);
    setNote('');
    setBehavior(null);
  };

  const startEditing = (s: Sighting) => {
    setEditingId(s.id);
    setKind(s.kind);
    setCount(s.count);
    setHeading(s.headingDeg);
    setBuckName(s.buckName ?? '');
    setOtherName(s.kind === 'other' ? (s.notes ?? '') : '');
    setWhere(s.fromStand ?? null);
    setNote(s.comment ?? '');
    setBehavior(s.behavior ?? null);
  };

  const save = () => {
    const fields = {
      kind,
      count,
      headingDeg: heading,
      buckName: kind === 'buck' ? buckName.trim() || null : null,
      notes: kind === 'other' ? otherName.trim() || null : null,
      fromStand: where,
      comment: note.trim() || null,
      behavior,
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

      <div className="behavior-row" role="group" aria-label="What they were doing">
        {(Object.keys(BEHAVIORS) as DeerBehavior[]).map((b) => (
          <button key={b} className={behavior === b ? 'active' : ''} aria-pressed={behavior === b} onClick={() => setBehavior(behavior === b ? null : b)}>
            {BEHAVIORS[b]}
          </button>
        ))}
      </div>

      <WherePicker
        where={where ?? null}
        headingDeg={heading}
        color={DEER_KINDS[kind].color}
        onChange={(next) => {
          setWhere(next.where);
          setHeading(next.headingDeg);
        }}
        logged={report.sightings.filter((s) => s.id !== editingId)}
      />

      <input
        type="text"
        className="sighting-note"
        placeholder="Note (optional), e.g. chasing a doe"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Note about this sighting"
      />

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
                    {s.behavior ? ` · ${BEHAVIORS[s.behavior].toLowerCase()}` : ''}
                    {whereLabel(s) ? ` · ${whereLabel(s)}` : ''}
                    {s.comment && <span className="sighting-comment">{s.comment}</span>}
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
        onChange={(e) => saveNotes(e.target.value)}
        onBlur={(e) => {
          if (notesTimer.current) clearTimeout(notesTimer.current);
          if ((e.target.value || null) !== latest.current.notes) props.onChange({ ...latest.current, notes: e.target.value || null });
        }}
      />
      <button
        className="end-button"
        onClick={() => {
          // Keep notes typed but not yet blurred.
          if (notesTimer.current) clearTimeout(notesTimer.current);
          if (notes.current && (notes.current.value || null) !== latest.current.notes) props.onChange({ ...latest.current, notes: notes.current.value || null });
          clearDraft();
          props.onDone();
        }}
      >
        {props.doneLabel}
      </button>
    </section>
  );
}

// Each stand with its Apple Maps button, plus what hunting it has produced.
function StandsTab({
  data,
  reports,
  moving,
  onMoving,
  fix,
  gpsError,
  onMove,
  onMessage,
}: {
  data: FieldData;
  reports: HuntReport[];
  moving: boolean;
  onMoving(on: boolean): void;
  fix: Fix | null;
  gpsError: string | null;
  onMove(pin: FieldPin): void;
  onMessage(m: string): void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const fresh = fix && Date.now() - fix.at < 60_000 ? fix : null;
  // A new spot sent for a stand that the hub hasn't moved or turned down yet.
  const pendingMove = (standId: string) => data.pins.find((p) => p.moveStandId === standId && !p.deletedAt && !data.handled[p.id]) ?? null;
  const moveHere = (s: FieldData['stands'][number]) => {
    if (!fresh) return;
    const yards = Math.round(metersBetween([s.lng, s.lat], [fresh.lng, fresh.lat]) * 1.09361);
    if (!window.confirm(`Send your spot as the new location for ${s.name}? That's ${yards} yd from where it is now. The hub moves it once someone there says OK.`)) return;
    onMove(
      record({
        lat: fresh.lat,
        lng: fresh.lng,
        accuracyM: Math.round(fresh.accuracyM),
        type: 'stand',
        note: `New spot for ${s.name}`,
        status: 'new' as const,
        markerId: null,
        moveStandId: s.id,
      }),
    );
    onMessage(`New spot for ${s.name} saved (±${Math.round(fresh.accuracyM)} m).${data.camp ? ' It goes to the hub as soon as you have signal.' : ''}`);
  };
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
      <p className="field-hint">Apple Maps uses your downloaded offline maps to guide you in with no signal.</p>
      <label className={`move-toggle${moving ? ' on' : ''}`}>
        <input type="checkbox" checked={moving} onChange={(e) => onMoving(e.target.checked)} />
        <span>
          <strong>Move stands</strong>
          <span className="field-hint">
            {moving
              ? fresh
                ? `Stand at the stand's new spot, then tap its button. GPS ±${Math.round(fresh.accuracyM)} m.`
                : (gpsError ?? 'Finding your location…')
              : 'Turn on to send a new location for a stand you moved.'}
          </span>
        </span>
      </label>
      <ul className="field-list stands">
        {data.stands.map((s) => {
          const standReports = reports.filter((r) => r.standId === s.id);
          const stats = standStats(standReports);
          const open = openId === s.id;
          return (
            <li key={s.id}>
              <div className="stand-top">
                <button className="stand-head" onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}>
                  <span>
                    <strong>{s.name}</strong>
                    {s.place && <span className="stand-place"> · {s.place}</span>}
                    {s.goodWinds.length > 0 && <span className="muted"> · good on {s.goodWinds.join(' ')}</span>}
                  </span>
                  <span className="muted">
                    {stats.hunts === 0
                      ? 'No hunts yet'
                      : `${stats.hunts} hunt${stats.hunts === 1 ? '' : 's'} · ${stats.deer} deer${stats.mainHeading ? ` · mostly ${stats.mainHeading}` : ''}`}
                  </span>
                </button>
                <a className="maps-button" href={appleMapsUrl(s)} aria-label={`Open ${s.name} in Apple Maps`}>
                  <Icon name="pin" size={14} /> Maps
                </a>
              </div>
              {open && stats.hunts > 0 && <FieldStandHistory stats={stats} reports={standReports} />}
              {pendingMove(s.id) && <p className="field-hint move-pending">New spot saved. The hub moves the stand once someone there says OK.</p>}
              {moving && (
                <button className="move-button" disabled={!fresh} onClick={() => moveHere(s)}>
                  Stand moved? Use my spot as its new location
                </button>
              )}
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
  // From a scanned QR code, to fill in the join form.
  joinCode: string | null;
  onData(update: (d: FieldData) => FieldData): void;
  onMessage(m: string): void;
}) {
  const { data } = props;
  const fileInput = useRef<HTMLInputElement>(null);

  const files = (
    <>
      <h2>Send to the hub</h2>
      <p className="field-hint">
        {data.pins.length} pin{data.pins.length === 1 ? '' : 's'}, {data.reports.length} hunt{data.reports.length === 1 ? '' : 's'} and {data.notes.length} note{data.notes.length === 1 ? '' : 's'} on this phone.
        Send the file to your PC (email it to yourself, or save it to iCloud Drive), then use “Import from phone” in the hub.
      </p>
      <button
        className="big-button"
        disabled={data.pins.length + data.reports.length + data.notes.length === 0}
        onClick={() => {
          const file: PhoneFile = { kind: PHONE_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), pins: data.pins, reports: data.reports, tracks: data.tracks, notes: data.notes };
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          shareJsonFile(`fenceline-phone-${stamp}.json`, file)
            .then(() => props.onMessage('File ready. Bring it into the hub with “Import from phone”.'))
            .catch(() => undefined);
        }}
      >
        Send pins, hunts and notes
      </button>
      <button
        className="end-button"
        disabled={data.pins.length + data.reports.length + data.notes.length === 0 || data.activeReportId !== null}
        onClick={() => {
          if (window.confirm('Clear the pins, hunts and notes from this phone? Only do this after the hub has them.')) {
            props.onData((d) => ({ ...d, pins: [], reports: [], notes: [] }));
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
      <CampCard data={data} sync={props.sync} joinCode={props.joinCode} onData={props.onData} onMessage={props.onMessage} />
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
function CampCard(props: {
  data: FieldData;
  sync: CampStatus;
  joinCode: string | null;
  onData(update: (d: FieldData) => FieldData): void;
  onMessage(m: string): void;
}) {
  const { data, sync } = props;
  const [hunter, setHunter] = useState('');
  const [code, setCode] = useState(props.joinCode ?? '');
  const [scanning, setScanning] = useState(false);
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
      <p className="field-hint">Get the camp code from whoever runs the hub (Join the Camp in its sidebar), or scan its QR code below. You only do this once.</p>
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
      {scanning ? (
        <QrScanner
          onCode={(scanned) => {
            setCode(scanned);
            setScanning(false);
            props.onMessage(hunter.trim() ? 'Got the camp code. Tap Join camp.' : 'Got the camp code. Enter your name, then tap Join camp.');
          }}
          onClose={() => setScanning(false)}
        />
      ) : (
        // No camera API on pages that aren't https (or very old browsers).
        'mediaDevices' in navigator && (
          <button className="end-button" onClick={() => setScanning(true)}>
            Scan the camp QR code
          </button>
        )
      )}
      {error && <p className="field-warn">{error}</p>}
      <button className="big-button" disabled={busy || !hunter.trim() || code.replace(/[^A-Za-z0-9]/g, '').length < 12} onClick={() => void join()}>
        {busy ? 'Joining…' : 'Join camp'}
      </button>
    </section>
  );
}
