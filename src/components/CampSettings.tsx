import { useState } from 'react';

import { CampQr } from '@/components/CampQr';
import { answerPartnerRequest, CAMP_SYNC_AVAILABLE, createCamp, joinCamp, removePartner, requestPartner, type CampInfo } from '@/lib/camp';
import type { SharedCollection } from '@/lib/partnerSync';
import type { CampLink } from '@/types/models';

// What Settings shows about partners, from the camp as it is right now.
export interface CampPartners {
  manager: boolean;
  uid: string | null;
  info: CampInfo | null;
  // How much the first share would send.
  counts: Record<SharedCollection, number>;
  syncError: string | null;
  waiting: boolean;
}

interface CampSettingsProps {
  camp: CampLink | null;
  partners: CampPartners;
  onChange(camp: CampLink | null): void;
}

const COUNT_LABELS: Record<SharedCollection, [string, string]> = {
  properties: ['property', 'properties'],
  markers: ['stand or pin', 'stands and pins'],
  areas: ['area', 'areas'],
  sections: ['section', 'sections'],
  plans: ['plan', 'plans'],
  trails: ['trail', 'trails'],
  reports: ['hunt', 'hunts'],
  fieldPins: ['phone pin', 'phone pins'],
  fieldTracks: ['phone walk', 'phone walks'],
  actionItems: ['Action Board card', 'Action Board cards'],
};

// Settings › Camp sync: start a camp (or join one another hub started), show the
// code hunters type into the phone page, and share the map with partners.
export function CampSettings({ camp, partners, onChange }: CampSettingsProps) {
  const [campName, setCampName] = useState('');
  const [hunter, setHunter] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
  const act = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  if (camp) {
    const { info, uid, manager, counts } = partners;
    const requested = uid !== null && !!info?.partnerRequests[uid];
    const requests = Object.entries(info?.partnerRequests ?? {});
    const partnerIds = info ? [...new Set([...(info.ownerUid ? [info.ownerUid] : []), ...info.partners])] : [];
    const summary = (Object.keys(COUNT_LABELS) as SharedCollection[])
      .filter((c) => counts[c] > 0)
      .map((c) => `${counts[c]} ${COUNT_LABELS[c][counts[c] === 1 ? 0 : 1]}`)
      .join(', ');
    const startSharing = async () => {
      // A dated copy of this PC's data first, in case the first sync isn't what you expected.
      await window.hub?.backupData();
      setConfirming(false);
      onChange({ ...camp, sharing: true });
    };
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
        <p className="hint">Hunters open the Camp tab on the phone page and type their name and this code, or scan the QR code with the phone's camera. They see stands and deer reports, and can send notes.</p>
        <CampQr campName={camp.name} code={camp.code} />

        <h3 className="camp-partners-title">Partners</h3>
        {manager ? (
          <>
            <p className="hint">Partners use the desktop app and edit the same map, plans, logs and Action Board. Have them join with this code under Settings, then approve them here.</p>
            <ul className="camp-partners">
              {partnerIds.map((id) => (
                <li key={id}>
                  <span>
                    {info?.names[id] ?? 'Partner'}
                    {id === uid ? ' (this PC)' : ''}
                  </span>
                  {id !== uid && id !== info?.ownerUid && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Remove ${info?.names[id] ?? 'this partner'} as a partner? Their hub keeps what it has but stops syncing.`)) act(() => removePartner(camp, id));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
              {requests.map(([id, name]) => (
                <li key={id} className="camp-request">
                  <span>{name} wants to be a partner</span>
                  <span className="camp-request-buttons">
                    <button className="primary" onClick={() => act(() => answerPartnerRequest(camp, id, true))}>
                      Approve
                    </button>
                    <button onClick={() => act(() => answerPartnerRequest(camp, id, false))}>Decline</button>
                  </span>
                </li>
              ))}
            </ul>

            {camp.sharing ? (
              <>
                <p className="hint">
                  {partners.waiting ? 'Sending changes…' : 'Map sharing is on.'} Everything is still saved on this PC, and only changes are sent. Trail camera photos and tags and map images stay here.
                </p>
                <button
                  onClick={() => {
                    if (window.confirm('Stop sharing the map from this PC? What you already have stays, and you can turn it back on.')) onChange({ ...camp, sharing: false });
                  }}
                >
                  Stop sharing the map
                </button>
              </>
            ) : confirming ? (
              <div className="camp-confirm">
                <p className="hint">
                  This sends {summary || 'nothing yet'} to your camp in Firebase, and brings in what your partners have shared. Trail camera photos and tags and map images stay on this PC. A dated backup of your data is saved first.
                </p>
                <div className="phone-buttons">
                  <button className="primary" onClick={() => act(startSharing)}>
                    Start sharing
                  </button>
                  <button onClick={() => setConfirming(false)}>Not now</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)}>Share the map with partners</button>
            )}
          </>
        ) : (
          <>
            <p className="hint">{requested ? 'Waiting for a partner to approve this PC. Their hub shows the request in Settings.' : 'Partners share the map, plans, logs and Action Board. Ask to be one and a partner can approve you.'}</p>
            {!requested && <button onClick={() => act(() => requestPartner(camp))}>Ask to be a partner</button>}
          </>
        )}
        {(error || partners.syncError) && <p className="hint error-text">{error ?? partners.syncError}</p>}

        <button
          className="camp-stop"
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
          <button
            disabled={busy || !hunter.trim() || code.replace(/[^A-Za-z0-9]/g, '').length < 12}
            onClick={() =>
              void run(async () => {
                const link = await joinCamp(code, hunter.trim());
                // If this doesn't go through, Settings offers it as a button.
                if (!link.isOwner) await requestPartner(link).catch(() => undefined);
                return link;
              })
            }
          >
            Join
          </button>
        </div>
      </details>
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
