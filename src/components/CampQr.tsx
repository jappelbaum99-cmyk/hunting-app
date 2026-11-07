import { useMemo, useState } from 'react';

import { campQrCard, qrModules, qrPath } from '@/lib/qr';
import { campJoinUrl } from '@/lib/site';

// A QR code a phone's camera opens the phone page with, the camp code filled in,
// and a button to save it as a picture with the code written under it.
export function CampQr({ campName, code }: { campName: string; code: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const modules = useMemo(() => qrModules(campJoinUrl(code)), [code]);
  const quiet = 4;
  const size = modules.length + quiet * 2;

  const save = async () => {
    try {
      const blob = await campQrCard(campName, code);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${campName.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Camp'} join code.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage('Saved. Text or email it, or print it for the camp wall.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="camp-qr">
      <svg viewBox={`${-quiet} ${-quiet} ${size} ${size}`} role="img" aria-label={`QR code to join ${campName}`} shapeRendering="crispEdges">
        <rect x={-quiet} y={-quiet} width={size} height={size} fill="#fff" />
        <path d={qrPath(modules)} fill="#000" />
      </svg>
      <div className="camp-qr-side">
        <span>Scan with the phone's camera to open the phone page with the code filled in.</span>
        <button className="mini" onClick={() => void save()}>
          Save image
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </div>
  );
}
