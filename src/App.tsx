import type { Position } from 'geojson';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { AlignPanel, completePoints, type AlignDraft } from '@/components/AlignPanel';
import { DetailPanel } from '@/components/DetailPanel';
import { DrawBar, EditBar, LineEditBar } from '@/components/DrawBar';
import { ForecastPanel } from '@/components/ForecastPanel';
import { LayerPanel } from '@/components/LayerPanel';
import { MapToolbar } from '@/components/MapToolbar';
import { OfflineField } from '@/components/OfflineField';
import { ReportPanel } from '@/components/ReportPanel';
import { base64ToBytes, bytesToBase64, MAP_FILE_KIND, mapFileName, parseMapFile, pickRecords, type MapFile } from '@/lib/mapFile';
import { PHONE_FILE_KIND, shareJsonFile, STANDS_FILE_KIND, type PhoneFile, type StandsFile } from '@/field/fieldData';
import { SectionPanel } from '@/components/SectionPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ActionBoardPanel } from '@/components/ActionBoardPanel';
import { SchedulesPanel } from '@/components/SchedulesPanel';
import { SummaryPanel } from '@/components/SummaryPanel';
import { CameraPhotosInfo } from '@/components/CameraPhotosInfo';
import { CameraView } from '@/components/CameraView';
import { StandHistory } from '@/components/StandHistory';
import { Sidebar, SIDEBAR_WIDTH } from '@/components/Sidebar';
import { newRecordFields, useHubData } from '@/data/HubDataProvider';
import { useHubCamp } from '@/data/useHubCamp';
import { usePartnerSync } from '@/data/usePartnerSync';
import { useAutoOffline } from '@/map/useAutoOffline';
import { imageFileName, loadImageBytes, readImageSize, saveImage } from '@/data/images';
import { isDesktop } from '@/data/storage';
import { useForecast } from '@/data/useForecast';
import { useImageUrls } from '@/data/useImageUrls';
import { placeNotes } from '@/lib/actionBoard';
import { countShared } from '@/lib/partnerSync';
import { combineLines, cutParts, feetToMeters, joinParts, nearestLine, overlaps, removeFromParts } from '@/lib/combineTrails';
import { removeEntry, saveEntry, todayDate } from '@/lib/plotLog';
import { dueCards, isOverdue, logEntryFor, markDone, skipSeason, undoDone, type SchedulePlace } from '@/lib/schedules';
import { upcomingRows } from '@/lib/upcoming';
import { isHuntingSpot, isPlotType, pinTypeInfo, pinTypeList } from '@/lib/featureTypes';
import { acresOf, boundsOf, formatAcres, offsetPosition, placeName, pointsToPolygon, propertyContaining } from '@/lib/geo';
import { formatDistance, lineBounds, lineLengthM, metersBetween, TRAIL_KINDS, trailParts, trailStyle, trailTypeStyle, unpackPoints, withParts } from '@/lib/trails';
import { overlayCorners } from '@/lib/georef';
import { importGeoFile } from '@/lib/importGeo';
import { huntPosition, kindInfo, reportWeather } from '@/lib/reports';
import { newPlan } from '@/lib/plans';
import { compassPointOf, rateStands, sitsFor, type StandRating } from '@/lib/standRating';
import { followNearbyLines, ringsOf as ringsOfShapes } from '@/lib/snap';
import { areaTypeInfo, areaTypeList, categoryStyle, propertyColor } from '@/lib/styles';
import { hourAt, weatherAt, weatherFor } from '@/lib/weather';
import { UpdateBanner, useUpdateCheck } from '@/components/UpdateBanner';
import { DEFAULT_LAYERS, type MapLayersState } from '@/map/layers';
import { DEFAULT_CENTER, MapView, type AlignMarker, type MapViewHandle, type HuntSpotView, type OverlayView, type SightingView } from '@/map/MapView';
import type { ActionItem, AreaGeometry, AreaType, FieldNote, FieldPin, FieldTrack, HuntReport, MapArea, MapTrail, TrailKind, MapImageOverlay, MapMarker, MarkerType, Property, Selection } from '@/types/models';

type EditTarget = 'property' | 'section' | 'area' | 'trail';

// A shape's corners for reshaping: each outer ring without its repeated last
// point (holes are kept as they are), or a trail's points.
function ringsOf(geometry: AreaGeometry): Position[][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates[0].slice(0, -1)] : geometry.coordinates.map((poly) => poly[0].slice(0, -1));
}

function withRings(geometry: AreaGeometry, rings: Position[][]): AreaGeometry {
  const close = (ring: Position[]) => [...ring, ring[0]];
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: [close(rings[0]), ...geometry.coordinates.slice(1)] };
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly, i) => [close(rings[i]), ...poly.slice(1)]) };
}

type TrailPickAction = 'split' | 'join' | 'trim';

type Mode =
  | { kind: 'browse' }
  | { kind: 'place'; markerType: MarkerType }
  | { kind: 'draw'; target: 'property' }
  | { kind: 'draw'; target: 'section' }
  | { kind: 'draw'; target: 'area'; areaType: AreaType }
  | { kind: 'draw'; target: 'trail'; trailKind: TrailKind }
  // Reshaping a saved shape: drag its corners.
  | { kind: 'edit'; target: EditTarget; id: string }
  // Clicking the map picks where to split this trail, which trail to join it
  // to, or the two ends of a stretch to delete.
  | { kind: 'trailPick'; action: TrailPickAction; id: string; otherId?: string }
  | { kind: 'align' }
  // Clicking the map sets where a sighting in a hunt report happened.
  | { kind: 'placeSighting'; reportId: string; sightingId: string };

const MAX_IMPORTED_SHAPES = 50;
const STAND_NAME = /\b(stand|blind|tree ?stand|ladder|box)\b/i;
// The align panel's width (--detail-width under .has-align in styles.css) plus its gaps.
const ALIGN_PANEL_INSET = 520 + 24;
const DEFAULT_OVERLAY_OPACITY = 0.6;
// How close a click has to be to count as on a trail, in meters.
const TRAIL_PICK_M = 60;

function cornersPolygon(corners: OverlayView['corners']): AreaGeometry {
  return pointsToPolygon(corners);
}

// Where to get the weather: the chosen property, else the first one, else the
// middle of the stands, else Salem.
// Stands and blinds: the pins you hunt from.

const SIDEBAR_WIDTH_KEY = 'hunting-hub-sidebar-width';

function loadSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (saved >= SIDEBAR_WIDTH.min && saved <= SIDEBAR_WIDTH.max) return saved;
  } catch {
    // Not saved, or storage is blocked: use the default.
  }
  return SIDEBAR_WIDTH.default;
}

function saveSidebarWidth(width: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Only a convenience.
  }
}

function forecastLocation(property: Property | null, properties: Property[], markers: MapMarker[]): [number, number] {
  const target = property ?? properties[0];
  if (target) {
    const [w, s, e, n] = boundsOf(target.boundary);
    return [(w + e) / 2, (s + n) / 2];
  }
  if (markers.length > 0) {
    return [markers.reduce((t, m) => t + m.lng, 0) / markers.length, markers.reduce((t, m) => t + m.lat, 0) / markers.length];
  }
  return DEFAULT_CENTER;
}

export function App() {
  const hub = useHubData();
  const update = useUpdateCheck();
  // Properties, sections and areas, for filing trail camera photos by place.
  const photoPlaces = useMemo(() => ({ properties: hub.properties, sections: hub.sections, areas: hub.areas }), [hub.properties, hub.sections, hub.areas]);
  // Stands, blinds, platforms, and custom pin types marked as hunting locations.
  const isStandMarker = (m: MapMarker) => isHuntingSpot(m.type, hub.settings.customPinTypes);
  const mapRef = useRef<MapViewHandle>(null);
  const [layers, setLayers] = useState<MapLayersState>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [draftPoints, setDraftPoints] = useState<Position[]>([]);
  // While reshaping: the corners as they are now, and earlier versions for Undo.
  const [editRings, setEditRings] = useState<Position[][] | null>(null);
  const [editHistory, setEditHistory] = useState<Position[][][]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The sidebar's width, dragged from its edge (remembered on this PC).
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  // Forecast rating groups whose stands show scent cones on the map.
  const [coneGroups, setConeGroups] = useState<StandRating[]>([]);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [alignDraft, setAlignDraft] = useState<AlignDraft | null>(null);
  // The picked file for a new map image; it's only written to disk on Save.
  const [alignFile, setAlignFile] = useState<File | null>(null);
  const [savingAlign, setSavingAlign] = useState(false);
  const imageUrls = useImageUrls(hub.overlays);
  const [forecastOpen, setForecastOpen] = useState(false);
  // Settings shows in the sidebar over the lists (and over the forecast, if open).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  // The pin unlocked to be moved. It locks again once it's no longer selected.
  const [unlockedPinId, setUnlockedPinId] = useState<string | null>(null);
  // What the last Combine changed, so it can be undone.
  const [lastCombine, setLastCombine] = useState<{ trailId: string; before: MapTrail[]; createdIds: string[] } | null>(null);
  // Trail Cameras: open, hidden while a new camera is pinned, and that camera once pinned.
  const [camerasOpen, setCamerasOpen] = useState(false);
  const [cameraPinName, setCameraPinName] = useState<string | null>(null);
  const [newCameraId, setNewCameraId] = useState<string | null>(null);
  const [cameraFocus, setCameraFocus] = useState<string | null>(null);
  // null = rate stands for all properties.
  const [forecastPropertyId, setForecastPropertyId] = useState<string | null>(null);
  // null = now.
  const [forecastTime, setForecastTime] = useState<number | null>(null);
  // The plan open in a section's panel.
  const [openPlan, setOpenPlan] = useState<{ sectionId: string; planId: string } | null>(null);
  // Report id -> weather lookup state ('loading' or an error message).
  const [weatherStatus, setWeatherStatus] = useState<Record<string, string>>({});
  // The picked sit ('now', '2026-11-02-am', ...), or null for a single picked hour.
  const [forecastSitId, setForecastSitId] = useState<string | null>('now');
  const forecastProperty = hub.properties.find((p) => p.id === forecastPropertyId) ?? null;
  const [forecastState, refreshForecast] = useForecast(
    forecastLocation(forecastProperty, hub.properties, hub.markers),
    forecastOpen,
  );

  useEffect(() => {
    window.hub?.dataPath().then(setDataPath).catch(() => undefined);
  }, []);

  const nextName = (label: string, existing: { name: string }[]) => {
    const used = new Set(existing.map((r) => r.name));
    for (let n = 1; ; n++) if (!used.has(`${label} ${n}`)) return `${label} ${n}`;
  };

  const cancelMode = useCallback(() => {
    setMode({ kind: 'browse' });
    setDraftPoints([]);
    setEditRings(null);
    setEditHistory([]);
  }, []);

  // Reshape a saved shape: its corners get handles until Done or Cancel.
  const startEdit = (target: EditTarget, id: string) => {
    const shape =
      target === 'property'
        ? hub.properties.find((p) => p.id === id)?.boundary
        : target === 'section'
          ? hub.sections.find((s) => s.id === id)?.geometry
          : target === 'area'
            ? hub.areas.find((a) => a.id === id)?.geometry
            : null;
    const trail = target === 'trail' ? hub.trails.find((t) => t.id === id) : null;
    const rings = shape ? ringsOf(shape) : trail ? trailParts(trail) : null;
    if (!rings) return;
    setDraftPoints([]);
    setEditRings(rings);
    setEditHistory([]);
    setMode({ kind: 'edit', target, id });
  };

  // Back to editing a line after a tool changed it, before the saved copy has updated.
  const editLine = (id: string, parts: Position[][]) => {
    setDraftPoints([]);
    setEditRings(parts);
    setEditHistory([]);
    setMode({ kind: 'edit', target: 'trail', id });
  };

  const finishEdit = useCallback(() => {
    if (mode.kind !== 'edit' || !editRings) return;
    if (mode.target === 'property') {
      const p = hub.properties.find((r) => r.id === mode.id);
      if (p) hub.saveProperty({ ...p, boundary: withRings(p.boundary, editRings) });
    } else if (mode.target === 'section') {
      const s = hub.sections.find((r) => r.id === mode.id);
      if (s) {
        // Stretches left close to the property line land exactly on it, as they do when drawing.
        const lines = ringsOfShapes(hub.properties.map((p) => p.boundary));
        const followed = hub.settings.snapping.enabled
          ? editRings.map((ring) => {
              const closed = [...ring, ring[0]];
              const result = followNearbyLines(closed, lines);
              return result === closed ? ring : result.slice(0, -1);
            })
          : editRings;
        hub.saveSection({ ...s, geometry: withRings(s.geometry, followed) });
        if (followed.some((ring, i) => ring !== editRings[i])) setNotice(`${s.name} now follows the property line where it runs close to it.`);
      }
    } else if (mode.target === 'area') {
      const a = hub.areas.find((r) => r.id === mode.id);
      if (a) hub.saveArea({ ...a, geometry: withRings(a.geometry, editRings) });
    } else {
      const t = hub.trails.find((r) => r.id === mode.id);
      if (t) hub.saveTrail(withParts(t, editRings));
    }
    const selected: Selection = mode.target === 'property' ? { kind: 'property', id: mode.id } : mode.target === 'section' ? { kind: 'section', id: mode.id } : mode.target === 'area' ? { kind: 'area', id: mode.id } : { kind: 'trail', id: mode.id };
    cancelMode();
    setSelection(selected);
  }, [mode, editRings, hub, cancelMode]);

  const undoEdit = useCallback(() => {
    setEditHistory((history) => {
      if (history.length === 0) return history;
      setEditRings(history[history.length - 1]);
      return history.slice(0, -1);
    });
  }, []);

  const startMode = (next: Mode) => {
    setSelection(null);
    setDraftPoints([]);
    setMode(next);
  };

  const finishDrawing = useCallback(() => {
    if (mode.kind !== 'draw' || draftPoints.length < (mode.target === 'trail' ? 2 : 3)) return;
    if (mode.target === 'trail') {
      const record: MapTrail = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, draftPoints[0])?.id ?? null,
        kind: mode.trailKind,
        name: nextName(TRAIL_KINDS[mode.trailKind].label, hub.trails),
        line: { type: 'LineString', coordinates: draftPoints },
        notes: null,
        source: 'drawn',
      };
      hub.saveTrail(record);
      setSelection({ kind: 'trail', id: record.id });
      cancelMode();
      return;
    }
    const geometry = pointsToPolygon(draftPoints);
    if (mode.target === 'property') {
      const record = {
        ...newRecordFields(),
        name: nextName('Property', hub.properties),
        owner: null,
        source: 'drawn' as const,
        boundary: geometry,
        notes: null,
      };
      hub.saveProperty(record);
      setSelection({ kind: 'property', id: record.id });
    } else if (mode.target === 'section') {
      const drawn = geometry.coordinates[0];
      const ring = hub.settings.snapping.enabled ? followNearbyLines(drawn, ringsOfShapes(hub.properties.map((p) => p.boundary))) : drawn;
      const record = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, draftPoints[0])?.id ?? null,
        name: nextName('Section', hub.sections),
        geometry: { ...geometry, coordinates: [ring] },
        notes: null,
      };
      hub.saveSection(record);
      setSelection({ kind: 'section', id: record.id });
      if (ring !== drawn) setNotice(`${record.name} now follows the property line where you drew close to it.`);
    } else {
      const label = areaTypeInfo(mode.areaType, hub.settings).label;
      const record = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, draftPoints[0])?.id ?? null,
        type: mode.areaType,
        name: nextName(label, hub.areas),
        geometry,
        notes: null,
      };
      hub.saveArea(record);
      setSelection({ kind: 'area', id: record.id });
    }
    cancelMode();
  }, [mode, draftPoints, hub, cancelMode]);

  const startAlignNew = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const { width, height } = await readImageSize(url);
      setSelection(null);
      setAlignFile(file);
      setAlignDraft({
        overlayId: crypto.randomUUID(),
        isNew: true,
        name: file.name.replace(/\.[^.]+$/, ''),
        url,
        width,
        height,
        points: [],
        opacity: DEFAULT_OVERLAY_OPACITY,
      });
      setMode({ kind: 'align' });
    } catch (error) {
      URL.revokeObjectURL(url);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const startRealign = (overlay: MapImageOverlay) => {
    const url = imageUrls[overlay.fileName];
    if (!url) {
      setNotice('That map image is still loading. Try again in a moment.');
      return;
    }
    setSelection(null);
    setAlignFile(null);
    setAlignDraft({
      overlayId: overlay.id,
      isNew: false,
      name: overlay.name,
      url,
      width: overlay.imageWidth,
      height: overlay.imageHeight,
      points: overlay.controlPoints,
      opacity: overlay.opacity,
    });
    setMode({ kind: 'align' });
    const corners = overlayCorners(overlay.controlPoints, overlay.imageWidth, overlay.imageHeight);
    if (corners) mapRef.current?.fitTo(cornersPolygon(corners), ALIGN_PANEL_INSET);
  };

  const endAlign = () => {
    if (alignDraft?.isNew) URL.revokeObjectURL(alignDraft.url);
    setAlignDraft(null);
    setAlignFile(null);
    setMode({ kind: 'browse' });
  };

  const saveAlign = async () => {
    if (!alignDraft) return;
    const controlPoints = completePoints(alignDraft.points);
    if (controlPoints.length < 2) return;
    setSavingAlign(true);
    try {
      const existing = hub.overlays.find((o) => o.id === alignDraft.overlayId);
      let fileName = existing?.fileName;
      if (!fileName) {
        if (!alignFile) throw new Error('The image file is missing.');
        fileName = imageFileName(alignDraft.overlayId, alignFile.name);
        await saveImage(fileName, alignFile);
      }
      const at = new Date().toISOString();
      hub.saveOverlay({
        id: alignDraft.overlayId,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        deletedAt: null,
        name: alignDraft.name.trim() || 'Map image',
        fileName,
        imageWidth: alignDraft.width,
        imageHeight: alignDraft.height,
        controlPoints,
        opacity: alignDraft.opacity,
        visible: true,
      });
      endAlign();
      setSelection({ kind: 'overlay', id: alignDraft.overlayId });
    } catch (error) {
      setNotice(`Could not save the map image: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingAlign(false);
    }
  };

  // Where a report's weather is looked up: its stand or new spot, else the first property.
  const reportLocation = (report: HuntReport): [number, number] => huntPosition(report, hub.markers) ?? forecastLocation(null, hub.properties, hub.markers);

  const fillWeather = async (report: HuntReport) => {
    setWeatherStatus((s) => ({ ...s, [report.id]: 'loading' }));
    try {
      const [lng, lat] = reportLocation(report);
      const { hour, pressure } = await weatherFor(lat, lng, Date.parse(report.start));
      // Merge into the latest copy, so edits made while waiting aren't lost.
      hub.patchReport(report.id, { weather: reportWeather(hour, pressure) });
      setWeatherStatus((s) => ({ ...s, [report.id]: 'idle' }));
    } catch (error) {
      setWeatherStatus((s) => ({
        ...s,
        [report.id]: `Couldn't get the weather (${error instanceof Error ? error.message : String(error)}). It needs internet, and only goes back about 3 months.`,
      }));
    }
  };

  // Brings in hunts and pins from phones, by file or from camp. What the hub
  // added to them (weather, and whether a pin was added to the map) is kept.
  const bringInFromPhones = (incomingReports: HuntReport[], incomingPins: FieldPin[], incomingTracks: FieldTrack[] = [], incomingNotes: FieldNote[] = []) => {
    const all = hub.allData;
    // Notes become board cards, or entries in a food plot's log.
    const placed = placeNotes(incomingNotes, all?.actionItems ?? [], all?.areas ?? [], (lng, lat) => propertyContaining(hub.properties, [lng, lat])?.id ?? null);
    for (const area of placed.areas) hub.saveArea(area);
    if (placed.items.length + placed.updated.length) hub.mergeRecords({ actionItems: [...placed.items, ...placed.updated] });
    const reports = incomingReports.map((r) => {
      const have = all?.reports.find((h) => h.id === r.id);
      return {
        ...r,
        // Phone hunts know their stand; link the property from it here.
        propertyId: r.propertyId ?? hub.markers.find((m) => m.id === r.standId)?.propertyId ?? null,
        weather: r.weather ?? have?.weather ?? null,
      };
    });
    const pins = incomingPins.map((p) => {
      const have = all?.fieldPins.find((h) => h.id === p.id);
      return have ? { ...p, status: have.status, markerId: have.markerId } : p;
    });
    const tracks = incomingTracks.map((t) => {
      const have = all?.fieldTracks.find((h) => h.id === t.id);
      return have ? { ...t, status: have.status, trailId: have.trailId } : t;
    });
    const merged = hub.mergeFromPhone({ reports, fieldPins: pins, fieldTracks: tracks });
    const result = { added: merged.added + placed.items.length + placed.areas.length, updated: merged.updated + placed.updated.length };
    // The phone has no internet in the stand, so look up weather for its hunts now.
    for (const r of reports) {
      const have = all?.reports.find((h) => h.id === r.id);
      if (!r.weather && !(have && have.updatedAt >= r.updatedAt)) void fillWeather(r);
    }
    return result;
  };

  // Phone pins and walks already added to the map or dismissed here.
  const campHandled: Record<string, 'added' | 'dismissed'> = {};
  for (const p of hub.allData?.fieldPins ?? []) if (p.status !== 'new') campHandled[p.id] = p.status;
  for (const t of hub.allData?.fieldTracks ?? []) if (t.status !== 'new') campHandled[t.id] = t.status;
  // Phone notes the hub has taken in, onto the board or into a food plot's log.
  for (const i of hub.allData?.actionItems ?? []) if (i.source === 'phone') campHandled[i.id] = i.deletedAt ? 'dismissed' : 'added';
  for (const a of hub.allData?.areas ?? []) for (const e of a.log ?? []) if (e.fromPhone) campHandled[e.id] = 'added';
  const campPlots = hub.areas
    .filter((a) => isPlotType(a.type, areaTypeInfo(a.type, hub.settings).label))
    .map((a) => ({ id: a.id, name: a.name, planted: a.planted ?? null }));

  // Camp sync: hunts and pins arrive from phones, and stands go out to them.
  const campStands = (hub.allData?.markers ?? []).filter(isStandMarker).map((m) => ({
    id: m.id,
    name: m.name,
    lat: m.lat,
    lng: m.lng,
    goodWinds: m.goodWinds,
    place: placeName(hub.properties, hub.sections, [m.lng, m.lat]),
    updatedAt: m.updatedAt,
    deletedAt: m.deletedAt,
  }));
  const camp = useHubCamp(hub.settings.camp ?? null, campStands, ({ reports, pins, tracks, notes }) => {
    const before = new Set(
      [...(hub.allData?.reports ?? []), ...(hub.allData?.fieldPins ?? []), ...(hub.allData?.fieldTracks ?? []), ...(hub.allData?.actionItems ?? []), ...(hub.allData?.areas ?? []).flatMap((a) => a.log ?? [])].map((r) => r.id),
    );
    const freshHunts = reports.filter((r) => !before.has(r.id));
    const freshPins = pins.filter((p) => !before.has(p.id));
    const freshWalks = tracks.filter((t) => !before.has(t.id));
    const freshNotes = notes.filter((n) => !before.has(n.id) && !n.deletedAt);
    bringInFromPhones(reports, pins, tracks, notes);
    if (freshHunts.length + freshPins.length + freshWalks.length + freshNotes.length === 0) return;
    const who = [...new Set([...freshHunts, ...freshPins, ...freshWalks, ...freshNotes].map((r) => r.loggedBy).filter(Boolean))].join(', ');
    const parts = [
      freshHunts.length ? `${freshHunts.length} hunt${freshHunts.length === 1 ? '' : 's'}` : '',
      freshPins.length ? `${freshPins.length} pin${freshPins.length === 1 ? '' : 's'}` : '',
      freshWalks.length ? `${freshWalks.length} walk${freshWalks.length === 1 ? '' : 's'}` : '',
      freshNotes.length ? `${freshNotes.length} note${freshNotes.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    setNotice(`New from camp: ${parts.join(' and ')}${who ? ` from ${who}` : ''}.`);
  }, hub.settings.customPinTypes, campHandled, campPlots);

  // Every property's maps kept saved on this PC in the background (desktop app).
  const autoOffline = useAutoOffline({ properties: hub.properties, layers, enabled: hub.settings.offlineAuto !== false, radiusM: hub.settings.offlineRadiusM });

  // The map, plans, logs and board shared with the camp's other partners.
  const partnerSync = usePartnerSync({
    camp: hub.settings.camp ?? null,
    manager: camp.manager,
    data: hub.allData,
    pinTypes: hub.settings.customPinTypes,
    areaTypes: hub.settings.customAreaTypes,
    mergeRecords: hub.mergeRecords,
    patchCamp: hub.patchCamp,
    onNotice: setNotice,
  });

  useEffect(() => {
    if (selection?.kind !== 'marker' || selection.id !== unlockedPinId) setUnlockedPinId(null);
  }, [selection, unlockedPinId]);

  // Schedules coming due put a To do card on the Action Board.
  useEffect(() => {
    if (!hub.allData) return;
    const places: SchedulePlace[] = [...hub.areas.map((a) => ({ ...a, kind: 'area' as const })), ...hub.sections.map((s) => ({ ...s, kind: 'section' as const }))];
    const cards = dueCards(places, hub.allData.actionItems, hub.settings.scheduleLeadDays, todayDate());
    if (cards.length === 0) return;
    hub.mergeRecords({ actionItems: cards });
    setNotice(`${cards.length} scheduled job${cards.length === 1 ? '' : 's'} added to To do on the Action Board.`);
  }, [hub.allData]);

  // Brings in a file saved by the phone's Send tab.
  const importPhone = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as PhoneFile;
      if (parsed.kind !== PHONE_FILE_KIND) throw new Error("That isn't a file from the phone's Send tab.");
      const notes = parsed.notes ?? [];
      const { added, updated } = bringInFromPhones(parsed.reports, parsed.pins, parsed.tracks ?? [], notes);
      setNotice(
        added + updated === 0
          ? 'Nothing new in that file.'
          : `Brought in ${parsed.pins.length} pin${parsed.pins.length === 1 ? '' : 's'}, ${parsed.reports.length} hunt${parsed.reports.length === 1 ? '' : 's'} and ${notes.length} note${notes.length === 1 ? '' : 's'} (${added} new, ${updated} updated).`,
      );
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Saves one property (or the whole map, when propertyId is null) as a file to send to someone else's hub.
  const exportMap = async (propertyId: string | null) => {
    if (!hub.allData) return;
    try {
      const records = pickRecords(hub.allData, propertyId);
      const title = propertyId ? (records.properties[0]?.name ?? 'Property') : 'Whole map';
      const images: Record<string, string> = {};
      let missing = 0;
      for (const o of records.overlays) {
        if (o.deletedAt) continue;
        const bytes = await loadImageBytes(o.fileName);
        if (bytes) images[o.fileName] = bytesToBase64(bytes);
        else missing += 1;
      }
      const usedTypes = new Set(records.areas.map((a) => a.type));
      const file: MapFile = {
        kind: MAP_FILE_KIND,
        version: 1,
        exportedAt: new Date().toISOString(),
        title,
        records,
        customAreaTypes: hub.settings.customAreaTypes.filter((t) => usedTypes.has(t.id)),
        customPinTypes: hub.settings.customPinTypes.filter((t) => records.markers.some((m) => m.type === t.id)),
        images,
      };
      const name = mapFileName(title);
      await shareJsonFile(name, file);
      const count = <T extends { deletedAt: string | null }>(list: T[], word: string) => {
        const n = list.filter((r) => !r.deletedAt).length;
        return `${n} ${word}${n === 1 ? '' : 's'}`;
      };
      const imageCount = Object.keys(images).length;
      setNotice(
        `Saved "${name}" (${count(records.markers, 'pin')}, ${count(records.areas, 'area')}, ${count(records.reports, 'hunt')}, ${imageCount} map image${imageCount === 1 ? '' : 's'}).` +
          (missing ? ` ${missing} map image file${missing === 1 ? ' was' : 's were'} missing and left out.` : '') +
          ' Send it by email, text or a USB stick; they open it with Import a map file.',
      );
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
      setNotice(`Could not save the map file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Brings in a map file saved by another hub (or this one).
  const importMap = async (file: File) => {
    try {
      const parsed = parseMapFile(await file.text());
      for (const [name, base64] of Object.entries(parsed.images)) {
        await saveImage(name, new Blob([new Uint8Array(base64ToBytes(base64))]));
      }
      const { added, updated } = hub.mergeRecords(parsed.records, parsed.customAreaTypes, parsed.customPinTypes);
      setNotice(
        added + updated === 0
          ? `Nothing new in "${parsed.title}". This map already has all of it.`
          : `Brought in "${parsed.title}": ${added} new and ${updated} updated items.`,
      );
      const shown = parsed.records.properties.filter((p) => !p.deletedAt);
      if (shown.length) mapRef.current?.fitTo(combinedBounds(shown.map((p) => p.boundary)));
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendStandsToPhone = () => {
    const stands = hub.markers.filter(isStandMarker).map((m) => ({
      id: m.id,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      goodWinds: m.goodWinds,
      place: placeName(hub.properties, hub.sections, [m.lng, m.lat]),
    }));
    const file: StandsFile = { kind: STANDS_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), stands };
    void shareJsonFile('fenceline-stands.json', file).then(() =>
      setNotice(`Saved fenceline-stands.json with ${stands.length} stands. Get it onto the phone (email or iCloud Drive), then load it on the phone's Send tab.`),
    );
  };

  // Folds overlapping lines of the same type into this one.
  const combineTrails = (record: MapTrail, feet: number) => {
    const distance = feetToMeters(feet);
    // The record may hold corners just dragged, newer than the saved copy.
    const sameKind = hub.trails.filter((t) => t.kind === record.kind).map((t) => (t.id === record.id ? record : t));
    // Each branch goes in as a line of its own, and what's left is put back together.
    const partId = (trailId: string, index: number) => (index === 0 ? trailId : `${trailId}#${index}`);
    const result = combineLines(sameKind.flatMap((t) => trailParts(t).map((points, i) => ({ id: partId(t.id, i), points }))), record.id, distance);
    if (result.removed.length === 0 && result.changed.size === 0 && result.branches.length === 0) {
      const otherTypes = hub.trails.filter((t) => t.kind !== record.kind && overlaps(record.line.coordinates, t.line.coordinates, distance));
      setNotice(
        otherTypes.length > 0
          ? `${otherTypes.map((t) => t.name).join(', ')} overlap${otherTypes.length === 1 ? 's' : ''} this line but ${otherTypes.length === 1 ? 'is' : 'are'} a different type. Set the same type to combine them.`
          : `No other lines of this type run within ${feet} ft of this one.`,
      );
      editLine(record.id, trailParts(record));
      return;
    }
    const removed = new Set(result.removed);
    const before: MapTrail[] = [];
    let count = 0;
    let ownParts = trailParts(record);
    for (const trail of sameKind) {
      const ids = trailParts(trail).map((_, i) => partId(trail.id, i));
      const own = trail.id === record.id;
      if (!own && !ids.some((id) => removed.has(id) || result.changed.has(id))) continue;
      before.push(trail);
      const parts = trailParts(trail).flatMap((part, i) => (removed.has(ids[i]) ? [] : [result.changed.get(ids[i]) ?? part]));
      if (own) ownParts = [...parts, ...result.branches.map((branch) => branch.points)];
      else if (parts.length > 0) hub.saveTrail(withParts(trail, parts));
      else {
        hub.deleteTrail(trail.id);
        count++;
      }
    }
    hub.saveTrail(withParts(record, ownParts));
    setLastCombine({ trailId: record.id, before, createdIds: [] });
    const branches = result.branches.length ? ` ${result.branches.length} turn-off${result.branches.length === 1 ? '' : 's'} kept on it as ${result.branches.length === 1 ? 'a branch' : 'branches'}.` : '';
    const shorter = count === 0 ? ` It's now ${formatDistance(ownParts.reduce((total, part) => total + lineLengthM(part), 0))}.` : '';
    setNotice(`${count ? `Combined ${count} line${count === 1 ? '' : 's'} into ${record.name}.` : `Removed where ${record.name} doubled back on itself.`}${shorter}${branches}`);
    editLine(record.id, ownParts);
  };

  // A click on the map while splitting a trail or picking one to join it to.
  const pickOnTrail = (id: string, action: TrailPickAction, position: Position) => {
    const record = hub.trails.find((t) => t.id === id);
    if (!record) return cancelMode();
    const onThisTrail = nearestLine(trailParts(record).map((points, i) => ({ id: String(i), points })), position, TRAIL_PICK_M);
    // Saves what a cut left: the first set stays this trail, any others become new ones.
    const saveCut = (groups: Position[][][]) => {
      const taken = new Set(hub.trails.map((t) => t.name));
      const created = groups.slice(1).map((parts) => {
        let n = 2;
        while (taken.has(`${record.name} ${n}`)) n++;
        taken.add(`${record.name} ${n}`);
        return withParts({ ...record, ...newRecordFields(), name: `${record.name} ${n}`, propertyId: propertyContaining(hub.properties, parts[0][0])?.id ?? record.propertyId }, parts);
      });
      setLastCombine({ trailId: record.id, before: [record], createdIds: created.map((t) => t.id) });
      hub.saveTrail(withParts(record, groups[0]));
      for (const trail of created) hub.saveTrail(trail);
      editLine(record.id, groups[0]);
      setSelection({ kind: 'trail', id: record.id });
      return created;
    };
    if (action === 'trim') {
      if (!onThisTrail) return setNotice('Click on the line.');
      if (draftPoints.length === 0) return setDraftPoints([position]);
      const groups = removeFromParts(trailParts(record), draftPoints[0], position);
      setDraftPoints([]);
      if (!groups) return setNotice('Both spots need to be on the same stretch of the line. Click the first one again.');
      if (groups.length === 0) return setNotice('That would delete the whole line. Use Delete on its panel for that.');
      const created = saveCut(groups);
      setNotice(created.length > 0 ? `Deleted that part. The rest is now ${[record, ...created].map((t) => t.name).join(' and ')}.` : `Deleted that part of ${record.name}.`);
    } else if (action === 'split') {
      if (!onThisTrail) return setNotice('Click on the line to split it there.');
      const groups = cutParts(trailParts(record), position);
      if (!groups) return setNotice("That's right at the end of the line, or it still connects another way. Click somewhere else on it.");
      const created = saveCut(groups);
      setNotice(`Split into ${[record, ...created].map((t) => t.name).join(' and ')}.`);
    } else {
      const others = hub.trails.filter((t) => t.id !== id).flatMap((t) => trailParts(t).map((points) => ({ id: t.id, points })));
      const picked = nearestLine(others, position, TRAIL_PICK_M);
      if (!picked) return setNotice('Click on the line you want to join to this one.');
      setMode({ kind: 'trailPick', action, id, otherId: picked.id });
    }
  };

  // The second click's line becomes part of this one, whichever way they meet.
  const confirmJoin = () => {
    if (mode.kind !== 'trailPick' || !mode.otherId) return;
    const record = hub.trails.find((t) => t.id === mode.id);
    const other = hub.trails.find((t) => t.id === mode.otherId);
    if (!record || !other) return cancelMode();
    const { parts, gapM } = joinParts(trailParts(record), trailParts(other));
    setLastCombine({ trailId: record.id, before: [record, other], createdIds: [] });
    const notes = [record.notes, other.notes].filter(Boolean).join('\n') || null;
    hub.saveTrail(withParts({ ...record, notes }, parts));
    hub.deleteTrail(other.id);
    setNotice(`Joined ${other.name} into ${record.name}${gapM >= 1 ? `, bridging ${formatDistance(gapM)} with a straight line` : ''}.`);
    editLine(record.id, parts);
  };

  // While editing a line, clicking another one offers to join them.
  const clickTrailWhileEditing = (ids: string[]) => {
    if (mode.kind !== 'edit' || mode.target !== 'trail') return;
    const otherId = ids.find((id) => id !== mode.id);
    if (!otherId) return;
    saveLineEdit();
    setEditRings(null);
    setEditHistory([]);
    setDraftPoints([]);
    setMode({ kind: 'trailPick', action: 'join', id: mode.id, otherId });
  };

  // Undo while editing a line: corners dragged since the last tool, then that tool.
  const undoLineEdit = () => {
    if (editHistory.length > 0) return undoEdit();
    if (!lastCombine) return;
    for (const trail of lastCombine.before) hub.saveTrail(trail);
    for (const id of lastCombine.createdIds) hub.deleteTrail(id);
    const own = lastCombine.before.find((t) => t.id === lastCombine.trailId);
    if (own) setEditRings(trailParts(own));
    setLastCombine(null);
    setNotice('Undone.');
  };

  // Dragged corners are saved before a tool runs, so the tool works on what's on screen.
  const saveLineEdit = () => {
    if (mode.kind !== 'edit' || !editRings) return null;
    const trail = hub.trails.find((t) => t.id === mode.id);
    if (!trail) return null;
    const record = withParts(trail, editRings);
    if (editHistory.length > 0) hub.saveTrail(record);
    return record;
  };

  // Leaving Split, Join or Delete part without finishing it.
  const backToLineEdit = () => {
    const trail = mode.kind === 'trailPick' ? hub.trails.find((t) => t.id === mode.id) : null;
    if (trail) editLine(trail.id, trailParts(trail));
    else cancelMode();
  };

  // Walks recorded on phones: look at one, turn it into a trail or (walked all the
  // way around) an area, or dismiss it.
  const handleFieldTrack = (id: string, action: 'show' | 'add' | 'area' | 'dismiss') => {
    const track = hub.fieldTracks.find((t) => t.id === id);
    if (!track) return;
    const points = unpackPoints(track.coords);
    if (points.length < 2) return;
    if (action === 'show') {
      const [w, s, e, n] = lineBounds({ type: 'LineString', coordinates: points });
      mapRef.current?.fitTo({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
    } else if (action === 'dismiss') {
      hub.saveFieldTrack({ ...track, status: 'dismissed' });
    } else if (action === 'area') {
      // The walk ends near where it began; the outline closes back to the first point.
      const ring = points.length > 3 && metersBetween(points[0], points[points.length - 1]) < 3 ? points.slice(0, -1) : points;
      if (ring.length < 3) {
        setNotice('This walk has too few points to make an area.');
        return;
      }
      const label = areaTypeInfo('other', hub.settings).label;
      const area: MapArea = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, ring[0])?.id ?? null,
        type: 'other',
        name: nextName(label, hub.areas),
        geometry: pointsToPolygon(ring),
        notes: track.loggedBy ? `Walked by ${track.loggedBy}` : null,
      };
      hub.saveArea(area);
      hub.saveFieldTrack({ ...track, status: 'added', areaId: area.id });
      setSelection({ kind: 'area', id: area.id });
      setNotice(`${area.name} is the shape you walked. Pick its type and name on its panel.`);
    } else {
      const trail: MapTrail = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, points[0])?.id ?? null,
        kind: 'path',
        name: track.name,
        line: { type: 'LineString', coordinates: points },
        notes: track.loggedBy ? `Walked by ${track.loggedBy}` : null,
        source: 'walked',
      };
      hub.saveTrail(trail);
      hub.saveFieldTrack({ ...track, status: 'added', trailId: trail.id });
      setSelection({ kind: 'trail', id: trail.id });
    }
  };

  const handleFieldPin = (id: string, action: 'show' | 'add' | 'dismiss') => {
    const pin = hub.fieldPins.find((p) => p.id === id);
    if (!pin) return;
    const moving = pin.moveStandId ? (hub.markers.find((m) => m.id === pin.moveStandId) ?? null) : null;
    if (action === 'show') {
      mapRef.current?.flyTo(pin.lng, pin.lat);
    } else if (action === 'dismiss') {
      hub.saveFieldPin({ ...pin, status: 'dismissed' });
    } else if (moving) {
      // A stand moved in the field: same stand and history, new spot.
      hub.saveMarker({
        ...moving,
        lng: pin.lng,
        lat: pin.lat,
        propertyId: propertyContaining(hub.properties, [pin.lng, pin.lat])?.id ?? moving.propertyId,
        updatedAt: new Date().toISOString(),
      });
      hub.saveFieldPin({ ...pin, status: 'added', markerId: moving.id });
      setSelection({ kind: 'marker', id: moving.id });
      zoomTo({ kind: 'marker', id: moving.id });
    } else {
      const marker: MapMarker = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, [pin.lng, pin.lat])?.id ?? null,
        type: pin.type,
        name: nextName(pinTypeInfo(pin.type, hub.settings.customPinTypes).label, hub.markers),
        lng: pin.lng,
        lat: pin.lat,
        notes: pin.note,
        goodWinds: [],
      };
      hub.saveMarker(marker);
      hub.saveFieldPin({ ...pin, status: 'added', markerId: marker.id });
      setSelection({ kind: 'marker', id: marker.id });
      zoomTo({ kind: 'marker', id: marker.id });
    }
  };

  const startReport = (standId: string | null) => {
    const stand = hub.markers.find((m) => m.id === standId) ?? null;
    const report: HuntReport = {
      ...newRecordFields(),
      standId: stand?.id ?? null,
      propertyId: stand?.propertyId ?? null,
      start: new Date().toISOString(),
      end: null,
      weather: null,
      sightings: [],
      notes: null,
      source: 'hub',
    };
    hub.saveReport(report);
    cancelMode();
    setSelection({ kind: 'report', id: report.id });
    void fillWeather(report);
  };

  const handleMapClick = (position: Position) => {
    if (mode.kind === 'trailPick') {
      pickOnTrail(mode.id, mode.action, position);
      return;
    }
    if (mode.kind === 'placeSighting') {
      const report = hub.reports.find((r) => r.id === mode.reportId);
      if (report) {
        hub.saveReport({
          ...report,
          sightings: report.sightings.map((s) => (s.id === mode.sightingId ? { ...s, lng: position[0], lat: position[1] } : s)),
        });
      }
      cancelMode();
      setSelection({ kind: 'report', id: mode.reportId });
      return;
    }
    if (mode.kind === 'align' && alignDraft) {
      const waiting = alignDraft.points.findIndex((p) => p.map === null);
      if (waiting === -1) {
        setNotice('Click a spot on the image first, then the same spot on the map.');
        return;
      }
      const points = [...alignDraft.points];
      points[waiting] = { ...points[waiting], map: [position[0], position[1]] };
      setAlignDraft({ ...alignDraft, points });
    } else if (mode.kind === 'draw') {
      setDraftPoints((points) => [...points, position]);
    } else if (mode.kind === 'place') {
      const record: MapMarker = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, position)?.id ?? null,
        type: mode.markerType,
        name: cameraPinName ?? nextName(pinTypeInfo(mode.markerType, hub.settings.customPinTypes).label, hub.markers),
        lng: position[0],
        lat: position[1],
        notes: null,
        goodWinds: [],
      };
      hub.saveMarker(record);
      cancelMode();
      if (cameraPinName) {
        // Back to the photo import with the new camera picked.
        setCameraPinName(null);
        setNewCameraId(record.id);
      } else {
        setSelection({ kind: 'marker', id: record.id });
      }
    }
  };

  const handleMarkerMoved = (id: string, position: Position) => {
    const marker = hub.markers.find((m) => m.id === id);
    if (!marker) return;
    hub.saveMarker({
      ...marker,
      lng: position[0],
      lat: position[1],
      propertyId: propertyContaining(hub.properties, position)?.id ?? null,
    });
  };

  const handleImport = async (file: File) => {
    try {
      const result = await importGeoFile(file);
      const shapes = result.shapes.slice(0, MAX_IMPORTED_SHAPES);
      if (shapes.length === 0 && result.points.length === 0) {
        setNotice(`No property shapes or waypoints found in ${file.name}.`);
        return;
      }
      const imported = shapes.map((shape) => ({
        ...newRecordFields(),
        name: shape.name ?? nextName('Property', hub.properties),
        owner: shape.owner,
        source: 'imported' as const,
        boundary: shape.geometry,
        notes: null,
      }));
      imported.forEach(hub.saveProperty);
      const allProperties = [...hub.properties, ...imported];
      for (const point of result.points) {
        const type: MarkerType = point.name && STAND_NAME.test(point.name) ? 'stand' : 'other';
        hub.saveMarker({
          ...newRecordFields(),
          propertyId: propertyContaining(allProperties, point.position)?.id ?? null,
          type,
          name: point.name ?? nextName(pinTypeInfo(type).label, hub.markers),
          lng: point.position[0],
          lat: point.position[1],
          notes: null,
          goodWinds: [],
        });
      }

      const skipped = result.shapes.length - shapes.length;
      setNotice(
        `Imported ${shapes.length} boundar${shapes.length === 1 ? 'y' : 'ies'} and ${result.points.length} pin${result.points.length === 1 ? '' : 's'}` +
          (skipped > 0 ? ` (skipped ${skipped} extra shapes).` : '.'),
      );
      if (imported[0]) {
        setSelection({ kind: 'property', id: imported[0].id });
        mapRef.current?.fitTo(combinedBounds(imported.map((p) => p.boundary)));
      } else if (result.points[0]) {
        mapRef.current?.flyTo(result.points[0].position[0], result.points[0].position[1]);
      }
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const zoomTo = (target: Selection) => {
    if (target.kind === 'report') {
      const report = hub.reports.find((r) => r.id === target.id);
      if (report) {
        const [lng, lat] = reportLocation(report);
        mapRef.current?.flyTo(lng, lat);
      }
      return;
    }
    if (target.kind === 'marker') {
      const m = hub.markers.find((r) => r.id === target.id);
      if (m) mapRef.current?.flyTo(m.lng, m.lat);
    } else if (target.kind === 'trail') {
      const t = hub.trails.find((r) => r.id === target.id);
      if (t) {
        const [w, s, e, n] = lineBounds({ type: 'LineString', coordinates: trailParts(t).flat() });
        mapRef.current?.fitTo({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
      }
    } else if (target.kind === 'overlay') {
      const o = hub.overlays.find((r) => r.id === target.id);
      const corners = o && overlayCorners(o.controlPoints, o.imageWidth, o.imageHeight);
      if (corners) mapRef.current?.fitTo(cornersPolygon(corners));
    } else {
      const geometry =
        target.kind === 'property'
          ? hub.properties.find((r) => r.id === target.id)?.boundary
          : target.kind === 'section'
            ? hub.sections.find((r) => r.id === target.id)?.geometry
            : hub.areas.find((r) => r.id === target.id)?.geometry;
      if (geometry) mapRef.current?.fitTo(geometry);
    }
  };

  // Keyboard shortcuts for drawing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      // Lining up an image takes real work, so only its Cancel button ends it.
      if (mode.kind === 'align') return;
      if (event.key === 'Escape') {
        if (mode.kind === 'trailPick') backToLineEdit();
        else if (mode.kind !== 'browse') cancelMode();
        else setSelection(null);
      } else if (mode.kind === 'trailPick' && event.key === 'Enter') {
        confirmJoin();
      } else if (mode.kind === 'edit' && event.key === 'Enter') {
        finishEdit();
      } else if (mode.kind === 'edit' && event.key === 'z' && event.ctrlKey) {
        event.preventDefault();
        if (mode.target === 'trail') undoLineEdit();
        else undoEdit();
      } else if (mode.kind === 'draw' && event.key === 'Enter') {
        finishDrawing();
      } else if (mode.kind === 'draw' && (event.key === 'Backspace' || (event.key === 'z' && event.ctrlKey))) {
        event.preventDefault();
        setDraftPoints((points) => points.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, cancelMode, finishDrawing, finishEdit, undoEdit, undoLineEdit, backToLineEdit, confirmJoin]);

  useEffect(() => {
    if (cameraPinName !== null && mode.kind === 'browse') setCameraPinName(null);
  }, [mode, cameraPinName]);

  // The desktop app needs to know where the photo library is to show its photos.
  useEffect(() => {
    if (hub.settings.photoLibrary) void window.hub?.setPhotoLibrary(hub.settings.photoLibrary).catch(() => undefined);
  }, [hub.settings.photoLibrary]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (hub.loadError) {
    return <div className="fatal">Could not read your hub data: {hub.loadError}</div>;
  }
  if (!hub.loaded) return <div className="fatal">Loading…</div>;

  const propertyName = (id: string | null) => hub.properties.find((p) => p.id === id)?.name ?? null;
  let draftColor = '#ffffff';
  let modeTitle = '';
  if (mode.kind === 'placeSighting') {
    modeTitle = 'deer you saw';
  } else if (mode.kind === 'place') {
    modeTitle = pinTypeInfo(mode.markerType, hub.settings.customPinTypes).label.toLowerCase();
  } else if (mode.kind === 'draw' && mode.target === 'property') {
    [draftColor, modeTitle] = [propertyColor(null, hub.settings), 'property line'];
  } else if (mode.kind === 'draw' && mode.target === 'section') {
    [draftColor, modeTitle] = ['#f7efe6', 'section'];
  } else if (mode.kind === 'draw' && mode.target === 'trail') {
    [draftColor, modeTitle] = [trailTypeStyle(mode.trailKind, hub.settings.trailStyles).color, TRAIL_KINDS[mode.trailKind].label.toLowerCase()];
  } else if (mode.kind === 'draw') {
    const info = areaTypeInfo(mode.areaType, hub.settings);
    [draftColor, modeTitle] = [info.color, info.label.toLowerCase()];
  }

  // Saved images, with the one being lined up swapped for its live preview.
  const overlayViews: OverlayView[] = [];
  for (const o of hub.overlays) {
    if (!o.visible || o.id === alignDraft?.overlayId) continue;
    const url = imageUrls[o.fileName];
    const corners = overlayCorners(o.controlPoints, o.imageWidth, o.imageHeight);
    if (url && corners) overlayViews.push({ id: o.id, url, corners, opacity: o.opacity });
  }
  const alignMarkers: AlignMarker[] = [];
  if (alignDraft) {
    const corners = overlayCorners(completePoints(alignDraft.points), alignDraft.width, alignDraft.height);
    if (corners) overlayViews.push({ id: alignDraft.overlayId, url: alignDraft.url, corners, opacity: alignDraft.opacity });
    alignDraft.points.forEach((p, index) => {
      if (p.map) alignMarkers.push({ index, position: p.map });
    });
  }

  // Stand picks for the chosen sit (or now), from each stand's good winds.
  const now = Date.now();
  const forecast = forecastState.status === 'ready' ? forecastState.forecast : null;
  const isStand = isStandMarker;
  // Areas deer bed or hide in (per area type in Settings); scent into them is bad.
  const sensitiveAreas = hub.areas.filter((a) => areaTypeInfo(a.type, hub.settings).scentSensitive);
  const forecastStands = hub.markers.filter((m) => isStand(m) && (!forecastProperty || m.propertyId === forecastProperty.id));
  // Blended, not snapped to the hour, so cones glide as the sit slider moves.
  const ratingHour = forecast ? weatherAt(forecast, forecastTime ?? now) : null;
  const ratedStands = ratingHour ? rateStands(forecastStands, ratingHour, sensitiveAreas) : [];
  const standRatings: Record<string, StandRating> | null =
    forecastOpen && ratingHour ? Object.fromEntries(ratedStands.map((r) => [r.stand.id, r.rating])) : null;
  // Scent cones: the stand you clicked, plus any rating groups switched on in the forecast.
  const selectedStand = selection?.kind === 'marker' ? hub.markers.find((m) => m.id === selection.id && isStand(m)) : undefined;
  const coneStands = [
    ...(forecastOpen ? ratedStands.filter((r) => coneGroups.includes(r.rating)) : []),
    ...(selectedStand && ratingHour ? rateStands([selectedStand], ratingHour, sensitiveAreas) : []),
  ].filter((r, i, all) => all.findIndex((o) => o.stand.id === r.stand.id) === i);

  let forecastTeaser = 'Wind and stand picks';
  if (forecastState.status === 'loading') forecastTeaser = 'Getting the wind…';
  if (forecast) {
    const nowHour = hourAt(forecast, now);
    const wind = `${compassPointOf(nowHour.windFromDeg)} ${Math.round(nowHour.windMph)} mph now`;
    const allStands = hub.markers.filter(isStand);
    const good = rateStands(allStands, nowHour, sensitiveAreas).filter((r) => r.rating === 'good').length;
    forecastTeaser = allStands.length === 0 ? wind : `${wind} · ${good} good stand${good === 1 ? '' : 's'}`;
  }

  // The Trail Cameras card's one-liner.
  const toReview = hub.photos.filter((p) => p.status === 'new').length;
  const cameraCount = hub.markers.filter((m) => m.type === 'camera').length;
  const cameraTeaser = hub.photos.length
    ? `${hub.photos.length.toLocaleString()} photos${toReview ? ` · ${toReview.toLocaleString()} to review` : ''}`
    : cameraCount
      ? `${cameraCount} camera${cameraCount === 1 ? '' : 's'} · import photos`
      : 'Sort photos from your cameras';

  // The Summary card's one-liner.
  const totalAcres = hub.properties.reduce((t, p) => t + acresOf(p.boundary), 0);
  const spotCount = hub.markers.filter(isStandMarker).length;
  const summaryTeaser = [
    totalAcres ? formatAcres(totalAcres) : null,
    `${spotCount} hunting spot${spotCount === 1 ? '' : 's'}`,
    `${hub.reports.length} hunt${hub.reports.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  // The Action Board card's one-liner.
  const boardCount = (status: ActionItem['status']) => hub.actionItems.filter((i) => i.status === status).length;
  const boardTeaser = hub.actionItems.length === boardCount('done') ? 'Ideas and work to do' : `${boardCount('planned')} to do · ${boardCount('idea')} idea${boardCount('idea') === 1 ? '' : 's'}`;

  // The Schedules card's one-liner.
  const schedulePlaces: SchedulePlace[] = [...hub.areas.map((a) => ({ ...a, kind: 'area' as const })), ...hub.sections.map((s) => ({ ...s, kind: 'section' as const }))];
  const upcoming = upcomingRows(schedulePlaces, hub.plans, todayDate());
  const overdueCount = upcoming.filter((r) => isOverdue(r.end, todayDate())).length;
  const schedulesTeaser = upcoming.length === 0 ? 'Everything you have planned' : `${upcoming.length} coming up${overdueCount ? ` · ${overdueCount} overdue` : ''}`;

  // Marking a scheduled card done starts the schedule's next cycle and, on a
  // food plot, logs the work. Taking it back out of Done undoes both.
  const changeCard = (next: ActionItem) => {
    const before = hub.actionItems.find((i) => i.id === next.id);
    const link = next.schedule;
    if (!link || !before || (before.status === 'done') === (next.status === 'done')) return hub.saveActionItem(next);
    const area = link.placeKind === 'area' ? hub.areas.find((a) => a.id === link.placeId) : undefined;
    const section = link.placeKind === 'section' ? hub.sections.find((s) => s.id === link.placeId) : undefined;
    const schedule = (area ?? section)?.schedules?.find((s) => s.id === link.id);
    if (!schedule) return hub.saveActionItem(next);
    const today = todayDate();
    const onPlot = area !== undefined && isPlotType(area.type, areaTypeInfo(area.type, hub.settings).label);
    if (next.status === 'done') {
      hub.saveActionItem({ ...next, schedule: { ...link, lastDoneBefore: schedule.lastDone, handledBefore: schedule.handledSeason ?? null } });
      if (area) hub.saveArea(onPlot ? saveEntry(markDone(area, link.id, today, link.season), logEntryFor(next, schedule, today)) : markDone(area, link.id, today, link.season));
      if (section) hub.saveSection(markDone(section, link.id, today, link.season));
    } else {
      hub.saveActionItem(next);
      if (area) {
        const undone = undoDone(area, link.id, link.lastDoneBefore, link.handledBefore);
        hub.saveArea(onPlot && area.log?.some((e) => e.id === next.id) ? removeEntry(undone, next.id) : undone);
      }
      if (section) hub.saveSection(undoDone(section, link.id, link.lastDoneBefore, link.handledBefore));
    }
  };

  // Removing a scheduled card that isn't done skips that cycle of the schedule.
  const deleteCard = (id: string) => {
    const link = hub.actionItems.find((i) => i.id === id && i.status !== 'done')?.schedule;
    if (link?.placeKind === 'area') {
      const area = hub.areas.find((a) => a.id === link.placeId);
      if (area) hub.saveArea(skipSeason(area, link.id, link.season));
    }
    if (link?.placeKind === 'section') {
      const section = hub.sections.find((s) => s.id === link.placeId);
      if (section) hub.saveSection(skipSeason(section, link.id, link.season));
    }
    hub.deleteActionItem(id);
  };

  // Adds a stand at a card's spot and moves the card to done.
  const makeStandFromCard = (item: ActionItem) => {
    if (item.lng === null || item.lat === null) return;
    const marker: MapMarker = {
      ...newRecordFields(),
      propertyId: propertyContaining(hub.properties, [item.lng, item.lat])?.id ?? item.propertyId,
      type: 'stand',
      name: nextName(pinTypeInfo('stand', hub.settings.customPinTypes).label, hub.markers),
      lng: item.lng,
      lat: item.lat,
      notes: item.text,
      goodWinds: [],
    };
    hub.saveMarker(marker);
    hub.saveActionItem({ ...item, status: 'done', markerId: marker.id });
    setSelection({ kind: 'marker', id: marker.id });
    zoomTo({ kind: 'marker', id: marker.id });
  };

  const forecastView = forecastOpen ? (
    <ForecastPanel
      state={forecastState}
      properties={hub.properties}
      propertyId={forecastPropertyId}
      sits={forecast ? sitsFor(forecast, now) : []}
      sitId={forecastSitId}
      selectedTime={forecastTime ?? now}
      ratedStands={ratedStands}
      coneGroups={coneGroups}
      onToggleCones={(group) => setConeGroups((g) => (g.includes(group) ? g.filter((x) => x !== group) : [...g, group]))}
      onPropertyChange={setForecastPropertyId}
      onSitChange={(sit) => {
        setForecastSitId(sit.id);
        setForecastTime(sit.peak);
      }}
      onTimeChange={setForecastTime}
      onHourPick={(time) => {
        setForecastSitId(null);
        setForecastTime(time);
      }}
      onPickStand={(id) => {
        setSelection({ kind: 'marker', id });
        zoomTo({ kind: 'marker', id });
      }}
      onRefresh={refreshForecast}
      onClose={() => {
        setForecastOpen(false);
        setForecastTime(null);
        setForecastSitId('now');
      }}
    />
  ) : null;

  // Deer from hunt reports. Ones not placed on the map are spread in a small
  // ring around their stand so several sightings don't hide each other.
  const SIGHTING_RING_M = 18;
  const YARD_M = 0.9144;
  const sightingViews: SightingView[] = [];
  if (layers.sightings) {
    for (const report of hub.reports) {
      const position = huntPosition(report, hub.markers);
      const stand = position ? { lng: position[0], lat: position[1] } : null;
      const unplaced = report.sightings.filter((s) => s.lat === null && !s.fromStand);
      for (const s of report.sightings) {
        let at: [number, number] | null = s.lat !== null && s.lng !== null ? [s.lng, s.lat] : null;
        if (!at && stand && s.fromStand) {
          // Tapped on the phone as "about this far, this way" from the stand.
          at = offsetPosition(stand.lng, stand.lat, s.fromStand.bearingDeg, s.fromStand.yards * YARD_M);
        } else if (!at && stand) {
          at = offsetPosition(stand.lng, stand.lat, (360 * unplaced.indexOf(s)) / Math.max(1, unplaced.length), SIGHTING_RING_M);
        }
        const info = kindInfo(s.kind);
        if (at) sightingViews.push({ reportId: report.id, id: s.id, lng: at[0], lat: at[1], headingDeg: s.headingDeg, kind: s.kind, color: info.color, ...(info.deer ? {} : { icon: info.icon }) });
      }
    }
  }

  // New spots hunted from (no stand), with hunts within 20 m of each other counted as one spot.
  const SAME_SPOT_M = 20;
  const spotGroups: { at: [number, number]; reports: HuntReport[] }[] = [];
  for (const report of hub.reports) {
    if (!report.spot || report.standId) continue;
    const at: [number, number] = [report.spot.lng, report.spot.lat];
    const group = spotGroups.find((g) => metersBetween(g.at, at) < SAME_SPOT_M);
    if (group) group.reports.push(report);
    else spotGroups.push({ at, reports: [report] });
  }
  const huntSpotViews: HuntSpotView[] = layers.huntSpots
    ? spotGroups.map((g) => {
        const newest = [...g.reports].sort((a, b) => b.start.localeCompare(a.start))[0];
        const named = g.reports.find((r) => r.spot?.name)?.spot?.name;
        return { id: g.reports[0].id, at: g.at, name: named ?? 'New spot', hunts: g.reports.length, reportId: newest.id };
      })
    : [];

  // A new spot kept for good: a hunting location there, with every hunt from that spot moved onto it.
  const makeStandFromSpot = (report: HuntReport, type: MarkerType) => {
    if (!report.spot) return;
    const at: [number, number] = [report.spot.lng, report.spot.lat];
    const info = pinTypeInfo(type, hub.settings.customPinTypes);
    const atSpot = hub.reports.filter((r) => r.spot && !r.standId && metersBetween([r.spot.lng, r.spot.lat], at) < SAME_SPOT_M);
    const named = report.spot.name ?? atSpot.find((r) => r.spot?.name)?.spot?.name ?? null;
    const marker: MapMarker = {
      ...newRecordFields(),
      propertyId: propertyContaining(hub.properties, at)?.id ?? null,
      type,
      name: named ?? nextName(info.label, hub.markers),
      lng: at[0],
      lat: at[1],
      notes: null,
      goodWinds: [],
    };
    hub.saveMarker(marker);
    for (const r of atSpot) {
      hub.saveReport({ ...r, standId: marker.id, propertyId: r.propertyId ?? marker.propertyId, updatedAt: new Date().toISOString() });
    }
    setSelection({ kind: 'marker', id: marker.id });
    setNotice(`${marker.name} added to Hunting Locations.`);
  };

  // Lines a new shape can snap onto: property lines always, plus section and
  // area edges when drawing a section, area or trail, so neighbors share an edge.
  const editing = mode.kind === 'edit' ? mode : null;
  const snapRings =
    mode.kind === 'trailPick'
      ? hub.trails.filter((t) => (mode.action !== 'join') === (t.id === mode.id)).flatMap(trailParts)
      : mode.kind === 'draw' || editing
      ? [
          ...ringsOfShapes([
            ...hub.properties.filter((p) => p.id !== editing?.id).map((p) => p.boundary),
            ...(mode.kind === 'draw' && mode.target === 'property' ? [] : hub.sections.filter((s) => s.id !== editing?.id).map((s) => s.geometry)),
            // Areas share edges with the areas next to them.
            ...(mode.kind === 'draw' && mode.target === 'property' ? [] : hub.areas.filter((a) => a.id !== editing?.id).map((a) => a.geometry)),
          ]),
          // Trails can join existing trails.
          ...((mode.kind === 'draw' && mode.target === 'trail') || editing?.target === 'trail'
            ? hub.trails.filter((t) => t.id !== editing?.id).flatMap(trailParts)
            : []),
        ]
      : [];

  // The shape being reshaped: its color and name for the map and the edit bar.
  let editColor = '#ffffff';
  let editTitle = '';
  if (mode.kind === 'edit') {
    if (mode.target === 'property') {
      const p = hub.properties.find((r) => r.id === mode.id);
      [editColor, editTitle] = [propertyColor(p ?? null, hub.settings), `${p?.name ?? 'property'} line`];
    } else if (mode.target === 'section') {
      [editColor, editTitle] = ['#f7efe6', hub.sections.find((r) => r.id === mode.id)?.name ?? 'section'];
    } else if (mode.target === 'area') {
      const a = hub.areas.find((r) => r.id === mode.id);
      [editColor, editTitle] = [a ? areaTypeInfo(a.type, hub.settings).color : '#ffffff', a?.name ?? 'area'];
    } else {
      const t = hub.trails.find((r) => r.id === mode.id);
      [editColor, editTitle] = [t ? trailStyle(t, hub.settings.trailStyles).color : '#ffffff', t?.name ?? 'trail'];
    }
  }

  // While a line is being edited its menu at the bottom is the only one.
  const editingLine = (mode.kind === 'edit' && mode.target === 'trail') || mode.kind === 'trailPick';
  const appClass = `app${selection && !editingLine ? ' has-detail' : ''}${alignDraft ? ' has-align' : ''}`;
  return (
    <div className={appClass} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        properties={hub.properties}
        sections={hub.sections}
        plans={hub.plans}
        reports={hub.reports}
        newFieldPins={hub.fieldPins.filter((p) => p.status === 'new')}
        newFieldTracks={hub.fieldTracks.filter((t) => t.status === 'new')}
        onFieldTrack={handleFieldTrack}
        trails={hub.trails}
        width={sidebarWidth}
        onResize={setSidebarWidth}
        onResizeEnd={saveSidebarWidth}
        camp={hub.settings.camp ?? null}
        campError={camp.error ?? partnerSync.error}
        onExportMap={() => void exportMap(null)}
        onImportMap={(file) => void importMap(file)}
        onFieldPin={handleFieldPin}
        onLogHunt={() => startReport(selection?.kind === 'marker' && hub.markers.some((m) => m.id === selection.id && isStandMarker(m)) ? selection.id : null)}
        areas={hub.areas}
        markers={hub.markers}
        overlays={hub.overlays}
        selection={selection}
        dataPath={isDesktop ? dataPath : null}
        view={
          settingsOpen ? (
            <SettingsPanel
              settings={hub.settings}
              onChange={hub.saveSettings}
              onClose={() => setSettingsOpen(false)}
              onImportPhone={(file) => void importPhone(file)}
              onSendStands={sendStandsToPhone}
              update={update}
              autoOffline={autoOffline}
              campPartners={{ manager: camp.manager, uid: camp.uid, info: camp.info, counts: countShared(hub.allData ?? {}), syncError: partnerSync.error, waiting: partnerSync.waiting }}
            />
          ) : summaryOpen ? (
            <SummaryPanel
              properties={hub.properties}
              areas={hub.areas}
              markers={hub.markers}
              trails={hub.trails}
              sections={hub.sections}
              reports={hub.reports}
              photos={hub.photos}
              settings={hub.settings}
              onPickStand={(id) => {
                setSelection({ kind: 'marker', id });
                zoomTo({ kind: 'marker', id });
              }}
              onPickSection={(id) => {
                setSelection({ kind: 'section', id });
                zoomTo({ kind: 'section', id });
              }}
              onPickArea={(id) => {
                setSelection({ kind: 'area', id });
                zoomTo({ kind: 'area', id });
              }}
              onClose={() => setSummaryOpen(false)}
            />
          ) : boardOpen ? (
            <ActionBoardPanel
              items={hub.actionItems}
              onAdd={(kind, text) =>
                hub.saveActionItem({ ...newRecordFields(), kind, text, status: 'idea', lat: null, lng: null, loggedBy: hub.settings.camp?.hunter ?? null, propertyId: null, source: 'hub', markerId: null })
              }
              onChange={changeCard}
              onDelete={deleteCard}
              onOpenPlace={(item) => {
                if (!item.schedule) return;
                const next: Selection = { kind: item.schedule.placeKind, id: item.schedule.placeId };
                setSelection(next);
                zoomTo(next);
              }}
              onShow={(item) => {
                if (item.lng !== null && item.lat !== null) mapRef.current?.flyTo(item.lng, item.lat);
              }}
              onMakeStand={makeStandFromCard}
              onOpenStand={(id) => {
                setSelection({ kind: 'marker', id });
                zoomTo({ kind: 'marker', id });
              }}
              closed={hub.settings.boardClosed ?? ['done']}
              onClosedChange={(boardClosed) => hub.saveSettings({ ...hub.settings, boardClosed })}
              onClose={() => setBoardOpen(false)}
            />
          ) : schedulesOpen ? (
            <SchedulesPanel
              places={schedulePlaces}
              plans={hub.plans}
              order={hub.settings.scheduleOrder}
              onOrderChange={(scheduleOrder) => hub.saveSettings({ ...hub.settings, scheduleOrder })}
              onSaveSchedules={(place, schedules) => {
                const area = place.kind === 'area' ? hub.areas.find((a) => a.id === place.id) : undefined;
                const section = place.kind === 'section' ? hub.sections.find((s) => s.id === place.id) : undefined;
                if (area) hub.saveArea({ ...area, schedules });
                if (section) hub.saveSection({ ...section, schedules });
              }}
              onSavePlan={hub.savePlan}
              onRemovePlan={hub.deletePlan}
              onOpenPlace={(place) => {
                const next: Selection = { kind: place.kind, id: place.id };
                setSelection(next);
                zoomTo(next);
              }}
              onClose={() => setSchedulesOpen(false)}
            />
          ) : (
            forecastView
          )
        }
        settings={hub.settings}
        forecastTeaser={forecastTeaser}
        cameraTeaser={cameraTeaser}
        onOpenCameras={() => {
          if (mode.kind === 'align') return;
          setCameraFocus(null);
          setCamerasOpen(true);
        }}
        summaryTeaser={summaryTeaser}
        onOpenSummary={() => {
          if (mode.kind === 'align') return;
          setForecastOpen(false);
          setBoardOpen(false);
          setSchedulesOpen(false);
          setSummaryOpen(true);
        }}
        boardTeaser={boardTeaser}
        onOpenBoard={() => {
          if (mode.kind === 'align') return;
          setForecastOpen(false);
          setSummaryOpen(false);
          setSchedulesOpen(false);
          setBoardOpen(true);
        }}
        schedulesTeaser={schedulesTeaser}
        onOpenSchedules={() => {
          if (mode.kind === 'align') return;
          setForecastOpen(false);
          setSummaryOpen(false);
          setBoardOpen(false);
          setSchedulesOpen(true);
        }}
        onOpenForecast={() => {
          if (mode.kind === 'align') return;
          setForecastTime(null);
          setForecastSitId('now');
          setSummaryOpen(false);
          setBoardOpen(false);
          setSchedulesOpen(false);
          setForecastOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(!settingsOpen)}
        onShowDataFolder={window.hub ? () => void window.hub?.showDataFolder() : null}
        onPick={(next) => {
          if (mode.kind === 'align') return;
          cancelMode();
          setSelection(next);
          zoomTo(next);
        }}
      />

      <main className="map-area">
        <MapView
          ref={mapRef}
          layers={layers}
          properties={hub.properties}
          areas={hub.areas}
          markers={hub.markers}
          sections={hub.sections}
          trails={hub.trails}
          fieldTracks={hub.fieldTracks.filter((t) => t.status === 'new')}
          draftLine={mode.kind === 'draw' && mode.target === 'trail'}
          editShape={editRings && mode.kind === 'edit' ? { rings: editRings, closed: mode.target !== 'trail', color: editColor } : null}
          onEditBegin={() => editRings && setEditHistory((h) => [...h, editRings])}
          onEditRings={setEditRings}
          onEditClickTrails={clickTrailWhileEditing}
          joiningTrailId={mode.kind === 'trailPick' ? (mode.otherId ?? null) : null}
          settings={hub.settings}
          snapRings={snapRings}
          snapPx={hub.settings.snapping.enabled ? hub.settings.snapping.distancePx : 0}
          overlays={overlayViews}
          alignMarkers={alignMarkers}
          standRatings={standRatings}
          unlockedPinId={unlockedPinId}
          scentCones={coneStands.map((r) => ({ id: r.stand.id, rating: r.rating, cone: r.cone }))}
          sightings={sightingViews}
          huntSpots={huntSpotViews}
          windFromDeg={ratingHour?.windFromDeg ?? null}
          selection={selection}
          interaction={mode.kind === 'placeSighting' ? 'place' : mode.kind === 'trailPick' ? 'draw' : mode.kind}
          draftPoints={draftPoints}
          draftColor={draftColor}
          onMapClick={handleMapClick}
          onSelect={setSelection}
          onMarkerMoved={handleMarkerMoved}
          onAlignMarkerMoved={(index, position) => {
            if (!alignDraft) return;
            const points = alignDraft.points.map((p, i) => (i === index ? { ...p, map: position } : p));
            setAlignDraft({ ...alignDraft, points });
          }}
        />
        {mode.kind !== 'align' && (
          <MapToolbar
            disabled={mode.kind !== 'browse'}
            trailStyles={hub.settings.trailStyles}
            areaTypes={areaTypeList(hub.settings)}
            pinTypes={pinTypeList(hub.settings.customPinTypes)}
            onDrawProperty={() => startMode({ kind: 'draw', target: 'property' })}
            onDrawSection={() => startMode({ kind: 'draw', target: 'section' })}
            onDrawArea={(areaType) => startMode({ kind: 'draw', target: 'area', areaType })}
            onDrawTrail={(trailKind) => startMode({ kind: 'draw', target: 'trail', trailKind })}
            onPlaceMarker={(markerType) => startMode({ kind: 'place', markerType })}
            onImport={(file) => void handleImport(file)}
            onAddImage={(file) => void startAlignNew(file)}
          />
        )}
        <LayerPanel layers={layers} onChange={setLayers} settings={hub.settings} onChangeSettings={hub.saveSettings} />
        {camerasOpen && (
          // Stays mounted (just hidden) while a new camera is pinned, so the import picks up where it was.
          <div className="camera-overlay" hidden={cameraPinName !== null}>
            <CameraView
              key={cameraFocus ?? 'all'}
              photos={hub.photos}
              cameras={hub.markers.filter((m) => m.type === 'camera')}
              places={photoPlaces}
              library={hub.settings.photoLibrary ?? null}
              onSetLibrary={(dir) => hub.saveSettings({ ...hub.settings, photoLibrary: dir })}
              onSavePhotos={hub.savePhotos}
              onPinNewCamera={(name) => {
                setCameraPinName(name);
                setNewCameraId(null);
                startMode({ kind: 'place', markerType: 'camera' });
              }}
              newCameraId={newCameraId}
              initialCamera={cameraFocus}
              newRecord={newRecordFields}
              buckNames={[
                ...new Set(
                  [
                    ...hub.reports.flatMap((r) => r.sightings.map((x) => x.buckName)),
                    ...hub.photos.flatMap((p) => (p.tally ?? []).map((t) => t.buckName)),
                  ].filter((n): n is string => !!n && n.trim() !== ''),
                ),
              ].sort()}
              onShowCamera={(id) => {
                setCamerasOpen(false);
                setSelection({ kind: 'marker', id });
                zoomTo({ kind: 'marker', id });
              }}
              onClose={() => setCamerasOpen(false)}
            />
          </div>
        )}
        {mode.kind === 'edit' && mode.target === 'trail' && editRings && (
          <LineEditBar
            title={editTitle}
            parts={editRings}
            canUndo={editHistory.length > 0 || lastCombine?.trailId === mode.id}
            onUndo={undoLineEdit}
            onCancel={cancelMode}
            onDone={finishEdit}
            onPick={(action) => {
              saveLineEdit();
              setDraftPoints([]);
              setEditRings(null);
              setEditHistory([]);
              setMode({ kind: 'trailPick', action, id: mode.id });
            }}
            onCombine={(feet) => {
              const record = saveLineEdit();
              if (record) combineTrails(record, feet);
            }}
          />
        )}
        {mode.kind === 'edit' && mode.target !== 'trail' && editRings && (
          <EditBar
            title={editTitle}
            rings={editRings}
            canUndo={editHistory.length > 0}
            onUndo={undoEdit}
            onCancel={cancelMode}
            onDone={finishEdit}
          />
        )}
        {(mode.kind === 'draw' || mode.kind === 'place' || mode.kind === 'placeSighting') && (
          <DrawBar
            kind={mode.kind === 'draw' ? 'draw' : 'place'}
            title={modeTitle}
            points={draftPoints}
            onUndo={() => setDraftPoints((points) => points.slice(0, -1))}
            onCancel={cancelMode}
            onFinish={finishDrawing}
            minPoints={mode.kind === 'draw' && mode.target === 'trail' ? 2 : 3}
          />
        )}
        {mode.kind === 'trailPick' && (
          <div className="draw-bar line-edit">
            <div className="line-edit-title">
              {mode.action === 'split' ? (
                'Click the spot on the line where it should split. Click right at a T to unhook that branch.'
              ) : mode.action === 'trim' ? (
                draftPoints.length === 0 ? 'Click one end of the part to delete.' : 'Now click the other end of the part to delete.'
              ) : mode.otherId ? (
                <>
                  Join <strong>{hub.trails.find((t) => t.id === mode.otherId)?.name}</strong> into <strong>{hub.trails.find((t) => t.id === mode.id)?.name}</strong> as one line?
                </>
              ) : (
                'Click the line to join to this one.'
              )}
            </div>
            <div className="line-edit-tools">
              <button onClick={backToLineEdit} title="Esc">
                Cancel
              </button>
              {mode.otherId && (
                <button className="primary" onClick={confirmJoin} title="Enter">
                  Join
                </button>
              )}
            </div>
          </div>
        )}
        <UpdateBanner updater={update} />
        {(notice || hub.saveError) && (
          <div className={`toast${hub.saveError ? ' error' : ''}`}>{hub.saveError ? `Save failed: ${hub.saveError}` : notice}</div>
        )}
      </main>

      {alignDraft ? (
        <AlignPanel
          draft={alignDraft}
          saving={savingAlign}
          onChange={setAlignDraft}
          onSave={() => void saveAlign()}
          onCancel={endAlign}
        />
      ) : editingLine ? null : (
        renderDetail()
      )}
    </div>
  );

  // Called as a function, not a component, so inputs keep focus while typing.
  function renderDetail() {
    if (!selection) return null;
    const common = {
      onZoom: () => zoomTo(selection),
      onClose: () => setSelection(null),
    };
    if (selection.kind === 'report') {
      const record = hub.reports.find((r) => r.id === selection.id);
      if (!record) return null;
      return (
        <ReportPanel
          report={record}
          stands={hub.markers.filter(isStandMarker)}
          weatherStatus={weatherStatus[record.id] ?? 'idle'}
          onChange={hub.saveReport}
          onFillWeather={() => void fillWeather(record)}
          spotTypes={pinTypeList(hub.settings.customPinTypes).filter((t) => t.huntingSpot)}
          onMakeStand={(type) => makeStandFromSpot(record, type)}
          onPlaceSighting={(sightingId) => setMode({ kind: 'placeSighting', reportId: record.id, sightingId })}
          onDelete={() => {
            hub.deleteReport(record.id);
            setSelection(null);
          }}
          {...common}
        />
      );
    }
    if (selection.kind === 'section') {
      const record = hub.sections.find((r) => r.id === selection.id);
      if (!record) return null;
      // A plan only stays open while its own section is selected.
      const planId = openPlan?.sectionId === record.id ? openPlan.planId : null;
      return (
        <SectionPanel
          section={record}
          onEditShape={() => startEdit('section', record.id)}
          plans={hub.plans.filter((p) => p.sectionId === record.id)}
          propertyName={propertyName(record.propertyId)}
          forecast={forecast}
          openPlanId={planId}
          onChange={hub.saveSection}
          onDelete={() => {
            hub.deleteSection(record.id);
            setSelection(null);
          }}
          onAddPlan={(kind) => {
            const plan = newPlan(record.id, kind, newRecordFields());
            hub.savePlan(plan);
            setOpenPlan({ sectionId: record.id, planId: plan.id });
          }}
          onOpenPlan={(id) => setOpenPlan(id ? { sectionId: record.id, planId: id } : null)}
          onChangePlan={hub.savePlan}
          onDeletePlan={hub.deletePlan}
          {...common}
        />
      );
    }
    if (selection.kind === 'overlay') {
      const record = hub.overlays.find((r) => r.id === selection.id);
      if (!record) return null;
      return (
        <DetailPanel
          kind="overlay"
          record={record}
          propertyName={null}
          onChange={hub.saveOverlay}
          onRealign={() => startRealign(record)}
          onDelete={() => {
            hub.deleteOverlay(record.id);
            setSelection(null);
          }}
          {...common}
        />
      );
    }
    if (selection.kind === 'trail') {
      const record = hub.trails.find((r) => r.id === selection.id);
      if (!record) return null;
      return (
        <DetailPanel
          kind="trail"
          record={record}
          onEditShape={() => startEdit('trail', record.id)}
          propertyName={propertyName(record.propertyId)}
          defaultColor={trailTypeStyle(record.kind, hub.settings.trailStyles).color}
          trailStyles={hub.settings.trailStyles}
          onChange={hub.saveTrail}
          onDelete={() => {
            hub.deleteTrail(record.id);
            setSelection(null);
          }}
          {...common}
        />
      );
    }
        if (selection.kind === 'property') {
      const record = hub.properties.find((r) => r.id === selection.id);
      if (!record) return null;
      return (
        <DetailPanel
          kind="property"
          record={record}
          onEditShape={() => startEdit('property', record.id)}
          propertyName={null}
          defaultColor={propertyColor(null, hub.settings)}
          onChange={hub.saveProperty}
          onShare={() => void exportMap(record.id)}
          offlineField={
            <OfflineField
              key={record.id}
              property={record}
              layers={layers}
              radiusM={hub.settings.offlineRadiusM}
              auto={autoOffline}
              onDownloaded={(offline) => hub.patchProperty(record.id, { offline })}
            />
          }
          onDelete={() => {
            hub.deleteProperty(record.id);
            setSelection(null);
          }}
          {...common}
        />
      );
    }
    if (selection.kind === 'area') {
      const record = hub.areas.find((r) => r.id === selection.id);
      if (!record) return null;
      return (
        <DetailPanel
          kind="area"
          record={record}
          onEditShape={() => startEdit('area', record.id)}
          areaTypes={areaTypeList(hub.settings)}
          propertyName={propertyName(record.propertyId)}
          onChange={hub.saveArea}
          onDelete={() => {
            hub.deleteArea(record.id);
            setSelection(null);
          }}
          {...common}
        />
      );
    }
    const record = hub.markers.find((r) => r.id === selection.id);
    if (!record) return null;
    return (
      <DetailPanel
        kind="marker"
        record={record}
        pinTypes={pinTypeList(hub.settings.customPinTypes)}
        unlocked={unlockedPinId === record.id}
        onToggleLock={() => setUnlockedPinId(unlockedPinId === record.id ? null : record.id)}
        onLogHunt={isStandMarker(record) ? () => startReport(record.id) : undefined}
        history={
          isStandMarker(record) ? (
            <StandHistory reports={hub.reports.filter((r) => r.standId === record.id)} onPickReport={(id) => setSelection({ kind: 'report', id })} />
          ) : record.type === 'camera' ? (
            <CameraPhotosInfo
              photos={hub.photos.filter((p) => p.cameraId === record.id)}
              onOpen={() => {
                setCameraFocus(record.id);
                setCamerasOpen(true);
              }}
            />
          ) : undefined
        }
        propertyName={propertyName(record.propertyId)}
        defaultColor={categoryStyle(record.type, hub.settings).color}
        onChange={hub.saveMarker}
        onDelete={() => {
          hub.deleteMarker(record.id);
          setSelection(null);
        }}
        {...common}
      />
    );
  }
}

function combinedBounds(geometries: AreaGeometry[]): AreaGeometry {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geometries) {
    const [gw, gs, ge, gn] = boundsOf(g);
    w = Math.min(w, gw);
    s = Math.min(s, gs);
    e = Math.max(e, ge);
    n = Math.max(n, gn);
  }
  return pointsToPolygon([
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]);
}
