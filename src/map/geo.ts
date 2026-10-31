import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Point, Polygon, Position } from 'geojson';

import { AREA_TYPES, MARKER_TYPES } from '@/map/featureTypes';
import type { MapArea, MapMarker, Property } from '@/types/models';

const SQ_METERS_PER_ACRE = 4046.8564224;

export type AreaGeometry = Polygon | MultiPolygon;

export function isAreaGeometry(geometry: Geometry | null | undefined): geometry is AreaGeometry {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

export function parseAreaGeometry(json: string | null): AreaGeometry | null {
  if (!json) return null;
  try {
    const geometry = JSON.parse(json) as Geometry;
    return isAreaGeometry(geometry) ? geometry : null;
  } catch {
    return null;
  }
}

// Turns tapped vertices into a closed polygon.
export function pointsToPolygon(points: Position[]): Polygon {
  return { type: 'Polygon', coordinates: [[...points, points[0]]] };
}

export function acresOf(geometry: AreaGeometry): number {
  return area(geometry) / SQ_METERS_PER_ACRE;
}

export function formatAcres(acres: number | null): string {
  if (acres == null) return '';
  return `${acres < 10 ? acres.toFixed(2) : acres.toFixed(1)} ac`;
}

// Bounding box as [southwest, northeast] corners.
export function boundsOf(geometry: AreaGeometry): [Position, Position] {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

// Finds which saved property a point falls inside, if any.
export function propertyContaining(properties: Property[], position: Position): Property | null {
  for (const property of properties) {
    const boundary = parseAreaGeometry(property.boundaryGeoJson);
    if (boundary && booleanPointInPolygon(position, boundary)) return property;
  }
  return null;
}

export function markersToFeatures(markers: MapMarker[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: { id: m.id, name: m.name, color: MARKER_TYPES[m.type].color, isStand: m.type === 'stand' },
    })),
  };
}

export function areasToFeatures(areas: MapArea[]): FeatureCollection<AreaGeometry> {
  const features: Feature<AreaGeometry>[] = [];
  for (const a of areas) {
    const geometry = parseAreaGeometry(a.geoJson);
    if (!geometry) continue;
    features.push({
      type: 'Feature',
      id: a.id,
      geometry,
      properties: { id: a.id, name: a.name, color: AREA_TYPES[a.type].color },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function propertiesToFeatures(properties: Property[]): FeatureCollection<AreaGeometry> {
  const features: Feature<AreaGeometry>[] = [];
  for (const p of properties) {
    const geometry = parseAreaGeometry(p.boundaryGeoJson);
    if (!geometry) continue;
    features.push({ type: 'Feature', id: p.id, geometry, properties: { id: p.id, name: p.name } });
  }
  return { type: 'FeatureCollection', features };
}
