// Deer and turkeys taken: kept on their hunt report, shared by the hub and phone.
import type { Harvest, HarvestKind, HarvestWeapon, HuntReport, Sighting } from '@/types/models';

export const HARVEST_KINDS: Record<HarvestKind, { label: string; plural: string; species: 'deer' | 'turkey' }> = {
  buck: { label: 'Buck', plural: 'bucks', species: 'deer' },
  doe: { label: 'Doe', plural: 'does', species: 'deer' },
  button_buck: { label: 'Button buck', plural: 'button bucks', species: 'deer' },
  gobbler: { label: 'Gobbler', plural: 'gobblers', species: 'turkey' },
  jake: { label: 'Jake', plural: 'jakes', species: 'turkey' },
  hen: { label: 'Hen', plural: 'hens', species: 'turkey' },
};

export const HARVEST_KIND_ORDER = Object.keys(HARVEST_KINDS) as HarvestKind[];

export const WEAPONS: { id: HarvestWeapon; label: string }[] = [
  { id: 'bow', label: 'Bow' },
  { id: 'crossbow', label: 'Crossbow' },
  { id: 'rifle', label: 'Rifle' },
  { id: 'muzzleloader', label: 'Muzzleloader' },
  { id: 'shotgun', label: 'Shotgun' },
  { id: 'handgun', label: 'Handgun' },
  { id: 'other', label: 'Other' },
];

export const speciesOf = (h: Pick<Harvest, 'kind'>) => (HARVEST_KINDS[h.kind] ?? HARVEST_KINDS.buck).species;

// The kind to start from for a sighting: a seen buck becomes a harvested buck, and so on.
function kindFor(s: Sighting | null): HarvestKind {
  if (!s) return 'buck';
  if (s.kind === 'doe' || s.kind === 'fawn') return 'doe';
  if (s.kind === 'turkey') return 'gobbler';
  return 'buck';
}

// A new harvest on a hunt, filled in from a sighting when there is one.
export function newHarvest(report: HuntReport, opts: { sighting?: Sighting | null; hunter?: string | null; kind?: HarvestKind } = {}): Harvest {
  const now = new Date().toISOString();
  const s = opts.sighting ?? null;
  const fallbackTime = new Date(Math.min(Date.now(), Date.parse(report.end ?? report.start) || Date.now())).toISOString();
  const kind = opts.kind ?? kindFor(s);
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    time: s?.time ?? fallbackTime,
    kind,
    hunter: opts.hunter ?? report.loggedBy ?? null,
    weapon: null,
    sightingId: s?.id ?? null,
    fromStand: s?.fromStand ?? null,
    points: kind === 'buck' ? s?.antlerPoints ?? null : null,
    spreadIn: null,
    buckName: kind === 'buck' ? s?.buckName ?? null : null,
    beardIn: null,
    spurIn: null,
    weightLb: null,
    checkNumber: null,
    notes: null,
  };
}

// A hunt's harvests that haven't been removed.
export function harvestsOf(report: HuntReport): Harvest[] {
  return (report.harvests ?? []).filter((h) => !h.deletedAt);
}

// Change one harvest on its hunt (removing sets deletedAt, so it syncs).
export function withHarvest(report: HuntReport, id: string, patch: Partial<Harvest>): HuntReport {
  const now = new Date().toISOString();
  return { ...report, harvests: (report.harvests ?? []).map((h) => (h.id === id ? { ...h, ...patch, updatedAt: now } : h)) };
}

export function addHarvest(report: HuntReport, harvest: Harvest): HuntReport {
  return { ...report, harvests: [...(report.harvests ?? []), harvest] };
}

// "8-point buck", "Doe", "Gobbler".
export function harvestTitle(h: Harvest): string {
  const label = (HARVEST_KINDS[h.kind] ?? HARVEST_KINDS.buck).label;
  if (h.kind === 'buck' && h.points) return `${h.points}-point buck${h.buckName ? ` (${h.buckName})` : ''}`;
  if (h.kind === 'buck' && h.buckName) return `Buck (${h.buckName})`;
  return label;
}

const inches = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')} in`;

// "Bow · 185 lb · 17 in spread" or "Shotgun · 10 in beard, 1 in spurs".
export function harvestDetail(h: Harvest): string {
  const parts: string[] = [];
  const weapon = WEAPONS.find((w) => w.id === h.weapon);
  if (weapon) parts.push(weapon.label);
  if (h.weightLb) parts.push(`${h.weightLb} lb`);
  if (speciesOf(h) === 'deer' && h.spreadIn) parts.push(`${inches(h.spreadIn)} spread`);
  if (speciesOf(h) === 'turkey') {
    const t = [h.beardIn ? `${inches(h.beardIn)} beard` : null, h.spurIn ? `${inches(h.spurIn)} spurs` : null].filter(Boolean);
    if (t.length) parts.push(t.join(', '));
  }
  return parts.join(' · ');
}

// Every harvest with its hunt, newest first.
export function allHarvests(reports: HuntReport[]): { harvest: Harvest; report: HuntReport }[] {
  return reports
    .filter((r) => !r.deletedAt)
    .flatMap((report) => harvestsOf(report).map((harvest) => ({ harvest, report })))
    .sort((a, b) => b.harvest.time.localeCompare(a.harvest.time));
}

// "2 bucks, 1 doe, 1 gobbler".
export function harvestCounts(list: Harvest[]): string {
  const counts = new Map<HarvestKind, number>();
  for (const h of list) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  return HARVEST_KIND_ORDER.filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k)!;
      return `${n} ${n === 1 ? HARVEST_KINDS[k].label.toLowerCase() : HARVEST_KINDS[k].plural}`;
    })
    .join(', ');
}

// For a hunt row: "Took an 8-point buck", or null with none.
export function harvestLine(report: HuntReport): string | null {
  const list = harvestsOf(report);
  if (list.length === 0) return null;
  return `Took ${list.map((h) => harvestTitle(h).replace(/^(\w)/, (c) => c.toLowerCase())).join(', ')}`;
}

// A number box's text to a number, or null when empty.
export function numberOrNull(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
