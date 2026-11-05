// The Action Board: notes from phones become cards on the hub, and plot work
// from a phone goes straight into that food plot's log.
import { PLOT_ACTIONS, saveEntry } from '@/lib/plotLog';
import type { ActionItem, BoardStatus, FieldNote, MapArea, NoteKind } from '@/types/models';

export const NOTE_KINDS: Record<NoteKind, string> = {
  stand: 'Stand idea',
  work: 'Work to do',
  thought: 'Thought',
};

// 'planned' is stored as is; people see it as To do.
export const BOARD_STATUSES: Record<BoardStatus, string> = {
  idea: 'Idea',
  planned: 'To do',
  done: 'Done',
};

// The open lists, in the order they're shown. Done sits in a dropdown below them.
export const BOARD_LISTS: { status: BoardStatus; heading: string }[] = [
  { status: 'planned', heading: 'To do' },
  { status: 'idea', heading: 'Ideas' },
];

// Sent to phones through the camp document, which has a size limit, so finished
// cards stop being sent after this many.
const DONE_CARDS_SHARED = 30;

// What phones see of a card. `due` is set on cards made by a schedule.
export type BoardCard = Pick<ActionItem, 'id' | 'kind' | 'text' | 'status' | 'lat' | 'lng' | 'loggedBy' | 'createdAt'> & {
  due?: { label: string; end: string } | null;
};

// What phones see of a food plot.
export interface CampPlot {
  id: string;
  name: string;
  planted: string | null;
}

export function boardCards(items: ActionItem[]): BoardCard[] {
  const newestFirst = [...items].filter((i) => !i.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = newestFirst.filter((i) => i.status === 'done').slice(0, DONE_CARDS_SHARED);
  return [...newestFirst.filter((i) => i.status !== 'done'), ...done].map(({ id, kind, text, status, lat, lng, loggedBy, createdAt, schedule }) => ({
    due: schedule ? { label: schedule.dueLabel, end: schedule.dueEnd } : null,
    id,
    kind,
    text,
    status,
    lat,
    lng,
    loggedBy,
    createdAt,
  }));
}

// Sorts incoming notes into new cards and food plots with new log entries.
// Both are skipped once the hub has them, so a card's edits and a removed log
// entry stay as the hub left them. Plot work for a plot this hub doesn't have
// becomes a card, so it isn't lost.
export function placeNotes(
  notes: FieldNote[],
  items: ActionItem[],
  areas: MapArea[],
  propertyAt: (lng: number, lat: number) => string | null,
): { items: ActionItem[]; areas: MapArea[] } {
  const known = new Set(items.map((i) => i.id));
  const changed = new Map<string, MapArea>();
  const fresh: ActionItem[] = [];
  for (const note of notes) {
    if (note.deletedAt || known.has(note.id)) continue;
    const plot = note.plot;
    const area = plot ? (changed.get(plot.areaId) ?? areas.find((a) => a.id === plot.areaId)) : undefined;
    if (plot && area) {
      if (area.log?.some((e) => e.id === note.id)) continue;
      changed.set(
        area.id,
        saveEntry(area, {
          id: note.id,
          action: plot.action,
          what: plot.what,
          date: plot.date,
          notes: note.text || null,
          createdAt: note.createdAt,
          deletedAt: null,
          fromPhone: true,
          loggedBy: note.loggedBy,
        }),
      );
      continue;
    }
    const work = plot ? `${PLOT_ACTIONS[plot.action]}${plot.what ? ` ${plot.what}` : ''} (${plot.date})` : null;
    fresh.push({
      id: note.id,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      deletedAt: null,
      kind: note.kind,
      text: [work, note.text].filter(Boolean).join(': '),
      status: 'idea',
      lat: note.lat,
      lng: note.lng,
      loggedBy: note.loggedBy,
      propertyId: note.lat !== null && note.lng !== null ? propertyAt(note.lng, note.lat) : null,
      source: 'phone',
      markerId: null,
    });
  }
  return { items: fresh, areas: [...changed.values()] };
}
