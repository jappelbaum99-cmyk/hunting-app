import type { IconName } from '@/lib/icons';
import type { BuiltInAreaType, BuiltInMarkerType, CustomPinType, MarkerType } from '@/types/models';

interface TypeInfo {
  label: string;
  color: string;
}

interface AreaTypeInfo extends TypeInfo {
  icon: IconName;
  // Deer bed or hide here, so scent drifting in makes a stand Bad.
  scentSensitive: boolean;
}

export const MARKER_TYPES: Record<BuiltInMarkerType, TypeInfo> = {
  stand: { label: 'Stand', color: '#f28c28' },
  blind: { label: 'Blind', color: '#b5792f' },
  platform: { label: 'Platform', color: '#e2b04a' },
  camera: { label: 'Trail camera', color: '#3fa7e0' },
  rub: { label: 'Rub', color: '#c0392b' },
  scrape: { label: 'Scrape', color: '#8e44ad' },
  trail: { label: 'Trail', color: '#d4b04a' },
  water: { label: 'Water', color: '#2e86de' },
  parking: { label: 'Parking', color: '#7f8c8d' },
  other: { label: 'Other', color: '#ecf0f1' },
};

// Built-in area types. Settings can change their color and icon and add more
// types; use areaTypeInfo() in lib/styles.ts rather than reading this directly.
export const AREA_TYPES: Record<BuiltInAreaType, AreaTypeInfo> = {
  food_plot: { label: 'Food plot', color: '#7bd34f', icon: 'wheat', scentSensitive: false },
  bedding: { label: 'Bedding', color: '#c9894a', icon: 'bed', scentSensitive: true },
  sanctuary: { label: 'Sanctuary', color: '#e05252', icon: 'sanctuary', scentSensitive: true },
  timber: { label: 'Timber', color: '#2f8f4e', icon: 'pine', scentSensitive: false },
  water: { label: 'Water', color: '#3987e5', icon: 'water', scentSensitive: false },
  other: { label: 'Other', color: '#c8c8c8', icon: 'pin', scentSensitive: false },
};

export interface PinTypeView {
  id: MarkerType;
  label: string;
  color: string;
  custom: boolean;
  huntingSpot: boolean;
}

// A pin type's name and default color: built-in, or one added in Settings.
// A type this device doesn't know shows as a plain pin.
export function pinTypeInfo(type: MarkerType, custom: CustomPinType[] = []): PinTypeView {
  if (type in MARKER_TYPES) return { id: type, ...MARKER_TYPES[type as BuiltInMarkerType], custom: false, huntingSpot: WIND_MARKER_TYPES.includes(type) };
  const own = custom.find((t) => t.id === type);
  return own
    ? { id: own.id, label: own.label || 'Pin', color: own.color, custom: true, huntingSpot: own.huntingSpot === true }
    : { id: type, label: 'Pin', color: MARKER_TYPES.other.color, custom: true, huntingSpot: false };
}

// Every pin type to offer, built-in first, then ones added in Settings.
export function pinTypeList(custom: CustomPinType[] = []): PinTypeView[] {
  return [
    ...(Object.keys(MARKER_TYPES) as BuiltInMarkerType[]).map((t) => pinTypeInfo(t)),
    ...custom.filter((t) => !t.deletedAt).map((t) => pinTypeInfo(t.id, custom)),
  ];
}

export const PROPERTY_LINE_COLOR = '#ffd400';

// Common food plot plantings, offered as suggestions (any text is fine).
export const FOOD_PLOT_CROPS = [
  'Clover',
  'Alfalfa',
  'Chicory',
  'Brassicas',
  'Turnips',
  'Radishes',
  'Soybeans',
  'Corn',
  'Winter wheat',
  'Cereal rye',
  'Oats',
  'Winter peas',
  'Sorghum',
];

// Food plots, and custom area types named like one ("Clover plot"), get the planting fields.
export function isPlotType(type: string, label: string): boolean {
  return type === 'food_plot' || /plot/i.test(label);
}

// Built-in places to hunt from. They get "good wind" directions, scent cones,
// forecast ratings and hunt logging; custom pin types can opt in too.
export const WIND_MARKER_TYPES: MarkerType[] = ['stand', 'blind', 'platform'];

export function isHuntingSpot(type: MarkerType, custom: CustomPinType[] = []): boolean {
  return WIND_MARKER_TYPES.includes(type) || custom.some((t) => t.id === type && t.huntingSpot);
}
