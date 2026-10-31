import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'hunting.db';

// Each entry upgrades the schema by one version. Never edit a shipped
// migration; add a new one to the end instead.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE properties (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    boundary_geojson TEXT,
    source TEXT NOT NULL DEFAULT 'drawn',
    parcel_id TEXT,
    owner TEXT,
    acres REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE markers (
    id TEXT PRIMARY KEY NOT NULL,
    property_id TEXT REFERENCES properties(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    notes TEXT,
    good_winds TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE areas (
    id TEXT PRIMARY KEY NOT NULL,
    property_id TEXT REFERENCES properties(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    geojson TEXT NOT NULL,
    acres REAL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE hunts (
    id TEXT PRIMARY KEY NOT NULL,
    stand_id TEXT NOT NULL REFERENCES markers(id),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    weather_json TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE sightings (
    id TEXT PRIMARY KEY NOT NULL,
    hunt_id TEXT NOT NULL REFERENCES hunts(id),
    seen_at TEXT NOT NULL,
    deer_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    antler_points INTEGER,
    lat REAL,
    lng REAL,
    heading_deg REAL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX idx_markers_property ON markers(property_id);
  CREATE INDEX idx_areas_property ON areas(property_id);
  CREATE INDEX idx_hunts_stand ON hunts(stand_id);
  CREATE INDEX idx_sightings_hunt ON sightings(hunt_id);
  `,
];

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}
