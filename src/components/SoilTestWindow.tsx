import { useMemo, useState } from 'react';

import { Icon } from '@/components/Icon';
import { applyDraft, blankDraft, draftOf, LatestTest, SoilForm, type Draft } from '@/components/SoilTestsField';
import { acresOf, boundsOf, formatAcres } from '@/lib/geo';
import { formatPlotDate, removeEntry, todayDate } from '@/lib/plotLog';
import { phRating, removeSoilTest, retestSchedule, runName, sampleRuns, saveSoilTest, soilTests, testSummary, type SampleRun } from '@/lib/soil';
import type { AreaGeometry, MapArea, MapMarker, SoilTest } from '@/types/models';

// What the window shows on the right.
export type SoilWindowPick = { kind: 'run'; key: string } | { kind: 'test'; areaId: string; testId: string } | { kind: 'new' };

interface Props {
  areas: MapArea[];
  markers: MapMarker[];
  initial: SoilWindowPick | null;
  onSaveArea(area: MapArea): void;
  // A new field drawn around a test's sample spots.
  onAddField(spots: MapMarker[], name: string): MapArea;
  onSaveMarkers(markers: MapMarker[]): void;
  onAddTask(text: string): void;
  onShowOnMap(geometry: AreaGeometry | null, spots: MapMarker[]): void;
  onClose(): void;
}

const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Every soil test in one place: ones taken in the field waiting for lab results,
// and ones with results in. Pick one to give it a field, type in the lab's numbers
// and see what to buy.
export function SoilTestWindow(props: Props) {
  const { areas, markers } = props;
  const live = areas.filter((a) => !a.deletedAt);
  const runs = useMemo(() => sampleRuns(markers, live), [markers, live]);
  const waiting = runs.filter((r) => !r.test);
  const done = live
    .flatMap((area) => soilTests(area).map((test) => ({ area, test })))
    .sort((a, b) => b.test.date.localeCompare(a.test.date) || b.test.updatedAt.localeCompare(a.test.updatedAt));
  const [pick, setPick] = useState<SoilWindowPick | null>(props.initial ?? (waiting[0] ? { kind: 'run', key: waiting[0].key } : done[0] ? { kind: 'test', areaId: done[0].area.id, testId: done[0].test.id } : { kind: 'new' }));

  const areaName = (id: string | null) => live.find((a) => a.id === id)?.name ?? null;
  const pickedRun = pick?.kind === 'run' ? (runs.find((r) => r.key === pick.key) ?? null) : null;
  const pickedTest = pick?.kind === 'test' ? (done.find((d) => d.area.id === pick.areaId && d.test.id === pick.testId) ?? null) : null;

  return (
    <div className="soil-window-backdrop" role="dialog" aria-label="Soil tests">
      <div className="soil-window">
        <header className="soil-window-head">
          <h2>Soil Tests</h2>
          <button className="icon" onClick={props.onClose} title="Close" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="soil-window-body">
          <nav className="soil-window-list">
            <div className="soil-list-head">Waiting for results</div>
            {waiting.length === 0 && <p className="hint">None. Start a soil test on the phone (Map tab, Soil test), and its cores show here.</p>}
            {waiting.map((r) => (
              <button key={r.key} className={`soil-list-row${pick?.kind === 'run' && pick.key === r.key ? ' active' : ''}`} onClick={() => setPick({ kind: 'run', key: r.key })}>
                <span className="row-title">{runName(r, areaName(r.areaId))}</span>
                <span className="row-detail">
                  {r.spots.length} core{r.spots.length === 1 ? '' : 's'} · {formatPlotDate(dayOf(r.firstAt))}
                </span>
                {!r.areaId && <span className="soil-badge">Needs a field</span>}
              </button>
            ))}

            <div className="soil-list-head">Results in</div>
            {done.length === 0 && <p className="hint">No results yet.</p>}
            {done.map(({ area, test }) => {
              const rating = test.ph != null ? phRating(test.ph) : null;
              return (
                <button
                  key={test.id}
                  className={`soil-list-row${pick?.kind === 'test' && pick.testId === test.id ? ' active' : ''}`}
                  onClick={() => setPick({ kind: 'test', areaId: area.id, testId: test.id })}
                >
                  <span className="row-title">{area.name || 'Field'}</span>
                  <span className="row-detail">{formatPlotDate(test.date)}</span>
                  {rating && <span className={`soil-badge soil-${rating.tone}`}>pH {test.ph}</span>}
                </button>
              );
            })}

            <button className={`soil-list-new${pick?.kind === 'new' ? ' active' : ''}`} onClick={() => setPick({ kind: 'new' })}>
              + Results for a field (no cores marked)
            </button>
          </nav>

          <section className="soil-window-main">
            {pickedRun && (
              <RunDetail
                key={pickedRun.key}
                {...props}
                run={pickedRun}
                areas={live}
                onSaved={(areaId, testId) => setPick({ kind: 'test', areaId, testId })}
              />
            )}
            {pickedTest && <TestDetail key={pickedTest.test.id} {...props} areas={live} area={pickedTest.area} test={pickedTest.test} markers={markers} onRemoved={() => setPick(waiting[0] ? { kind: 'run', key: waiting[0].key } : { kind: 'new' })} />}
            {pick?.kind === 'new' && <NewDetail {...props} areas={live} onSaved={(areaId, testId) => setPick({ kind: 'test', areaId, testId })} />}
            {!pickedRun && !pickedTest && pick?.kind !== 'new' && <p className="empty">Pick a soil test on the left.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

// A test's field and spots, as a small drawing: the field's outline and numbered cores.
function SpotsDrawing({ field, spots }: { field: AreaGeometry | null; spots: MapMarker[] }) {
  const points: [number, number][] = spots.map((s) => [s.lng, s.lat]);
  const rings = field ? (field.type === 'Polygon' ? field.coordinates : field.coordinates.flat()) : [];
  const all = [...points, ...rings.flat().map((p) => [p[0], p[1]] as [number, number])];
  if (!all.length) return null;
  const [w, s, e, n] = field ? boundsOf(field) : [Infinity, Infinity, -Infinity, -Infinity];
  const minX = Math.min(w, ...points.map((p) => p[0]));
  const maxX = Math.max(e, ...points.map((p) => p[0]));
  const minY = Math.min(s, ...points.map((p) => p[1]));
  const maxY = Math.max(n, ...points.map((p) => p[1]));
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxX - minX) * k, 1e-5);
  const spanY = Math.max(maxY - minY, 1e-5);
  const W = 320;
  const H = Math.min(240, Math.max(140, (W * spanY) / spanX));
  const pad = 18;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = (W - spanX * scale) / 2;
  const oy = (H - spanY * scale) / 2;
  const xy = ([lng, lat]: [number, number] | number[]) => [ox + (lng - minX) * k * scale, H - oy - (lat - minY) * scale];
  return (
    <svg className="soil-drawing" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where the cores were taken">
      {rings.map((ring, i) => (
        <path key={i} d={`M${ring.map((p) => xy(p).join(',')).join('L')}Z`} className="soil-drawing-field" />
      ))}
      {spots.map((m, i) => {
        const [x, y] = xy([m.lng, m.lat]);
        return (
          <g key={m.id}>
            <circle cx={x} cy={y} r={8} className="soil-drawing-spot" />
            <text x={x} y={y + 3.5} textAnchor="middle" className="soil-drawing-num">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type DetailProps = Props & { areas: MapArea[] };

// Cores taken, no results yet: pick or make the field, then type in the lab's numbers.
function RunDetail({ run, areas, onSaved, ...props }: DetailProps & { run: SampleRun; onSaved(areaId: string, testId: string): void }) {
  const [areaId, setAreaId] = useState<string | null>(run.areaId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [addCard, setAddCard] = useState(true);
  const [addRetest, setAddRetest] = useState(true);
  const area = areas.find((a) => a.id === areaId) ?? null;
  const name = runName(run, area?.name);
  const by = run.spots.find((s) => s.notes)?.notes;

  const save = () => {
    if (!draft || !area) return;
    const { area: next, test, cardText } = applyDraft(area, draft, { sampleIds: run.spots.map((s) => s.id), addCard, addRetest });
    props.onSaveArea(next);
    // The cores now belong to this field.
    props.onSaveMarkers(run.spots.filter((s) => s.sampleOf !== area.id).map((s) => ({ ...s, sampleOf: area.id, updatedAt: new Date().toISOString() })));
    if (cardText) props.onAddTask(cardText);
    onSaved(area.id, test.id);
  };

  return (
    <div className="soil-detail">
      <div className="soil-detail-head">
        <div>
          <h3>{name}</h3>
          <p className="muted">
            {run.spots.length} core{run.spots.length === 1 ? '' : 's'} taken {formatPlotDate(dayOf(run.firstAt))}
            {by ? ` · ${by}` : ''}
          </p>
        </div>
        <button onClick={() => props.onShowOnMap(area?.geometry ?? null, run.spots)}>Show on map</button>
      </div>

      <ol className="soil-steps">
        <li className={area ? 'done' : 'now'}>
          <strong>Field</strong>
          <div className="soil-step-body">
            <SpotsDrawing field={area?.geometry ?? null} spots={run.spots} />
            <div className="soil-field-pick">
              <select value={areaId ?? ''} onChange={(e) => setAreaId(e.target.value || null)} aria-label="Field">
                <option value="">Pick the field…</option>
                {[...areas]
                  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || 'Unnamed area'} · {formatAcres(acresOf(a.geometry))}
                    </option>
                  ))}
              </select>
              <span className="muted">or</span>
              <button
                onClick={() => {
                  const made = props.onAddField(run.spots, run.fieldName ?? `Field ${new Date(run.firstAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
                  setAreaId(made.id);
                }}
                title="Draws a field outline around these cores; reshape it on the map later with Edit shape"
              >
                Make a field from these spots
              </button>
            </div>
            {area && <p className="hint">{formatAcres(acresOf(area.geometry))}: the lime and fertilizer amounts are worked out for this size.</p>}
          </div>
        </li>
        <li className={draft ? 'now' : ''}>
          <strong>Lab results</strong>
          <div className="soil-step-body">
            {draft ? (
              <>
                {!area && <p className="poster-warn">Pick or make the field first, so the results have somewhere to go.</p>}
                <SoilForm
                  draft={draft}
                  setDraft={setDraft}
                  isNew
                  hasRetest={Boolean(area && retestSchedule(area))}
                  addCard={addCard}
                  setAddCard={setAddCard}
                  addRetest={addRetest}
                  setAddRetest={setAddRetest}
                  onSave={() => area && save()}
                  onCancel={() => setDraft(null)}
                />
              </>
            ) : (
              <>
                <p className="hint">Mix the cores, send about 2 cups to the lab, and type the report in here when it comes back.</p>
                <button className="primary" onClick={() => setDraft({ ...blankDraft(), date: dayOf(run.firstAt) })}>
                  Add the lab results
                </button>
              </>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}

// A test with results: what to buy, the field's history, and edit or remove.
function TestDetail({ area, test, markers, onRemoved, ...props }: DetailProps & { area: MapArea; test: SoilTest; onRemoved(): void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const spots = markers.filter((m) => test.sampleIds?.includes(m.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const history = soilTests(area);

  return (
    <div className="soil-detail">
      <div className="soil-detail-head">
        <div>
          <h3>{area.name || 'Field'}</h3>
          <p className="muted">
            Sampled {formatPlotDate(test.date)}
            {spots.length ? ` · ${spots.length} cores` : ''} · {formatAcres(acresOf(area.geometry))}
          </p>
        </div>
        <button onClick={() => props.onShowOnMap(area.geometry, spots)}>Show on map</button>
      </div>

      <div className="soil-detail-grid">
        <div>
          {draft ? (
            <SoilForm
              draft={draft}
              setDraft={setDraft}
              isNew={false}
              hasRetest
              addCard={false}
              setAddCard={() => undefined}
              addRetest={false}
              setAddRetest={() => undefined}
              onSave={() => {
                props.onSaveArea(applyDraft(area, draft, { sampleIds: test.sampleIds ?? [], addCard: false, addRetest: false }).area);
                setDraft(null);
              }}
              onCancel={() => setDraft(null)}
              onRemove={() => {
                if (!window.confirm(`Remove the soil test from ${formatPlotDate(test.date)}? Its sample spots stay on the map and go back to waiting for results.`)) return;
                let next = removeSoilTest(area, test.id);
                if (next.log?.some((e) => e.id === test.id)) next = removeEntry(next, test.id);
                props.onSaveArea(next);
                onRemoved();
              }}
            />
          ) : (
            <>
              <LatestTest test={test} acres={acresOf(area.geometry)} onBlend={(blend) => props.onSaveArea(saveSoilTest(area, { ...test, blend, updatedAt: new Date().toISOString() }))} />
              <button onClick={() => setDraft(draftOf(test))}>Edit results</button>
            </>
          )}
        </div>
        <div>
          <SpotsDrawing field={area.geometry} spots={spots} />
          {history.length > 1 && (
            <>
              <div className="field-label">This field over time</div>
              <ul className="plot-log soil-history">
                {history.map((t) => (
                  <li key={t.id} className={t.id === test.id ? 'current' : undefined}>
                    <div className="plot-log-text">
                      <span className="row-title">{formatPlotDate(t.date)}</span>
                      <span className="row-detail">{testSummary(t)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Results for a field without any cores marked: pick the field, type them in.
function NewDetail({ areas, onSaved, ...props }: DetailProps & { onSaved(areaId: string, testId: string): void }) {
  const [areaId, setAreaId] = useState<string>('');
  const [draft, setDraft] = useState<Draft>({ ...blankDraft(), date: todayDate() });
  const [addCard, setAddCard] = useState(true);
  const [addRetest, setAddRetest] = useState(true);
  const area = areas.find((a) => a.id === areaId) ?? null;
  return (
    <div className="soil-detail">
      <div className="soil-detail-head">
        <h3>Results for a field</h3>
      </div>
      <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Field">
        <option value="">Pick the field…</option>
        {[...areas]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || 'Unnamed area'} · {formatAcres(acresOf(a.geometry))}
            </option>
          ))}
      </select>
      <SoilForm
        draft={draft}
        setDraft={setDraft}
        isNew
        hasRetest={Boolean(area && retestSchedule(area))}
        addCard={addCard}
        setAddCard={setAddCard}
        addRetest={addRetest}
        setAddRetest={setAddRetest}
        onSave={() => {
          if (!area) return;
          const { area: next, test, cardText } = applyDraft(area, draft, { sampleIds: [], addCard, addRetest });
          props.onSaveArea(next);
          if (cardText) props.onAddTask(cardText);
          onSaved(area.id, test.id);
        }}
        onCancel={() => setDraft({ ...blankDraft(), date: todayDate() })}
      />
      {!area && <p className="hint">Pick the field so the lime and fertilizer amounts fit its size.</p>}
    </div>
  );
}

