import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '@/lib/ids';
import type {
  AreaType,
  CompassPoint,
  MapArea,
  MapMarker,
  MarkerType,
  Property,
  PropertySource,
} from '@/types/models';

// Records are soft-deleted (deleted_at set) so hunt history that points at a
// deleted stand stays intact, and so deletes can be synced later.

interface MarkerRow {
  id: string;
  property_id: string | null;
  type: string;
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  good_winds: string;
}

function toMarker(row: MarkerRow): MapMarker {
  return {
    id: row.id,
    propertyId: row.property_id,
    type: row.type as MarkerType,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    notes: row.notes,
    goodWinds: JSON.parse(row.good_winds) as CompassPoint[],
  };
}

export async function listMarkers(db: SQLiteDatabase): Promise<MapMarker[]> {
  const rows = await db.getAllAsync<MarkerRow>(
    `SELECT id, property_id, type, name, lat, lng, notes, good_winds
     FROM markers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  return rows.map(toMarker);
}

export async function saveMarker(db: SQLiteDatabase, marker: MapMarker): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO markers (id, property_id, type, name, lat, lng, notes, good_winds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       property_id = excluded.property_id, type = excluded.type, name = excluded.name,
       lat = excluded.lat, lng = excluded.lng, notes = excluded.notes,
       good_winds = excluded.good_winds, updated_at = excluded.updated_at`,
    marker.id,
    marker.propertyId,
    marker.type,
    marker.name,
    marker.lat,
    marker.lng,
    marker.notes,
    JSON.stringify(marker.goodWinds),
    now,
    now,
  );
}

export async function deleteMarker(db: SQLiteDatabase, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE markers SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
}

interface AreaRow {
  id: string;
  property_id: string | null;
  type: string;
  name: string;
  geojson: string;
  acres: number | null;
  notes: string | null;
}

function toArea(row: AreaRow): MapArea {
  return {
    id: row.id,
    propertyId: row.property_id,
    type: row.type as AreaType,
    name: row.name,
    geoJson: row.geojson,
    acres: row.acres,
    notes: row.notes,
  };
}

export async function listAreas(db: SQLiteDatabase): Promise<MapArea[]> {
  const rows = await db.getAllAsync<AreaRow>(
    `SELECT id, property_id, type, name, geojson, acres, notes
     FROM areas WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  return rows.map(toArea);
}

export async function saveArea(db: SQLiteDatabase, area: MapArea): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO areas (id, property_id, type, name, geojson, acres, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       property_id = excluded.property_id, type = excluded.type, name = excluded.name,
       geojson = excluded.geojson, acres = excluded.acres, notes = excluded.notes,
       updated_at = excluded.updated_at`,
    area.id,
    area.propertyId,
    area.type,
    area.name,
    area.geoJson,
    area.acres,
    area.notes,
    now,
    now,
  );
}

export async function deleteArea(db: SQLiteDatabase, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE areas SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
}

interface PropertyRow {
  id: string;
  name: string;
  boundary_geojson: string | null;
  source: string;
  parcel_id: string | null;
  owner: string | null;
  acres: number | null;
}

function toProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    name: row.name,
    boundaryGeoJson: row.boundary_geojson,
    source: row.source as PropertySource,
    parcelId: row.parcel_id,
    owner: row.owner,
    acres: row.acres,
  };
}

export async function listProperties(db: SQLiteDatabase): Promise<Property[]> {
  const rows = await db.getAllAsync<PropertyRow>(
    `SELECT id, name, boundary_geojson, source, parcel_id, owner, acres
     FROM properties WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  return rows.map(toProperty);
}

export async function saveProperty(db: SQLiteDatabase, property: Property): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO properties (id, name, boundary_geojson, source, parcel_id, owner, acres, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, boundary_geojson = excluded.boundary_geojson, source = excluded.source,
       parcel_id = excluded.parcel_id, owner = excluded.owner, acres = excluded.acres,
       updated_at = excluded.updated_at`,
    property.id,
    property.name,
    property.boundaryGeoJson,
    property.source,
    property.parcelId,
    property.owner,
    property.acres,
    now,
    now,
  );
}

export async function deleteProperty(db: SQLiteDatabase, id: string): Promise<void> {
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    // Stands and areas stay; they just stop belonging to the property.
    await db.runAsync('UPDATE markers SET property_id = NULL, updated_at = ? WHERE property_id = ?', now, id);
    await db.runAsync('UPDATE areas SET property_id = NULL, updated_at = ? WHERE property_id = ?', now, id);
    await db.runAsync('UPDATE properties SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  });
}
