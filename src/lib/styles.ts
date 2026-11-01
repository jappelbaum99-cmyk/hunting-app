// Resolves how things look: an item's own color, else its category's color
// from Settings, else the built-in default.
import { AREA_TYPES, MARKER_TYPES, PROPERTY_LINE_COLOR } from '@/lib/featureTypes';
import type { AreaType, HubSettings, MapMarker, MarkerShape, MarkerStyle, MarkerType, Property } from '@/types/models';

export const DEFAULT_MARKER_SIZE = 16;
export const MIN_MARKER_SIZE = 10;
export const MAX_MARKER_SIZE = 32;

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
    color: custom.color ?? MARKER_TYPES[type].color,
    shape: custom.shape ?? 'circle',
    size: custom.size ?? DEFAULT_MARKER_SIZE,
  };
}

export function markerStyle(marker: MapMarker, settings: HubSettings): MarkerStyle {
  const style = categoryStyle(marker.type, settings);
  return marker.color ? { ...style, color: marker.color } : style;
}

export function areaColor(type: AreaType, settings: HubSettings): string {
  return settings.areaColors[type] ?? AREA_TYPES[type].color;
}

export function propertyColor(property: Property | null, settings: HubSettings): string {
  return property?.color ?? settings.propertyLineColor ?? PROPERTY_LINE_COLOR;
}
