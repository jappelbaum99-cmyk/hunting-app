import { useEffect, useRef, useState } from 'react';

import { joinCodeFrom } from '@/lib/site';

// Reads the hub's camp QR code with the phone's back camera. Scanning here,
// inside the home screen app, puts the camp in the app itself: the iPhone
// Camera app would open Safari instead, which keeps its own separate data.
// The QR decoder loads only when this opens.
export function QrScanner(props: { onCode(code: string): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting the camera…');
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });

    const start = async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        ]);
        stream = media;
        if (stopped || !video.current || !g) return media.getTracks().forEach((t) => t.stop());
        video.current.srcObject = media;
        await video.current.play();
        setStatus('Point the camera at the camp QR code.');
        const look = () => {
          if (stopped) return;
          const v = video.current;
          if (v && v.videoWidth) {
            // A smaller copy reads just as well and keeps the phone cool.
            const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            g.drawImage(v, 0, 0, canvas.width, canvas.height);
            const found = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
            if (found) {
              const code = joinCodeFrom(found.data);
              if (code) return latest.current.onCode(code);
              setStatus("That QR code isn't a Fenceline camp code.");
            }
          }
          frame = requestAnimationFrame(look);
        };
        frame = requestAnimationFrame(look);
      } catch (error) {
        const name = (error as DOMException)?.name;
        setStatus(
          name === 'NotAllowedError'
            ? 'The camera is blocked. Allow it for this page (Settings › Safari › Camera), or type the code instead.'
            : "Couldn't start the camera. Type the code instead.",
        );
      }
    };
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="qr-scanner" role="dialog" aria-label="Scan the camp QR code">
      <div className="qr-scanner-view">
        <video ref={video} playsInline muted />
        <div className="qr-scanner-frame" aria-hidden />
      </div>
      <p className="field-hint">{status}</p>
      <button className="end-button" onClick={props.onClose}>
        Cancel
      </button>
    </div>
  );
}
