import { useEffect, useState } from 'react';
import type { UpdateInfo } from '@/data/storage';

// How often a hub left open asks GitHub again.
const RECHECK_MS = 12 * 60 * 60 * 1000;

// Asks GitHub for the newest version when the hub opens (desktop only), then twice a day.
export function useUpdateCheck(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    if (!window.hub?.checkForUpdate) return;
    const check = () =>
      window.hub
        ?.checkForUpdate()
        .then(setInfo)
        .catch(() => undefined);
    void check();
    const timer = window.setInterval(() => void check(), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return info;
}

// "Version X is ready" banner on the map. Later hides it until the hub is reopened.
export function UpdateBanner({ info }: { info: UpdateInfo | null }) {
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  if (!info?.available || hiddenFor === info.latest) return null;
  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong>Hunting Hub {info.latest} is ready</strong>
        <span>
          You have {info.current}. Download it, then run it: your maps and photos stay put.
        </span>
      </div>
      <div className="update-actions">
        <button className="primary" onClick={() => void window.hub?.downloadUpdate()}>
          Download
        </button>
        <button onClick={() => void window.hub?.openReleaseNotes()}>What's new</button>
        <button onClick={() => setHiddenFor(info.latest)}>Later</button>
      </div>
    </div>
  );
}

// Settings: the version on this PC and a manual check.
export function UpdateSettings({ info }: { info: UpdateInfo | null }) {
  const [checked, setChecked] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  if (!window.hub?.checkForUpdate) return null;
  const shown = checked ?? info;
  const check = () => {
    setState('checking');
    window.hub
      ?.checkForUpdate()
      .then((next) => {
        setChecked(next);
        setState('idle');
      })
      .catch(() => setState('error'));
  };
  return (
    <section className="sidebar-section">
      <h2>App version</h2>
      <p className="hint">
        {shown ? `This PC has version ${shown.current}. ` : ''}
        {state === 'checking'
          ? 'Checking for a newer version…'
          : state === 'error'
            ? "Couldn't reach GitHub to check. Try again when you're online."
            : shown?.available
              ? `Version ${shown.latest} is ready to download.`
              : shown
                ? 'This is the newest version.'
                : 'The hub checks for a newer version each time it opens.'}
      </p>
      <div className="phone-buttons">
        {shown?.available ? (
          <button className="primary" onClick={() => void window.hub?.downloadUpdate()}>
            Download {shown.latest}
          </button>
        ) : (
          <button onClick={check} disabled={state === 'checking'}>
            Check for updates
          </button>
        )}
        <button onClick={() => void window.hub?.openReleaseNotes()}>What's new</button>
      </div>
    </section>
  );
}
