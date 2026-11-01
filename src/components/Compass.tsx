interface CompassProps {
  // Map rotation in degrees (0 = north up).
  bearing: number;
  // When set, an arrow shows which way the wind is blowing.
  windFromDeg: number | null;
  onResetNorth(): void;
}

const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

// Always-visible compass rose. It turns with the map; click it to face north.
export function Compass({ bearing, windFromDeg, onResetNorth }: CompassProps) {
  const title = windFromDeg === null ? 'Compass: click to face north' : 'Compass and wind: click to face north';
  return (
    <button className="compass" onClick={onResetNorth} title={title} aria-label={title}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <g transform={`rotate(${-bearing} 50 50)`}>
          {TICKS.map((deg) => (
            <line
              key={deg}
              x1="50"
              y1={deg % 90 === 0 ? 7 : 9}
              x2="50"
              y2="14"
              className={deg % 90 === 0 ? 'tick major' : 'tick'}
              transform={`rotate(${deg} 50 50)`}
            />
          ))}
          <path d="M50 18 57 50H43Z" className="needle-north" />
          <path d="M50 82 57 50H43Z" className="needle-south" />
          <text x="50" y="30" className="cardinal north">
            N
          </text>
          <text x="50" y="78" className="cardinal">
            S
          </text>
          <text x="76" y="54" className="cardinal">
            E
          </text>
          <text x="24" y="54" className="cardinal">
            W
          </text>
        </g>
        {windFromDeg !== null && (
          // The arrow points where the wind is going (downwind), which is where your scent goes.
          <g transform={`rotate(${windFromDeg + 180 - bearing} 50 50)`} className="wind-arrow">
            <line x1="50" y1="76" x2="50" y2="30" />
            <path d="M50 22 58 36H42Z" />
          </g>
        )}
        <circle cx="50" cy="50" r="4" className="hub" />
      </svg>
    </button>
  );
}
