// Plan types, starter checklists, and the burn-day finder.
import type { IconName } from '@/lib/icons';
import { compassPointOf } from '@/lib/standRating';
import type { Forecast, ForecastHour } from '@/lib/weather';
import type { BurnDetails, Plan, PlanKind, PlanStatus, TimberPractice } from '@/types/models';

export const PLAN_KINDS: Record<PlanKind, { label: string; icon: IconName }> = {
  burn: { label: 'Burn plan', icon: 'fire' },
  timber: { label: 'Timber plan', icon: 'pine' },
  habitat: { label: 'Habitat plan', icon: 'wheat' },
  other: { label: 'Other plan', icon: 'clipboard' },
};

export const PLAN_STATUSES: Record<PlanStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
};

export const TIMBER_PRACTICES: Record<TimberPractice, string> = {
  thinning: 'Thinning',
  selective_harvest: 'Selective harvest',
  clearcut: 'Clearcut',
  tsi: 'Timber stand improvement (TSI)',
  hinge_cut: 'Hinge cutting',
  edge_feathering: 'Edge feathering',
  planting: 'Tree planting',
  other: 'Other',
};

const STARTER_TASKS: Record<PlanKind, string[]> = {
  burn: [
    'Cut or disk firebreaks around the unit',
    'Check burn rules and notify the fire department',
    'Tell the neighbors the day before',
    'Line up crew, water and equipment',
    'Check the weather the morning of the burn',
  ],
  timber: [
    'Walk the unit and mark the trees',
    'Talk to an MDC forester or private land conservationist',
    'Get contractor bids',
    'Schedule the work',
  ],
  habitat: ['Walk the unit and note what is there', 'Decide what to plant or cut', 'Schedule the work'],
  other: [],
};

// Common prescribed-fire limits, as a starting point to adjust.
export const DEFAULT_BURN: BurnDetails = {
  windowStart: null,
  windowEnd: null,
  goodWinds: [],
  minWindMph: 4,
  maxWindMph: 15,
  minHumidity: 25,
  maxHumidity: 55,
};

export function newPlan(sectionId: string, kind: PlanKind, base: Pick<Plan, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Plan {
  return {
    ...base,
    sectionId,
    kind,
    title: PLAN_KINDS[kind].label,
    status: 'idea',
    targetDate: null,
    notes: null,
    tasks: STARTER_TASKS[kind].map((text) => ({ id: crypto.randomUUID(), text, done: false })),
    burn: kind === 'burn' ? { ...DEFAULT_BURN } : null,
    timber: kind === 'timber' ? { practice: 'thinning', contractor: null, estimatedCost: null, estimatedIncome: null } : null,
  };
}

const HOUR = 3600_000;
// Don't light within 2 hours of sunrise (dew, inversions) or 1 hour of sunset.
const BURN_START_AFTER_SUNRISE = 2 * HOUR;
const BURN_END_BEFORE_SUNSET = HOUR;
const MAX_RAIN_CHANCE = 30;

export interface BurnWindow {
  start: number;
  // End of the last good hour.
  end: number;
  hours: ForecastHour[];
}

// Why one forecast hour isn't burnable, or null when it is.
export function burnProblem(hour: ForecastHour, burn: BurnDetails): string | null {
  if (hour.windMph < burn.minWindMph) return 'wind too light';
  if (hour.windMph > burn.maxWindMph) return 'wind too strong';
  if (burn.goodWinds.length > 0 && !burn.goodWinds.includes(compassPointOf(hour.windFromDeg))) return 'wrong wind direction';
  if (hour.humidity < burn.minHumidity) return 'humidity too low';
  if (hour.humidity > burn.maxHumidity) return 'humidity too high';
  if (hour.precipChance > MAX_RAIN_CHANCE) return 'rain likely';
  return null;
}

// Daytime stretches in the forecast where every hour meets the burn plan.
export function burnWindows(forecast: Forecast, burn: BurnDetails): BurnWindow[] {
  const windows: BurnWindow[] = [];
  let current: BurnWindow | null = null;
  for (const hour of forecast.hours) {
    const day = forecast.days.find((d) => hour.time >= d.sunrise && hour.time < d.sunset);
    const daytime = day && hour.time >= day.sunrise + BURN_START_AFTER_SUNRISE && hour.time <= day.sunset - BURN_END_BEFORE_SUNSET;
    const ok = daytime && hour.time >= Date.now() - HOUR && burnProblem(hour, burn) === null;
    if (ok) {
      if (current && hour.time - current.end <= HOUR) {
        current.end = hour.time + HOUR;
        current.hours.push(hour);
      } else {
        current = { start: hour.time, end: hour.time + HOUR, hours: [hour] };
        windows.push(current);
      }
    } else {
      current = null;
    }
  }
  return windows;
}
