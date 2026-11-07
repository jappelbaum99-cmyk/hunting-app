// Everything scheduled, for the Schedules tab: repeating work on areas and
// sections, and section plans with a date. Soonest first until it's put in
// another order; that order is a list of row keys kept in this hub's settings.
import { formatPlotDate } from '@/lib/plotLog';
import { cadenceLabel, comingUp, windowLabel, scheduleTitle, type SchedulePlace } from '@/lib/schedules';
import { PLAN_KINDS, PLAN_STATUSES } from '@/lib/plans';
import type { Plan, WorkSchedule } from '@/types/models';

interface RowBase {
  key: string;
  title: string;
  placeName: string;
  // e.g. "Feb–Mar 2028" or a date.
  when: string;
  detail: string;
  start: string;
  end: string;
}

export interface ScheduleRow extends RowBase {
  type: 'schedule';
  place: SchedulePlace;
  schedule: WorkSchedule;
}

export interface PlanRow extends RowBase {
  type: 'plan';
  place: SchedulePlace;
  plan: Plan;
}

export type UpcomingRow = ScheduleRow | PlanRow;

export function upcomingRows(places: SchedulePlace[], plans: Plan[], today: string): UpcomingRow[] {
  const scheduled: UpcomingRow[] = comingUp(places, today, Infinity).map(({ place, schedule, due }) => ({
    type: 'schedule',
    key: `schedule:${schedule.id}`,
    title: scheduleTitle(schedule),
    placeName: place.name,
    when: due.label,
    detail: `${cadenceLabel(schedule)} · ${windowLabel(schedule)}`,
    start: due.start,
    end: due.end,
    place,
    schedule,
  }));
  const planned: UpcomingRow[] = [];
  for (const plan of plans) {
    const date = plan.targetDate ?? plan.burn?.windowStart ?? null;
    const place = places.find((p) => p.kind === 'section' && p.id === plan.sectionId);
    if (!date || !place || plan.deletedAt || plan.status === 'done') continue;
    planned.push({
      type: 'plan',
      key: `plan:${plan.id}`,
      title: plan.title,
      placeName: place.name,
      when: formatPlotDate(date),
      detail: `${PLAN_KINDS[plan.kind].label} · ${PLAN_STATUSES[plan.status]}`,
      start: date,
      end: plan.targetDate ? date : (plan.burn?.windowEnd ?? date),
      place,
      plan,
    });
  }
  return [...scheduled, ...planned].sort((a, b) => a.start.localeCompare(b.start) || a.placeName.localeCompare(b.placeName));
}

// Puts rows in the chosen order. Anything new goes in by date, ahead of the first
// ordered row that's due later, rather than falling to the bottom. Expects rows soonest first.
export function orderRows(rows: UpcomingRow[], order: string[]): UpcomingRow[] {
  const position = new Map(order.map((key, i) => [key, i]));
  const placed = rows.filter((r) => position.has(r.key)).sort((a, b) => (position.get(a.key) as number) - (position.get(b.key) as number));
  for (const row of rows) {
    if (position.has(row.key)) continue;
    const later = placed.findIndex((r) => r.start > row.start);
    placed.splice(later === -1 ? placed.length : later, 0, row);
  }
  return placed;
}

// The keys after moving one to a new spot in the list.
export function moveKey(keys: string[], key: string, to: number): string[] {
  const rest = keys.filter((k) => k !== key);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, key);
  return rest;
}
