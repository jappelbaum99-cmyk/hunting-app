import { StyleURL } from '@rnmapbox/maps';

export type BasemapId = 'satellite' | 'topo';

export interface Basemap {
  id: BasemapId;
  label: string;
  styleURL: string;
  // Satellite imagery has no contour lines, so we draw them on top.
  showContours: boolean;
}

export const BASEMAPS: Basemap[] = [
  { id: 'satellite', label: 'Satellite', styleURL: StyleURL.SatelliteStreet, showContours: true },
  { id: 'topo', label: 'Topo', styleURL: StyleURL.Outdoors, showContours: false },
];
