import type { Position } from 'geojson';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AlignPanel, completePoints, type AlignDraft } from '@/components/AlignPanel';
import { DetailPanel } from '@/components/DetailPanel';
import { DrawBar } from '@/components/DrawBar';
import { LayerPanel } from '@/components/LayerPanel';
import { MapToolbar } from '@/components/MapToolbar';
import { Sidebar } from '@/components/Sidebar';
import { newRecordFields, useHubData } from '@/data/HubDataProvider';
import { imageFileName, readImageSize, saveImage } from '@/data/images';
import { isDesktop } from '@/data/storage';
import { useImageUrls } from '@/data/useImageUrls';
import { AREA_TYPES, MARKER_TYPES } from '@/lib/featureTypes';
import { boundsOf, pointsToPolygon, propertyContaining } from '@/lib/geo';
import { overlayCorners } from '@/lib/georef';
import { importGeoFile } from '@/lib/importGeo';
import { DEFAULT_LAYERS, type MapLayersState } from '@/map/layers';
import { MapView, type AlignMarker, type MapViewHandle, type OverlayView } from '@/map/MapView';
import type { AreaGeometry, AreaType, MapImageOverlay, MapMarker, MarkerType, Selection } from '@/types/models';

type Mode =
  | { kind: 'browse' }
  | { kind: 'place'; markerType: MarkerType }
  | { kind: 'draw'; target: 'property' }
  | { kind: 'draw'; target: 'area'; areaType: AreaType }
  | { kind: 'align' };

const MAX_IMPORTED_SHAPES = 50;
const STAND_NAME = /\b(stand|blind|tree ?stand|ladder|box)\b/i;
// The align panel's width (--detail-width under .has-align in styles.css) plus its gaps.
const ALIGN_PANEL_INSET = 520 + 24;
const DEFAULT_OVERLAY_OPACITY = 0.6;

function cornersPolygon(corners: OverlayView['corners']): AreaGeometry {
  return pointsToPolygon(corners);
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
    } else {
      const label = AREA_TYPES[mode.areaType].label;
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

  const handleMapClick = (position: Position) => {
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
  const draftColor =
    mode.kind === 'draw' ? (mode.target === 'area' ? AREA_TYPES[mode.areaType].color : '#ffd400') : '#ffffff';
  const modeTitle =
    mode.kind === 'place'
      ? MARKER_TYPES[mode.markerType].label.toLowerCase()
      : mode.kind === 'draw'
        ? mode.target === 'property'
          ? 'property line'
          : AREA_TYPES[mode.areaType].label.toLowerCase()
        : '';

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

  const appClass = `app${selection ? ' has-detail' : ''}${alignDraft ? ' has-align' : ''}`;
  return (
    <div className={appClass}>
      <Sidebar
        properties={hub.properties}
        areas={hub.areas}
        markers={hub.markers}
        overlays={hub.overlays}
        selection={selection}
        dataPath={isDesktop ? dataPath : null}
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
          overlays={overlayViews}
          alignMarkers={alignMarkers}
          selection={selection}
          interaction={mode.kind}
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
            onDrawProperty={() => startMode({ kind: 'draw', target: 'property' })}
            onDrawArea={(areaType) => startMode({ kind: 'draw', target: 'area', areaType })}
            onPlaceMarker={(markerType) => startMode({ kind: 'place', markerType })}
            onImport={(file) => void handleImport(file)}
            onAddImage={(file) => void startAlignNew(file)}
          />
        )}
        <LayerPanel layers={layers} onChange={setLayers} />
        {(mode.kind === 'draw' || mode.kind === 'place') && (
          <DrawBar
            kind={mode.kind}
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
          onChange={hub.saveProperty}
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
        propertyName={propertyName(record.propertyId)}
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
