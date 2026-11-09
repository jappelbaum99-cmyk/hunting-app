import { useState } from 'react';

import { acresOf, formatAcres } from '@/lib/geo';
import { formatPlotDate, removeEntry, saveEntry, todayDate } from '@/lib/plotLog';
import { cadenceLabel } from '@/lib/schedules';
import {
  bestBlend,
  BLENDS,
  DEFAULT_RETEST_YEARS,
  FERTILIZER_BAG_LB,
  formatNumber,
  LIME_BAG_LB,
  limeFor,
  logEntryForTest,
  needsFertilizer,
  newRetestSchedule,
  phRating,
  planBlend,
  removeSoilTest,
  retestSchedule,
  saveSoilTest,
  soilTests,
  testSummary,
  workText,
} from '@/lib/soil';
import type { MapArea, MapMarker, SoilTest } from '@/types/models';

// The boxes of the form, as typed.
const NUMBER_FIELDS = ['ph', 'bufferPh', 'p', 'k', 'ca', 'mg', 'om', 'cec', 'lime', 'limeEnm', 'nLbs', 'pLbs', 'kLbs'] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];
export type Draft = Record<NumberField, string> & {
  id: string | null;
  date: string;
  lab: string;
  crop: string;
  units: SoilTest['units'];
  limeUnits: SoilTest['limeUnits'];
  notes: string;
};

export const blankDraft = (): Draft => ({
  ...(Object.fromEntries(NUMBER_FIELDS.map((f) => [f, ''])) as Record<NumberField, string>),
  id: null,
  date: todayDate(),
  lab: '',
  crop: '',
  units: 'lb_acre',
  limeUnits: 'tons',
  notes: '',
});

export const draftOf = (t: SoilTest): Draft => ({
  ...(Object.fromEntries(NUMBER_FIELDS.map((f) => [f, t[f] == null ? '' : String(t[f])])) as Record<NumberField, string>),
  id: t.id,
  date: t.date,
  lab: t.lab ?? '',
  crop: t.crop ?? '',
  units: t.units,
  limeUnits: t.limeUnits,
  notes: t.notes ?? '',
});

const toNumber = (s: string): number | null => {
  const n = Number(s.trim());
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};

// Saves the typed-in results to the field: the test (taking these sample spots
// if it's new), its plot log entry, the retest reminder, and the Action Board text
// for the work, when asked for.
export function applyDraft(
  record: MapArea,
  draft: Draft,
  opts: { sampleIds: string[]; addCard: boolean; addRetest: boolean },
): { area: MapArea; test: SoilTest; cardText: string | null } {
  const tests = soilTests(record);
  const existing = tests.find((t) => t.id === draft.id);
  const now = new Date().toISOString();
  const numbers = Object.fromEntries(NUMBER_FIELDS.map((f) => [f, toNumber(draft[f])])) as Record<NumberField, number | null>;
  const test: SoilTest = {
    ...numbers,
    id: existing?.id ?? crypto.randomUUID(),
    date: draft.date,
    lab: draft.lab.trim() || null,
    crop: draft.crop.trim() || null,
    units: draft.units,
    limeUnits: draft.limeUnits,
    notes: draft.notes.trim() || null,
    blend: existing?.blend ?? null,
    sampleIds: existing ? (existing.sampleIds ?? opts.sampleIds) : opts.sampleIds,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  };
  if (!test.blend || !planBlend(test, test.blend, 1)) test.blend = bestBlend(test);

  let next = saveSoilTest(record, test);
  next = saveEntry(next, logEntryForTest(test, record.log?.find((e) => e.id === test.id)));
  // The retest clock starts from the newest test.
  const retest = retestSchedule(record);
  if (retest) {
    if (!retest.lastDone || test.date > retest.lastDone) next = { ...next, schedules: (next.schedules ?? []).map((sc) => (sc.id === retest.id ? { ...sc, lastDone: test.date } : sc)) };
  } else if (!existing && opts.addRetest) {
    next = { ...next, schedules: [...(next.schedules ?? []), newRetestSchedule(test.date)] };
  }
  const cardText = !existing && opts.addCard ? workText(record.name || 'Field', test, acresOf(record.geometry), test.blend ?? null) : null;
  return { area: next, test, cardText };
}

// A food plot's soil tests: the newest one with what to buy for this plot, older
// ones for comparing, and a form for typing in the lab's report.
export function SoilTestsField({
  record,
  onChange,
  onAddTask,
  samples,
  onOpenWindow,
}: {
  record: MapArea;
  onChange(a: MapArea): void;
  onAddTask(text: string): void;
  // Soil sample pins inside this field.
  samples: MapMarker[];
  // Opens the Soil Tests window, on this test if given.
  onOpenWindow?: (testId: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [addCard, setAddCard] = useState(true);
  const [addRetest, setAddRetest] = useState(true);
  const tests = soilTests(record);
  const latest = tests[0];
  const acres = acresOf(record.geometry);
  const retest = retestSchedule(record);
  // Sample spots not tied to a test yet: they go with the next one saved.
  const linked = new Set(tests.flatMap((t) => t.sampleIds ?? []));
  const waiting = samples.filter((s) => !linked.has(s.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sampleDate = (m: MapMarker) => {
    const d = new Date(m.createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const save = () => {
    if (!draft || !draft.date) return;
    const existing = tests.find((t) => t.id === draft.id);
    const { area, cardText } = applyDraft(record, draft, { sampleIds: existing ? (existing.sampleIds ?? []) : waiting.map((m) => m.id), addCard, addRetest });
    onChange(area);
    if (cardText) onAddTask(cardText);
    setDraft(null);
  };

  const remove = (test: SoilTest) => {
    if (!window.confirm(`Remove the soil test from ${formatPlotDate(test.date)}?`)) return;
    let next = removeSoilTest(record, test.id);
    if (next.log?.some((e) => e.id === test.id)) next = removeEntry(next, test.id);
    onChange(next);
    if (draft?.id === test.id) setDraft(null);
  };

  return (
    <div className="field">
      <div className="field-label soil-field-label">
        <span>Soil test</span>
        {onOpenWindow && (
          <button className="link" onClick={() => onOpenWindow(latest?.id ?? null)} title="Every soil test in one window, with the sample spots">
            Open in Soil Tests
          </button>
        )}
      </div>

      {waiting.length > 0 && (
        <p className="soil-samples-waiting">
          <strong>{waiting.length} sample spot{waiting.length === 1 ? '' : 's'}</strong> on the map, taken {formatPlotDate(sampleDate(waiting[0]))}
          {sampleDate(waiting[0]) !== sampleDate(waiting[waiting.length - 1]) ? ` to ${formatPlotDate(sampleDate(waiting[waiting.length - 1]))}` : ''}. When the lab results come back, press <strong>Add soil test results</strong> and they go with it.
        </p>
      )}

      {latest && !draft && <LatestTest test={latest} acres={acres} onBlend={(blend) => onChange(saveSoilTest(record, { ...latest, blend, updatedAt: new Date().toISOString() }))} />}

      {tests.length > 1 && !draft && (
        <ul className="plot-log soil-history">
          {tests.map((t) => (
            <li key={t.id}>
              <div className="plot-log-text">
                <span className="row-title">{formatPlotDate(t.date)}</span>
                <span className="row-detail">{testSummary(t)}</span>
              </div>
              <button className="link" onClick={() => setDraft(draftOf(t))}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <SoilForm
          draft={draft}
          setDraft={setDraft}
          isNew={!draft.id}
          hasRetest={Boolean(retest)}
          addCard={addCard}
          setAddCard={setAddCard}
          addRetest={addRetest}
          setAddRetest={setAddRetest}
          onSave={save}
          onCancel={() => setDraft(null)}
          onRemove={draft.id ? () => remove(tests.find((t) => t.id === draft.id)!) : undefined}
        />
      ) : (
        <div className="soil-actions">
          <button className="schedule-add" onClick={() => setDraft({ ...blankDraft(), date: waiting.length ? sampleDate(waiting[waiting.length - 1]) : todayDate() })}>
            + Add soil test results
          </button>
          {latest && tests.length === 1 && (
            <button className="link" onClick={() => setDraft(draftOf(latest))}>
              Edit
            </button>
          )}
        </div>
      )}

      {!draft && (
        <div className="hint">
          {retest
            ? `Retest: ${cadenceLabel(retest).toLowerCase()} (see Schedule below).`
            : 'Take 10–15 cores 4–6 inches deep spread across the plot, mix them in a clean bucket, and send about 2 cups to the lab.'}
        </div>
      )}
    </div>
  );
}

export function LatestTest({ test, acres, onBlend }: { test: SoilTest; acres: number; onBlend(blend: string): void }) {
  const rating = test.ph != null ? phRating(test.ph) : null;
  const lime = limeFor(test, acres);
  const blend = test.blend ?? bestBlend(test);
  const plan = blend ? planBlend(test, blend, acres) : null;
  const best = bestBlend(test);
  const unit = test.units === 'ppm' ? 'ppm' : 'lb/ac';
  const recs = [
    test.lime ? (test.limeUnits === 'tons' ? `${test.lime} tons lime` : `${formatNumber(test.lime)} lb ENM`) : null,
    needsFertilizer(test) ? `${test.nLbs ?? 0}-${test.pLbs ?? 0}-${test.kLbs ?? 0} (N-P-K lb)` : null,
  ].filter(Boolean);

  return (
    <div className="soil-card">
      <div className="soil-head">
        {test.ph != null && (
          <span className={`soil-ph soil-${rating!.tone}`}>
            pH {test.ph}
            <small>{rating!.label}</small>
          </span>
        )}
        <span className="soil-meta">
          <span className="row-title">{formatPlotDate(test.date)}</span>
          <span className="row-detail">
            {[test.lab, test.crop && `for ${test.crop}`, test.sampleIds?.length ? `from ${test.sampleIds.length} sample spot${test.sampleIds.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'Latest test'}
          </span>
        </span>
      </div>

      <dl className="soil-numbers">
        {(
          [
            ['P', test.p, unit],
            ['K', test.k, unit],
            ['Ca', test.ca, unit],
            ['Mg', test.mg, unit],
            ['OM', test.om, '%'],
            ['CEC', test.cec, ''],
            ['Buffer pH', test.bufferPh, ''],
          ] as const
        )
          .filter(([, v]) => v != null)
          .map(([label, v, u]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {formatNumber(v!)}
                {u && <small> {u}</small>}
              </dd>
            </div>
          ))}
      </dl>

      {recs.length > 0 && <div className="row-detail">Lab says, per acre: {recs.join(' · ')}</div>}

      {(lime || needsFertilizer(test)) && (
        <div className="soil-buy">
          <div className="soil-buy-title">To buy for this plot ({formatAcres(acres)})</div>
          {test.lime ? (
            lime ? (
              <div>
                <strong>Lime:</strong> {formatNumber(lime.tons)} tons, or {lime.bags.toLocaleString()} {LIME_BAG_LB}-lb bags
              </div>
            ) : (
              <div className="muted">Lime: add your lime's ENM per ton (on the quarry ticket) to work out the tons.</div>
            )
          ) : null}
          {needsFertilizer(test) && (
            <div className="soil-blend">
              <label className="schedule-inline">
                <strong>Fertilizer:</strong>
                <select value={blend ?? ''} onChange={(e) => onBlend(e.target.value)} aria-label="Fertilizer blend">
                  {BLENDS.filter((b) => planBlend(test, b.name, 1)).map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.name === best ? ' (closest)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {plan && (
                <>
                  <div>
                    {Math.round(plan.pounds).toLocaleString()} lb, or {plan.bags} {FERTILIZER_BAG_LB}-lb bag{plan.bags === 1 ? '' : 's'} ({Math.round(plan.perAcre)} lb/acre)
                  </div>
                  <div className="row-detail">
                    Gives {Math.round(plan.gives.n)}-{Math.round(plan.gives.p)}-{Math.round(plan.gives.k)} per acre
                    {(['n', 'p', 'k'] as const).some((x) => plan.short[x] >= 1)
                      ? `; short ${(['n', 'p', 'k'] as const)
                          .filter((x) => plan.short[x] >= 1)
                          .map((x) => `${Math.round(plan.short[x])} lb ${x.toUpperCase()}`)
                          .join(', ')}`
                      : ''}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {test.notes && <div className="plot-log-notes">{test.notes}</div>}
    </div>
  );
}

interface FormProps {
  draft: Draft;
  setDraft(d: Draft): void;
  isNew: boolean;
  hasRetest: boolean;
  addCard: boolean;
  setAddCard(v: boolean): void;
  addRetest: boolean;
  setAddRetest(v: boolean): void;
  onSave(): void;
  onCancel(): void;
  onRemove?: () => void;
}

export function SoilForm({ draft, setDraft, isNew, hasRetest, addCard, setAddCard, addRetest, setAddRetest, onSave, onCancel, onRemove }: FormProps) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const num = (field: NumberField, label: string, step = 'any') => (
    <label className="soil-input">
      <span>{label}</span>
      <input type="number" inputMode="decimal" step={step} min={0} value={draft[field]} onChange={(e) => set({ [field]: e.target.value } as Partial<Draft>)} />
    </label>
  );

  return (
    <div className="plot-form schedule-form soil-form">
      <div className="plot-fields">
        <input type="date" max={todayDate()} value={draft.date} onChange={(e) => set({ date: e.target.value })} aria-label="Date sampled" />
        <input type="text" placeholder="Lab (optional)" value={draft.lab} onChange={(e) => set({ lab: e.target.value })} aria-label="Lab" />
      </div>
      <input type="text" placeholder="Recommendations for, e.g. Clover (optional)" value={draft.crop} onChange={(e) => set({ crop: e.target.value })} aria-label="Crop" />

      <div className="soil-section">Results</div>
      <div className="soil-grid">
        {num('ph', 'pH', '0.1')}
        {num('bufferPh', 'Buffer pH', '0.1')}
        {num('p', 'Phosphorus (P)')}
        {num('k', 'Potassium (K)')}
        {num('ca', 'Calcium (Ca)')}
        {num('mg', 'Magnesium (Mg)')}
        {num('om', 'Organic matter %', '0.1')}
        {num('cec', 'CEC', '0.1')}
      </div>
      <label className="schedule-inline">
        <span>P, K, Ca and Mg in</span>
        <select value={draft.units} onChange={(e) => set({ units: e.target.value as Draft['units'] })} aria-label="Units">
          <option value="lb_acre">lb per acre</option>
          <option value="ppm">ppm</option>
        </select>
      </label>

      <div className="soil-section">Lab recommends, per acre</div>
      <div className="soil-grid">
        <label className="soil-input">
          <span>Lime</span>
          <span className="soil-with-unit">
            <input type="number" inputMode="decimal" step="any" min={0} value={draft.lime} onChange={(e) => set({ lime: e.target.value })} />
            <select value={draft.limeUnits} onChange={(e) => set({ limeUnits: e.target.value as Draft['limeUnits'] })} aria-label="Lime units">
              <option value="tons">tons</option>
              <option value="enm">lb ENM</option>
            </select>
          </span>
        </label>
        {draft.limeUnits === 'enm' && num('limeEnm', 'Your lime: ENM per ton')}
        {num('nLbs', 'Nitrogen (N) lb')}
        {num('pLbs', 'Phosphate (P₂O₅) lb')}
        {num('kLbs', 'Potash (K₂O) lb')}
      </div>
      {draft.limeUnits === 'enm' && <div className="hint">Missouri's lab writes lime as pounds of ENM. The quarry's ticket says how much ENM a ton of their lime has, often 400–600.</div>}

      <textarea rows={2} placeholder="Notes" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Soil test notes" />

      {isNew && (
        <>
          <label className="check">
            <input type="checkbox" checked={addCard} onChange={(e) => setAddCard(e.target.checked)} />
            Put the lime and fertilizer on the Action Board
          </label>
          {!hasRetest && (
            <label className="check">
              <input type="checkbox" checked={addRetest} onChange={(e) => setAddRetest(e.target.checked)} />
              Remind me to retest every {DEFAULT_RETEST_YEARS} years
            </label>
          )}
        </>
      )}

      <div className="plot-form-actions">
        <button className="primary" disabled={!draft.date} onClick={onSave}>
          Save test
        </button>
        <button onClick={onCancel}>Cancel</button>
        {onRemove && (
          <button className="danger" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
