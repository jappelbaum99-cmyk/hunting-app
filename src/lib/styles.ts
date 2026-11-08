// Resolves how things look: an item's own color, else its category's color
// from Settings, else the built-in default.
import { AREA_TYPES, pinTypeInfo, PROPERTY_LINE_COLOR } from '@/lib/featureTypes';
import { iconName, type IconName } from '@/lib/icons';
import type { AreaType, BuiltInAreaType, HubSettings, LabelKind, MapMarker, MarkerShape, MarkerStyle, MarkerType, OutlineLook, Property } from '@/types/models';

export const DEFAULT_MARKER_SIZE = 16;
export const MIN_MARKER_SIZE = 4;
export const MAX_MARKER_SIZE = 32;

export const LABEL_KINDS: { id: LabelKind; label: string }[] = [
  { id: 'pin', label: 'Stands and pins' },
  { id: 'property', label: 'Properties' },
  { id: 'section', label: 'Sections' },
  { id: 'area', label: 'Areas' },
  { id: 'trail', label: 'Trails' },
  { id: 'hunt', label: 'New hunt spots' },
];

export const MARKER_SHAPES: { id: MarkerShape; label: string }[] = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'pin', label: 'Pin' },
];

// Quick picks for colors; any color can still be chosen with the picker.
export const COLOR_SWATCHES = [
  '#f08a24',
  '#ffd400',
  '#e05252',
  '#c0392b',
  '#8b5a2f',
  '#7bd34f',
  '#2f8f4e',
  '#3fa7e0',
  '#8e44ad',
  '#ecf0f1',
];

export function categoryStyle(type: MarkerType, settings: HubSettings): MarkerStyle {
  const custom = settings.markerStyles[type] ?? {};
  return {
    color: custom.color ?? pinTypeInfo(type, settings.customPinTypes).color,
    shape: custom.shape ?? 'circle',
    size: custom.size ?? DEFAULT_MARKER_SIZE,
  };
}

export function markerStyle(marker: MapMarker, settings: HubSettings): MarkerStyle {
  const style = categoryStyle(marker.type, settings);
  return marker.color ? { ...style, color: marker.color } : style;
}

export interface AreaTypeView {
  id: AreaType;
  label: string;
  color: string;
  icon: IconName;
  scentSensitive: boolean;
  custom: boolean;
}

const BUILT_IN_AREAS = Object.keys(AREA_TYPES) as BuiltInAreaType[];

function isBuiltIn(type: AreaType): type is BuiltInAreaType {
  return (BUILT_IN_AREAS as string[]).includes(type);
}

// How an area type looks right now. Unknown types (e.g. a custom type from
// data made elsewhere) fall back to "Other".
export function areaTypeInfo(type: AreaType, settings: HubSettings): AreaTypeView {
  if (isBuiltIn(type)) {
    const base = AREA_TYPES[type];
    return {
      id: type,
      label: base.label,
      color: settings.areaColors[type] ?? base.color,
      icon: iconName(settings.areaIcons[type] ?? base.icon),
      scentSensitive: base.scentSensitive,
      custom: false,
    };
  }
  const custom = settings.customAreaTypes.find((t) => t.id === type);
  if (!custom) return { ...areaTypeInfo('other', settings), id: type };
  return { id: custom.id, label: custom.label, color: custom.color, icon: iconName(custom.icon), scentSensitive: custom.scentSensitive, custom: true };
}

// Every area type that can be picked: built-ins, then custom types not removed.
export function areaTypeList(settings: HubSettings): AreaTypeView[] {
  return [
    ...BUILT_IN_AREAS.map((t) => areaTypeInfo(t, settings)),
    ...settings.customAreaTypes.filter((t) => !t.deletedAt).map((t) => areaTypeInfo(t.id, settings)),
  ];
}

export function areaColor(type: AreaType, settings: HubSettings): string {
  return areaTypeInfo(type, settings).color;
}

export const OUTLINE_DEFAULTS: Record<'property' | 'section', Required<OutlineLook>> = {
  property: { pattern: 'solid', width: 2.5, fillOpacity: 0.08 },
  section: { pattern: 'dashed', width: 2, fillOpacity: 0.05 },
};

// How property or section outlines look: Settings, else the defaults.
export function outlineLook(kind: 'property' | 'section', settings: HubSettings): Required<OutlineLook> {
  return { ...OUTLINE_DEFAULTS[kind], ...(kind === 'property' ? settings.propertyLook : settings.sectionLook) };
}

// Dash lengths in line widths, as MapLibre takes them ([1, 0] draws solid).
export function dashFor(pattern: OutlineLook['pattern'], kind: 'property' | 'section'): number[] {
  if (pattern === 'dashed') return kind === 'section' ? [4, 2] : [3, 2];
  if (pattern === 'dotted') return [0.01, 2];
  return [1, 0];
}

export function propertyColor(property: Property | null, settings: HubSettings): string {
  return property?.color ?? settings.propertyLineColor ?? PROPERTY_LINE_COLOR;
}
