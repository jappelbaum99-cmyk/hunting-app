import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from 'geojson';

import { areaColor, propertyColor } from '@/lib/styles';
import type { AreaGeometry, HubSettings, MapArea, Property, Section } from '@/types/models';

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

// Where a point is, for showing on the phone: the section it's in, else the
// property, else null. E.g. "North Ridge".
export function placeName(properties: Property[], sections: Section[], position: Position): string | null {
  const section = sections.find((s) => booleanPointInPolygon(position, s.geometry));
  return section?.name ?? propertyContaining(properties, position)?.name ?? null;
}

// The point a given distance and compass bearing from another, close enough
// for the few hundred yards around a stand.
export function offsetPosition(lng: number, lat: number, bearingDeg: number, meters: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111_320;
  const dLng = (meters * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

// The closest a line ([lng, lat] points) comes to a spot: meters, and the
// compass bearing from the spot to that closest point. Flat-earth math, which is
// plenty for property-sized distances.
export function closestOnLine(spot: [number, number], line: [number, number][]): { meters: number; bearingDeg: number } | null {
  if (line.length === 0) return null;
  const mPerLng = 111_320 * Math.cos((spot[1] * Math.PI) / 180);
  const xy = (p: [number, number]) => [(p[0] - spot[0]) * mPerLng, (p[1] - spot[1]) * 111_320];
  let best: { meters: number; x: number; y: number } | null = null;
  const consider = (x: number, y: number) => {
    const meters = Math.hypot(x, y);
    if (!best || meters < best.meters) best = { meters, x, y };
  };
  if (line.length === 1) consider(xy(line[0])[0], xy(line[0])[1]);
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]);
    const [bx, by] = xy(line[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Where along this piece the spot is closest, clamped to its ends.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    consider(ax + t * dx, ay + t * dy);
  }
  const b = best as { meters: number; x: number; y: number } | null;
  if (!b) return null;
  return { meters: b.meters, bearingDeg: ((Math.atan2(b.x, b.y) * 180) / Math.PI + 360) % 360 };
}

// Compass bearing (0 = north) and meters from one [lng, lat] point to another.
export function bearingAndMeters(from: [number, number], to: [number, number]): { bearingDeg: number; meters: number } {
  const mPerLng = 111_320 * Math.cos((from[1] * Math.PI) / 180);
  const x = (to[0] - from[0]) * mPerLng;
  const y = (to[1] - from[1]) * 111_320;
  return { bearingDeg: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, meters: Math.hypot(x, y) };
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
