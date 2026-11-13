// The camp map: what the phones draw on their Map tab. Partners' hubs publish
// it on the camp document (the same one hunters already read for pin types and
// plots), packed as text because Firestore can't hold nested arrays. Colors are
// worked out on the hub, so phones don't need its Settings.
import type { Position } from 'geojson';

import { areaColor, markerStyle, propertyColor } from '@/lib/styles';
import { trailStyle } from '@/lib/trails';
import type { AreaGeometry, HubSettings, MapArea, MapMarker, MapTrail, Property, Section } from '@/types/models';

export interface CampMap {
  properties: { id: string; name: string; color: string; boundary: AreaGeometry }[];
  sections: { id: string; name: string; geometry: AreaGeometry }[];
  areas: { id: string; name: string; color: string; geometry: AreaGeometry }[];
  trails: { id: string; name: string; color: string; dashed: boolean; px: number; lines: Position[][] }[];
  pins: { id: string; name: string; type: string; color: string; lat: number; lng: number }[];
}

// A Firestore document holds up to 1 MiB; leave room for the rest of the camp.
export const MAX_CAMP_MAP_CHARS = 800_000;

const live = <T extends { deletedAt: string | null }>(list: T[]) => list.filter((r) => !r.deletedAt);

export function buildCampMap(
  data: { properties: Property[]; sections: Section[]; areas: MapArea[]; trails: MapTrail[]; markers: MapMarker[] },
  settings: HubSettings,
): CampMap {
  return {
    properties: live(data.properties).map((p) => ({ id: p.id, name: p.name, color: propertyColor(p, settings), boundary: p.boundary })),
    sections: live(data.sections).map((s) => ({ id: s.id, name: s.name, geometry: s.geometry })),
    areas: live(data.areas).map((a) => ({ id: a.id, name: a.name, color: areaColor(a.type, settings), geometry: a.geometry })),
    trails: live(data.trails).map((t) => {
      const look = trailStyle(t, settings.trailStyles);
      return { id: t.id, name: t.name, color: look.color, dashed: look.pattern !== 'solid', px: look.px, lines: [t.line.coordinates, ...(t.branches ?? [])] };
    }),
    pins: live(data.markers).map((m) => ({ id: m.id, name: m.name, type: m.type, color: markerStyle(m, settings).color, lat: m.lat, lng: m.lng })),
  };
}

// Text for the camp document. Coordinates are kept to about 10 cm.
export function packCampMap(map: CampMap): string {
  return JSON.stringify(map, (_key, value: unknown) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e6) / 1e6 : value));
}

export function unpackCampMap(text: string | null | undefined): CampMap | null {
  if (!text) return null;
  try {
    const map = JSON.parse(text) as Partial<CampMap>;
    return { properties: map.properties ?? [], sections: map.sections ?? [], areas: map.areas ?? [], trails: map.trails ?? [], pins: map.pins ?? [] };
  } catch {
    return null;
  }
}
