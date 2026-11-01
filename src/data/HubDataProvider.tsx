import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { loadHubData, saveHubData } from '@/data/storage';
import type { HubData, MapArea, MapImageOverlay, MapMarker, Plan, Property, Section } from '@/types/models';

const SAVE_DELAY_MS = 400;

type Collection = 'properties' | 'markers' | 'areas' | 'overlays' | 'sections' | 'plans';

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
  saveProperty(property: Property): void;
  saveMarker(marker: MapMarker): void;
  saveArea(area: MapArea): void;
  saveOverlay(overlay: MapImageOverlay): void;
  saveSection(section: Section): void;
  savePlan(plan: Plan): void;
  deleteProperty(id: string): void;
  deleteMarker(id: string): void;
  deleteArea(id: string): void;
  deleteOverlay(id: string): void;
  deleteSection(id: string): void;
  deletePlan(id: string): void;
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
      saveProperty: (p) => save('properties', p),
      saveMarker: (m) => save('markers', m),
      saveArea: (a) => save('areas', a),
      saveOverlay: (o) => save('overlays', o),
      saveSection: (s) => save('sections', s),
      savePlan: (p) => save('plans', p),
      deleteProperty: (id) => remove('properties', id),
      deleteMarker: (id) => remove('markers', id),
      deleteArea: (id) => remove('areas', id),
      deleteOverlay: (id) => remove('overlays', id),
      deleteSection: (id) => remove('sections', id),
      deletePlan: (id) => remove('plans', id),
    };
  }, [data, loadError, saveError, save, remove]);

  return <HubDataContext.Provider value={value}>{children}</HubDataContext.Provider>;
}

export function newRecordFields() {
  const at = nowIso();
  return { id: crypto.randomUUID(), createdAt: at, updatedAt: at, deletedAt: null };
}
