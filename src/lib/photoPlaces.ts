// Where trail camera photos were taken: the area or section (and property)
// they're filed under, rather than only the camera. Worked out from the
// camera's spot at import, and can be changed per photo.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Position } from 'geojson';

import { acresOf } from '@/lib/geo';
import { cameraFolder } from '@/lib/photos';
import type { AreaGeometry, CameraPhoto, MapArea, MapMarker, PhotoPlace, Property, Section } from '@/types/models';

export interface Places {
  properties: Property[];
  sections: Section[];
  areas: MapArea[];
}

export const NO_PLACE: PhotoPlace = { propertyId: null, sectionId: null, areaId: null };

// A point well inside a shape, for finding what it sits in: the middle of its outer ring.
function middleOf(geometry: AreaGeometry): Position {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  const points = ring.slice(0, -1);
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

// The property, section and smallest area a point falls in.
export function placeAt(places: Places, position: Position): PhotoPlace {
  const inside = (g: AreaGeometry) => booleanPointInPolygon(position, g);
  const area = places.areas.filter((a) => inside(a.geometry)).sort((a, b) => acresOf(a.geometry) - acresOf(b.geometry))[0] ?? null;
  const section = places.sections.find((s) => inside(s.geometry)) ?? null;
  const property =
    places.properties.find((p) => p.id === (area?.propertyId ?? section?.propertyId)) ?? places.properties.find((p) => inside(p.boundary)) ?? null;
  return { propertyId: property?.id ?? null, sectionId: section?.id ?? null, areaId: area?.id ?? null };
}

// Where a camera is now.
export function cameraPlace(places: Places, camera: Pick<MapMarker, 'lng' | 'lat'>): PhotoPlace {
  return placeAt(places, [camera.lng, camera.lat]);
}

// A photo's place; photos from before places were kept go by where their camera is now.
export function placeOf(photo: CameraPhoto, places: Places, cameras: MapMarker[]): PhotoPlace {
  if (photo.place) return photo.place;
  const camera = cameras.find((c) => c.id === photo.cameraId);
  return camera ? cameraPlace(places, camera) : NO_PLACE;
}

export function samePlace(a: PhotoPlace, b: PhotoPlace): boolean {
  return a.propertyId === b.propertyId && a.sectionId === b.sectionId && a.areaId === b.areaId;
}

// Keys for the viewer's tree: property, then the section/area inside it.
export function propertyKey(place: PhotoPlace): string {
  return place.propertyId ?? 'none';
}

export function spotKey(place: PhotoPlace): string {
  return `${place.sectionId ?? '-'}/${place.areaId ?? '-'}`;
}

function nameIn<T extends { id: string; name: string }>(list: T[], id: string | null): string | null {
  return id ? (list.find((x) => x.id === id)?.name ?? null) : null;
}

export function propertyName(places: Places, place: PhotoPlace): string {
  return nameIn(places.properties, place.propertyId) ?? 'Not on a property';
}

// The section and area, e.g. "North Ridge › Clover Plot"; null when only the property is known.
export function spotName(places: Places, place: PhotoPlace): string | null {
  const parts = [nameIn(places.sections, place.sectionId), nameIn(places.areas, place.areaId)].filter((n): n is string => !!n);
  return parts.length ? parts.join(' › ') : null;
}

// The whole thing, e.g. "Smith Farm › North Ridge › Clover Plot".
export function placeLabel(places: Places, place: PhotoPlace): string {
  const spot = spotName(places, place);
  return spot ? `${propertyName(places, place)} › ${spot}` : propertyName(places, place);
}

// Every place a photo can be filed under, for picking one by hand.
export function placeChoices(places: Places): { place: PhotoPlace; label: string }[] {
  const choices: PhotoPlace[] = [
    ...places.properties.map((p) => ({ propertyId: p.id, sectionId: null, areaId: null })),
    ...places.sections.map((s) => ({ ...placeAt(places, middleOf(s.geometry)), sectionId: s.id, areaId: null })),
    ...places.areas.map((a) => {
      const around = placeAt(places, middleOf(a.geometry));
      return { propertyId: a.propertyId ?? around.propertyId, sectionId: around.sectionId, areaId: a.id };
    }),
    NO_PLACE,
  ];
  return choices.map((place) => ({ place, label: placeLabel(places, place) })).sort((a, b) => a.label.localeCompare(b.label));
}

export function placeValue(place: PhotoPlace): string {
  return `${place.propertyId ?? ''}|${place.sectionId ?? ''}|${place.areaId ?? ''}`;
}

export function parsePlaceValue(value: string): PhotoPlace {
  const [propertyId, sectionId, areaId] = value.split('|');
  return { propertyId: propertyId || null, sectionId: sectionId || null, areaId: areaId || null };
}

function folderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '') || 'Unnamed';
}

// The library folders for a place and camera:
// <Property>/<Section>/<Area>/<Camera>, skipping what isn't known.
export function placeFolder(places: Places, place: PhotoPlace, camera: Pick<MapMarker, 'name' | 'id'>): string {
  const names = [
    propertyName(places, place),
    nameIn(places.sections, place.sectionId),
    nameIn(places.areas, place.areaId),
  ].filter((n): n is string => !!n);
  return [...names.map(folderName), cameraFolder(camera)].join('/');
}

// Where a photo belongs on disk: its place and camera, then its month (or Empty).
export function expectedPath(photo: CameraPhoto, places: Places, cameras: MapMarker[]): string | null {
  const camera = cameras.find((c) => c.id === photo.cameraId);
  if (!camera) return null;
  const name = photo.file.split('/').pop()!;
  const month = /^\d{4}-\d{2}/.test(name) ? name.slice(0, 7) : photo.takenAt.slice(0, 7);
  return `${placeFolder(places, placeOf(photo, places, cameras), camera)}/${photo.status === 'empty' ? 'Empty' : month}/${name}`;
}
