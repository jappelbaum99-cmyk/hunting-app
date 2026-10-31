import type { Position } from 'geojson';

export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

// Salem, MO — center of Dent County. Used until the user's location is known.
export const DEFAULT_CENTER: Position = [-91.536, 37.6456];
export const DEFAULT_ZOOM = 11;
