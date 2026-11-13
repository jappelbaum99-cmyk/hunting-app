// Test a stand spot: drop the spot, draw the way deer come and go, and see how
// the spot would have done through the last few seasons' October-December
// weather, with the cone and thermal path playing through any sit on the map.
import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { compassPointOf } from '@/lib/standRating';
import { fetchSeasons, momentAt, momentContext, testSeasons, testStand, type Moment, type MomentVerdict, type StandTestResult, type TestSit } from '@/lib/standTest';
import { elevationAt, loadElevationAround } from '@/map/elevation';
import type { CompassPoint } from '@/types/models';

export type StandTestStep = 'spot' | 'route' | 'ready';

interface StandTestPanelProps {
  step: StandTestStep;
  spot: [number, number] | null;
  route: [number, number][];
  // Testing a stand or blind you have: its name and good winds now.
  stand: { name: string; goodWinds: CompassPoint[] } | null;
  // Your stands and blinds to pick from, with this session's score if tested.
  stands: { id: string; name: string; hasRoute: boolean; score: { score: number; grade: string } | null }[];
  onPickStand(id: string): void;
  onPlaceSpot(): void;
  onDrawRoute(): void;
  onUndoPoint(): void;
  onFinishRoute(): void;
  // The moment showing on the map (cone and thermal path), or null.
  onShow(moment: Moment | null): void;
  onMakeStand(goodWinds: CompassPoint[]): void;
  // For a stand you have: replace its good winds with the ones it did well on.
  onSetGoodWinds(goodWinds: CompassPoint[]): void;
  onResult(score: number, grade: string): void;
  onClose(): void;
}

// Play runs through a sit in this long, then on to the next one.
const PLAY_SIT_MS = 7000;
const PLAY_FRAME_MS = 33;
// Elevation is loaded this far around the spot and the deer's way, for thermals.
const ELEVATION_RADIUS_M = 400;

export const VERDICT_TEXT: Record<MomentVerdict, string> = {
  clean: 'Clear: your scent stays off the deer’s way.',
  swirl: 'Thermals switching: your scent swirls around the stand.',
  wind: 'The wind carries your scent onto the deer’s way.',
  thermal: 'Thermals carry your scent onto the deer’s way.',
};

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const pct = (x: number) => `${Math.round(x * 100)}%`;

function sitLabel(sit: TestSit): string {
  const d = new Date(`${sit.date}T12:00:00`);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${sit.half === 'am' ? 'Morning' : 'Evening'}`;
}

export function StandTestPanel(props: StandTestPanelProps) {
  const { step, spot, route } = props;
  const [result, setResult] = useState<StandTestResult | null>(null);
  const [progress, setProgress] = useState<{ text: string; done: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sitIndex, setSitIndex] = useState(0);
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [runTick, setRunTick] = useState(0);

  const placeKey = step === 'ready' && spot && route.length >= 2 ? JSON.stringify([spot, route]) : null;

  // Run the test whenever the spot or the deer's way is set.
  useEffect(() => {
    setResult(null);
    setError(null);
    setPlaying(false);
    if (!placeKey || !spot) return;
    const controller = new AbortController();
    const years = testSeasons();
    (async () => {
      setProgress({ text: `Getting October–December weather for ${years[0]}–${years[years.length - 1]}…`, done: 0 });
      const [seasons] = await Promise.all([fetchSeasons(spot[1], spot[0], years, controller.signal), loadElevationAround([spot, ...route], ELEVATION_RADIUS_M)]);
      setProgress({ text: 'Checking every morning and evening sit…', done: 0 });
      const r = await testStand(seasons, years, { spot, route }, elevationAt, (done) => setProgress({ text: 'Checking every morning and evening sit…', done }), controller.signal);
      setResult(r);
      setProgress(null);
      props.onResult(r.score, r.grade);
      // Start on the first sit from the latest season's November.
      const start = r.sits.findIndex((s) => s.season === years[years.length - 1] && s.date.slice(5, 7) === '11');
      const i = Math.max(0, start);
      setSitIndex(i);
      setTime(r.sits[i].peak);
    })().catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => controller.abort();
  }, [placeKey, runTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => (result && spot ? momentContext({ spot, route }, elevationAt) : null), [result, spot, route]);
  const sit = result?.sits[sitIndex] ?? null;
  const season = sit && result ? result.seasons[result.seasons.findIndex((f) => f.days.some((d) => d.date === sit.date))] : null;
  const moment = useMemo(() => (ctx && season && time !== null ? momentAt(season, time, ctx) : null), [ctx, season, time]);

  const { onShow } = props;
  useEffect(() => {
    onShow(moment);
  }, [moment, onShow]);
  useEffect(() => () => onShow(null), [onShow]);

  // Play: glide through the sit, then on to the next one.
  const live = useRef({ sitIndex, time });
  live.current = { sitIndex, time };
  useEffect(() => {
    if (!playing || !result) return;
    let frame = 0;
    let last = performance.now();
    let sent = last;
    let index = live.current.sitIndex;
    let t = live.current.time ?? result.sits[index].start;
    const tick = (now: number) => {
      const s = result.sits[index];
      t += ((now - last) * (s.end - s.start)) / PLAY_SIT_MS;
      last = now;
      if (t >= s.end) {
        if (index + 1 >= result.sits.length) {
          setPlaying(false);
          return;
        }
        index += 1;
        t = result.sits[index].start;
        setSitIndex(index);
      }
      if (now - sent >= PLAY_FRAME_MS) {
        sent = now;
        setTime(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, result]);

  const pickSit = (i: number) => {
    if (!result) return;
    const index = Math.max(0, Math.min(result.sits.length - 1, i));
    setSitIndex(index);
    setTime(result.sits[index].peak);
  };

  return (
    <div className="forecast stand-test">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>{props.stand ? `Test ${props.stand.name}` : 'Test a stand spot'}</h2>
      </div>

      {step === 'spot' && (
        <>
          <p className="hint">Click the map where you’d hang the stand, or test one you have:</p>
          {props.stands.length > 0 && (
            <ul className="stand-test-pick">
              {props.stands.map((s) => (
                <li key={s.id}>
                  <button className="row" onClick={() => props.onPickStand(s.id)}>
                    <span className="row-title">{s.name}</span>
                    <span className="row-detail">
                      {s.score ? `${s.score.score} / 100 · ${s.score.grade}` : s.hasRoute ? 'Deer way saved' : 'Draw its deer way'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {step === 'route' && (
        <div className="stand-test-steps">
          <p className="hint">
            Now the way deer come and go: click where they come <strong>from</strong> (bedding, say), then along their trail past the spot, to where they <strong>go</strong> (food). Press Done at the end.
          </p>
          <div className="button-row">
            <button onClick={props.onUndoPoint} disabled={route.length === 0}>
              Undo point
            </button>
            <button className="primary" onClick={props.onFinishRoute} disabled={route.length < 2}>
              Done
            </button>
          </div>
        </div>
      )}

      {step === 'ready' && (
        <div className="button-row stand-test-edit">
          <button onClick={props.onPlaceSpot}>{props.stand ? 'Other spot' : 'Move spot'}</button>
          <button onClick={props.onDrawRoute}>Redraw deer way</button>
        </div>
      )}

      {progress && (
        <div className="stand-test-progress">
          <p className="hint">{progress.text}</p>
          <div className="activity-bar">
            <span style={{ width: `${Math.round(progress.done * 100)}%` }} />
          </div>
        </div>
      )}
      {error && (
        <div className="forecast-error">
          <p className="empty">Couldn’t test the spot: {error}. The weather history needs an internet connection.</p>
          <button onClick={() => setRunTick((n) => n + 1)}>Try again</button>
        </div>
      )}

      {result && sit && (
        <>
          <Summary result={result} />
          <IdealWinds
            key={placeKey}
            result={result}
            saved={props.stand?.goodWinds ?? null}
            onUse={(winds) => (props.stand ? props.onSetGoodWinds(winds) : props.onMakeStand(winds))}
          />
          <SeasonGrid result={result} sitIndex={sitIndex} onPick={pickSit} />
          <div className="weather-card stand-test-player">
            <div className="sit-title">
              <span>{sitLabel(sit)}</span>
              <span className={`verdict v-${sit.verdict}`}>{sit.verdict === 'good' ? 'Good sit' : sit.verdict === 'ok' ? 'Fair sit' : 'Bad sit'} · {pct(sit.clean)} clear</span>
            </div>
            <div className="sit-slider">
              <button className="play" onClick={() => pickSit(sitIndex - 1)} aria-label="Previous sit" title="Previous sit">
                ‹
              </button>
              <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play through the season'} title={playing ? 'Pause' : 'Play: each sit in turn'}>
                <Icon name={playing ? 'pause' : 'play'} size={16} />
              </button>
              <button className="play" onClick={() => pickSit(sitIndex + 1)} aria-label="Next sit" title="Next sit">
                ›
              </button>
              <input
                type="range"
                min={sit.start}
                max={sit.end}
                step={60_000}
                value={Math.min(sit.end, Math.max(sit.start, time ?? sit.peak))}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
                aria-label="Time during the sit"
              />
            </div>
            {moment && (
              <p className={`slider-readout stand-test-moment m-${moment.verdict}`}>
                <strong>{clock(moment.time)}</strong> · {compassPointOf(moment.hour.windFromDeg)} {Math.round(moment.hour.windMph)} mph · {Math.round(moment.hour.tempF)}°F
                {moment.thermal ? ` · thermals ${moment.thermal.phase}${moment.thermal.pull < 0.25 ? ' (weak)' : ''}` : ''}
                <br />
                {VERDICT_TEXT[moment.verdict]}
              </p>
            )}
          </div>
          <p className="hint">
            Past weather from Open-Meteo’s history for {result.seasons.length} seasons, October through December, checked every 15 minutes of each sit. Prime time (around sunrise and the last 90 minutes before dark) counts double. Rules of thumb for wind and thermals, not a guarantee.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ result }: { result: StandTestResult }) {
  const { am, pm } = result.byHalf;
  const tone = result.grade === 'Good' ? 'vhigh' : result.grade === 'Fair' ? 'mid' : 'low';
  return (
    <div className={`activity-card score-${tone}`}>
      <div className="activity-head">
        <div>
          <div className="activity-title">How this spot would have done</div>
          <div className="activity-score">
            {result.score}
            <small> / 100 · {result.grade}</small>
          </div>
        </div>
      </div>
      <div className="activity-bar">
        <span style={{ width: `${result.score}%` }} />
      </div>
      <dl className="sit-stats stand-test-stats">
        {(
          [
            ['Mornings', am],
            ['Evenings', pm],
          ] as const
        ).map(([label, h]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {pct(h.clean)} clear · {h.good} good, {h.ok} fair, {h.bad} bad
            </dd>
          </div>
        ))}
        {result.byMonth.map((m) => (
          <div key={m.month}>
            <dt>{m.label}</dt>
            <dd>{pct(m.clean)} clear</dd>
          </div>
        ))}
        <div>
          <dt>Scent reached the deer</dt>
          <dd>
            wind {pct(result.shares.wind)} · thermals {pct(result.shares.thermal)} · swirling {pct(result.shares.swirl)}
          </dd>
        </div>
      </dl>
      <ul className="drivers stand-test-notes">
        {result.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

// The winds the test found work, each with how often it kept scent clear.
// They start picked; tap one to add or drop it, then use them as the stand's
// good winds (or make the new spot a stand with them).
function IdealWinds({ result, saved, onUse }: { result: StandTestResult; saved: CompassPoint[] | null; onUse(winds: CompassPoint[]): void }) {
  const [picked, setPicked] = useState<CompassPoint[]>(result.goodWinds);
  const winds = result.byWind.filter((w): w is { point: CompassPoint; checks: number; clean: number } => w.point !== 'calm');
  const calm = result.byWind.find((w) => w.point === 'calm');
  const ordered = (list: CompassPoint[]) => winds.map((w) => w.point).filter((p) => list.includes(p));
  const toggle = (p: CompassPoint) => setPicked((now) => ordered(now.includes(p) ? now.filter((x) => x !== p) : [...now, p]));
  const same = saved !== null && ordered(saved).join() === picked.join();
  const best = [...winds].filter((w) => w.checks > 0).sort((x, y) => y.clean / y.checks - x.clean / x.checks).slice(0, 2);
  return (
    <section className="sidebar-section ideal-winds">
      <h2>Ideal winds</h2>
      <p className="hint">
        {result.goodWinds.length
          ? `These kept your scent off the deer’s way at least 75% of the time: ${result.goodWinds.join(', ')}. Tap a wind to add or drop it.`
          : `No wind kept it clear 75% of the time. The best were ${best.map((w) => `${w.point} (${pct(w.clean / w.checks)})`).join(' and ')}; tap winds to pick your own.`}
      </p>
      <div className="wind-bars ideal-wind-bars" role="group" aria-label="Winds: how often each kept scent clear">
        {winds.map((w) => (
          <button
            key={w.point}
            className={`wind-bar${picked.includes(w.point) ? ' good' : ''}`}
            aria-pressed={picked.includes(w.point)}
            onClick={() => toggle(w.point)}
            title={`${w.point} wind: ${w.checks ? pct(w.clean / w.checks) : 'never blew'} clear, ${w.checks} checks`}
          >
            <span className="wind-bar-pct">{w.checks ? pct(w.clean / w.checks) : '–'}</span>
            <span className="wind-bar-fill" style={{ height: `${w.checks ? Math.round((w.clean / w.checks) * 100) : 0}%`, opacity: w.checks ? 1 : 0.2 }} />
            <span className="wind-bar-label">{w.point}</span>
          </button>
        ))}
      </div>
      {calm && calm.checks > 0 && <p className="hint">Calm (under 3 mph): {pct(calm.clean / calm.checks)} clear.</p>}
      {saved !== null && <p className="hint">Its good winds now: {saved.length ? saved.join(', ') : 'none set'}.</p>}
      {saved !== null ? (
        <button className="primary stand-test-make" disabled={same || picked.length === 0} onClick={() => onUse(picked)}>
          {same ? 'These are its good winds' : `Use ${picked.length ? picked.join(', ') : 'these'} as its good winds`}
        </button>
      ) : (
        <button className="primary stand-test-make" onClick={() => onUse(picked)}>
          Make it a stand{picked.length ? ` with good winds ${picked.join(', ')}` : ''}
        </button>
      )}
    </section>
  );
}

// Every sit as a little square, a row each for mornings and evenings of each season.
function SeasonGrid({ result, sitIndex, onPick }: { result: StandTestResult; sitIndex: number; onPick(i: number): void }) {
  const years = [...new Set(result.sits.map((s) => s.season))];
  return (
    <div className="season-grid">
      <div className="season-grid-months">
        <span>Oct</span>
        <span>Nov</span>
        <span>Dec</span>
      </div>
      {years.map((year) =>
        (['am', 'pm'] as const).map((half) => (
          <div key={`${year}-${half}`} className="season-row">
            <span className="season-row-label">
              {year} {half.toUpperCase()}
            </span>
            <div className="season-cells">
              {result.sits.map((s, i) =>
                s.season === year && s.half === half ? (
                  <button
                    key={s.id}
                    className={`season-cell v-${s.verdict}${i === sitIndex ? ' active' : ''}`}
                    onClick={() => onPick(i)}
                    title={`${sitLabel(s)}: ${pct(s.clean)} clear · ${s.peakWind} ${Math.round(s.peakMph)} mph`}
                    aria-label={`${sitLabel(s)}, ${s.verdict}`}
                  />
                ) : null,
              )}
            </div>
          </div>
        )),
      )}
      <p className="hint season-grid-key">
        <i className="v-good" /> good <i className="v-ok" /> fair <i className="v-bad" /> bad. Click a sit to play it on the map.
      </p>
    </div>
  );
}
