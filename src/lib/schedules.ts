// Work that repeats on an area or section, like a burn every 3 years in Feb-Mar.
// A schedule works out when it's next due and puts a To do card on the Action
// Board ahead of that; marking the card done starts the next cycle.
import type { ActionItem, PlotAction, PlotEntry, ScheduleWork, WorkSchedule } from '@/types/models';

export const SCHEDULE_WORK: Record<ScheduleWork, { label: string; start: number; end: number; plotAction: PlotAction }> = {
  burn: { label: 'Burn', start: 2, end: 3, plotAction: 'other' },
  plant: { label: 'Plant', start: 8, end: 9, plotAction: 'planted' },
  lime: { label: 'Lime', start: 3, end: 4, plotAction: 'limed' },
  fertilize: { label: 'Fertilize', start: 3, end: 4, plotAction: 'fertilized' },
  mow: { label: 'Mow', start: 6, end: 7, plotAction: 'mowed' },
  spray: { label: 'Spray', start: 4, end: 5, plotAction: 'sprayed' },
  // Early enough that lime has months to work before fall planting.
  soil_test: { label: 'Soil test', start: 2, end: 3, plotAction: 'soil_test' },
  timber: { label: 'Timber work', start: 11, end: 2, plotAction: 'other' },
  other: { label: 'Other', start: 3, end: 4, plotAction: 'other' },
};

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DEFAULT_LEAD_DAYS = 60;

const DAY_MS = 86_400_000;

// A yyyy-mm-dd date as a whole day number, so dates subtract cleanly.
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

const pad = (n: number) => String(n).padStart(2, '0');

// Nov-Feb runs over New Year, so it counts as the year it starts in.
const crossesNewYear = (s: WorkSchedule) => s.endMonth < s.startMonth;

export function scheduleTitle(s: WorkSchedule): string {
  if (s.work === 'other') return s.detail?.trim() || SCHEDULE_WORK.other.label;
  return s.detail?.trim() ? `${SCHEDULE_WORK[s.work].label} ${s.detail.trim()}` : SCHEDULE_WORK[s.work].label;
}

export function cadenceLabel(s: WorkSchedule): string {
  return s.everyYears === 1 ? 'Every year' : `Every ${s.everyYears} years`;
}

export function windowLabel(s: WorkSchedule): string {
  return s.startMonth === s.endMonth ? MONTH_NAMES[s.startMonth - 1] : `${MONTH_NAMES[s.startMonth - 1]}–${MONTH_NAMES[s.endMonth - 1]}`;
}

function seasonOf(date: string, s: WorkSchedule): number {
  const [year, month] = date.split('-').map(Number);
  return crossesNewYear(s) && month <= s.endMonth ? year - 1 : year;
}

function seasonDates(s: WorkSchedule, season: number): { start: string; end: string } {
  const endYear = crossesNewYear(s) ? season + 1 : season;
  const lastDay = new Date(Date.UTC(endYear, s.endMonth, 0)).getUTCDate();
  return { start: `${season}-${pad(s.startMonth)}-01`, end: `${endYear}-${pad(s.endMonth)}-${pad(lastDay)}` };
}

export interface NextDue {
  season: number;
  start: string;
  end: string;
  // e.g. "Feb–Mar 2028", or "Nov 2027–Feb 2028" across New Year.
  label: string;
}

// When it's next due: a cycle after it was last done or skipped, or else the
// next time its window comes around.
export function nextDue(s: WorkSchedule, today: string): NextDue {
  const anchors = [s.lastDone ? seasonOf(s.lastDone, s) : null, s.handledSeason ?? null].filter((y): y is number => y !== null);
  let season: number;
  if (anchors.length) {
    season = Math.max(...anchors) + s.everyYears;
  } else {
    season = seasonOf(today, s);
    if (today > seasonDates(s, season).end) season += 1;
  }
  const { start, end } = seasonDates(s, season);
  const label = crossesNewYear(s) ? `${MONTH_NAMES[s.startMonth - 1]} ${season}–${MONTH_NAMES[s.endMonth - 1]} ${season + 1}` : `${windowLabel(s)} ${season}`;
  return { season, start, end, label };
}

export const isOverdue = (end: string, today: string) => today > end;

export interface SchedulePlace {
  kind: 'area' | 'section';
  id: string;
  name: string;
  propertyId: string | null;
  schedules?: WorkSchedule[];
}

export const liveSchedules = (place: { schedules?: WorkSchedule[] }) => (place.schedules ?? []).filter((s) => !s.deletedAt);

// To do cards for schedules coming due. Each cycle's card has a fixed id, so it's
// made only once, even if it was removed or the same work arrives from another hub.
export function dueCards(places: SchedulePlace[], items: ActionItem[], leadDays: number, today: string): ActionItem[] {
  const known = new Set(items.map((i) => i.id));
  const now = new Date().toISOString();
  const cards: ActionItem[] = [];
  for (const place of places) {
    for (const s of liveSchedules(place)) {
      const due = nextDue(s, today);
      const id = `schedule-${s.id}-${due.season}`;
      if (known.has(id) || dayNumber(due.start) - dayNumber(today) > leadDays) continue;
      cards.push({
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        kind: 'work',
        text: `${scheduleTitle(s)}: ${place.name}`,
        status: 'planned',
        lat: null,
        lng: null,
        loggedBy: null,
        propertyId: place.propertyId,
        source: 'hub',
        markerId: null,
        schedule: { id: s.id, placeKind: place.kind, placeId: place.id, season: due.season, dueLabel: due.label, dueEnd: due.end, lastDoneBefore: null, handledBefore: null },
      });
    }
  }
  return cards;
}

const patchSchedule = <T extends { schedules?: WorkSchedule[] }>(place: T, id: string, patch: Partial<WorkSchedule>): T => ({
  ...place,
  schedules: (place.schedules ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
});

// The card was marked done today, which starts the next cycle.
export const markDone = <T extends { schedules?: WorkSchedule[] }>(place: T, id: string, today: string, season: number) =>
  patchSchedule(place, id, { lastDone: today, handledSeason: season });

// The card was taken back out of Done.
export const undoDone = <T extends { schedules?: WorkSchedule[] }>(place: T, id: string, lastDone: string | null, handledSeason: number | null) =>
  patchSchedule(place, id, { lastDone, handledSeason });

// The card was removed, so this cycle is skipped.
export const skipSeason = <T extends { schedules?: WorkSchedule[] }>(place: T, id: string, season: number) => patchSchedule(place, id, { handledSeason: season });

// What a finished card adds to a food plot's log.
export function logEntryFor(item: ActionItem, s: WorkSchedule, today: string): PlotEntry {
  const action = SCHEDULE_WORK[s.work].plotAction;
  return {
    id: item.id,
    action,
    what: action === 'planted' ? s.detail?.trim() || null : null,
    date: today,
    notes: action === 'other' ? scheduleTitle(s) : null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
}

// Everything scheduled, soonest first, up to the end of the year this many years on.
export function comingUp(places: SchedulePlace[], today: string, years = 2): { place: SchedulePlace; schedule: WorkSchedule; due: NextDue }[] {
  const lastYear = Number(today.slice(0, 4)) + years;
  return places
    .flatMap((place) => liveSchedules(place).map((schedule) => ({ place, schedule, due: nextDue(schedule, today) })))
    .filter((row) => row.due.season <= lastYear)
    .sort((a, b) => a.due.start.localeCompare(b.due.start) || a.place.name.localeCompare(b.place.name));
}
