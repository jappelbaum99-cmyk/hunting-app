import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { listAreas, listMarkers, listProperties } from '@/db/repo';
import type { MapArea, MapMarker, Property } from '@/types/models';

interface Data {
  markers: MapMarker[];
  areas: MapArea[];
  properties: Property[];
  loaded: boolean;
  reload: () => Promise<void>;
}

const DataContext = createContext<Data | null>(null);

// Holds everything drawn on the map. Screens write through src/db/repo.ts and
// then call reload() so the map picks up the change.
export function DataProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [m, a, p] = await Promise.all([listMarkers(db), listAreas(db), listProperties(db)]);
    setMarkers(m);
    setAreas(a);
    setProperties(p);
    setLoaded(true);
  }, [db]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <DataContext.Provider value={{ markers, areas, properties, loaded, reload }}>{children}</DataContext.Provider>
  );
}

export function useData(): Data {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData must be used inside DataProvider');
  return data;
}
