// Shared data models for the hub (and later the phone site).
// Ids are UUIDs and deletes are soft (deletedAt) so records can sync between devices.
import type { MultiPolygon, Polygon } from 'geojson';

export type AreaGeometry = Polygon | MultiPolygon;

export type CompassPoint = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const COMPASS_POINTS: CompassPoint[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface Syncable {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type PropertySource = 'drawn' | 'imported' | 'parcel';

export interface Property extends Syncable {
  name: string;
  owner: string | null;
  source: PropertySource;
  boundary: AreaGeometry;
  notes: string | null;
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

export interface MapMarker extends Syncable {
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

export interface MapArea extends Syncable {
  propertyId: string | null;
  type: AreaType;
  name: string;
  geometry: AreaGeometry;
  notes: string | null;
}

// A point on an image (pixels from its top-left corner) matched to the same
// spot on the map.
export interface ControlPoint {
  image: [number, number];
  map: [number, number];
}

// A picture of a map (county parcel viewer, plat, survey...) laid over the
// map by matching control points, so property lines can be traced from it.
export interface MapImageOverlay extends Syncable {
  name: string;
  // File name inside Documents\Hunting Hub\images.
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  controlPoints: ControlPoint[];
  opacity: number;
  visible: boolean;
}

export interface HubData {
  schemaVersion: 1;
  properties: Property[];
  markers: MapMarker[];
  areas: MapArea[];
  overlays: MapImageOverlay[];
}

export type Selection =
  | { kind: 'property'; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'area'; id: string }
  | { kind: 'overlay'; id: string };
