// A map file: one property (or the whole map) packed into a single file to
// send to someone else's hub, with its stands, areas, sections, plans, hunts
// and map images. Deleted records ride along so a delete reaches the other hub.
import type {
  CustomAreaType,
  CustomPinType,
  HubData,
  HuntReport,
  MapArea,
  MapImageOverlay,
  MapMarker,
  MapTrail,
  Plan,
  Property,
  Section,
} from '@/types/models';
import { boundsOf } from '@/lib/geo';

export const MAP_FILE_KIND = 'hunting-hub-map';

export interface MapFileRecords {
  properties: Property[];
  markers: MapMarker[];
  areas: MapArea[];
  overlays: MapImageOverlay[];
  sections: Section[];
  plans: Plan[];
  reports: HuntReport[];
  trails: MapTrail[];
}

export interface MapFile {
  kind: typeof MAP_FILE_KIND;
  version: 1;
  exportedAt: string;
  // What was shared, e.g. "Smith Farm" or "Whole map".
  title: string;
  records: MapFileRecords;
  // Custom area types the shared areas use, so they look the same there.
  customAreaTypes: CustomAreaType[];
  // Custom pin types the shared pins use (missing in older files).
  customPinTypes?: CustomPinType[];
  // Map image files by file name, base64.
  images: Record<string, string>;
}

// Map images whose control points sit within this far of the property count as its.
const OVERLAY_MARGIN_DEG = 0.01;

// Picks the records for one property, or everything when propertyId is null.
export function pickRecords(data: HubData, propertyId: string | null): MapFileRecords {
  // Tile downloads stay on this computer; the other hub downloads its own.
  const properties = data.properties.map((p) => ({ ...p, offline: null }));
  if (propertyId === null) {
    return {
      properties,
      markers: data.markers,
      areas: data.areas,
      overlays: data.overlays,
      sections: data.sections,
      plans: data.plans,
      reports: data.reports,
      trails: data.trails,
    };
  }
  const property = properties.find((p) => p.id === propertyId);
  if (!property) throw new Error('That property is gone.');
  const onProperty = <T extends { propertyId: string | null }>(r: T) => r.propertyId === propertyId;
  const sections = data.sections.filter(onProperty);
  const sectionIds = new Set(sections.map((s) => s.id));
  const [west, south, east, north] = boundsOf(property.boundary);
  const near = ([lng, lat]: [number, number]) =>
    lng >= west - OVERLAY_MARGIN_DEG &&
    lng <= east + OVERLAY_MARGIN_DEG &&
    lat >= south - OVERLAY_MARGIN_DEG &&
    lat <= north + OVERLAY_MARGIN_DEG;
  const markers = data.markers.filter(onProperty);
  const markerIds = new Set(markers.map((m) => m.id));
  return {
    properties: [property],
    markers,
    areas: data.areas.filter(onProperty),
    overlays: data.overlays.filter((o) => !o.deletedAt && o.controlPoints.some((c) => near(c.map))),
    sections,
    plans: data.plans.filter((p) => sectionIds.has(p.sectionId)),
    // Hunts at its stands count too, even when the hunt itself wasn't linked.
    reports: data.reports.filter((r) => onProperty(r) || (r.standId !== null && markerIds.has(r.standId))),
    trails: data.trails.filter(onProperty),
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(text);
}

export function base64ToBytes(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

// Only plain image names, the same rule the desktop image handlers use.
const SAFE_IMAGE_NAME = /^[\w-]+\.(png|jpe?g|webp)$/i;

export function parseMapFile(text: string): MapFile {
  let parsed: MapFile;
  try {
    parsed = JSON.parse(text) as MapFile;
  } catch {
    throw new Error("That isn't a Hunting Hub map file.");
  }
  if (parsed?.kind !== MAP_FILE_KIND) throw new Error("That isn't a Hunting Hub map file.");
  if (parsed.version !== 1) throw new Error('That map file is from a newer Hunting Hub. Update this one first.');
  const r = parsed.records ?? ({} as Partial<MapFileRecords>);
  for (const name of Object.keys(parsed.images ?? {})) {
    if (!SAFE_IMAGE_NAME.test(name)) throw new Error(`That map file has a bad image name (${name}).`);
  }
  return {
    ...parsed,
    records: {
      properties: r.properties ?? [],
      markers: r.markers ?? [],
      areas: r.areas ?? [],
      overlays: r.overlays ?? [],
      sections: r.sections ?? [],
      plans: r.plans ?? [],
      reports: r.reports ?? [],
      trails: r.trails ?? [],
    },
    customAreaTypes: parsed.customAreaTypes ?? [],
    customPinTypes: parsed.customPinTypes ?? [],
    images: parsed.images ?? {},
  };
}

export function mapFileName(title: string): string {
  const safe = title.replace(/[^\w\- ]+/g, '').trim() || 'map';
  return `Hunting Hub - ${safe}.json`;
}
