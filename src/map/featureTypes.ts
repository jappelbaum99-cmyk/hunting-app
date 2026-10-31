import type { AreaType, MarkerType } from '@/types/models';

interface TypeInfo {
  label: string;
  color: string;
}

export const MARKER_TYPES: Record<MarkerType, TypeInfo> = {
  stand: { label: 'Stand', color: '#f28c28' },
  blind: { label: 'Blind', color: '#b5792f' },
  camera: { label: 'Trail camera', color: '#3fa7e0' },
  rub: { label: 'Rub', color: '#c0392b' },
  scrape: { label: 'Scrape', color: '#8e44ad' },
  trail: { label: 'Trail', color: '#d4b04a' },
  water: { label: 'Water', color: '#2e86de' },
  parking: { label: 'Parking', color: '#7f8c8d' },
  other: { label: 'Other', color: '#ecf0f1' },
};

export const AREA_TYPES: Record<AreaType, TypeInfo> = {
  food_plot: { label: 'Food plot', color: '#7bd34f' },
  bedding: { label: 'Bedding', color: '#c9894a' },
  sanctuary: { label: 'Sanctuary', color: '#e05252' },
  timber: { label: 'Timber', color: '#2f8f4e' },
  other: { label: 'Other', color: '#c8c8c8' },
};

export const PROPERTY_LINE_COLOR = '#ffd400';

// Types that get "good wind" directions.
export const WIND_MARKER_TYPES: MarkerType[] = ['stand', 'blind'];
