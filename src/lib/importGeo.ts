import { gpx, kml } from '@tmcw/togeojson';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';

import { isAreaGeometry } from '@/lib/geo';
import type { AreaGeometry } from '@/types/models';

export interface ImportedShape {
  name: string | null;
  owner: string | null;
  geometry: AreaGeometry;
}

export interface ImportedPoint {
  name: string | null;
  position: Position;
}

export interface ImportResult {
  shapes: ImportedShape[];
  points: ImportedPoint[];
}

export const IMPORT_ACCEPT = '.kml,.gpx,.geojson,.json';

// Reads a KML, GPX or GeoJSON file (e.g. exported from Google Earth, onX or a
// county GIS site) and pulls out polygons and waypoints. Lines are skipped.
export async function importGeoFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  let collection: FeatureCollection<Geometry | null>;
  if (extension === 'kml' || extension === 'gpx') {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    collection = extension === 'kml' ? kml(doc) : gpx(doc);
  } else if (extension === 'geojson' || extension === 'json') {
    collection = toFeatureCollection(JSON.parse(text));
  } else {
    throw new Error(`Unsupported file type ".${extension}". Use ${IMPORT_ACCEPT.replaceAll(',', ', ')}.`);
  }

  const result: ImportResult = { shapes: [], points: [] };
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (isAreaGeometry(geometry)) {
      result.shapes.push({ name: pick(feature.properties, NAME_KEYS), owner: pick(feature.properties, OWNER_KEYS), geometry });
    } else if (geometry?.type === 'Point') {
      result.points.push({ name: pick(feature.properties, NAME_KEYS), position: geometry.coordinates });
    }
  }
  return result;
}

function toFeatureCollection(json: unknown): FeatureCollection<Geometry | null> {
  const value = json as { type?: string };
  if (value?.type === 'FeatureCollection') return json as FeatureCollection<Geometry | null>;
  if (value?.type === 'Feature') return { type: 'FeatureCollection', features: [json as Feature<Geometry | null>] };
  if (value?.type) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: json as Geometry, properties: {} }] };
  }
  throw new Error('This file is not valid GeoJSON.');
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'label'];
const OWNER_KEYS = ['owner', 'Owner', 'OWNER', 'owner_name', 'OWNER_NAME', 'OWNNAME', 'ownername'];

function pick(properties: GeoJsonProperties, keys: string[]): string | null {
  if (!properties) return null;
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
