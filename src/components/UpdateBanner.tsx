import { useCallback, useEffect, useState } from 'react';
import type { UpdateInfo, UpdateStatus } from '@/data/storage';

// How often a hub left open asks GitHub again.
const RECHECK_MS = 12 * 60 * 60 * 1000;

export interface Updater {
  info: UpdateInfo | null;
  status: UpdateStatus;
  check(): Promise<void>;
}

// Asks GitHub for the newest version when the hub opens (desktop only), then twice a day.
export function useUpdateCheck(): Updater {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const check = useCallback(async () => {
    const next = await window.hub?.checkForUpdate();
    if (next) setInfo(next);
  }, []);
  useEffect(() => {
    if (!window.hub?.checkForUpdate) return;
    void check().catch(() => undefined);
    const timer = window.setInterval(() => void check().catch(() => undefined), RECHECK_MS);
    const stopListening = window.hub.onUpdateStatus(setStatus);
    return () => {
      window.clearInterval(timer);
      stopListening();
    };
  }, [check]);
  return { info, status, check };
}

// The next step for this update: download it, wait, restart, or try again.
function UpdateButtons({ status }: { status: UpdateStatus }) {
  switch (status.state) {
    case 'downloading':
      return null;
    case 'ready':
      return (
        <button className="primary" onClick={() => void window.hub?.installUpdate()}>
          Restart and update
        </button>
      );
    case 'error':
      return (
        <>
          <button className="primary" onClick={() => void window.hub?.downloadUpdate()}>
            Try again
          </button>
          <button onClick={() => void window.hub?.downloadUpdateInBrowser()}>Use the browser</button>
        </>
      );
    default:
      return (
        <button className="primary" onClick={() => void window.hub?.downloadUpdate()}>
          Download
        </button>
      );
  }
}

function statusText(status: UpdateStatus): string | null {
  if (status.state === 'downloading') return `Downloading, ${status.percent}%. You can keep working.`;
  if (status.state === 'ready') return 'Downloaded. It installs when you restart or next close the hub. Your maps and photos stay put.';
  if (status.state === 'error') return "The download didn't finish. Check the internet and try again.";
  return null;
}

// "Version X is ready" banner on the map. Later hides it until the hub is reopened.
export function UpdateBanner({ updater }: { updater: Updater }) {
  const { info, status } = updater;
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  if (!info?.available || hiddenFor === info.latest) return null;
  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong>Hunting Hub {info.latest} is ready</strong>
        <span>{statusText(status) ?? `You have ${info.current}. Your maps and photos stay put.`}</span>
        {status.state === 'downloading' && <progress value={status.percent} max={100} />}
      </div>
      <div className="update-actions">
        <UpdateButtons status={status} />
        <button onClick={() => void window.hub?.openReleaseNotes()}>What's new</button>
        <button onClick={() => setHiddenFor(info.latest)}>Later</button>
      </div>
    </div>
  );
}

// Settings: the version on this PC and a manual check.
export function UpdateSettings({ updater }: { updater: Updater }) {
  const { info, status } = updater;
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  if (!window.hub?.checkForUpdate) return null;
  const check = () => {
    setState('checking');
    updater
      .check()
      .then(() => setState('idle'))
      .catch(() => setState('error'));
  };
  return (
    <section className="sidebar-section">
      <h2>App version</h2>
      <p className="hint">
        {info ? `This PC has version ${info.current}. ` : ''}
        {state === 'checking'
          ? 'Checking for a newer version…'
          : state === 'error'
            ? "Couldn't reach GitHub to check. Try again when you're online."
            : info?.available
              ? (statusText(status) ?? `Version ${info.latest} is ready to download.`)
              : info
                ? 'This is the newest version.'
                : 'The hub checks for a newer version each time it opens.'}
      </p>
      <div className="phone-buttons">
        {info?.available ? (
          <UpdateButtons status={status} />
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
