import { useState } from 'react';

import { CAMP_SYNC_AVAILABLE, createCamp, joinCamp } from '@/lib/camp';
import type { CampLink } from '@/types/models';

interface CampSettingsProps {
  camp: CampLink | null;
  onChange(camp: CampLink | null): void;
}

// Settings › Camp sync: start a camp (or join one another hub started) and
// show the code family members type into the phone page.
export function CampSettings({ camp, onChange }: CampSettingsProps) {
  const [campName, setCampName] = useState('');
  const [hunter, setHunter] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!CAMP_SYNC_AVAILABLE) {
    return (
      <section className="sidebar-section">
        <h2>Camp sync</h2>
        <p className="hint">Not set up in this version of the app yet.</p>
      </section>
    );
  }

  const run = async (action: () => Promise<CampLink>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (camp) {
    return (
      <section className="sidebar-section">
        <h2>Camp sync</h2>
        <p className="hint">
          Hunts and GPS pins from phones in <strong>{camp.name}</strong> arrive here by themselves, and your stands go to the phones.
        </p>
        <div className="camp-code">
          <span className="camp-code-label">Camp code</span>
          <strong>{camp.code}</strong>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(camp.code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="hint">Send this code to family. On the phone page they open the Camp tab, type their name and this code, and they're in.</p>
        <button
          onClick={() => {
            if (window.confirm(`Stop syncing with ${camp.name}? Hunts and pins already here stay. You can join again with the code.`)) onChange(null);
          }}
        >
          Stop camp sync
        </button>
      </section>
    );
  }

  return (
    <section className="sidebar-section">
      <h2>Camp sync</h2>
      <p className="hint">
        Start a camp to get hunts and GPS pins from family phones automatically, with no files to move. It's free and needs no accounts.
      </p>
      <div className="camp-form">
        <input type="text" placeholder="Your name, e.g. John" value={hunter} onChange={(e) => setHunter(e.target.value)} />
        <input type="text" placeholder="Camp name, e.g. Possum Trot Camp" value={campName} onChange={(e) => setCampName(e.target.value)} />
        <button className="primary" disabled={busy || !hunter.trim() || !campName.trim()} onClick={() => void run(() => createCamp(campName.trim(), hunter.trim()))}>
          {busy ? 'Starting…' : 'Start a camp'}
        </button>
      </div>
      <details className="camp-join">
        <summary>Join a camp another hub started</summary>
        <div className="camp-form">
          <input type="text" placeholder="Camp code" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
          <button disabled={busy || !hunter.trim() || code.replace(/[^A-Za-z0-9]/g, '').length < 12} onClick={() => void run(() => joinCamp(code, hunter.trim()))}>
            Join
          </button>
        </div>
      </details>
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
