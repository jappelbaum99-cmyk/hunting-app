import type { Position } from 'geojson';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AlignPanel, completePoints, type AlignDraft } from '@/components/AlignPanel';
import { DetailPanel } from '@/components/DetailPanel';
import { DrawBar } from '@/components/DrawBar';
import { ForecastPanel } from '@/components/ForecastPanel';
import { LayerPanel } from '@/components/LayerPanel';
import { MapToolbar } from '@/components/MapToolbar';
import { OfflineField } from '@/components/OfflineField';
import { ReportPanel } from '@/components/ReportPanel';
import { base64ToBytes, bytesToBase64, MAP_FILE_KIND, mapFileName, parseMapFile, pickRecords, type MapFile } from '@/lib/mapFile';
import { PHONE_FILE_KIND, shareJsonFile, STANDS_FILE_KIND, type PhoneFile, type StandsFile } from '@/field/fieldData';
import { SectionPanel } from '@/components/SectionPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { StandHistory } from '@/components/StandHistory';
import { Sidebar } from '@/components/Sidebar';
import { newRecordFields, useHubData } from '@/data/HubDataProvider';
import { useHubCamp } from '@/data/useHubCamp';
import { imageFileName, loadImageBytes, readImageSize, saveImage } from '@/data/images';
import { isDesktop } from '@/data/storage';
import { useForecast } from '@/data/useForecast';
import { useImageUrls } from '@/data/useImageUrls';
import { MARKER_TYPES, WIND_MARKER_TYPES } from '@/lib/featureTypes';
import { boundsOf, pointsToPolygon, propertyContaining } from '@/lib/geo';
import { overlayCorners } from '@/lib/georef';
import { importGeoFile } from '@/lib/importGeo';
import { kindInfo, reportWeather } from '@/lib/reports';
import { newPlan } from '@/lib/plans';
import { compassPointOf, rateStands, sitsFor, type StandRating } from '@/lib/standRating';
import { ringsOf } from '@/lib/snap';
import { areaTypeInfo, areaTypeList, categoryStyle, propertyColor } from '@/lib/styles';
import { hourAt, weatherAt, weatherFor } from '@/lib/weather';
import { DEFAULT_LAYERS, type MapLayersState } from '@/map/layers';
import { DEFAULT_CENTER, MapView, type AlignMarker, type MapViewHandle, type OverlayView, type SightingView } from '@/map/MapView';
import type { AreaGeometry, AreaType, FieldPin, HuntReport, MapImageOverlay, MapMarker, MarkerType, Property, Selection } from '@/types/models';

type Mode =
  | { kind: 'browse' }
  | { kind: 'place'; markerType: MarkerType }
  | { kind: 'draw'; target: 'property' }
  | { kind: 'draw'; target: 'section' }
  | { kind: 'draw'; target: 'area'; areaType: AreaType }
  | { kind: 'align' }
  // Clicking the map sets where a sighting in a hunt report happened.
  | { kind: 'placeSighting'; reportId: string; sightingId: string };

const MAX_IMPORTED_SHAPES = 50;
const STAND_NAME = /\b(stand|blind|tree ?stand|ladder|box)\b/i;
// The align panel's width (--detail-width under .has-align in styles.css) plus its gaps.
const ALIGN_PANEL_INSET = 520 + 24;
const DEFAULT_OVERLAY_OPACITY = 0.6;

function cornersPolygon(corners: OverlayView['corners']): AreaGeometry {
  return pointsToPolygon(corners);
}

// Where to get the weather: the chosen property, else the first one, else the
// middle of the stands, else Salem.
// Stands and blinds: the pins you hunt from.
const isStandMarker = (m: MapMarker) => WIND_MARKER_TYPES.includes(m.type);

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
  const mapRef = useRef<MapViewHandle>(null);
  const [layers, setLayers] = useState<MapLayersState>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [draftPoints, setDraftPoints] = useState<Position[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [alignDraft, setAlignDraft] = useState<AlignDraft | null>(null);
  // The picked file for a new map image; it's only written to disk on Save.
  const [alignFile, setAlignFile] = useState<File | null>(null);
  const [savingAlign, setSavingAlign] = useState(false);
  const imageUrls = useImageUrls(hub.overlays);
  const [forecastOpen, setForecastOpen] = useState(false);
  // Settings shows in the sidebar over the lists (and over the forecast, if open).
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  }, []);

  const startMode = (next: Mode) => {
    setSelection(null);
    setDraftPoints([]);
    setMode(next);
  };

  const finishDrawing = useCallback(() => {
    if (mode.kind !== 'draw' || draftPoints.length < 3) return;
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
      const record = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, draftPoints[0])?.id ?? null,
        name: nextName('Section', hub.sections),
        geometry,
        notes: null,
      };
      hub.saveSection(record);
      setSelection({ kind: 'section', id: record.id });
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

  // Where a report's weather is looked up: its stand, else the first property.
  const reportLocation = (report: HuntReport): [number, number] => {
    const stand = hub.markers.find((m) => m.id === report.standId);
    return stand ? [stand.lng, stand.lat] : forecastLocation(null, hub.properties, hub.markers);
  };

  const fillWeather = async (report: HuntReport) => {
    setWeatherStatus((s) => ({ ...s, [report.id]: 'loading' }));
    try {
      const [lng, lat] = reportLocation(report);
      const hour = await weatherFor(lat, lng, Date.parse(report.start));
      // Merge into the latest copy, so edits made while waiting aren't lost.
      hub.patchReport(report.id, { weather: reportWeather(hour) });
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
  const bringInFromPhones = (incomingReports: HuntReport[], incomingPins: FieldPin[]) => {
    const all = hub.allData;
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
    const result = hub.mergeFromPhone({ reports, fieldPins: pins });
    // The phone has no internet in the stand, so look up weather for its hunts now.
    for (const r of reports) {
      const have = all?.reports.find((h) => h.id === r.id);
      if (!r.weather && !(have && have.updatedAt >= r.updatedAt)) void fillWeather(r);
    }
    return result;
  };

  // Camp sync: hunts and pins arrive from phones, and stands go out to them.
  const campStands = (hub.allData?.markers ?? []).filter(isStandMarker).map((m) => ({
    id: m.id,
    name: m.name,
    lat: m.lat,
    lng: m.lng,
    goodWinds: m.goodWinds,
    updatedAt: m.updatedAt,
    deletedAt: m.deletedAt,
  }));
  const camp = useHubCamp(hub.settings.camp ?? null, campStands, ({ reports, pins }) => {
    const before = new Set([...(hub.allData?.reports ?? []), ...(hub.allData?.fieldPins ?? [])].map((r) => r.id));
    const freshHunts = reports.filter((r) => !before.has(r.id));
    const freshPins = pins.filter((p) => !before.has(p.id));
    bringInFromPhones(reports, pins);
    if (freshHunts.length + freshPins.length === 0) return;
    const who = [...new Set([...freshHunts, ...freshPins].map((r) => r.loggedBy).filter(Boolean))].join(', ');
    const parts = [
      freshHunts.length ? `${freshHunts.length} hunt${freshHunts.length === 1 ? '' : 's'}` : '',
      freshPins.length ? `${freshPins.length} pin${freshPins.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    setNotice(`New from camp: ${parts.join(' and ')}${who ? ` from ${who}` : ''}.`);
  });

  // Brings in a file saved by the phone's Send tab.
  const importPhone = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as PhoneFile;
      if (parsed.kind !== PHONE_FILE_KIND) throw new Error("That isn't a file from the phone's Send tab.");
      const { added, updated } = bringInFromPhones(parsed.reports, parsed.pins);
      setNotice(
        added + updated === 0
          ? 'Nothing new in that file.'
          : `Brought in ${parsed.pins.length} pin${parsed.pins.length === 1 ? '' : 's'} and ${parsed.reports.length} hunt${parsed.reports.length === 1 ? '' : 's'} (${added} new, ${updated} updated).`,
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
      const { added, updated } = hub.mergeRecords(parsed.records, parsed.customAreaTypes);
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
    const stands = hub.markers.filter(isStandMarker).map((m) => ({ id: m.id, name: m.name, lat: m.lat, lng: m.lng, goodWinds: m.goodWinds }));
    const file: StandsFile = { kind: STANDS_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), stands };
    void shareJsonFile('hunting-hub-stands.json', file).then(() =>
      setNotice(`Saved hunting-hub-stands.json with ${stands.length} stands. Get it onto the phone (email or iCloud Drive), then load it on the phone's Send tab.`),
    );
  };

  const handleFieldPin = (id: string, action: 'show' | 'add' | 'dismiss') => {
    const pin = hub.fieldPins.find((p) => p.id === id);
    if (!pin) return;
    if (action === 'show') {
      mapRef.current?.flyTo(pin.lng, pin.lat);
    } else if (action === 'dismiss') {
      hub.saveFieldPin({ ...pin, status: 'dismissed' });
    } else {
      const marker: MapMarker = {
        ...newRecordFields(),
        propertyId: propertyContaining(hub.properties, [pin.lng, pin.lat])?.id ?? null,
        type: pin.type,
        name: nextName(MARKER_TYPES[pin.type].label, hub.markers),
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
        name: nextName(MARKER_TYPES[mode.markerType].label, hub.markers),
        lng: position[0],
        lat: position[1],
        notes: null,
        goodWinds: [],
      };
      hub.saveMarker(record);
      setSelection({ kind: 'marker', id: record.id });
      cancelMode();
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
          name: point.name ?? nextName(MARKER_TYPES[type].label, hub.markers),
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
        if (mode.kind !== 'browse') cancelMode();
        else setSelection(null);
      } else if (mode.kind === 'draw' && event.key === 'Enter') {
        finishDrawing();
      } else if (mode.kind === 'draw' && (event.key === 'Backspace' || (event.key === 'z' && event.ctrlKey))) {
        event.preventDefault();
        setDraftPoints((points) => points.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, cancelMode, finishDrawing]);

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
    modeTitle = MARKER_TYPES[mode.markerType].label.toLowerCase();
  } else if (mode.kind === 'draw' && mode.target === 'property') {
    [draftColor, modeTitle] = [propertyColor(null, hub.settings), 'property line'];
  } else if (mode.kind === 'draw' && mode.target === 'section') {
    [draftColor, modeTitle] = ['#f7efe6', 'section'];
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
  const isStand = (m: MapMarker) => WIND_MARKER_TYPES.includes(m.type);
  // Areas deer bed or hide in (per area type in Settings); scent into them is bad.
  const sensitiveAreas = hub.areas.filter((a) => areaTypeInfo(a.type, hub.settings).scentSensitive);
  const forecastStands = hub.markers.filter((m) => isStand(m) && (!forecastProperty || m.propertyId === forecastProperty.id));
  // Blended, not snapped to the hour, so cones glide as the sit slider moves.
  const ratingHour = forecast ? weatherAt(forecast, forecastTime ?? now) : null;
  const ratedStands = ratingHour ? rateStands(forecastStands, ratingHour, sensitiveAreas) : [];
  const standRatings: Record<string, StandRating> | null =
    forecastOpen && ratingHour ? Object.fromEntries(ratedStands.map((r) => [r.stand.id, r.rating])) : null;

  let forecastTeaser = 'Wind and stand picks';
  if (forecastState.status === 'loading') forecastTeaser = 'Getting the wind…';
  if (forecast) {
    const nowHour = hourAt(forecast, now);
    const wind = `${compassPointOf(nowHour.windFromDeg)} ${Math.round(nowHour.windMph)} mph now`;
    const allStands = hub.markers.filter(isStand);
    const good = rateStands(allStands, nowHour, sensitiveAreas).filter((r) => r.rating === 'good').length;
    forecastTeaser = allStands.length === 0 ? wind : `${wind} · ${good} good stand${good === 1 ? '' : 's'}`;
  }

  const forecastView = forecastOpen ? (
    <ForecastPanel
      state={forecastState}
      properties={hub.properties}
      propertyId={forecastPropertyId}
      sits={forecast ? sitsFor(forecast, now) : []}
      sitId={forecastSitId}
      selectedTime={forecastTime ?? now}
      ratedStands={ratedStands}
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
  const sightingViews: SightingView[] = [];
  if (layers.sightings) {
    for (const report of hub.reports) {
      const stand = hub.markers.find((m) => m.id === report.standId);
      const unplaced = report.sightings.filter((s) => s.lat === null);
      for (const s of report.sightings) {
        let at: [number, number] | null = s.lat !== null && s.lng !== null ? [s.lng, s.lat] : null;
        if (!at && stand) {
          const angle = (2 * Math.PI * unplaced.indexOf(s)) / Math.max(1, unplaced.length);
          const dLat = (SIGHTING_RING_M * Math.cos(angle)) / 111_320;
          const dLng = (SIGHTING_RING_M * Math.sin(angle)) / (111_320 * Math.cos((stand.lat * Math.PI) / 180));
          at = [stand.lng + dLng, stand.lat + dLat];
        }
        if (at) sightingViews.push({ reportId: report.id, id: s.id, lng: at[0], lat: at[1], headingDeg: s.headingDeg, color: kindInfo(s.kind).color, ...(kindInfo(s.kind).deer ? {} : { icon: kindInfo(s.kind).icon }) });
      }
    }
  }

  // Lines a new shape can snap onto: property lines always, plus section
  // edges when drawing a section or area, so neighbors share an edge.
  const snapRings =
    mode.kind === 'draw'
      ? ringsOf([...hub.properties.map((p) => p.boundary), ...(mode.target === 'property' ? [] : hub.sections.map((s) => s.geometry))])
      : [];

  const appClass = `app${selection ? ' has-detail' : ''}${alignDraft ? ' has-align' : ''}`;
  return (
    <div className={appClass}>
      <Sidebar
        properties={hub.properties}
        sections={hub.sections}
        plans={hub.plans}
        reports={hub.reports}
        newFieldPins={hub.fieldPins.filter((p) => p.status === 'new')}
        onImportPhone={(file) => void importPhone(file)}
        camp={hub.settings.camp ?? null}
        campError={camp.error}
        onSendStands={sendStandsToPhone}
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
            <SettingsPanel settings={hub.settings} onChange={hub.saveSettings} onClose={() => setSettingsOpen(false)} />
          ) : (
            forecastView
          )
        }
        settings={hub.settings}
        forecastTeaser={forecastTeaser}
        onOpenForecast={() => {
          if (mode.kind === 'align') return;
          setForecastTime(null);
          setForecastSitId('now');
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
          settings={hub.settings}
          snapRings={snapRings}
          snapPx={hub.settings.snapping.enabled ? hub.settings.snapping.distancePx : 0}
          overlays={overlayViews}
          alignMarkers={alignMarkers}
          standRatings={standRatings}
          scentCones={standRatings ? ratedStands.map((r) => ({ id: r.stand.id, rating: r.rating, cone: r.cone })) : []}
          sightings={sightingViews}
          windFromDeg={ratingHour?.windFromDeg ?? null}
          selection={selection}
          interaction={mode.kind === 'placeSighting' ? 'place' : mode.kind}
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
            areaTypes={areaTypeList(hub.settings)}
            onDrawProperty={() => startMode({ kind: 'draw', target: 'property' })}
            onDrawSection={() => startMode({ kind: 'draw', target: 'section' })}
            onDrawArea={(areaType) => startMode({ kind: 'draw', target: 'area', areaType })}
            onPlaceMarker={(markerType) => startMode({ kind: 'place', markerType })}
            onImport={(file) => void handleImport(file)}
            onAddImage={(file) => void startAlignNew(file)}
          />
        )}
        <LayerPanel layers={layers} onChange={setLayers} />
        {(mode.kind === 'draw' || mode.kind === 'place' || mode.kind === 'placeSighting') && (
          <DrawBar
            kind={mode.kind === 'draw' ? 'draw' : 'place'}
            title={modeTitle}
            points={draftPoints}
            onUndo={() => setDraftPoints((points) => points.slice(0, -1))}
            onCancel={cancelMode}
            onFinish={finishDrawing}
          />
        )}
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
      ) : (
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
    if (selection.kind === 'property') {
      const record = hub.properties.find((r) => r.id === selection.id);
      if (!record) return null;
      return (
        <DetailPanel
          kind="property"
          record={record}
          propertyName={null}
          defaultColor={propertyColor(null, hub.settings)}
          onChange={hub.saveProperty}
          onShare={() => void exportMap(record.id)}
          offlineField={
            <OfflineField
              key={record.id}
              property={record}
              layers={layers}
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
        onLogHunt={isStandMarker(record) ? () => startReport(record.id) : undefined}
        history={
          isStandMarker(record) ? (
            <StandHistory reports={hub.reports.filter((r) => r.standId === record.id)} onPickReport={(id) => setSelection({ kind: 'report', id })} />
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
