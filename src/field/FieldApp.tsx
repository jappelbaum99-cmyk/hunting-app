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
import { MARKER_TYPES } from '@/lib/featureTypes';
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
  const active = data.reports.find((r) => r.id === data.activeReportId) ?? null;
  const unsent = data.pins.length + data.reports.length;

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
        {tab === 'pin' && <PinTab fix={gps.fix} pins={data.pins} onAdd={(pin) => setData((d) => ({ ...d, pins: [pin, ...d.pins] }))} onMessage={setMessage} />}
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
              });
              setData((d) => ({ ...d, reports: [report, ...d.reports], activeReportId: report.id }));
            }}
            onChange={saveReport}
            onEnd={(report) => {
              saveReport({ ...report, end: new Date().toISOString() });
              setData((d) => ({ ...d, activeReportId: null }));
              setMessage('Hunt saved. Send it to the hub from the Send tab.');
            }}
          />
        )}
        {tab === 'stands' && <StandsTab data={data} />}
        {tab === 'send' && <SendTab data={data} onData={setData} onMessage={setMessage} />}
      </main>

      {message && <div className="field-toast">{message}</div>}

      <nav className="field-tabs">
        {(
          [
            ['pin', '📍', 'Pin'],
            ['hunt', '🦌', active ? 'Hunting' : 'Hunt'],
            ['stands', '🪜', 'Stands'],
            ['send', '📤', unsent ? `Send (${unsent})` : 'Send'],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span aria-hidden>{icon}</span>
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
        {data.stands.length === 0 && <p className="field-hint">Send your stands from the hub (Send tab) to pick one here.</p>}
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
        <p className="field-hint">No stands yet. In the hub, use “Send stands to phone”, then load the file on the Send tab.</p>
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

function SendTab(props: { data: FieldData; onData(update: (d: FieldData) => FieldData): void; onMessage(m: string): void }) {
  const { data } = props;
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section className="field-card">
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
    </section>
  );
}
