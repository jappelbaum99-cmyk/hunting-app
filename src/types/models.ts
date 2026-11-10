// Shared data models for the hub (and later the phone site).
// Ids are UUIDs and deletes are soft (deletedAt) so records can sync between devices.
import type { LineString, MultiPolygon, Polygon, Position } from 'geojson';

export type AreaGeometry = Polygon | MultiPolygon;

export type CompassPoint = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const COMPASS_POINTS: CompassPoint[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface Syncable {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type PropertySource = 'drawn' | 'imported' | 'parcel';

export interface Property extends Syncable {
  name: string;
  owner: string | null;
  source: PropertySource;
  boundary: AreaGeometry;
  notes: string | null;
  // Set once its map tiles have been downloaded for offline use.
  offline?: { downloadedAt: string; tileCount: number; layers: string } | null;
  // Overrides the property line color from Settings.
  color?: string | null;
}

export type BuiltInMarkerType =
  | 'stand'
  | 'blind'
  | 'platform'
  | 'camera'
  | 'rub'
  | 'scrape'
  | 'trail'
  | 'water'
  | 'parking'
  | 'soil_sample'
  | 'other';
// A built-in pin type, or the id of a custom type added in Settings.
export type MarkerType = BuiltInMarkerType | (string & {});

// A pin type added in Settings (e.g. "Mineral lick"). Shape and size come from markerStyles.
export interface CustomPinType {
  id: string;
  label: string;
  color: string;
  // A place to hunt from: gets good winds, scent cones, forecast ratings and hunt logging.
  huntingSpot?: boolean;
  // Removed types stay so existing pins keep their look; they're hidden from pickers.
  deletedAt: string | null;
}

export interface MapMarker extends Syncable {
  propertyId: string | null;
  type: MarkerType;
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  // Winds a stand can be hunted on, e.g. ['N', 'NW'].
  goodWinds: CompassPoint[];
  // Overrides the category color from Settings.
  color?: string | null;
  // Soil sample pins: the field (area) it was taken in, once known.
  sampleOf?: string | null;
  // Soil sample pins from a phone's soil test: which test (all its cores share it) and the field name typed there.
  soilRun?: { id: string; fieldName: string | null } | null;
}

export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'pin';

export interface MarkerStyle {
  color: string;
  shape: MarkerShape;
  // Diameter in pixels.
  size: number;
}

// An outline's border pattern and width (map pixels), and how see-through its shading is (0-1).
export interface OutlineLook {
  pattern?: LinePattern;
  width?: number;
  fillOpacity?: number;
}

export type LabelKind ='pin' | 'property' | 'section' | 'area' | 'trail' | 'hunt';

// App-wide look, set in Settings. Anything left out uses the built-in default.
export interface HubSettings {
  markerStyles: Partial<Record<MarkerType, Partial<MarkerStyle>>>;
  areaColors: Partial<Record<AreaType, string>>;
  // Icon overrides for built-in area types.
  areaIcons: Partial<Record<AreaType, string>>;
  customAreaTypes: CustomAreaType[];
  customPinTypes: CustomPinType[];
  propertyLineColor: string | null;
  // How property and section outlines are drawn (see src/lib/styles.ts outlineLook).
  propertyLook?: OutlineLook | null;
  sectionLook?: OutlineLook | null;
  // Drawing snaps onto property and section lines within this many screen pixels.
  snapping: { enabled: boolean; distancePx: number };
  // The kinds of names left off the map.
  hiddenLabels: LabelKind[];
  // The pin and area types left off the map, like "pin:camera" or "area:timber".
  hiddenTypeLabels: string[];
  // The label choices saved as "My default", to come back to after Show all or Hide all.
  labelDefault?: { hiddenLabels: LabelKind[]; hiddenTypeLabels: string[] } | null;
  // The look of each trail type. Anything left out uses the built-in default.
  trailStyles: Partial<Record<TrailKind, { color?: string; pattern?: LinePattern; thickness?: LineThickness; outline?: boolean }>>;
  // How many days ahead of a schedule's window its To do card appears.
  scheduleLeadDays: number;
  // Desktop app: keep every property's maps saved in the background (on unless
  // turned off), this many meters around the property line.
  offlineAuto?: boolean;
  offlineRadiusM?: number;
  // Action Board lists folded shut. Missing means only Done is shut.
  boardClosed?: BoardFold[];
  // The order chosen for the Action Board's Coming up list, as row keys. Empty means soonest first.
  scheduleOrder: string[];
  // The camp this hub gets phone hunts and pins from, if any.
  camp?: CampLink | null;
  // Folder where trail camera photos are kept (desktop app).
  photoLibrary?: string | null;
  // Pin types left off the map, like 'camera' or 'rub'.
  hiddenPinTypes?: string[];
  // The local rut's peak breeding date, 'MM-DD', for the deer activity score (Missouri: about Nov 15).
  rutPeak?: string;
  // Close-up satellite photos: Missouri's leaf-off winter ones where saved (the
  // default), or the leaf-on summer NAIP ones everywhere.
  aerialPhotos?: 'leafOff' | 'leafOn';
  // The last poster laid out, to pick up where it was left (see src/map/poster.ts).
  poster?: PosterSettings | null;
}

export type PosterLabelKind = 'property' | 'section' | 'area' | 'trail' | 'pin';

// A printed map: paper, map look, what's drawn, and where labels were dragged to.
export interface PosterSettings {
  // A preset like '24x36', or 'custom'. Sizes are inches, short side first.
  size: string;
  widthIn: number;
  heightIn: number;
  landscape: boolean;
  dpi: number;
  format: 'jpg' | 'png';
  base: 'satellite' | 'topo' | 'lidar';
  // Close-up photos on Aerial: Missouri's leaf-off winter ones where saved, or summer NAIP.
  photos?: 'leafOff' | 'leafOn';
  lidarStyle: 'stretch' | 'multidirectional' | 'tinted' | 'slope';
  // Lidar shading over satellite or topo, 0-1.
  lidarBlend: number;
  contours: 'off' | '10' | '5' | '2';
  show: Record<'properties' | 'sections' | 'areas' | 'trails' | 'pins', boolean>;
  labels: Record<PosterLabelKind, boolean>;
  // Size of labels: points on paper per pixel on the map.
  textScale: number;
  // Size of pins and lines, the same way. Missing means the same as the labels.
  featureScale?: number;
  // Size of lines and outlines (from before each kind had its own). Missing means the same as the pins.
  lineScale?: number;
  // Each kind of line's size; one left out uses lineScale.
  lineScales?: Partial<Record<'property' | 'section' | 'area' | 'trail', number>>;
  // Single properties, areas, pins, trails or sections left off this poster.
  hiddenIds?: string[];
  // Pin types left off, like 'camera' or 'rub'.
  hiddenPinTypes?: string[];
  // Your own logo on the poster: the saved image file (like a map image), which
  // corner, and how wide in inches.
  logo?: { file: string; corner: 'tl' | 'tr' | 'bl' | 'br'; widthIn: number } | null;
  title: string;
  subtitle: string;
  northArrow: boolean;
  scaleBar: boolean;
  // The frame: its centre in web mercator meters, and meters of ground per inch of paper.
  center: [number, number] | null;
  metersPerInch: number | null;
  // Labels dragged somewhere else: label id -> [lng, lat] of the label's centre.
  labelAt: Record<string, [number, number]>;
  hiddenLabelIds: string[];
}

// A shared camp in Firebase that phones send hunts and pins to (see src/lib/camp.ts).
export interface CampLink {
  // The camp code; whoever has it can join.
  code: string;
  name: string;
  // The person using this device, shown on their hunts and pins.
  hunter: string;
  // Set on the hub that started the camp.
  isOwner?: boolean;
  // This hub shares its map, plans, logs and board with the camp's other partners.
  sharing?: boolean;
  // When this hub last finished sending changes, by its own clock.
  pushedAt?: string | null;
  // When Firebase got the newest change this hub has taken in.
  cursor?: string | null;
}

export type BuiltInAreaType = 'food_plot' | 'bedding' | 'sanctuary' | 'timber' | 'water' | 'other';
// A built-in type, or the id of a custom type added in Settings.
export type AreaType = BuiltInAreaType | (string & {});

export interface CustomAreaType {
  id: string;
  label: string;
  color: string;
  icon: string;
  // Deer bed or hide here, so scent drifting in makes a stand Bad.
  scentSensitive: boolean;
  // Removed types stay so existing areas keep their look; they're hidden from pickers.
  deletedAt: string | null;
}

export interface MapArea extends Syncable {
  propertyId: string | null;
  type: AreaType;
  name: string;
  geometry: AreaGeometry;
  notes: string | null;
  // Food plots: what's planted, and when (YYYY-MM-DD). Follows the newest planting in the log.
  planted?: string | null;
  plantedOn?: string | null;
  log?: PlotEntry[];
  schedules?: WorkSchedule[];
  soilTests?: SoilTest[];
}

// A food plot's soil test results, typed in from the lab's report (see src/lib/soil.ts).
// Empty boxes are null. The recommendations are per acre, as labs write them.
export interface SoilTest {
  id: string;
  // yyyy-mm-dd, when the sample was taken.
  date: string;
  lab: string | null;
  // What the lab's recommendations are for, e.g. Clover.
  crop: string | null;
  ph: number | null;
  bufferPh: number | null;
  // Phosphorus, potassium, calcium and magnesium, in `units`.
  p: number | null;
  k: number | null;
  ca: number | null;
  mg: number | null;
  units: 'lb_acre' | 'ppm';
  // Organic matter, percent.
  om: number | null;
  cec: number | null;
  // Recommendations per acre: lime, in tons of ag lime or pounds of ENM (Missouri's
  // lab writes ENM), and pounds of N, P2O5 and K2O.
  lime: number | null;
  limeUnits: 'tons' | 'enm';
  // The ENM in a ton of the lime being bought, from the quarry's ticket, for ENM recommendations.
  limeEnm: number | null;
  nLbs: number | null;
  pLbs: number | null;
  kLbs: number | null;
  // The bagged blend picked to cover them, e.g. 13-13-13.
  blend?: string | null;
  // The Soil sample pins this test was taken from (dropped on the phone or the map).
  sampleIds?: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ScheduleWork = 'burn' | 'plant' | 'lime' | 'fertilize' | 'mow' | 'spray' | 'soil_test' | 'timber' | 'other';

// Work that repeats on an area or section (see src/lib/schedules.ts).
export interface WorkSchedule {
  id: string;
  work: ScheduleWork;
  // What to plant, or the name of the work for 'other'.
  detail: string | null;
  everyYears: number;
  // The months it's done in, 1-12. An end before the start runs over New Year.
  startMonth: number;
  endMonth: number;
  // yyyy-mm-dd.
  lastDone: string | null;
  // The latest cycle dealt with through its card, done or skipped. Needed as well
  // as lastDone because a card can be finished ahead of its window.
  handledSeason?: number | null;
  createdAt: string;
  deletedAt: string | null;
}

// Ties a board card to the schedule and cycle that made it.
export interface CardSchedule {
  id: string;
  placeKind: 'area' | 'section';
  placeId: string;
  season: number;
  dueLabel: string;
  // yyyy-mm-dd, the last day of the window.
  dueEnd: string;
  // To put back if the card is taken out of Done.
  lastDoneBefore: string | null;
  handledBefore: number | null;
}

export type PlotAction = 'planted' | 'fertilized' | 'limed' | 'sprayed' | 'mowed' | 'disked' | 'soil_test' | 'other';

// One saved piece of work on a food plot (see src/lib/plotLog.ts).
export interface PlotEntry {
  id: string;
  action: PlotAction;
  // The planting, for 'planted'.
  what: string | null;
  // yyyy-mm-dd.
  date: string;
  notes: string | null;
  createdAt: string;
  deletedAt: string | null;
  // Set when it was logged from a phone.
  fromPhone?: boolean;
  loggedBy?: string | null;
}

export type NoteKind = 'stand' | 'work' | 'thought';
export type BoardStatus = 'idea' | 'planned' | 'done';
// The Action Board's foldable lists: one per status, plus scheduled work coming up.
export type BoardFold = BoardStatus | 'coming';

// A note written on the phone. It lands on the Action Board, or in a food plot's
// log when `plot` is set (see src/lib/actionBoard.ts).
export interface FieldNote extends Syncable {
  kind: NoteKind;
  text: string;
  lat: number | null;
  lng: number | null;
  loggedBy: string | null;
  plot?: { areaId: string; action: PlotAction; what: string | null; date: string } | null;
}

// A card on the hub's Action Board.
export interface ActionItem extends Syncable {
  kind: NoteKind;
  text: string;
  status: BoardStatus;
  lat: number | null;
  lng: number | null;
  loggedBy: string | null;
  propertyId: string | null;
  source: 'phone' | 'hub';
  // The stand made from this card, if any.
  markerId: string | null;
  // Set when a schedule made this card.
  schedule?: CardSchedule | null;
}

// A point on an image (pixels from its top-left corner) matched to the same
// spot on the map.
export interface ControlPoint {
  image: [number, number];
  map: [number, number];
}

// A picture of a map (county parcel viewer, plat, survey...) laid over the
// map by matching control points, so property lines can be traced from it.
export interface MapImageOverlay extends Syncable {
  name: string;
  // File name inside Documents\Hunting Hub\images.
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  controlPoints: ControlPoint[];
  opacity: number;
  visible: boolean;
}

// A named management unit within a property ("North Ridge", "Unit 3"),
// which plans like burns and timber work are attached to.
export interface Section extends Syncable {
  propertyId: string | null;
  name: string;
  geometry: AreaGeometry;
  notes: string | null;
  schedules?: WorkSchedule[];
}

export type PlanKind = 'burn' | 'timber' | 'habitat' | 'other';
export type PlanStatus = 'idea' | 'planned' | 'in_progress' | 'done';

export interface PlanTask {
  id: string;
  text: string;
  done: boolean;
}

// Conditions a prescribed burn needs; the forecast is checked against them.
export interface BurnDetails {
  // Burn season, as yyyy-mm-dd dates.
  windowStart: string | null;
  windowEnd: string | null;
  // Winds that push smoke and fire the safe way. Empty = any direction.
  goodWinds: CompassPoint[];
  minWindMph: number;
  maxWindMph: number;
  minHumidity: number;
  maxHumidity: number;
}

export type TimberPractice =
  | 'thinning'
  | 'selective_harvest'
  | 'clearcut'
  | 'tsi'
  | 'hinge_cut'
  | 'edge_feathering'
  | 'planting'
  | 'other';

export interface TimberDetails {
  practice: TimberPractice;
  contractor: string | null;
  estimatedCost: number | null;
  estimatedIncome: number | null;
}

// A plan belongs to a section or, since 0.13.1, an area (exactly one is set).
export interface Plan extends Syncable {
  sectionId: string | null;
  areaId?: string | null;
  kind: PlanKind;
  title: string;
  status: PlanStatus;
  // When it should happen, yyyy-mm-dd.
  targetDate: string | null;
  notes: string | null;
  tasks: PlanTask[];
  burn: BurnDetails | null;
  timber: TimberDetails | null;
}

// What was seen: deer by kind, or another animal. (The name predates turkey and bear.)
export type DeerKind = 'buck' | 'doe' | 'fawn' | 'unknown' | 'turkey' | 'bear' | 'other';

export interface Sighting {
  id: string;
  time: string;
  kind: DeerKind;
  count: number;
  // Bucks only.
  buckName: string | null;
  antlerPoints: number | null;
  // Which way the deer were traveling, 0 = north. Null = not moving / unknown.
  headingDeg: number | null;
  // Where they were seen; null = not placed (drawn at the stand).
  lat: number | null;
  lng: number | null;
  // Roughly where they were from the stand, tapped on the phone: a compass
  // direction and a distance band. Kept this small on purpose; the exact
  // spot is worked out from the stand when drawing. lat/lng win when set.
  fromStand?: { bearingDeg: number; yards: number } | null;
  // For "other", what it was (e.g. "coyote").
  notes: string | null;
  // Anything else worth remembering, e.g. "came from the creek".
  comment?: string | null;
  // What they were doing (missing on older sightings).
  behavior?: DeerBehavior | null;
}

export type DeerBehavior = 'feeding' | 'walking' | 'running' | 'chasing' | 'bedded' | 'scraping';

export interface ReportWeather {
  tempF: number;
  windFromDeg: number;
  windMph: number;
  gustMph: number;
  precipChance: number;
  // Barometric pressure and its 3-hour trend (missing on older reports).
  pressureInHg?: number;
  pressureTrend?: 'rising' | 'falling' | 'steady';
}

// One sit: where, when, the weather, and what was seen.
// A spot hunted that isn't a stand (a tree to sit under, a climber): where
// the phone was when the hunt started.
export interface HuntSpot {
  lat: number;
  lng: number;
  accuracyM: number | null;
  name: string | null;
}

export interface HuntReport extends Syncable {
  standId: string | null;
  // A new spot instead of a stand. Once a stand is made from it, standId wins.
  spot?: HuntSpot | null;
  propertyId: string | null;
  start: string;
  end: string | null;
  weather: ReportWeather | null;
  sightings: Sighting[];
  notes: string | null;
  // Logged here, or on the phone and brought in.
  source: 'hub' | 'phone';
  // Who logged it, from the phone's camp name.
  loggedBy?: string | null;
}

// A GPS pin dropped on the phone, waiting to become a stand or pin here.
export interface FieldPin extends Syncable {
  lat: number;
  lng: number;
  // How sure the phone was of its position, meters.
  accuracyM: number | null;
  type: MarkerType;
  note: string | null;
  status: 'new' | 'added' | 'dismissed';
  // The stand or pin made from it.
  markerId: string | null;
  // Who dropped it, from the phone's camp name.
  loggedBy?: string | null;
  // Set when this is a new spot for a stand that was moved (the stand's id),
  // rather than a new pin. The hub asks before moving the stand.
  moveStandId?: string | null;
  // A core from a soil sampling run on the phone's Soil tab: which run and field, and its number.
  // fieldName is null when the test was started without a field.
  soil?: { runId: string; areaId: string | null; fieldName: string | null; sample: number } | null;
}

export type TrailKind = 'deer' | 'path' | 'road' | 'fence' | 'other';
export type LinePattern = 'solid' | 'dashed' | 'dotted';
export type LineThickness = 'skinny' | 'normal' | 'thick';

// A line on the map: a deer trail, walking path, ATV road, fence line...
export interface MapTrail extends Syncable {
  propertyId: string | null;
  kind: TrailKind;
  name: string;
  line: LineString;
  notes: string | null;
  // Overrides the trail type's color.
  color?: string | null;
  // Override the line style set for its type.
  pattern?: LinePattern | null;
  thickness?: LineThickness | null;
  outline?: boolean | null;
  // More lines belonging to this trail, meeting it at a T.
  branches?: Position[][] | null;
  // Drawn in the hub, or walked with a phone's GPS.
  source: 'drawn' | 'walked';
}

// A walk recorded on the phone, waiting to become a trail (or an area) here.
export interface FieldTrack extends Syncable {
  name: string;
  // Walked along a trail, or around the edge of an area. Older walks are lines.
  shape?: 'line' | 'area';
  // Simplified GPS points as a flat [lng, lat, lng, lat, ...] list.
  coords: number[];
  startedAt: string;
  endedAt: string;
  lengthM: number;
  loggedBy?: string | null;
  status: 'new' | 'added' | 'dismissed';
  // The trail made from it.
  trailId: string | null;
  // Or the area.
  areaId?: string | null;
}

export interface PhotoTally {
  kind: DeerKind;
  count: number;
  // Left out unless it's a named buck: there can be a lot of photos.
  buckName?: string | null;
}

// A box MegaDetector drew: [x, y, width, height] as fractions of the photo.
export interface PhotoDetection {
  label: 'animal' | 'person' | 'vehicle';
  score: number;
  box: [number, number, number, number];
}

// Where a trail camera photo was taken (see src/lib/photoPlaces.ts). Any of these can be unknown.
export interface PhotoPlace {
  propertyId: string | null;
  sectionId: string | null;
  areaId: string | null;
}

// A trail camera photo, filed in the photo library (see src/lib/photos.ts).
export interface CameraPhoto extends Syncable {
  // The camera's map pin.
  cameraId: string;
  // The area or section it's filed under: set at import from where the camera
  // was, and can be changed. Older photos have none and go by the camera.
  place?: PhotoPlace;
  // Path inside the photo library, e.g. "Smith Farm/North Ridge/Creek Cam/2026-11/2026-11-01_064512.jpg".
  file: string;
  originalName: string;
  originalSize: number;
  // When the camera took it (its own clock), else when the file was saved.
  takenAt: string;
  // Not looked at yet, has animals, or nothing in it.
  status: 'new' | 'animal' | 'empty';
  // What's in it, when tagged (kept in step with tally).
  kinds: DeerKind[];
  // How many of each, with buck names: "2 does, 1 buck (Big 8)".
  tally?: PhotoTally[];
  // What MegaDetector found, and what that says about the photo.
  detections?: PhotoDetection[];
  ai?: 'animal' | 'empty' | 'unsure' | 'person' | null;
  notes: string | null;
  // The import it came in with.
  batchId: string;
}

export interface HubData {
  schemaVersion: 1;
  properties: Property[];
  markers: MapMarker[];
  areas: MapArea[];
  overlays: MapImageOverlay[];
  sections: Section[];
  plans: Plan[];
  reports: HuntReport[];
  fieldPins: FieldPin[];
  trails: MapTrail[];
  fieldTracks: FieldTrack[];
  photos: CameraPhoto[];
  actionItems: ActionItem[];
  settings: HubSettings;
}

export type Selection =
  | { kind: 'property'; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'area'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'report'; id: string }
  | { kind: 'trail'; id: string };
