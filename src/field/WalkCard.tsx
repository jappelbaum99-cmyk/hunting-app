import { useEffect, useState } from 'react';

import { Icon } from '@/components/Icon';
import { SentTools, type SentStatus } from '@/field/SentTools';
import { formatDistance, lineLengthM } from '@/lib/trails';
import type { FieldTrack } from '@/types/models';
import type { Position } from 'geojson';

export interface ActiveWalk {
  id: string;
  startedAt: string;
  points: Position[];
}

// Keeps the screen on while a walk is recorded: an iPhone stops GPS for a web
// page once the screen locks. Asks again when the page comes back to the front.
export function useWakeLock(on: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = () => {
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) return void l.release();
          lock = l;
          setHeld(true);
          l.addEventListener('release', () => setHeld(false));
        })
        .catch(() => setHeld(false));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
      setHeld(false);
    };
  }, [on]);
  return held;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
}

// Start a walk, see how far you've gone, stop to save it as a trail for the hub.
export function WalkCard(props: {
  walk: ActiveWalk | null;
  tracks: FieldTrack[];
  gpsReady: boolean;
  onStart(): void;
  onStop(): void;
  onDiscard(): void;
  onDeleteTrack(id: string): void;
  status(item: { id: string; updatedAt: string }): SentStatus;
  onResend(): void;
  onClear(): void;
}) {
  const { walk } = props;
  const awake = useWakeLock(walk !== null);
  // Re-render each minute so the timer moves.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!walk) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [walk]);

  if (walk) {
    return (
      <section className="field-card walk-card walking">
        <h2>
          <span className="live-dot" /> Recording a walk
        </h2>
        <div className="walk-stats">
          <div>
            <strong>{formatDistance(lineLengthM(walk.points))}</strong>
            <span>walked</span>
          </div>
          <div>
            <strong>{minutesSince(walk.startedAt)} min</strong>
            <span>so far</span>
          </div>
          <div>
            <strong>{walk.points.length}</strong>
            <span>points</span>
          </div>
        </div>
        <p className="field-hint">
          {awake ? 'The screen will stay on. ' : ''}Keep this page open: the phone stops GPS when the screen locks or you switch apps.
        </p>
        <button className="big-button" onClick={props.onStop} disabled={walk.points.length < 2}>
          Stop and save trail
        </button>
        <button
          className="end-button"
          onClick={() => {
            if (window.confirm('Throw away this walk?')) props.onDiscard();
          }}
        >
          Discard walk
        </button>
      </section>
    );
  }

  return (
    <section className="field-card walk-card">
      <h2>Walk a trail</h2>
      <p className="field-hint">Records the path you walk with GPS, so the hub can add it as a trail.</p>
      <button className="big-button" onClick={props.onStart} disabled={!props.gpsReady}>
        {props.gpsReady ? 'Start walk' : 'Waiting for GPS…'}
      </button>
      {props.tracks.length > 0 && (
        <>
          <h3>Walks on this phone</h3>
          <SentTools items={props.tracks} status={props.status} what="walk" onResend={props.onResend} onClear={props.onClear} />
          <ul className="field-list">
            {props.tracks.map((t) => (
              <li key={t.id}>
                <Icon name="track" size={18} />
                <span>
                  {t.name}
                  <span className="muted"> · {formatDistance(t.lengthM)}</span>
                  {props.status(t) === 'added' && <span className="sent-badge added">Trail on the hub</span>}
                  {props.status(t) === 'sent' && <span className="sent-badge sent">At camp</span>}
                  {props.status(t) === 'waiting' && <span className="sent-badge waiting">Waiting to send</span>}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete "${t.name}" from this phone?`)) props.onDeleteTrack(t.id);
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
