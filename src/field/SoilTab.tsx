import { useState } from 'react';

import { Icon } from '@/components/Icon';
import type { FieldData } from '@/field/fieldData';
import type { SentStatus } from '@/field/SentTools';
import type { FieldPin } from '@/types/models';

// A GPS fix, as the field page reads it.
interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  at: number;
}

// The soil sampling run going on now: which field, and when it started.
export interface SoilRun {
  id: string;
  areaId: string | null;
  // Null when started without a field; it's picked on the hub later.
  fieldName: string | null;
  startedAt: string;
}

// What a test is called on the phone: its field, or the day it was started.
export function testName(fieldName: string | null, at: string): string {
  return fieldName ?? `Soil test ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// A soil sampling run, its own process apart from dropping pins: pick the field,
// tap at every spot you take a core, then finish. Each core goes to the hub as a
// numbered sample spot in that field, and the hub ties them to the field's soil
// test when the lab results come back.
export function SoilTab(props: {
  data: FieldData;
  fix: Fix | null;
  gpsError: string | null;
  status(item: { id: string; updatedAt: string }): SentStatus;
  onStart(run: SoilRun): void;
  onSample(pin: FieldPin): void;
  onUndo(id: string): void;
  onFinish(): void;
  onMessage(m: string): void;
}) {
  const { data, fix } = props;
  const run = data.soilRun ?? null;
  // A food plot picked to sample, or null to start without one.
  const [areaId, setAreaId] = useState<string | null>(null);
  const plots = [...data.plots].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const samples = (runId: string) => data.pins.filter((p) => p.soil?.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const fresh = fix && Date.now() - fix.at < 60_000;

  // Past runs on this phone, newest first.
  const pastRuns = Object.values(
    data.pins
      .filter((p) => p.soil && p.soil.runId !== run?.id)
      .reduce<Record<string, { runId: string; fieldName: string; at: string; pins: FieldPin[] }>>((runs, p) => {
        const key = p.soil!.runId;
        runs[key] ??= { runId: key, fieldName: testName(p.soil!.fieldName, p.createdAt), at: p.createdAt, pins: [] };
        runs[key].pins.push(p);
        return runs;
      }, {}),
  ).sort((a, b) => b.at.localeCompare(a.at));

  if (!run) {
    const picked = areaId ? (plots.find((p) => p.id === areaId) ?? null) : null;
    return (
      <>
        <section className="field-card">
          <h2>Start a soil test</h2>
          <p className="field-hint">Tap a field, or just start the test and pick the field on the hub later. Then mark each spot you take a core.</p>
          {plots.length > 0 && (
            <div className="type-grid">
              {plots.map((p) => (
                <button key={p.id} className={areaId === p.id ? 'active' : ''} onClick={() => setAreaId(areaId === p.id ? null : p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {plots.length === 0 && (
            <p className="field-hint">{data.camp ? 'Your food plots show here once the hub has shared them.' : 'Join your camp to pick from your food plots, or just start the test.'}</p>
          )}
          <button
            className="big-button"
            onClick={() => props.onStart({ id: crypto.randomUUID(), areaId: picked?.id ?? null, fieldName: picked?.name ?? null, startedAt: new Date().toISOString() })}
          >
            {picked ? `Start a soil test in ${picked.name}` : 'Just start a test'}
          </button>
          <details className="soil-howto">
            <summary>How to take a good sample</summary>
            <ul className="soil-tips">
              <li>Walk a zigzag across the whole field and take 10 to 15 cores.</li>
              <li>Go 4 to 6 inches deep with a probe or spade, and skip spots like old brush piles, gates and where lime was piled.</li>
              <li>Mix the cores in a clean plastic bucket and send about 2 cups to the lab.</li>
            </ul>
          </details>
          {pastRuns.length > 0 && <PastRuns runs={pastRuns} status={props.status} />}
        </section>
      </>
    );
  }

  const taken = samples(run.id);
  return (
    <>
      <section className="field-card soil-run">
        <h2>Soil test: {testName(run.fieldName, run.startedAt)}</h2>
        <div className="soil-count">
          <strong>{taken.length}</strong>
          <span>{taken.length === 1 ? 'core' : 'cores'} so far · aim for 10 to 15</span>
        </div>
        <button
          className="big-button"
          disabled={!fresh}
          onClick={() => {
            if (!fix) return;
            const n = taken.length + 1;
            const now = new Date().toISOString();
            props.onSample({
              id: crypto.randomUUID(),
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              lat: fix.lat,
              lng: fix.lng,
              accuracyM: Math.round(fix.accuracyM),
              type: 'soil_sample',
              note: null,
              status: 'new',
              markerId: null,
              soil: { runId: run.id, areaId: run.areaId, fieldName: run.fieldName, sample: n },
            });
            props.onMessage(`Core ${n} marked (±${Math.round(fix.accuracyM)} m).`);
          }}
        >
          {fresh ? `Took core ${taken.length + 1} here` : 'Waiting for GPS…'}
        </button>
        {props.gpsError && <p className="field-warn">{props.gpsError}</p>}
        {fix && fix.accuracyM > 25 && <p className="field-hint">GPS is rough right now (±{Math.round(fix.accuracyM)} m).</p>}

        {taken.length > 0 && (
          <ul className="field-list">
            {[...taken].reverse().map((p) => (
              <li key={p.id}>
                <span className="type-dot" style={{ background: '#a0673a' }} />
                <span>Core {p.soil!.sample}</span>
                <span className="muted">{new Date(p.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                {props.status(p) !== 'added' && (
                  <button className="icon-button" aria-label={`Remove core ${p.soil!.sample}`} onClick={() => props.onUndo(p.id)}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <button
          className="soil-finish"
          onClick={() => {
            if (taken.length === 0 && !window.confirm('No cores marked yet. Stop this soil test?')) return;
            props.onFinish();
          }}
        >
          {taken.length ? `Done: ${taken.length} core${taken.length === 1 ? '' : 's'}` : 'Stop'}
        </button>
      </section>
    </>
  );
}

function PastRuns({ runs, status }: { runs: { runId: string; fieldName: string; at: string; pins: FieldPin[] }[]; status(item: { id: string; updatedAt: string }): SentStatus }) {
  return (
    <>
      <h3>Soil tests taken</h3>
      <ul className="field-list">
        {runs.map((r) => {
          const onHub = r.pins.every((p) => status(p) === 'added');
          const waiting = r.pins.some((p) => status(p) === 'waiting' || status(p) === 'local');
          return (
            <li key={r.runId}>
              <span className="type-dot" style={{ background: '#a0673a' }} />
              <span>
                {r.fieldName} · {r.pins.length} core{r.pins.length === 1 ? '' : 's'}
              </span>
              <span className="muted">{onHub ? 'on the hub' : waiting ? 'waiting for signal' : 'sent'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
