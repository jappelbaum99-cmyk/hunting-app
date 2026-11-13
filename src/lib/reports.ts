// Shared helpers for hunt reports (the hub and the phone page both use these).
import type { IconName } from '@/lib/icons';
import { COMPASS_POINTS, type DeerBehavior, type DeerKind, type HuntReport, type ReportWeather, type Sighting } from '@/types/models';
import type { ForecastHour, Pressure } from '@/lib/weather';

interface KindInfo {
  label: string;
  plural: string;
  color: string;
  icon: IconName;
  // Deer count toward deer totals and travel patterns; other animals are listed apart.
  deer: boolean;
}

// Deer are browns, darkest for bucks and lightest for fawns, and always drawn
// with a cream outline so they stand out on the map. Other animals share one
// neutral and are told apart by their icon, with their name beside it.
const NEUTRAL = '#c3c2b7';

export const DEER_KINDS: Record<DeerKind, KindInfo> = {
  buck: { label: 'Buck', plural: 'bucks', color: '#4a2a12', icon: 'deer', deer: true },
  doe: { label: 'Doe', plural: 'does', color: '#8b5a2f', icon: 'deer', deer: true },
  fawn: { label: 'Fawn', plural: 'fawns', color: '#c4935c', icon: 'deer', deer: true },
  unknown: { label: 'Deer', plural: 'deer', color: '#a07a55', icon: 'deer', deer: true },
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
    comment: null,
  };
}

export function reportWeather(hour: ForecastHour, pressure?: Pressure): ReportWeather {
  return {
    ...(pressure ? { pressureInHg: Math.round(pressure.inHg * 100) / 100, pressureTrend: pressure.trend } : {}),
    tempF: Math.round(hour.tempF),
    windFromDeg: Math.round(hour.windFromDeg),
    windMph: Math.round(hour.windMph),
    gustMph: Math.round(hour.gustMph),
    precipChance: Math.round(hour.precipChance),
  };
}

// "2 bucks, 3 does, 1 turkey" or "Nothing seen".
// Where a hunt was: its stand, else the new spot marked on the phone.
export function huntPosition(report: Pick<HuntReport, 'standId' | 'spot'>, stands: { id: string; lat: number; lng: number }[]): [number, number] | null {
  const stand = stands.find((s) => s.id === report.standId);
  if (stand) return [stand.lng, stand.lat];
  return report.spot ? [report.spot.lng, report.spot.lat] : null;
}

// What to call where a hunt was: "Ridge Stand", "Big oak (new spot)", "New spot" or "No stand".
export function huntPlaceName(report: Pick<HuntReport, 'standId' | 'spot'>, stands: { id: string; name: string }[]): string {
  const stand = stands.find((s) => s.id === report.standId);
  if (stand) return stand.name;
  if (report.spot) return report.spot.name ? `${report.spot.name} (new spot)` : 'New spot';
  return 'No stand';
}

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

// The rings on the phone's "where seen" target, in yards. The last is its edge;
// anything farther is typed in the distance box.
export const DISTANCE_BANDS = [25, 50, 100, 150] as const;

// Farthest distance a sighting can be from its stand, in yards.
export const MAX_YARDS = 800;

// What the deer were doing, picked with a tap on the phone.
export const BEHAVIORS = {
  feeding: 'Feeding',
  walking: 'Walking',
  running: 'Running',
  chasing: 'Chasing',
  bedded: 'Bedded',
  scraping: 'Scraping',
} as const satisfies Record<DeerBehavior, string>;

type FromStand = NonNullable<Sighting['fromStand']>;

// "~140 yd NE" for a spot measured from the stand.
export function spotLabel(w: FromStand): string {
  const point = COMPASS_POINTS[Math.round((((w.bearingDeg % 360) + 360) % 360) / 45) % 8];
  return `~${Math.round(w.yards)} yd ${point}`;
}

// "~140 yd NE", or null when not given.
export function whereLabel(s: Pick<Sighting, 'fromStand'>): string | null {
  return s.fromStand ? spotLabel(s.fromStand) : null;
}

// "Came in ~50 yd NW, went to ~90 yd SE", or null without a went-to spot.
export function inOutLabel(s: Pick<Sighting, 'fromStand' | 'wentTo'>): string | null {
  if (!s.wentTo) return null;
  const came = s.fromStand ? `Came in ${spotLabel(s.fromStand)}` : 'Came in at the stand';
  return `${came}, went to ${spotLabel(s.wentTo)}`;
}

// The way from one spot to another (both from the stand), to the nearest of 8 points.
export function headingBetween(from: FromStand | null, to: FromStand): number {
  const xy = (w: FromStand | null) => (w ? [Math.sin((w.bearingDeg * Math.PI) / 180) * w.yards, Math.cos((w.bearingDeg * Math.PI) / 180) * w.yards] : [0, 0]);
  const [x0, y0] = xy(from);
  const [x1, y1] = xy(to);
  const deg = ((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI + 360) % 360;
  return (Math.round(deg / 45) * 45) % 360;
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
