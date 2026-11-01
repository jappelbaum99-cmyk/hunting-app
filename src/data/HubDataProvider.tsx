import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { emptyHubData, loadHubData, saveHubData } from '@/data/storage';
import type {
  CustomAreaType,
  FieldPin,
  HubData,
  HubSettings,
  HuntReport,
  MapArea,
  MapImageOverlay,
  MapMarker,
  Plan,
  Property,
  Section,
} from '@/types/models';

const SAVE_DELAY_MS = 400;

type Collection = 'properties' | 'markers' | 'areas' | 'overlays' | 'sections' | 'plans' | 'reports' | 'fieldPins';

interface HubDataValue {
  loaded: boolean;
  loadError: string | null;
  saveError: string | null;
  properties: Property[];
  markers: MapMarker[];
  areas: MapArea[];
  overlays: MapImageOverlay[];
  sections: Section[];
  plans: Plan[];
  reports: HuntReport[];
  fieldPins: FieldPin[];
  settings: HubSettings;
  saveSettings(settings: HubSettings): void;
  saveProperty(property: Property): void;
  // Changes some fields of the stored property, whatever its latest version is.
  patchProperty(id: string, patch: Partial<Property>): void;
  saveMarker(marker: MapMarker): void;
  saveArea(area: MapArea): void;
  saveOverlay(overlay: MapImageOverlay): void;
  saveSection(section: Section): void;
  savePlan(plan: Plan): void;
  saveReport(report: HuntReport): void;
  // Changes some fields of the stored report, whatever its latest version is.
  patchReport(id: string, patch: Partial<HuntReport>): void;
  saveFieldPin(pin: FieldPin): void;
  // Brings in records from the phone: new ones are added, and ones already
  // here are replaced only when the incoming copy is newer.
  mergeFromPhone(incoming: { reports: HuntReport[]; fieldPins: FieldPin[] }): { added: number; updated: number };
  // Brings in records from another hub's map file, by the same newer-wins rule.
  // Deleted records come along so a delete there reaches this hub too.
  mergeRecords(incoming: Partial<Pick<HubData, Collection>>, customAreaTypes?: CustomAreaType[]): { added: number; updated: number };
  // Everything stored, deleted records included (for sharing).
  allData: HubData | null;
  deleteProperty(id: string): void;
  deleteMarker(id: string): void;
  deleteArea(id: string): void;
  deleteOverlay(id: string): void;
  deleteSection(id: string): void;
  deletePlan(id: string): void;
  deleteReport(id: string): void;
}

const HubDataContext = createContext<HubDataValue | null>(null);

export function useHubData(): HubDataValue {
  const value = useContext(HubDataContext);
  if (!value) throw new Error('useHubData must be used inside HubDataProvider');
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function upsert<T extends { id: string }>(list: T[], record: T): T[] {
  const index = list.findIndex((r) => r.id === record.id);
  if (index === -1) return [...list, record];
  const next = [...list];
  next[index] = record;
  return next;
}

function softDelete<T extends { id: string; deletedAt: string | null; updatedAt: string }>(
  list: T[],
  id: string,
  at: string,
): T[] {
  return list.map((r) => (r.id === id ? { ...r, deletedAt: at, updatedAt: at } : r));
}

export function HubDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HubData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    loadHubData()
      .then(setData)
      .catch((error: unknown) => setLoadError(String(error)));
  }, []);

  // Saves shortly after each change so the file on disk always matches the screen.
  useEffect(() => {
    if (!data || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      saveHubData(data)
        .then(() => setSaveError(null))
        .catch((error: unknown) => setSaveError(String(error)));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [data]);

  const update = useCallback((change: (current: HubData) => HubData) => {
    dirty.current = true;
    setData((current) => (current ? change(current) : current));
  }, []);

  const save = useCallback(
    <K extends Collection>(collection: K, record: HubData[K][number]) => {
      update((current) => ({
        ...current,
        [collection]: upsert(current[collection] as HubData[K][number][], { ...record, updatedAt: nowIso() }),
      }));
    },
    [update],
  );

  const remove = useCallback(
    (collection: Collection, id: string) => {
      const at = nowIso();
      update((current) => {
        const list = current[collection] as { id: string; deletedAt: string | null; updatedAt: string }[];
        const next = { ...current, [collection]: softDelete(list, id, at) } as HubData;
        if (collection === 'properties') {
          // Stands and areas stay on the map; they just lose their property link.
          const unlink = <T extends { propertyId: string | null; updatedAt: string }>(r: T): T =>
            r.propertyId === id ? { ...r, propertyId: null, updatedAt: at } : r;
          next.markers = next.markers.map(unlink);
          next.areas = next.areas.map(unlink);
          next.sections = next.sections.map(unlink);
        }
        if (collection === 'sections') {
          // A section's plans go with it.
          next.plans = next.plans.map((p) => (p.sectionId === id && !p.deletedAt ? { ...p, deletedAt: at, updatedAt: at } : p));
        }
        return next;
      });
    },
    [update],
  );

  const value = useMemo<HubDataValue>(() => {
    const live = <T extends { deletedAt: string | null }>(list: T[] | undefined) =>
      (list ?? []).filter((r) => r.deletedAt === null);
    function mergeRecords(incoming: Partial<Pick<HubData, Collection>>, customAreaTypes: CustomAreaType[] = []) {
      // Counted from the data as it is now; the update below applies the same rule.
      const result = { added: 0, updated: 0 };
      const collections = Object.keys(incoming) as Collection[];
      for (const collection of collections) {
        const byId = new Map((data?.[collection] ?? []).map((r) => [r.id, r]));
        for (const r of incoming[collection] ?? []) {
          const have = byId.get(r.id);
          if (!have) result.added += 1;
          else if (r.updatedAt > have.updatedAt) result.updated += 1;
        }
      }
      const merge = <T extends { id: string; updatedAt: string }>(current: T[], next: T[], keep?: (have: T, r: T) => T) => {
        const byId = new Map(current.map((r) => [r.id, r]));
        for (const r of next) {
          const have = byId.get(r.id);
          if (!have) byId.set(r.id, r);
          else if (r.updatedAt > have.updatedAt) byId.set(r.id, keep ? keep(have, r) : r);
        }
        return [...byId.values()];
      };
      update((current) => {
        const next = { ...current };
        for (const collection of collections) {
          const list = merge(
            current[collection] as { id: string; updatedAt: string }[],
            (incoming[collection] ?? []) as { id: string; updatedAt: string }[],
            // This computer's offline tile download stays this computer's.
            collection === 'properties' ? (have, r) => ({ ...r, offline: (have as Property).offline ?? null }) : undefined,
          );
          (next as Record<Collection, unknown>)[collection] = list;
        }
        const knownTypes = new Set(current.settings.customAreaTypes.map((t) => t.id));
        const newTypes = customAreaTypes.filter((t) => !knownTypes.has(t.id));
        if (newTypes.length) {
          next.settings = { ...current.settings, customAreaTypes: [...current.settings.customAreaTypes, ...newTypes] };
        }
        return next;
      });
      return result;
    }

    return {
      loaded: data !== null,
      loadError,
      saveError,
      properties: live(data?.properties),
      markers: live(data?.markers),
      areas: live(data?.areas),
      overlays: live(data?.overlays),
      sections: live(data?.sections),
      plans: live(data?.plans),
      reports: live(data?.reports),
      fieldPins: live(data?.fieldPins),
      settings: data?.settings ?? emptyHubData().settings,
      saveSettings: (settings) => update((current) => ({ ...current, settings })),
      saveProperty: (p) => save('properties', p),
      patchProperty: (id, patch) =>
        update((current) => ({
          ...current,
          properties: current.properties.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: nowIso() } : p)),
        })),
      saveMarker: (m) => save('markers', m),
      saveArea: (a) => save('areas', a),
      saveOverlay: (o) => save('overlays', o),
      saveSection: (s) => save('sections', s),
      savePlan: (p) => save('plans', p),
      saveReport: (r) => save('reports', r),
      patchReport: (id, patch) =>
        update((current) => ({
          ...current,
          reports: current.reports.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r)),
        })),
      saveFieldPin: (p) => save('fieldPins', p),
      mergeFromPhone: (incoming) => mergeRecords({ reports: incoming.reports, fieldPins: incoming.fieldPins }),
      mergeRecords,
      allData: data,
      deleteProperty: (id) => remove('properties', id),
      deleteMarker: (id) => remove('markers', id),
      deleteArea: (id) => remove('areas', id),
      deleteOverlay: (id) => remove('overlays', id),
      deleteSection: (id) => remove('sections', id),
      deletePlan: (id) => remove('plans', id),
      deleteReport: (id) => remove('reports', id),
    };
  }, [data, loadError, saveError, save, remove, update]);

  return <HubDataContext.Provider value={value}>{children}</HubDataContext.Provider>;
}

export function newRecordFields() {
  const at = nowIso();
  return { id: crypto.randomUUID(), createdAt: at, updatedAt: at, deletedAt: null };
}
