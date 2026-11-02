// Hunt report summaries: who's in the stand now, hunts by day, and what each
// stand has produced (deer seen and which way they travel).
import { DEER_KINDS, HEADINGS, kindInfo, sightingSummary } from '@/lib/reports';
import { compassPointOf } from '@/lib/standRating';
import type { CompassPoint, DeerKind, HuntReport } from '@/types/models';

// A phone hunt with no end is "in the stand now" only if it started recently;
// older ones were just never ended. Hunts typed into the hub are written up
// after the fact, so they never count as live.
const LIVE_FOR_MS = 12 * 60 * 60 * 1000;

export function isLive(report: HuntReport, now = Date.now()): boolean {
  if (report.end || report.source !== 'phone') return false;
  const started = Date.parse(report.start);
  return started <= now && now - started < LIVE_FOR_MS;
}

// Deer seen (all kinds of deer, or one kind). Turkeys, bears and other animals don't count.
export function deerCount(reports: Pick<HuntReport, 'sightings'>[], kind?: DeerKind): number {
  let n = 0;
  for (const r of reports) for (const s of r.sightings) if (kind ? s.kind === kind : kindInfo(s.kind).deer) n += s.count;
  return n;
}

// Other animals seen, e.g. "2 turkeys, 1 bear, 1 coyote"; empty when none.
export function otherAnimals(reports: Pick<HuntReport, 'sightings'>[]): string {
  const others = reports.flatMap((r) => r.sightings.filter((s) => !kindInfo(s.kind).deer));
  return others.length ? sightingSummary({ sightings: others }) : '';
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface HuntDay {
  key: string;
  // "Today", "Yesterday" or "Sat, Nov 1".
  label: string;
  reports: HuntReport[];
  deer: number;
  bucks: number;
  // Other animals, e.g. "2 turkeys"; empty when none.
  others: string;
}

// Newest day first, newest hunt first within a day.
export function huntsByDay(reports: HuntReport[], now = new Date()): HuntDay[] {
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  const days = new Map<string, HuntReport[]>();
  for (const r of [...reports].sort((a, b) => b.start.localeCompare(a.start))) {
    const key = dayKey(r.start);
    days.set(key, [...(days.get(key) ?? []), r]);
  }
  return [...days.entries()].map(([key, list]) => ({
    key,
    label:
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : new Date(list[0].start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    reports: list,
    deer: deerCount(list),
    bucks: deerCount(list, 'buck'),
    others: otherAnimals(list),
  }));
}

// "3 hunts · 5 deer (2 bucks) · 1 turkey".
export function daySummary(day: Pick<HuntDay, 'reports' | 'deer' | 'bucks'> & { others?: string }): string {
  const hunts = `${day.reports.length} hunt${day.reports.length === 1 ? '' : 's'}`;
  const deer = day.deer === 0 ? 'no deer' : `${day.deer} deer${day.bucks ? ` (${day.bucks} buck${day.bucks === 1 ? '' : 's'})` : ''}`;
  return [hunts, deer, day.others].filter(Boolean).join(' · ');
}

export interface StandStats {
  hunts: number;
  hours: number;
  deer: number;
  byKind: { kind: DeerKind; count: number }[];
  // Deer seen heading each way, in compass order, counting each deer.
  headings: { point: CompassPoint; deg: number; count: number }[];
  // The direction most deer were heading, when there's a clear leader.
  mainHeading: CompassPoint | null;
  // Hunts and deer by the wind during the hunt.
  byWind: { point: CompassPoint; hunts: number; deer: number }[];
  morning: { hunts: number; deer: number };
  evening: { hunts: number; deer: number };
}

export function standStats(reports: HuntReport[]): StandStats {
  const headings = HEADINGS.map((h) => ({ point: h.point, deg: h.deg, count: 0 }));
  const byWind = new Map<CompassPoint, { hunts: number; deer: number }>();
  const morning = { hunts: 0, deer: 0 };
  const evening = { hunts: 0, deer: 0 };
  let hours = 0;
  for (const r of reports) {
    const deer = deerCount([r]);
    for (const s of r.sightings) {
      // Travel patterns are about deer.
      if (s.headingDeg === null || !kindInfo(s.kind).deer) continue;
      const slot = headings.find((h) => h.deg === Math.round(s.headingDeg! / 45) * 45 % 360);
      if (slot) slot.count += s.count;
    }
    if (r.end) hours += Math.max(0, Date.parse(r.end) - Date.parse(r.start)) / 3_600_000;
    if (r.weather) {
      const point = compassPointOf(r.weather.windFromDeg);
      const entry = byWind.get(point) ?? { hunts: 0, deer: 0 };
      entry.hunts += 1;
      entry.deer += deer;
      byWind.set(point, entry);
    }
    const half = new Date(r.start).getHours() < 12 ? morning : evening;
    half.hunts += 1;
    half.deer += deer;
  }
  const sorted = [...headings].sort((a, b) => b.count - a.count);
  // A leader needs at least 2 deer and more than the runner-up.
  const mainHeading = sorted[0].count >= 2 && sorted[0].count > sorted[1].count ? sorted[0].point : null;
  return {
    hunts: reports.length,
    hours,
    deer: deerCount(reports),
    byKind: (Object.keys(DEER_KINDS) as DeerKind[]).map((kind) => ({ kind, count: deerCount(reports, kind) })).filter((k) => k.count > 0),
    headings,
    mainHeading,
    byWind: HEADINGS.map((h) => ({ point: h.point, ...(byWind.get(h.point) ?? { hunts: 0, deer: 0 }) })).filter((w) => w.hunts > 0),
    morning,
    evening,
  };
}
