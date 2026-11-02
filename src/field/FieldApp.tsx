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
import { MARKER_TYPES } from '@/lib/featureTypes';
import type { IconName } from '@/lib/icons';
import { DEER_KINDS, HEADINGS, newSighting, sightingSummary } from '@/lib/reports';
import type { DeerKind, FieldPin, HuntReport, MarkerType, Sighting } from '@/types/models';

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

  const gps = useGps(tab === 'pin' || tab === 'hunt');
  const sync = useCampSync(data, setData);
  const active = data.reports.find((r) => r.id === data.activeReportId) ?? null;
  // With a camp, what's still waiting for signal; without one, everything on the phone.
  const unsent = data.camp ? sync.waiting : data.pins.length + data.reports.length;
  const loggedBy = data.camp?.hunter ?? null;

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
        {tab === 'pin' && <PinTab fix={gps.fix} pins={data.pins} onAdd={(pin) => setData((d) => ({ ...d, pins: [{ ...pin, loggedBy }, ...d.pins] }))} onMessage={setMessage} />}
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
            onChange={saveReport}
            onEnd={(report) => {
              saveReport({ ...report, end: new Date().toISOString() });
              setData((d) => ({ ...d, activeReportId: null }));
              setMessage(data.camp ? 'Hunt saved. It goes to camp as soon as you have signal.' : 'Hunt saved. Send it to the hub from the Send tab.');
            }}
          />
        )}
        {tab === 'stands' && <StandsTab data={data} />}
        {tab === 'send' && <SendTab data={data} sync={sync} onData={setData} onMessage={setMessage} />}
      </main>

      {message && <div className="field-toast">{message}</div>}

      <nav className="field-tabs">
        {(
          [
            ['pin', 'pin', 'Pin'],
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

function PinTab(props: { fix: Fix | null; pins: FieldPin[]; onAdd(pin: FieldPin): void; onMessage(m: string): void }) {
  const [type, setType] = useState<MarkerType>('stand');
  const [note, setNote] = useState('');
  const { fix } = props;
  // A fix older than a minute may be from somewhere else; wait for a fresh one.
  const fresh = fix && Date.now() - fix.at < 60_000;

  return (
    <section className="field-card">
      <h2>Drop a pin where you're standing</h2>
      <div className="type-grid">
        {PIN_TYPES.map((t) => (
          <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>
            <span className="type-dot" style={{ background: MARKER_TYPES[t].color }} />
            {MARKER_TYPES[t].label}
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
          props.onMessage(`${MARKER_TYPES[type].label} pin saved (±${Math.round(fix.accuracyM)} m).`);
        }}
      >
        {fresh ? `Drop ${MARKER_TYPES[type].label.toLowerCase()} pin` : 'Waiting for GPS…'}
      </button>
      {fix && fix.accuracyM > 25 && <p className="field-hint">GPS is rough right now (±{Math.round(fix.accuracyM)} m). Give it a minute in the open for a better fix.</p>}

      {props.pins.length > 0 && (
        <>
          <h3>Saved pins</h3>
          <ul className="field-list">
            {props.pins.map((p) => (
              <li key={p.id}>
                <span className="type-dot" style={{ background: MARKER_TYPES[p.type].color }} />
                <span>
                  {MARKER_TYPES[p.type].label}
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

function HuntTab(props: {
  data: FieldData;
  active: HuntReport | null;
  fix: Fix | null;
  onStart(standId: string | null): void;
  onChange(report: HuntReport): void;
  onEnd(report: HuntReport): void;
}) {
  const { data, active } = props;
  const [standId, setStandId] = useState<string>('');

  // Suggest the closest stand from GPS.
  useEffect(() => {
    if (standId || !props.fix || data.stands.length === 0) return;
    const { lat, lng } = props.fix;
    const closest = [...data.stands].sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng))[0];
    setStandId(closest.id);
  }, [props.fix, data.stands, standId]);

  if (!active) {
    return (
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

        {data.reports.length > 0 && (
          <>
            <h3>Hunts on this phone</h3>
            <ul className="field-list">
              {data.reports.map((r) => (
                <li key={r.id}>
                  <span>{data.stands.find((s) => s.id === r.standId)?.name ?? 'No stand'}</span>
                  <span className="muted">
                    {new Date(r.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {sightingSummary(r)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    );
  }

  return (
    <QuickLog
      report={active}
      standName={data.stands.find((s) => s.id === active.standId)?.name ?? 'No stand'}
      onChange={props.onChange}
      onEnd={() => props.onEnd(active)}
    />
  );
}

// Fast logging from the stand: what, how many, which way, tap Save.
function QuickLog(props: { report: HuntReport; standName: string; onChange(r: HuntReport): void; onEnd(): void }) {
  const { report } = props;
  const [kind, setKind] = useState<DeerKind>('doe');
  const [count, setCount] = useState(1);
  const [heading, setHeading] = useState<number | null>(null);
  const [buckName, setBuckName] = useState('');
  const notes = useRef<HTMLTextAreaElement>(null);

  const add = () => {
    const sighting: Sighting = {
      ...newSighting(new Date().toISOString()),
      kind,
      count,
      headingDeg: heading,
      buckName: kind === 'buck' ? buckName.trim() || null : null,
    };
    props.onChange({ ...report, sightings: [...report.sightings, sighting] });
    setCount(1);
    setHeading(null);
    setBuckName('');
  };

  return (
    <section className="field-card">
      <h2>
        {props.standName} <span className="muted">since {clock(report.start)}</span>
      </h2>

      <div className="kind-row">
        {(Object.keys(DEER_KINDS) as DeerKind[]).map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} style={{ '--deer': DEER_KINDS[k].color } as CSSProperties} onClick={() => setKind(k)}>
            {DEER_KINDS[k].label}
          </button>
        ))}
      </div>
      {kind === 'buck' && <input type="text" placeholder="Which buck? e.g. Big 8" value={buckName} onChange={(e) => setBuckName(e.target.value)} />}

      <div className="count-row">
        <button onClick={() => setCount(Math.max(1, count - 1))} aria-label="Fewer">
          −
        </button>
        <strong>{count}</strong>
        <button onClick={() => setCount(count + 1)} aria-label="More">
          +
        </button>
      </div>

      <div className="field-compass">
        {HEADINGS.map((h) => (
          <button key={h.point} className={`h-${h.point}${heading === h.deg ? ' active' : ''}`} onClick={() => setHeading(heading === h.deg ? null : h.deg)}>
            {h.point}
          </button>
        ))}
        <span className="h-C">{heading === null ? 'Still' : <span style={{ display: 'inline-block', transform: `rotate(${heading}deg)` }}>↑</span>}</span>
      </div>

      <button className="big-button" onClick={add}>
        Save {count} {count === 1 ? DEER_KINDS[kind].label.toLowerCase() : DEER_KINDS[kind].plural}
      </button>

      {report.sightings.length > 0 && (
        <ul className="field-list">
          {[...report.sightings].reverse().map((s) => (
            <li key={s.id}>
              <span className="type-dot" style={{ background: DEER_KINDS[s.kind].color }} />
              <span>
                {s.count} {s.count === 1 ? DEER_KINDS[s.kind].label.toLowerCase() : DEER_KINDS[s.kind].plural}
                {s.buckName ? ` (${s.buckName})` : ''}
                {s.headingDeg !== null ? ` → ${HEADINGS.find((h) => h.deg === s.headingDeg)?.point}` : ''}
              </span>
              <span className="muted">{clock(s.time)}</span>
            </li>
          ))}
        </ul>
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
          if (notes.current) props.onChange({ ...report, notes: notes.current.value || null });
          props.onEnd();
        }}
      >
        Done hunting
      </button>
    </section>
  );
}

function StandsTab({ data }: { data: FieldData }) {
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
      <ul className="field-list stands">
        {data.stands.map((s) => (
          <li key={s.id}>
            <span>
              <strong>{s.name}</strong>
              {s.goodWinds.length > 0 && <span className="muted"> · good on {s.goodWinds.join(' ')}</span>}
            </span>
            <a className="maps-button" href={appleMapsUrl(s)}>
              Open in Apple Maps
            </a>
          </li>
        ))}
      </ul>
    </section>
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
          const file: PhoneFile = { kind: PHONE_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), pins: data.pins, reports: data.reports };
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
          {sync.waiting === 0
            ? '✓ Everything is at camp'
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
