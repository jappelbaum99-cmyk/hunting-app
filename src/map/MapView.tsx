import 'maplibre-gl/dist/maplibre-gl.css';
import { iconSvg, type IconName } from '@/lib/icons';

import type { FeatureCollection, LineString, MultiLineString, Polygon, Position } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, ImageSource, RasterTileSource } from 'maplibre-gl';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';

import { Compass } from '@/components/Compass';
import type { StandRating } from '@/lib/standRating';
import { areasToFeatures, boundsOf, propertiesToFeatures } from '@/lib/geo';
import { findSnap, type Snap } from '@/lib/snap';
import { areaTypeInfo, dashFor, LABEL_KINDS, markerStyle, outlineLook, propertyColor } from '@/lib/styles';
import {
  buildBaseStyle,
  contourTiles,
  DEFAULT_LAYERS,
  LAYER_IDS,
  lidarStyleTiles,
  retryFailedTiles,
  setUpMapLibre,
  type MapLayersState,
} from '@/map/layers';
import { lineMidpoint, trailParts, trailStyle, unpackPoints } from '@/lib/trails';
import { declutterLabels } from '@/map/labelCollisions';
import type { AreaGeometry, DeerKind, FieldTrack, HubSettings, MapArea, MapMarker, MapTrail, Property, Section, Selection } from '@/types/models';

export const DEFAULT_CENTER: [number, number] = [-91.536, 37.6456]; // Salem, MO
const DEFAULT_ZOOM = 12;
const CAMERA_KEY = 'hunting-hub-camera';
// Panels float over the map, so zooming centres things in the space between
// them. Each inset is a panel's width plus its gaps (see styles.css): the
// sidebar on the left (--sidebar-width), and on the right the detail panel
// (--detail-width), which is open whenever we zoom to a selection.
const SIDEBAR_INSET = 300 + 24;
export const DETAIL_PANEL_INSET = 340 + 24;
const FIT_MARGIN = 60;

export interface MapViewHandle {
  // rightInset: width of whatever panel covers the right side of the map.
  fitTo(geometry: AreaGeometry, rightInset?: number): void;
  flyTo(lng: number, lat: number): void;
  // What's on screen now, [w, s, e, n].
  getBounds(): [number, number, number, number] | null;
}

export type MapInteraction = 'browse' | 'place' | 'draw' | 'align' | 'edit';

// A map image ready to draw: corners are top-left, top-right, bottom-right, bottom-left.
export interface OverlayView {
  id: string;
  url: string;
  corners: [[number, number], [number, number], [number, number], [number, number]];
  opacity: number;
}

// A deer sighting ready to draw.
export interface SightingView {
  reportId: string;
  id: string;
  lng: number;
  lat: number;
  // Travel direction, 0 = north; null = not moving.
  headingDeg: number | null;
  kind: DeerKind;
  color: string;
  // Animals other than deer carry their icon, since they share one color.
  icon?: IconName;
  // Where it went ([lng, lat]): drawn as a line with an arrow from where it was seen.
  wentTo?: [number, number];
}

// A map-side control point while lining up an image.
export interface AlignMarker {
  index: number;
  position: [number, number];
}

export interface HuntSpotView {
  id: string;
  at: [number, number];
  name: string;
  hunts: number;
  // The newest hunt there, opened on click.
  reportId: string;
}

interface MapViewProps {
  ref?: Ref<MapViewHandle>;
  layers: MapLayersState;
  properties: Property[];
  areas: MapArea[];
  markers: MapMarker[];
  sections: Section[];
  trails: MapTrail[];
  // Walks from phones waiting in the inbox, drawn faintly until added.
  fieldTracks: FieldTrack[];
  settings: HubSettings;
  // Outlines that drawing snaps onto, and how close (screen pixels) counts; 0 = off.
  snapRings: Position[][];
  snapPx: number;
  overlays: OverlayView[];
  alignMarkers: AlignMarker[];
  // Stand id -> forecast rating, while the Hunt Forecast is open.
  standRatings: Record<string, StandRating> | null;
  // The one pin that can be dragged right now, if any.
  unlockedPinId: string | null;
  // Downwind scent wedges for rated stands.
  scentCones: { id: string; rating: StandRating; cone: Polygon }[];
  // Deer seen in hunt reports.
  sightings: SightingView[];
  // New spots hunted from that aren't stands; clicking opens the latest hunt there.
  huntSpots: HuntSpotView[];
  // Shown as an arrow on the compass when known.
  windFromDeg: number | null;
  // Where thermals carry scent from stands with a cone: stand outward, [lng, lat].
  thermalPaths: { id: string; phase: 'falling' | 'rising' | 'switching'; ends: 'pools' | 'ridge' | 'open' | null; pull: number; points: [number, number][] }[];
  // Testing a stand spot (Hunt Forecast): the spot, and the way deer come and go.
  standTest: { spot: [number, number] | null; route: [number, number][] } | null;
  selection: Selection | null;
  interaction: MapInteraction;
  draftPoints: Position[];
  draftColor: string;
  // Drawing a line (trail) rather than a closed shape.
  draftLine: boolean;
  // A shape being reshaped: its rings (corners, not repeating the first), or null.
  editShape: { rings: Position[][]; closed: boolean; color: string } | null;
  // A drag, add or remove is starting (so it can be undone), then the new corners.
  onEditBegin(): void;
  onEditRings(rings: Position[][]): void;
  // Trails under a click while a shape is being reshaped.
  onEditClickTrails(ids: string[]): void;
  // A second trail shown selected while choosing to join it.
  joiningTrailId: string | null;
  onMapClick(position: Position): void;
  onSelect(selection: Selection | null): void;
  onMarkerMoved(id: string, position: Position): void;
  onAlignMarkerMoved(index: number, position: [number, number]): void;
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function loadCamera(): { center: [number, number]; zoom: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? 'null');
    if (Array.isArray(saved?.center) && typeof saved?.zoom === 'number') return saved;
  } catch {
    // Fall through to the default view.
  }
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

function saveCamera(map: maplibregl.Map): void {
  try {
    const { lng, lat } = map.getCenter();
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ center: [lng, lat], zoom: map.getZoom() }));
  } catch {
    // Remembering the view is only a convenience.
  }
}

function addFeatureLayers(map: maplibregl.Map): void {
  map.addSource('properties', { type: 'geojson', data: EMPTY });
  map.addSource('areas', { type: 'geojson', data: EMPTY });
  map.addSource('edit', { type: 'geojson', data: EMPTY });
  map.addSource('draft', { type: 'geojson', data: EMPTY });
  map.addSource('scent', { type: 'geojson', data: EMPTY });
  map.addSource('sections', { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'property-fill',
    type: 'fill',
    source: 'properties',
    // A light see-through tint. Not clickable: properties are picked from the
    // sidebar, so clicks inside one reach the stands and areas on it.
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.16, 0.08] },
  });
  map.addLayer({
    id: 'property-casing',
    type: 'line',
    source: 'properties',
    paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.5 },
  });
  map.addLayer({
    id: 'property-line',
    type: 'line',
    source: 'properties',
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 3.5, 2.5] },
  });
  // Management sections: under areas, so a food plot inside a section stays clickable.
  map.addLayer({
    id: 'section-fill',
    type: 'fill',
    source: 'sections',
    paint: { 'fill-color': '#f7efe6', 'fill-opacity': ['case', ['get', 'selected'], 0.16, 0.05] },
  });
  map.addLayer({
    id: 'section-line',
    type: 'line',
    source: 'sections',
    paint: {
      'line-color': ['case', ['get', 'selected'], '#f08a24', '#f7efe6'],
      'line-width': ['case', ['get', 'selected'], 3, 2],
      'line-dasharray': [4, 2],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'area-fill',
    type: 'fill',
    source: 'areas',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.5, 0.3] },
  });
  map.addLayer({
    id: 'area-line',
    type: 'line',
    source: 'areas',
    paint: { 'line-color': ['case', ['get', 'selected'], '#ffffff', ['get', 'color']], 'line-width': 2 },
  });
  // Trails: a dark casing under each line so it reads on satellite, then the
  // line itself (dashed for deer trails and fence lines). Phone walks still in
  // the inbox are faint dotted lines.
  map.addSource('field-tracks', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'field-track-line',
    type: 'line',
    source: 'field-tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#f7efe6', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [0.5, 2] },
  });
  map.addSource('trails', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'trail-casing',
    type: 'line',
    source: 'trails',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    // With the outline off it's see-through, not removed: it's also what clicks land on.
    paint: {
      'line-color': ['case', ['get', 'selected'], '#ffffff', 'rgba(20, 12, 6, 0.7)'],
      'line-width': ['+', ['get', 'width'], ['case', ['get', 'selected'], 5, 3]],
      'line-opacity': ['case', ['any', ['get', 'selected'], ['get', 'outline']], 1, 0],
    },
  });
  // A pattern can't vary line by line within a layer, so each has its own.
  map.addLayer({
    id: 'trail-line',
    type: 'line',
    source: 'trails',
    filter: ['==', ['get', 'pattern'], 'solid'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
  });
  map.addLayer({
    id: 'trail-line-dashed',
    type: 'line',
    source: 'trails',
    filter: ['==', ['get', 'pattern'], 'dashed'],
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [2, 1.5] },
  });
  map.addLayer({
    id: 'trail-line-dotted',
    type: 'line',
    source: 'trails',
    filter: ['==', ['get', 'pattern'], 'dotted'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [0.01, 2] },
  });
  // Scent cones sit over areas, so you can see one drifting into bedding.
  // Each cone is three stacked wedges (full, two-thirds and one-third width),
  // so it's darkest down the middle and fades out to the edges.
  map.addLayer({
    id: 'scent-fill',
    type: 'fill',
    source: 'scent',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': CONE_LAYER_OPACITY, 'fill-antialias': true },
  });
  // Thermal scent paths: a wide soft glow with a fainter core, so it reads as
  // air drifting over the ground rather than a hard line.
  map.addSource('thermal', { type: 'geojson', data: EMPTY });
  // The spread: stacked bands, each narrower, so it's strongest down the
  // middle and fades softly to its edges, like the cones.
  map.addLayer({
    id: 'thermal-spread',
    type: 'fill',
    source: 'thermal',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': THERMAL_BAND_OPACITY, 'fill-antialias': true },
  });
  map.addLayer({
    id: 'thermal-pool',
    type: 'circle',
    source: 'thermal',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.32,
      'circle-blur': 0.9,
      'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 13, 6, 17, 60],
    },
  });
  map.addLayer({
    id: 'thermal-core',
    type: 'line',
    source: 'thermal',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 17, 2.5], 'line-blur': 0.8 },
  });
  // Testing a stand spot: the deer's way (hollow dot where they come from,
  // filled where they go) and the spot itself.
  map.addSource('stand-test', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'stand-test-route-casing',
    type: 'line',
    source: 'stand-test',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': 'rgba(20, 12, 6, 0.75)', 'line-width': 6 },
  });
  map.addLayer({
    id: 'stand-test-route',
    type: 'line',
    source: 'stand-test',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': STAND_TEST_DEER, 'line-width': 3, 'line-dasharray': [2, 1.2] },
  });
  map.addLayer({
    id: 'stand-test-points',
    type: 'circle',
    source: 'stand-test',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'spot', 8, 6],
      'circle-color': ['match', ['get', 'kind'], 'spot', '#f08a24', 'from', 'rgba(0, 0, 0, 0)', STAND_TEST_DEER],
      'circle-stroke-color': ['match', ['get', 'kind'], 'spot', '#ffffff', STAND_TEST_DEER],
      'circle-stroke-width': ['match', ['get', 'kind'], 'from', 3, 2],
    },
  });
  // Animals from hunt reports. A moving animal is a pill pointing the way it
  // went (chevron at the front), in its kind's color; one that wasn't moving
  // is a dot. Pill images are drawn per kind on a canvas below.
  map.addSource('sightings', { type: 'geojson', data: EMPTY });
  // Where each animal came in and went: a line under its pill, an arrow at the end.
  map.addSource('sighting-paths', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'sighting-path-casing',
    type: 'line',
    source: 'sighting-paths',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#1c130d', 'line-width': 5, 'line-opacity': 0.55 },
  });
  map.addLayer({
    id: 'sighting-path',
    type: 'line',
    source: 'sighting-paths',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#f7efe6', 'line-width': 2.5, 'line-opacity': 0.9 },
  });
  map.addImage('sighting-arrow', arrowImage(), { pixelRatio: 2 });
  map.addLayer({
    id: 'sighting-path-arrow',
    type: 'symbol',
    source: 'sighting-paths',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'icon-image': 'sighting-arrow',
      'icon-size': 1.4,
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: 'sighting-pills-still',
    type: 'symbol',
    source: 'sightings',
    filter: ['!', ['has', 'heading']],
    layout: {
      'icon-image': ['get', 'pill'],
      'icon-size': PILL_SIZE_BY_ZOOM,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: 'sighting-pills',
    type: 'symbol',
    source: 'sightings',
    filter: ['has', 'heading'],
    layout: {
      'icon-image': ['get', 'pill'],
      'icon-size': PILL_SIZE_BY_ZOOM,
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  // Turkey, bear and other pills share a color, so their icon rides on top, kept upright.
  map.addLayer({
    id: 'sighting-pill-icons',
    type: 'symbol',
    source: 'sightings',
    filter: ['has', 'icon'],
    layout: {
      'icon-image': ['concat', 'animal-ink-', ['get', 'icon']],
      'icon-size': PILL_SIZE_BY_ZOOM,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  for (const icon of ANIMAL_ICONS) {
    void iconImage(icon, 22, '#1c130d').then((image) => {
      if (!map.hasImage(`animal-ink-${icon}`)) map.addImage(`animal-ink-${icon}`, image, { pixelRatio: 2 });
    });
  }

  // Wind streaks flowing downwind inside each cone (moved by the animation in
  // MapView): soft, blurred lines that fade in, drift with a gentle sway and
  // fade out, brighter at the head so the direction reads without arrows.
  map.addSource('scent-arrows', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'scent-arrows',
    type: 'line',
    source: 'scent-arrows',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-opacity': ['get', 'opacity'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, ['*', 1.6, ['get', 'weight']], 17, ['*', 3, ['get', 'weight']]],
      'line-blur': 1.2,
    },
  });
  map.addLayer({
    id: 'edit-fill',
    type: 'fill',
    source: 'edit',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 },
  });
  map.addLayer({
    id: 'edit-line',
    type: 'line',
    source: 'edit',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
  });
  map.addLayer({
    id: 'draft-fill',
    type: 'fill',
    source: 'draft',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 },
  });
  map.addLayer({
    id: 'draft-line',
    type: 'line',
    source: 'draft',
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1] },
  });
  map.addLayer({
    id: 'draft-vertex',
    type: 'circle',
    source: 'draft',
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'snap']]],
    paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'draft-snap',
    type: 'circle',
    source: 'draft',
    filter: ['has', 'snap'],
    paint: {
      // Bigger ring on a corner, smaller on a straight edge.
      'circle-radius': ['case', ['==', ['get', 'snap'], 'vertex'], 9, 6],
      'circle-color': 'rgba(240, 138, 36, 0.25)',
      'circle-stroke-color': '#f08a24',
      'circle-stroke-width': 2.5,
    },
  });
}

// A solid arrow pointing up (north), white so it can be tinted (sdf icon).
const ANIMAL_ICONS: IconName[] = ['turkey', 'bear', 'binoculars'];

// One of the app's SVG icons as an image, in the given ink.
async function iconBitmap(icon: IconName, size: number, ink: string): Promise<HTMLImageElement> {
  const svg = iconSvg(icon, size)
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('stroke="currentColor"', `stroke="${ink}"`)
    .replace(/fill="currentColor"/g, `fill="${ink}"`);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

async function iconImage(icon: IconName, size: number, ink: string): Promise<ImageData> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(await iconBitmap(icon, size, ink), 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

// A pill pointing up (north), with a chevron at its front end when the animal
// was moving; the layer turns it to face the way it went. A cream outline keeps
// dark browns visible on the map. Drawn at 2x for sharp edges.
// Animal pills grow as you zoom in: small over the whole property, full size up close.
const PILL_SIZE_BY_ZOOM: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 12, 0.22, 15, 0.38, 17, 0.6, 19, 0.85];

// The map image for a pill of this color, made the first time it's needed
// (named by its color, so a color change always gets a fresh image).
function pillName(map: maplibregl.Map, color: string, moving: boolean): string {
  const name = `pill-${moving ? 'moving' : 'still'}-${color.replace('#', '')}`;
  if (!map.hasImage(name)) map.addImage(name, pillImage(color, moving), { pixelRatio: 2 });
  return name;
}

// The arrowhead at the end of a sighting's line, pointing up (north) before rotating.
function arrowImage(): ImageData {
  const size = 26;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(size / 2, 3);
  ctx.lineTo(size - 5, size - 5);
  ctx.lineTo(size / 2, size - 10);
  ctx.lineTo(5, size - 5);
  ctx.closePath();
  ctx.fillStyle = '#f7efe6';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1c130d';
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// Compass bearing (0 = north) from one [lng, lat] to another.
function bearingBetween(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toRad) * Math.cos(b[1] * toRad);
  const x = Math.cos(a[1] * toRad) * Math.sin(b[1] * toRad) - Math.sin(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.cos((b[0] - a[0]) * toRad);
  return ((Math.atan2(y, x) / toRad) + 360) % 360;
}

function pillImage(color: string, moving: boolean): ImageData {
  const w = 30;
  const h = 64;
  const pad = 3;
  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const ctx = canvas.getContext('2d')!;
  const r = w / 2;
  ctx.translate(pad, pad);
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.arc(r, r, r, Math.PI, 0);
  ctx.lineTo(w, h - r);
  ctx.arc(r, h - r, r, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f7efe6';
  ctx.stroke();
  if (!moving) return ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Chevron near the front.
  ctx.beginPath();
  ctx.moveTo(r - 8, 19);
  ctx.lineTo(r, 11);
  ctx.lineTo(r + 8, 19);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Scent cone colors, matching the stand's rating: green good, yellow maybe,
// red bad (wrong wind, or scent into bedding), gray when no winds are set.
const CONE_COLORS: Record<StandRating, string> = { good: '#34c759', ok: '#ffcc00', bad: '#ff453a', unset: '#8e8e93' };
// The wind streaks inside: a pale tint of the same color, so they read as light moving over it.
const STREAK_COLORS: Record<StandRating, string> = { good: '#dcf8e3', ok: '#fff4c2', bad: '#ffd6d2', unset: '#ececf0' };

function coneColor(rating: StandRating): string {
  return CONE_COLORS[rating];
}

// Each cone is drawn as thin stacked layers, widest and longest first. Every
// layer has the same low opacity, so the shading deepens smoothly toward the
// middle and fades softly at the sides and far end, with no hard steps.
const CONE_BANDS = Array.from({ length: 9 }, (_, i) => ({ width: 1 - i * 0.105, length: 1 - i * 0.045 }));
const CONE_LAYER_OPACITY = 0.055;

// The same cone, narrowed around its middle and shortened (1 = unchanged).
function narrowCone(cone: Polygon, factor: number, lengthFactor = 1): Polygon {
  if (factor === 1 && lengthFactor === 1) return cone;
  const ring = cone.coordinates[0];
  const origin = ring[0];
  const cosLat = Math.cos((origin[1] * Math.PI) / 180);
  const arc = ring.slice(1, -1).map((p) => {
    const x = (p[0] - origin[0]) * cosLat;
    const y = p[1] - origin[1];
    return { bearing: Math.atan2(x, y), dist: Math.hypot(x, y) };
  });
  const mid = arc[Math.floor(arc.length / 2)].bearing;
  const narrowed = arc.map(({ bearing, dist }) => {
    let delta = bearing - mid;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const b = mid + delta * factor;
    const d = dist * lengthFactor;
    return [origin[0] + (Math.sin(b) * d) / cosLat, origin[1] + Math.cos(b) * d];
  });
  return { type: 'Polygon', coordinates: [[origin, ...narrowed, origin]] };
}

// Where the drifting arrows are at time `now`: a few lanes across each cone,
// each with arrows staggered along it, moving from the stand out to the tip.
// Wind streaks in each cone: where across the cone each one runs (-1 left
// edge, 1 right), and how far along its trip it starts, so they don't move in step.
const STREAKS = [
  { lane: -0.62, offset: 0.0 },
  { lane: 0.08, offset: 0.13 },
  { lane: 0.55, offset: 0.27 },
  { lane: -0.3, offset: 0.41 },
  { lane: 0.32, offset: 0.58 },
  { lane: -0.05, offset: 0.72 },
  { lane: 0.7, offset: 0.86 },
];
// One trip from near the stand to the far end of the cone.
const STREAK_PERIOD_MS = 5200;
// A streak's length, as a share of the cone's length.
const STREAK_LENGTH = 0.16;
// How far a streak sways side to side, as a share of the cone's width there.
const STREAK_SWAY = 0.1;
// Tail to head: each piece a bit brighter and thicker, so streaks taper.
const STREAK_PIECES = [
  { from: 0, to: 0.4, opacity: 0.25, weight: 0.7 },
  { from: 0.35, to: 0.75, opacity: 0.55, weight: 0.9 },
  { from: 0.7, to: 1, opacity: 0.9, weight: 1 },
];

// Thermal paths: cool violet when falling (downhill), warm violet when rising.
// Easy to tell apart on any ground: cool blue as air sinks, warm amber as it rises.
const THERMAL_COLORS = { falling: '#4fb3ff', rising: '#ffb347', switching: '#c8c8d8' } as const;
const THERMAL_STREAK_COLOR = '#f1ecff';
const THERMAL_STREAKS = 3;
const THERMAL_PERIOD_MS = 7000;
// A streak's length as a share of the path.
const THERMAL_STREAK_LENGTH = 0.14;

type ThermalPathView = MapViewProps['thermalPaths'][number];

// The spread around a thermal path: how much wider it gets per meter it
// travels (each side), more when thermals only weakly steer the scent.
const spreadRate = (pull: number) => 0.1 + 0.3 * (1 - Math.max(0, Math.min(1, pull)));
// Stacked bands as shares of the full spread, and each one's opacity.
const THERMAL_BANDS = [1, 0.66, 0.33];
const THERMAL_BAND_OPACITY = 0.12;

// A band around the path that widens with distance: `rate` meters each side
// per meter along, plus a little at the stand. Null for too short a path.
function thermalBand(points: [number, number][], rate: number, factor: number): Polygon | null {
  if (points.length < 2) return null;
  const lat0 = points[0][1];
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mPerLat = 110_540;
  const xy = points.map(([lng, lat]) => [(lng - points[0][0]) * mPerLng, (lat - lat0) * mPerLat]);
  const left: Position[] = [];
  const right: Position[] = [];
  let along = 0;
  for (let i = 0; i < xy.length; i++) {
    if (i > 0) along += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    const a = xy[Math.max(0, i - 1)];
    const b = xy[Math.min(xy.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Square to the path.
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const half = 3 * factor + along * rate;
    left.push([points[0][0] + (xy[i][0] + nx * half) / mPerLng, lat0 + (xy[i][1] + ny * half) / mPerLat]);
    right.push([points[0][0] + (xy[i][0] - nx * half) / mPerLng, lat0 + (xy[i][1] - ny * half) / mPerLat]);
  }
  if (along < 1) return null;
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

// Streaks gliding along each thermal path, the same soft style as the cones.
function thermalStreakFeatures(paths: ThermalPathView[], now: number | null): FeatureCollection['features'] {
  const features: FeatureCollection['features'] = [];
  for (const path of paths) {
    const pts = path.points;
    if (pts.length < 2) continue;
    const cosLat = Math.cos((pts[0][1] * Math.PI) / 180);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * cosLat, pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total === 0) continue;
    // The point a share t (0-1) of the way along the path.
    const at = (t: number): Position => {
      const d = Math.max(0, Math.min(1, t)) * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const span = cum[i] - cum[i - 1] || 1;
      const k = (d - cum[i - 1]) / span;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    };
    for (let n = 0; n < THERMAL_STREAKS; n++) {
      const progress = now === null ? (n + 0.5) / THERMAL_STREAKS : (now / THERMAL_PERIOD_MS + n / THERMAL_STREAKS) % 1;
      const head = 0.06 + progress * 0.94;
      const tail = head - THERMAL_STREAK_LENGTH;
      const fade = now === null ? 0.6 : Math.sin(progress * Math.PI);
      if (fade <= 0.02 || tail <= 0) continue;
      for (const piece of STREAK_PIECES) {
        const coords: Position[] = [];
        for (let k = 0; k <= 4; k++) coords.push(at(tail + (head - tail) * (piece.from + ((piece.to - piece.from) * k) / 4)));
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { opacity: piece.opacity * fade * 0.9, weight: piece.weight, color: THERMAL_STREAK_COLOR } });
      }
    }
  }
  return features;
}

function scentArrowFeatures(cones: { cone: Polygon; rating: StandRating }[], now: number | null): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const { cone, rating } of cones) {
    const ring = cone.coordinates[0];
    const origin = ring[0];
    // Ring is: origin, arc points (left to right), origin.
    const arc = ring.slice(1, -1);
    if (arc.length < 3) continue;
    const cosLat = Math.cos((origin[1] * Math.PI) / 180);
    // Work in flat x/y (x squeezed by latitude) so sway is the same both ways.
    const toXY = (p: Position) => [(p[0] - origin[0]) * cosLat, p[1] - origin[1]];
    const toLngLat = (x: number, y: number): Position => [origin[0] + x / cosLat, origin[1] + y];
    const left = toXY(arc[0]);
    const right = toXY(arc[arc.length - 1]);
    const mid = toXY(arc[Math.floor(arc.length / 2)]);
    const length = Math.hypot(mid[0], mid[1]);
    if (length === 0) continue;
    // Down the cone, and across it (to the right).
    const along = [mid[0] / length, mid[1] / length];
    const across = [along[1], -along[0]];
    // Half the cone's width at its far end.
    const halfWidth = Math.abs((right[0] - left[0]) * across[0] + (right[1] - left[1]) * across[1]) / 2;
    // A pale tint of the cone, so streaks read as light moving over it.
    const color = STREAK_COLORS[rating];

    // A point at distance t (0 stand, 1 far end) along a lane, swaying gently.
    const pointAt = (lane: number, t: number, seed: number, phase: number): Position => {
      const sway = Math.sin((t * 2.2 + seed) * Math.PI * 2 + phase) * STREAK_SWAY;
      const side = (lane + sway) * halfWidth * t;
      return toLngLat(along[0] * length * t + across[0] * side, along[1] * length * t + across[1] * side);
    };

    STREAKS.forEach(({ lane, offset }, i) => {
      // Still streaks (reduced motion) sit at fixed spots and don't sway.
      const progress = now === null ? (i + 0.5) / STREAKS.length : (now / STREAK_PERIOD_MS + offset) % 1;
      const phase = now === null ? 0 : (now / 2600) % (Math.PI * 2);
      // Keep off the stand itself; fade in and out at the ends of the trip.
      const head = 0.14 + progress * (0.98 - 0.14);
      const tail = head - STREAK_LENGTH;
      const fade = now === null ? 0.7 : Math.sin(progress * Math.PI);
      if (fade <= 0.02 || tail <= 0.04) return;
      for (const piece of STREAK_PIECES) {
        const coords: Position[] = [];
        const steps = 4;
        for (let k = 0; k <= steps; k++) {
          const t = tail + (head - tail) * (piece.from + ((piece.to - piece.from) * k) / steps);
          coords.push(pointAt(lane, t, offset * 3, phase));
        }
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { opacity: piece.opacity * fade, weight: piece.weight, color },
        });
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

// The deer's way when testing a stand spot.
export const STAND_TEST_DEER = '#f2c46d';

function draftFeatures(points: Position[], cursor: Position | null, color: string, snap: Snap['kind'] | null = null, line = false): FeatureCollection {
  const ring = cursor ? [...points, cursor] : points;
  const features: FeatureCollection['features'] = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: p },
    properties: { color },
  }));
  // A ring under the cursor shows the next click will snap onto a line.
  if (cursor && snap) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: cursor }, properties: { color, snap } });
  }
  if (ring.length >= 3 && !line) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
      properties: { color },
    });
  } else if (ring.length >= 2) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: { color } });
  }
  return { type: 'FeatureCollection', features };
}

function centerOf(geometry: AreaGeometry): [number, number] {
  const [w, s, e, n] = boundsOf(geometry);
  return [(w + e) / 2, (s + n) / 2];
}

// Property names go along the top edge so they don't sit under stands in the middle.
function topCenterOf(geometry: AreaGeometry): [number, number] {
  const [w, , e, n] = boundsOf(geometry);
  return [(w + e) / 2, n];
}

export function MapView(props: MapViewProps) {
  const { ref, layers, properties, areas, markers, sections, overlays, alignMarkers, standRatings, selection, interaction, trails, fieldTracks } = props;
  const { draftPoints, draftColor, settings } = props;
  // The compass is a maplibre control (so it stacks with the zoom buttons)
  // whose contents React renders through a portal.
  const [compassHost, setCompassHost] = useState<HTMLElement | null>(null);
  const [bearing, setBearing] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // Bumped once the style loads so the data effects below run against a ready map.
  const [readyTick, setReadyTick] = useState(0);
  // Matches the tiles baked into buildBaseStyle().
  const loadedTiles = useRef<{ lidar: string; contours: string }>({ lidar: DEFAULT_LAYERS.lidarStyle, contours: '10:' });
  const markerElements = useRef(new Map<string, maplibregl.Marker>());
  const labelElements = useRef(new Map<string, maplibregl.Marker>());
  // Hides names that would overlap; set up with the map.
  const declutter = useRef<() => void>(() => undefined);
  const spotElements = useRef(new Map<string, maplibregl.Marker>());
  const editHandles = useRef(new Map<string, maplibregl.Marker>());
  const alignElements = useRef(new Map<string, maplibregl.Marker>());
  // Overlay id -> image URL currently loaded into its maplibre source.
  const overlayUrls = useRef(new Map<string, string>());
  const cursorRef = useRef<Position | null>(null);
  // Latest props for map event handlers, which are bound once.
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    fitTo(geometry, rightInset = DETAIL_PANEL_INSET) {
      const [w, s, e, n] = boundsOf(geometry);
      const padding = {
        top: FIT_MARGIN + 50, // clear of the toolbar
        bottom: FIT_MARGIN,
        left: FIT_MARGIN + SIDEBAR_INSET,
        right: FIT_MARGIN + rightInset,
      };
      mapRef.current?.fitBounds([w, s, e, n], { padding, maxZoom: 17, duration: 800 });
    },
    flyTo(lng, lat) {
      const map = mapRef.current;
      const offset: [number, number] = [(SIDEBAR_INSET - DETAIL_PANEL_INSET) / 2, 0];
      map?.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), offset, duration: 800 });
    },
    getBounds() {
      const b = mapRef.current?.getBounds();
      return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null;
    },
  }));

  // Create the map once.
  useEffect(() => {
    setUpMapLibre();
    const camera = loadCamera();
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: buildBaseStyle(),
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: 19,
      maxPitch: 75,
      doubleClickZoom: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) Object.assign(window, { __map: map });
    // Bottom right, bottom to top: attribution, zoom buttons, compass.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const host = document.createElement('div');
    host.className = 'maplibregl-ctrl compass-host';
    map.addControl({ onAdd: () => host, onRemove: () => host.remove() }, 'bottom-right');
    setCompassHost(host);
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 140 }), 'bottom-left');
    map.on('rotate', () => setBearing(map.getBearing()));
    retryFailedTiles(map);

    // 'style.load' fires before tiles arrive, unlike 'load', which waits on the slow USGS servers.
    map.once('style.load', () => {
      addFeatureLayers(map);
      readyRef.current = true;
      setReadyTick((t) => t + 1);
    });
    map.on('moveend', () => saveCamera(map));

    // Names that would land on each other: checked once a frame at most while
    // the map moves (a few times a second), and again when it stops.
    let frame = 0;
    let lastRun = 0;
    const runDeclutter = () => {
      frame = 0;
      lastRun = performance.now();
      declutterLabels(map.getContainer());
    };
    declutter.current = () => {
      if (!frame) frame = requestAnimationFrame(runDeclutter);
    };
    map.on('move', () => {
      if (performance.now() - lastRun > 120) declutter.current();
    });
    map.on('moveend', () => declutter.current());

    // While drawing, a point near an existing line lands exactly on it.
    const snapAt = (point: { x: number; y: number }): Snap | null => {
      const { interaction: mode, snapRings, snapPx } = latest.current;
      if (mode !== 'draw') return null;
      return findSnap(point, snapRings, snapPx, (lngLat) => map.project(lngLat));
    };

    map.on('click', (event) => {
      const { interaction: mode, onMapClick, onSelect } = latest.current;
      const position: Position = snapAt(event.point)?.position ?? [event.lngLat.lng, event.lngLat.lat];
      if (mode === 'edit') {
        const box: [[number, number], [number, number]] = [
          [event.point.x - 6, event.point.y - 6],
          [event.point.x + 6, event.point.y + 6],
        ];
        latest.current.onEditClickTrails(map.queryRenderedFeatures(box, { layers: ['trail-casing'] }).map((f) => f.properties.id as string));
        return;
      }
      if (mode !== 'browse') {
        onMapClick(position);
        return;
      }
      // Areas win over the sections they sit in.
      // A deer sighting opens its hunt report.
      const deer = map.queryRenderedFeatures(event.point, { layers: ['sighting-pills', 'sighting-pills-still', 'sighting-pill-icons'] })[0];
      if (deer) {
        onSelect({ kind: 'report', id: deer.properties.reportId as string });
        return;
      }
      // Trails are thin, so they win over the shapes under them.
      const trail = map.queryRenderedFeatures(
        [
          [event.point.x - 6, event.point.y - 6],
          [event.point.x + 6, event.point.y + 6],
        ],
        { layers: ['trail-casing'] },
      )[0];
      if (trail) {
        onSelect({ kind: 'trail', id: trail.properties.id as string });
        return;
      }
      const hits = map.queryRenderedFeatures(event.point, { layers: ['area-fill', 'section-fill'] });
      const hit = hits.find((h) => h.layer.id === 'area-fill') ?? hits[0];
      const id = hit?.properties?.id as string | undefined;
      onSelect(id ? { kind: hit.layer.id === 'area-fill' ? 'area' : 'section', id } : null);
    });

    map.on('mousemove', (event) => {
      if (latest.current.interaction !== 'draw') return;
      const snap = snapAt(event.point);
      cursorRef.current = snap?.position ?? [event.lngLat.lng, event.lngLat.lat];
      const source = map.getSource<GeoJSONSource>('draft');
      source?.setData(draftFeatures(latest.current.draftPoints, cursorRef.current, latest.current.draftColor, snap?.kind, latest.current.draftLine));
    });

    for (const layer of ['area-fill', 'section-fill', 'trail-casing', 'sighting-pills', 'sighting-pills-still', 'sighting-pill-icons']) {
      map.on('mouseenter', layer, () => {
        if (latest.current.interaction === 'browse') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        if (latest.current.interaction === 'browse') map.getCanvas().style.cursor = '';
      });
    }

    const markersById = markerElements.current;
    const labelsById = labelElements.current;
    const alignById = alignElements.current;
    const urlsById = overlayUrls.current;
    return () => {
      markersById.clear();
      labelsById.clear();
      alignById.clear();
      urlsById.clear();
      readyRef.current = false;
      cancelAnimationFrame(frame);
      declutter.current = () => undefined;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Names and pins may have changed; keep them from piling up.
  useEffect(() => declutter.current());

  // Base map and overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const show = (id: string, visible: boolean) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    show(LAYER_IDS.satellite, layers.base === 'satellite');
    show(LAYER_IDS.aerial, layers.base === 'satellite');
    show(LAYER_IDS.aerialMo, layers.base === 'satellite' && settings.aerialPhotos !== 'leafOn');
    show(LAYER_IDS.topo, layers.base === 'topo');
    show(LAYER_IDS.lidar, layers.base === 'lidar');
    show(LAYER_IDS.lidarBlend, layers.base !== 'lidar' && layers.lidarBlend > 0);
    map.setPaintProperty(LAYER_IDS.lidarBlend, 'raster-opacity', layers.lidarBlend);
    // setTiles reloads every tile, so only call it when the style really changed.
    if (loadedTiles.current.lidar !== layers.lidarStyle) {
      loadedTiles.current.lidar = layers.lidarStyle;
      map.getSource<RasterTileSource>('lidar')?.setTiles(lidarStyleTiles(layers.lidarStyle));
    }

    const contourColor = settings.contourColor ?? null;
    const contours = contourTiles(layers.contours, contourColor);
    show(LAYER_IDS.contours, contours !== null);
    const contourKey = `${layers.contours}:${contourColor ?? ''}`;
    if (contours && loadedTiles.current.contours !== contourKey) {
      loadedTiles.current.contours = contourKey;
      map.getSource<RasterTileSource>('contours')?.setTiles(contours);
    }
    // 3D: tilt in when turned on, back to flat when off.
    if (map.getSource('terrain')) {
      const current = map.getTerrain();
      if (layers.terrain !== (current !== null)) map.easeTo({ pitch: layers.terrain ? 60 : 0, duration: 800 });
      if (!layers.terrain) {
        if (current) map.setTerrain(null);
      } else if (current?.exaggeration !== layers.terrainHeight) {
        map.setTerrain({ source: 'terrain', exaggeration: layers.terrainHeight });
      }
    }
    // Contours come back as black lines; lighten them over satellite imagery.
    show(LAYER_IDS.slope, layers.slope);
    map.setPaintProperty(LAYER_IDS.slope, 'raster-opacity', layers.slopeOpacity);
    // The original black lines are lightened over satellite; a picked color is drawn as is.
    map.setPaintProperty(LAYER_IDS.contours, 'raster-brightness-min', !contourColor && layers.base === 'satellite' ? 0.85 : 0);
    map.setPaintProperty(LAYER_IDS.contours, 'raster-opacity', layers.contourOpacity);
  }, [layers, settings.aerialPhotos, settings.contourColor, readyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Property and area shapes.
  const selectedId = selection?.id ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource<GeoJSONSource>('properties')?.setData(propertiesToFeatures(properties, selectedId, settings));
    map.getSource<GeoJSONSource>('areas')?.setData(areasToFeatures(areas, selectedId, settings));
    map.getSource<GeoJSONSource>('sections')?.setData({
      type: 'FeatureCollection',
      features: sections.map((s) => ({
        type: 'Feature',
        geometry: s.geometry,
        properties: { id: s.id, selected: s.id === selectedId },
      })),
    });

    map.getSource<GeoJSONSource>('trails')?.setData({
      type: 'FeatureCollection',
      features: trails.map((t) => {
        const { color, pattern, px, outline } = trailStyle(t, settings.trailStyles);
        const geometry: LineString | MultiLineString = t.branches?.length ? { type: 'MultiLineString', coordinates: trailParts(t) } : t.line;
        return { type: 'Feature', geometry, properties: { id: t.id, color, pattern, width: px, outline, selected: t.id === selectedId || t.id === props.joiningTrailId } };
      }),
    });
    map.getSource<GeoJSONSource>('field-tracks')?.setData({
      type: 'FeatureCollection',
      features: fieldTracks.map((t) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: unpackPoints(t.coords) }, properties: { id: t.id } })),
    });

    // Names for shapes, drawn as HTML so no font server is needed.
    const wanted = new Map<string, { text: string; at: [number, number]; kind: string; color?: string; icon?: IconName; hidden?: boolean; selected?: boolean }>();
    for (const p of properties) {
      wanted.set(p.id, { text: p.name, at: topCenterOf(p.boundary), kind: 'property', color: propertyColor(p, settings) });
    }
    // Section names sit at the top of the section so they don't cover areas in the middle.
    for (const s of sections) wanted.set(s.id, { text: s.name, at: topCenterOf(s.geometry), kind: 'section' });
    for (const a of areas) {
      wanted.set(a.id, { text: a.name, icon: areaTypeInfo(a.type, settings).icon, at: centerOf(a.geometry), kind: 'area', selected: a.id === selectedId, hidden: settings.hiddenTypeLabels.includes(`area:${a.type}`) && a.id !== selectedId });
    }
    for (const t of trails) {
      const [lng, lat] = lineMidpoint(t.line.coordinates);
      wanted.set(t.id, { text: t.name, at: [lng, lat], kind: 'trail' });
    }
    syncHtmlMarkers(map, labelElements.current, wanted, (item, existing) => {
      const el = existing ?? document.createElement('div');
      // classList, not className: maplibre adds its own positioning class to this element.
      el.classList.add('map-label', `map-label-${item.kind}`);
      el.classList.toggle('map-label-hidden', item.hidden === true);
      el.classList.toggle('map-label-selected', item.selected === true);
      el.textContent = item.text;
      if (item.icon) el.insertAdjacentHTML('afterbegin', iconSvg(item.icon, 15));
      el.style.color = item.color ?? '';
      return el;
    }, { anchor: 'center' });
  }, [properties, areas, sections, trails, fieldTracks, selectedId, props.joiningTrailId, settings, readyTick]);

  // Property and section borders and shading, as set in Settings.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const prop = outlineLook('property', settings);
    const sec = outlineLook('section', settings);
    const cap = (pattern: string) => (pattern === 'dotted' ? 'round' : 'butt');
    map.setPaintProperty('property-fill', 'fill-opacity', ['case', ['get', 'selected'], Math.min(1, prop.fillOpacity * 2 + 0.02), prop.fillOpacity]);
    map.setPaintProperty('property-line', 'line-width', ['case', ['get', 'selected'], prop.width + 1, prop.width]);
    map.setPaintProperty('property-line', 'line-dasharray', dashFor(prop.pattern, 'property'));
    map.setLayoutProperty('property-line', 'line-cap', cap(prop.pattern));
    map.setPaintProperty('property-casing', 'line-width', prop.width + 2.5);
    // A dark edge under a dashed or dotted line would fill in its gaps.
    map.setPaintProperty('property-casing', 'line-opacity', prop.pattern === 'solid' ? 0.5 * prop.lineOpacity : 0);
    // A selected outline stays fully visible however faint the rest are.
    map.setPaintProperty('property-line', 'line-opacity', ['case', ['get', 'selected'], 1, prop.lineOpacity]);
    map.setPaintProperty('section-fill', 'fill-opacity', ['case', ['get', 'selected'], Math.min(1, sec.fillOpacity * 2 + 0.06), sec.fillOpacity]);
    map.setPaintProperty('section-line', 'line-width', ['case', ['get', 'selected'], sec.width + 1, sec.width]);
    map.setPaintProperty('section-line', 'line-dasharray', dashFor(sec.pattern, 'section'));
    map.setLayoutProperty('section-line', 'line-cap', cap(sec.pattern));
    map.setPaintProperty('section-line', 'line-opacity', ['case', ['get', 'selected'], 1, sec.lineOpacity]);
  }, [settings.propertyLook, settings.sectionLook, readyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Point markers (stands, cameras, ...) as draggable HTML pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    // Pin types turned off in Choose Map stay hidden, unless it's the selected pin.
    const hiddenTypes = settings.hiddenPinTypes ?? [];
    const wanted = new Map(
      markers.filter((m) => m.id === selectedId || !hiddenTypes.includes(m.type)).map((m) => [
        m.id,
        { id: m.id, name: m.name, selected: m.id === selectedId, noLabel: settings.hiddenTypeLabels.includes(`pin:${m.type}`), style: markerStyle(m, settings), at: [m.lng, m.lat] as [number, number] },
      ]),
    );
    syncHtmlMarkers(
      map,
      markerElements.current,
      wanted,
      (item, existing) => {
        const el = existing ?? document.createElement('div');
        el.classList.add('map-pin');
        el.classList.toggle('map-pin-selected', item.selected);
        el.classList.toggle('map-pin-no-label', item.noLabel);
        // Forecast highlight: good stands glow, bad ones fade.
        const rating = standRatings?.[item.id];
        for (const r of ['good', 'ok', 'bad', 'unset'] as const) el.classList.toggle(`rating-${r}`, rating === r);
        el.classList.toggle('rated', standRatings !== null);
        el.style.setProperty('--pin-color', item.style.color);
        el.style.setProperty('--pin-size', `${item.style.size}px`);
        el.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = `map-pin-dot shape-${item.style.shape}`;
        const label = document.createElement('span');
        label.className = 'map-pin-label';
        label.textContent = item.name;
        el.append(dot, label);
        return el;
      },
      // Anchored on the left edge; the dot's negative margin (styles.css)
      // centres it on the location so the label hangs off to the right.
      { anchor: 'left' },
      (marker, id) => {
        marker.getElement().addEventListener('click', (event) => {
          if (latest.current.interaction !== 'browse') return;
          event.stopPropagation();
          latest.current.onSelect({ kind: 'marker', id });
        });
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          latest.current.onMarkerMoved(id, [lng, lat]);
        });
      },
    );
    // Pins stay put unless this one was unlocked to move it.
    for (const [id, marker] of markerElements.current) {
      marker.setDraggable(id === props.unlockedPinId);
      marker.getElement().classList.toggle('map-pin-unlocked', id === props.unlockedPinId);
    }
    const container = map.getContainer();
    for (const { id } of LABEL_KINDS) container.classList.toggle(`hide-label-${id}`, settings.hiddenLabels.includes(id));
  }, [markers, selectedId, standRatings, settings, props.unlockedPinId, readyTick]);

  // New spots hunted from: a dashed ring, so they read differently from stands.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const wanted = new Map(props.huntSpots.map((s) => [s.id, s]));
    syncHtmlMarkers(
      map,
      spotElements.current,
      wanted,
      (item, existing) => {
        const el = existing ?? document.createElement('div');
        el.classList.add('hunt-spot');
        el.classList.toggle('hunt-spot-selected', item.reportId === selectedId);
        el.dataset.reportId = item.reportId;
        el.innerHTML = '';
        const ring = document.createElement('span');
        ring.className = 'hunt-spot-ring';
        const label = document.createElement('span');
        label.className = 'hunt-spot-label';
        label.textContent = `${item.name} · ${item.hunts} hunt${item.hunts === 1 ? '' : 's'}`;
        el.append(ring, label);
        return el;
      },
      { anchor: 'left' },
      (marker) => {
        marker.getElement().addEventListener('click', (event) => {
          if (latest.current.interaction !== 'browse') return;
          event.stopPropagation();
          const reportId = (event.currentTarget as HTMLElement).dataset.reportId;
          if (reportId) latest.current.onSelect({ kind: 'report', id: reportId });
        });
      },
    );
  }, [props.huntSpots, selectedId, readyTick]);

  // Map images, drawn above the base maps and under property lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const loaded = overlayUrls.current;
    const wanted = new Map(overlays.map((o) => [o.id, o]));
    for (const id of [...loaded.keys()]) {
      if (wanted.has(id)) continue;
      map.removeLayer(`overlay-${id}`);
      map.removeSource(`overlay-${id}`);
      loaded.delete(id);
    }
    for (const o of overlays) {
      const sourceId = `overlay-${o.id}`;
      const source = map.getSource<ImageSource>(sourceId);
      if (!source) {
        map.addSource(sourceId, { type: 'image', url: o.url, coordinates: o.corners });
        map.addLayer(
          { id: sourceId, type: 'raster', source: sourceId, paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 0 } },
          'property-fill',
        );
      } else if (loaded.get(o.id) !== o.url) {
        source.updateImage({ url: o.url, coordinates: o.corners });
      } else {
        source.setCoordinates(o.corners);
      }
      map.setPaintProperty(sourceId, 'raster-opacity', o.opacity);
      loaded.set(o.id, o.url);
    }
  }, [overlays, readyTick]);

  // Numbered, draggable map points while lining up an image.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const wanted = new Map(alignMarkers.map((m) => [String(m.index), { at: m.position, index: m.index }]));
    syncHtmlMarkers(
      map,
      alignElements.current,
      wanted,
      (item, existing) => {
        const el = existing ?? document.createElement('div');
        el.classList.add('control-point', 'on-map');
        el.textContent = String(item.index + 1);
        return el;
      },
      { anchor: 'center' },
      (marker, key) => {
        marker.setDraggable(true);
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          latest.current.onAlignMarkerMoved(Number(key), [lng, lat]);
        });
      },
    );
  }, [alignMarkers, readyTick]);

  // Scent cones in the stand's rating color: green good, yellow maybe, red bad.
  const { scentCones } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource<GeoJSONSource>('scent')?.setData({
      type: 'FeatureCollection',
      features: scentCones.flatMap((c) =>
        CONE_BANDS.map(({ width, length }, i) => ({
          type: 'Feature' as const,
          geometry: narrowCone(c.cone, width, length),
          properties: { id: c.id, band: i + 1, color: coneColor(c.rating) },
        })),
      ),
    });
  }, [scentCones, readyTick]);

  // Thermal scent paths.
  const { thermalPaths } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource<GeoJSONSource>('thermal')?.setData({
      type: 'FeatureCollection',
      features: thermalPaths.flatMap((p) => [
        // The spread, widest first.
        ...THERMAL_BANDS.flatMap((factor) => {
          const band = thermalBand(p.points, spreadRate(p.pull) * factor, factor);
          return band ? [{ type: 'Feature' as const, geometry: band, properties: { id: p.id, color: THERMAL_COLORS[p.phase] } }] : [];
        }),
        {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: p.points },
          properties: { id: p.id, color: THERMAL_COLORS[p.phase] },
        },
        // Where scent settles: pools in a low spot, or tops out on high ground.
        ...(p.ends === 'pools' || p.ends === 'ridge'
          ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p.points[p.points.length - 1] }, properties: { id: p.id, color: THERMAL_COLORS[p.phase], pool: true } }]
          : []),
      ]),
    });
  }, [thermalPaths, readyTick]);

  // Testing a stand spot.
  const { standTest } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const features: FeatureCollection['features'] = [];
    const route = standTest?.route ?? [];
    if (route.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: route }, properties: {} });
    if (route.length >= 1) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: route[0] }, properties: { kind: 'from' } });
    if (route.length >= 2) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: route[route.length - 1] }, properties: { kind: 'to' } });
    if (standTest?.spot) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: standTest.spot }, properties: { kind: 'spot' } });
    map.getSource<GeoJSONSource>('stand-test')?.setData({ type: 'FeatureCollection', features });
  }, [standTest, readyTick]);

  // Deer sightings.
  const { sightings } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource<GeoJSONSource>('sightings')?.setData({
      type: 'FeatureCollection',
      features: sightings.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        // `heading` is left out (not null) for still deer, so the layer filters can test for it.
        properties: {
          reportId: s.reportId,
          kind: s.kind,
          pill: pillName(map, s.color, s.headingDeg !== null),
          ...(s.headingDeg !== null ? { heading: s.headingDeg } : {}),
          ...(s.icon ? { icon: s.icon } : {}),
        },
      })),
    });
    const went = sightings.filter((s) => s.wentTo);
    map.getSource<GeoJSONSource>('sighting-paths')?.setData({
      type: 'FeatureCollection',
      features: went.flatMap((s) => [
        {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [[s.lng, s.lat], s.wentTo!] },
          properties: { color: s.color },
        },
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: s.wentTo! },
          properties: { bearing: bearingBetween([s.lng, s.lat], s.wentTo!) },
        },
      ]),
    });
  }, [sightings, readyTick]);

  // Flowing wind streaks: one animation loop for the map's life, reading the
  // latest cones from a ref. About 30 updates a second keeps the flow smooth and
  // stays light on the PC; with "reduce motion" on, the streaks hold still.
  const conesRef = useRef(scentCones);
  conesRef.current = scentCones;
  const thermalRef = useRef(props.thermalPaths);
  thermalRef.current = props.thermalPaths;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let last = 0;
    let shown = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const cones = conesRef.current;
      const thermals = thermalRef.current;
      // Nothing to animate: clear once, then idle.
      if (cones.length === 0 && thermals.length === 0) {
        if (shown > 0) map.getSource<GeoJSONSource>('scent-arrows')?.setData(EMPTY);
        shown = 0;
        return;
      }
      // Still arrows only need to follow the slider, so update them less often.
      if (now - last < (reduceMotion ? 250 : 33)) return;
      last = now;
      shown = cones.length + thermals.length;
      const flow = scentArrowFeatures(cones, reduceMotion ? null : now);
      flow.features.push(...thermalStreakFeatures(thermals, reduceMotion ? null : now));
      map.getSource<GeoJSONSource>('scent-arrows')?.setData(flow);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [readyTick]);

  // Shape being reshaped: the outline, a draggable handle on each corner, and a
  // "+" between corners to add one. Right-click a corner to remove it.
  const { editShape } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource<GeoJSONSource>('edit');
    if (!editShape) {
      source?.setData(EMPTY);
      for (const marker of editHandles.current.values()) marker.remove();
      editHandles.current.clear();
      return;
    }
    const { rings, closed, color } = editShape;
    source?.setData({
      type: 'FeatureCollection',
      features: rings.map((ring) => ({
        type: 'Feature',
        geometry: closed && ring.length >= 3 ? { type: 'Polygon', coordinates: [[...ring, ring[0]]] } : { type: 'LineString', coordinates: ring },
        properties: { color },
      })),
    });

    const wanted = new Map<string, { kind: 'corner' | 'add'; ring: number; index: number; at: [number, number] }>();
    rings.forEach((ring, r) => {
      ring.forEach((p, i) => {
        wanted.set(`v-${r}-${i}`, { kind: 'corner', ring: r, index: i, at: [p[0], p[1]] });
        const next = ring[i + 1] ?? (closed ? ring[0] : null);
        if (next) wanted.set(`m-${r}-${i}`, { kind: 'add', ring: r, index: i, at: [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2] });
      });
    });
    syncHtmlMarkers(
      map,
      editHandles.current,
      wanted,
      (item, existing) => {
        const el = existing ?? document.createElement('div');
        el.classList.add('edit-handle', `edit-${item.kind}`);
        el.title = item.kind === 'corner' ? 'Drag to move · right-click to remove' : 'Click to add a corner here';
        return el;
      },
      { anchor: 'center' },
      (marker, id) => {
        const [kind, r, i] = id.split('-');
        const ringIndex = Number(r);
        const index = Number(i);
        const el = marker.getElement();
        const current = () => latest.current.editShape?.rings ?? [];
        const withRing = (ring: Position[]) => current().map((x, n) => (n === ringIndex ? ring : x));
        if (kind === 'v') {
          marker.setDraggable(true);
          marker.on('dragstart', () => latest.current.onEditBegin());
          marker.on('drag', () => {
            const { lng, lat } = marker.getLngLat();
            const snap = findSnap(map.project([lng, lat]), latest.current.snapRings, latest.current.snapPx, (p) => map.project(p));
            const at = snap?.position ?? [lng, lat];
            const was = current()[ringIndex][index];
            // Branches of a line share the corner where they meet, so it moves on all of them.
            const moved = latest.current.editShape?.closed
              ? withRing(current()[ringIndex].map((p, n) => (n === index ? at : p)))
              : current().map((ring) => ring.map((p) => (p[0] === was[0] && p[1] === was[1] ? at : p)));
            latest.current.onEditRings(moved);
          });
          el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            const ring = current()[ringIndex];
            const min = latest.current.editShape?.closed ? 3 : 2;
            if (!ring || ring.length <= min) return;
            latest.current.onEditBegin();
            latest.current.onEditRings(withRing(ring.filter((_, n) => n !== index)));
          });
        } else {
          el.addEventListener('click', (event) => {
            event.stopPropagation();
            const ring = current()[ringIndex];
            if (!ring) return;
            const next = ring[index + 1] ?? ring[0];
            const mid: Position = [(ring[index][0] + next[0]) / 2, (ring[index][1] + next[1]) / 2];
            latest.current.onEditBegin();
            latest.current.onEditRings(withRing([...ring.slice(0, index + 1), mid, ...ring.slice(index + 1)]));
          });
        }
      },
    );
  }, [editShape, readyTick]);

  // Shape being drawn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (interaction !== 'draw') cursorRef.current = null;
    map.getSource<GeoJSONSource>('draft')?.setData(draftFeatures(draftPoints, cursorRef.current, draftColor, null, props.draftLine));
    map.getCanvas().style.cursor = interaction === 'browse' ? '' : 'crosshair';
  }, [draftPoints, draftColor, interaction, readyTick]);

  // A quick double click zooms in while browsing. It stays off while drawing,
  // placing, aligning or editing, where clicks set points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (interaction === 'browse') map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
  }, [interaction]);

  return (
    <div ref={containerRef} className="map">
      {compassHost &&
        createPortal(
          <Compass
            bearing={bearing}
            windFromDeg={props.windFromDeg}
            onResetNorth={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 })}
          />,
          compassHost,
        )}
    </div>
  );
}

interface HtmlItem {
  at: [number, number];
}

// Adds, updates and removes maplibre HTML markers to match `wanted`.
function syncHtmlMarkers<T extends HtmlItem>(
  map: maplibregl.Map,
  current: Map<string, maplibregl.Marker>,
  wanted: Map<string, T>,
  render: (item: T, existing: HTMLElement | null) => HTMLElement,
  placement: Partial<Pick<maplibregl.MarkerOptions, 'anchor' | 'offset'>>,
  onCreate?: (marker: maplibregl.Marker, id: string) => void,
): void {
  for (const [id, marker] of current) {
    if (!wanted.has(id)) {
      marker.remove();
      current.delete(id);
    }
  }
  for (const [id, item] of wanted) {
    const existing = current.get(id);
    if (existing) {
      render(item, existing.getElement());
      existing.setLngLat(item.at);
    } else {
      const marker = new maplibregl.Marker({ element: render(item, null), ...placement }).setLngLat(item.at).addTo(map);
      current.set(id, marker);
      onCreate?.(marker, id);
    }
  }
}
