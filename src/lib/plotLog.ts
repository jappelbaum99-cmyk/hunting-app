// A food plot's saved history: what was planted and what work was done, and when.
// The newest planting is also kept on the area as what's planted now.
import type { MapArea, PlotAction, PlotEntry } from '@/types/models';

export const PLOT_ACTIONS: Record<PlotAction, string> = {
  planted: 'Planted',
  fertilized: 'Fertilized',
  limed: 'Limed',
  sprayed: 'Sprayed',
  mowed: 'Mowed',
  disked: 'Disked',
  soil_test: 'Soil test',
  other: 'Other',
};

// Today on this computer's calendar, as yyyy-mm-dd.
export function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function formatPlotDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Saved entries, newest first.
export function plotEntries(area: MapArea): PlotEntry[] {
  return (area.log ?? []).filter((e) => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function entryTitle(entry: PlotEntry): string {
  return entry.action === 'planted' && entry.what ? `Planted ${entry.what}` : PLOT_ACTIONS[entry.action];
}

function withLog(area: MapArea, log: PlotEntry[]): MapArea {
  const next = { ...area, log };
  // A scheduled planting done without naming the crop doesn't change what's planted.
  const named = (e: PlotEntry) => e.action === 'planted' && Boolean(e.what);
  const planting = plotEntries(next).find(named);
  if (planting) return { ...next, planted: planting.what, plantedOn: planting.date };
  // Keep a planting typed in before plots had a log, unless its log entries were removed.
  return log.some(named) ? { ...next, planted: null, plantedOn: null } : next;
}

// Adds a new entry, or replaces the one with the same id.
export function saveEntry(area: MapArea, entry: PlotEntry): MapArea {
  const log = area.log ?? [];
  return withLog(area, log.some((e) => e.id === entry.id) ? log.map((e) => (e.id === entry.id ? entry : e)) : [...log, entry]);
}

export function removeEntry(area: MapArea, id: string): MapArea {
  const deletedAt = new Date().toISOString();
  return withLog(area, (area.log ?? []).map((e) => (e.id === id ? { ...e, deletedAt } : e)));
}
