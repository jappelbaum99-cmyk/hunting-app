// Shared helpers for hunt reports (the hub and the phone page both use these).
import type { IconName } from '@/lib/icons';
import { COMPASS_POINTS, type DeerKind, type HuntReport, type ReportWeather, type Sighting } from '@/types/models';
import type { ForecastHour } from '@/lib/weather';

interface KindInfo {
  label: string;
  plural: string;
  color: string;
  icon: IconName;
  // Deer count toward deer totals and travel patterns; other animals are listed apart.
  deer: boolean;
}

// Buck, doe and fawn use colors checked to stay distinct from each other
// (including for color blindness) on the dark map. Everything else shares one
// neutral and is told apart by its icon, with its name beside it.
const NEUTRAL = '#c3c2b7';

export const DEER_KINDS: Record<DeerKind, KindInfo> = {
  buck: { label: 'Buck', plural: 'bucks', color: '#d95926', icon: 'deer', deer: true },
  doe: { label: 'Doe', plural: 'does', color: '#3987e5', icon: 'deer', deer: true },
  fawn: { label: 'Fawn', plural: 'fawns', color: '#199e70', icon: 'deer', deer: true },
  unknown: { label: 'Deer', plural: 'deer', color: NEUTRAL, icon: 'deer', deer: true },
  turkey: { label: 'Turkey', plural: 'turkeys', color: NEUTRAL, icon: 'turkey', deer: false },
  bear: { label: 'Bear', plural: 'bears', color: NEUTRAL, icon: 'bear', deer: false },
  other: { label: 'Other', plural: 'other', color: NEUTRAL, icon: 'binoculars', deer: false },
};

// The kind's look, falling back to plain "Deer" for a kind this version doesn't know.
export function kindInfo(kind: string): KindInfo {
  return DEER_KINDS[kind as DeerKind] ?? DEER_KINDS.unknown;
}

// "1 buck", "2 turkeys", or for other animals what they were: "1 coyote".
export function sightingLabel(s: Pick<Sighting, 'kind' | 'count' | 'notes'>): string {
  const info = kindInfo(s.kind);
  if (s.kind === 'other' && s.notes?.trim()) return `${s.count} ${s.notes.trim()}`;
  return `${s.count} ${s.count === 1 ? info.label.toLowerCase() : info.plural}`;
}

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
    fromStand: null,
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

// "2 bucks, 3 does, 1 turkey" or "Nothing seen".
export function sightingSummary(report: Pick<HuntReport, 'sightings'>): string {
  // Totals per kind, except "other" animals, which are listed by what they were.
  const totals = new Map<string, { kind: DeerKind; count: number; notes: string | null }>();
  for (const s of report.sightings) {
    const key = s.kind === 'other' ? `other:${s.notes?.trim().toLowerCase() ?? ''}` : s.kind;
    const entry = totals.get(key) ?? { kind: s.kind, count: 0, notes: s.notes };
    entry.count += s.count;
    totals.set(key, entry);
  }
  if (totals.size === 0) return 'Nothing seen';
  const order = Object.keys(DEER_KINDS);
  return [...totals.values()]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(sightingLabel)
    .join(', ');
}

// Distance bands for "where seen", in yards. The last one means "farther".
export const DISTANCE_BANDS = [50, 100, 200, 300] as const;

// "~100 yd NE", "200+ yd W", or null when not given.
export function whereLabel(s: Pick<Sighting, 'fromStand'>): string | null {
  if (!s.fromStand) return null;
  const point = COMPASS_POINTS[Math.round((((s.fromStand.bearingDeg % 360) + 360) % 360) / 45) % 8];
  const last = DISTANCE_BANDS[DISTANCE_BANDS.length - 1];
  const yards = s.fromStand.yards >= last ? `${DISTANCE_BANDS[DISTANCE_BANDS.length - 2]}+` : `~${s.fromStand.yards}`;
  return `${yards} yd ${point}`;
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
