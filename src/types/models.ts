// Shared data models. These mirror the SQLite tables in src/db/database.ts.
// Ids are text (UUIDs) so records can be synced between devices later.

export type CompassPoint = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type PropertySource = 'drawn' | 'imported' | 'parcel';

export interface Property {
  id: string;
  name: string;
  boundaryGeoJson: string | null;
  source: PropertySource;
  parcelId: string | null;
  owner: string | null;
  acres: number | null;
}

export type MarkerType =
  | 'stand'
  | 'blind'
  | 'camera'
  | 'rub'
  | 'scrape'
  | 'trail'
  | 'water'
  | 'parking'
  | 'other';

export interface MapMarker {
  id: string;
  propertyId: string | null;
  type: MarkerType;
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  // Winds a stand can be hunted on, e.g. ['N', 'NW'].
  goodWinds: CompassPoint[];
}

export type AreaType = 'food_plot' | 'bedding' | 'sanctuary' | 'timber' | 'other';

export interface MapArea {
  id: string;
  propertyId: string | null;
  type: AreaType;
  name: string;
  geoJson: string;
  acres: number | null;
  notes: string | null;
}

export interface Hunt {
  id: string;
  standId: string;
  startedAt: string;
  endedAt: string | null;
  weatherJson: string | null;
  notes: string | null;
}

export type DeerType = 'buck' | 'doe' | 'fawn' | 'unknown';

export interface Sighting {
  id: string;
  huntId: string;
  seenAt: string;
  deerType: DeerType;
  count: number;
  antlerPoints: number | null;
  lat: number | null;
  lng: number | null;
  // Direction of travel in degrees (0 = north).
  headingDeg: number | null;
  notes: string | null;
}
