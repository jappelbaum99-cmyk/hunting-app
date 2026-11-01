// Shared helpers for hunt reports (the hub and the phone page both use these).
import { COMPASS_POINTS, type DeerKind, type HuntReport, type ReportWeather, type Sighting } from '@/types/models';
import type { ForecastHour } from '@/lib/weather';

export const DEER_KINDS: Record<DeerKind, { label: string; plural: string; color: string }> = {
  buck: { label: 'Buck', plural: 'bucks', color: '#e07b1f' },
  doe: { label: 'Doe', plural: 'does', color: '#d9b48f' },
  fawn: { label: 'Fawn', plural: 'fawns', color: '#f5e6cf' },
  unknown: { label: 'Unknown', plural: 'unknown', color: '#a7a7a7' },
};

// Travel directions offered when logging a sighting.
export const HEADINGS = COMPASS_POINTS.map((point, i) => ({ point, deg: i * 45 }));

export function newSighting(time: string): Sighting {
  return {
    id: crypto.randomUUID(),
    time,
    kind: 'doe',
    count: 1,
    buckName: null,
    antlerPoints: null,
    headingDeg: null,
    lat: null,
    lng: null,
    notes: null,
  };
}

export function reportWeather(hour: ForecastHour): ReportWeather {
  return {
    tempF: Math.round(hour.tempF),
    windFromDeg: Math.round(hour.windFromDeg),
    windMph: Math.round(hour.windMph),
    gustMph: Math.round(hour.gustMph),
    precipChance: Math.round(hour.precipChance),
  };
}

// "2 bucks, 3 does" or "No deer".
export function sightingSummary(report: Pick<HuntReport, 'sightings'>): string {
  const totals = new Map<DeerKind, number>();
  for (const s of report.sightings) totals.set(s.kind, (totals.get(s.kind) ?? 0) + s.count);
  if (totals.size === 0) return 'No deer';
  return (Object.keys(DEER_KINDS) as DeerKind[])
    .filter((k) => totals.has(k))
    .map((k) => {
      const n = totals.get(k)!;
      return `${n} ${n === 1 ? DEER_KINDS[k].label.toLowerCase() : DEER_KINDS[k].plural}`;
    })
    .join(', ');
}

// For <input type="date"> and <input type="time">, in the PC's local time.
export function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fromDateTimeInputs(date: string, time: string): string {
  return new Date(`${date}T${time || '00:00'}`).toISOString();
}
