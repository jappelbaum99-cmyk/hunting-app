import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from 'geojson';

import { areaColor, propertyColor } from '@/lib/styles';
import type { AreaGeometry, HubSettings, MapArea, Property } from '@/types/models';

const SQ_METERS_PER_ACRE = 4046.8564224;

export function isAreaGeometry(geometry: Geometry | null | undefined): geometry is AreaGeometry {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

// Turns clicked vertices into a closed polygon.
export function pointsToPolygon(points: Position[]): Polygon {
  return { type: 'Polygon', coordinates: [[...points, points[0]]] };
}

export function acresOf(geometry: AreaGeometry): number {
  return area(geometry) / SQ_METERS_PER_ACRE;
}

export function formatAcres(acres: number): string {
  return `${acres < 10 ? acres.toFixed(2) : acres.toFixed(1)} ac`;
}

// Bounding box as [west, south, east, north].
export function boundsOf(geometry: AreaGeometry): [number, number, number, number] {
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
  return [minX, minY, maxX, maxY];
}

// Finds which saved property a point falls inside, if any.
export function propertyContaining(properties: Property[], position: Position): Property | null {
  return properties.find((p) => booleanPointInPolygon(position, p.boundary)) ?? null;
}

export function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function areasToFeatures(
  areas: MapArea[],
  selectedId: string | null,
  settings: HubSettings,
): FeatureCollection<AreaGeometry> {
  return {
    type: 'FeatureCollection',
    features: areas.map(
      (a): Feature<AreaGeometry> => ({
        type: 'Feature',
        geometry: a.geometry,
        properties: { id: a.id, name: a.name, color: areaColor(a.type, settings), selected: a.id === selectedId },
      }),
    ),
  };
}

export function propertiesToFeatures(
  properties: Property[],
  selectedId: string | null,
  settings: HubSettings,
): FeatureCollection<AreaGeometry> {
  return {
    type: 'FeatureCollection',
    features: properties.map(
      (p): Feature<AreaGeometry> => ({
        type: 'Feature',
        geometry: p.boundary,
        properties: { id: p.id, name: p.name, color: propertyColor(p, settings), selected: p.id === selectedId },
      }),
    ),
  };
}
