import type { Position } from 'geojson';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DetailPanel } from '@/components/DetailPanel';
import { DrawBar } from '@/components/DrawBar';
import { LayerPanel } from '@/components/LayerPanel';
import { MapToolbar } from '@/components/MapToolbar';
import { Sidebar } from '@/components/Sidebar';
import { newRecordFields, useHubData } from '@/data/HubDataProvider';
import { isDesktop } from '@/data/storage';
import { AREA_TYPES, MARKER_TYPES } from '@/lib/featureTypes';
import { boundsOf, pointsToPolygon, propertyContaining } from '@/lib/geo';
import { importGeoFile } from '@/lib/importGeo';
import { DEFAULT_LAYERS, type MapLayersState } from '@/map/layers';
import { MapView, type MapViewHandle } from '@/map/MapView';
import type { AreaGeometry, AreaType, MapMarker, MarkerType, Selection } from '@/types/models';

type Mode =
  | { kind: 'browse' }
  | { kind: 'place'; markerType: MarkerType }
  | { kind: 'draw'; target: 'property' }
  | { kind: 'draw'; target: 'area'; areaType: AreaType };

const MAX_IMPORTED_SHAPES = 50;
const STAND_NAME = /\b(stand|blind|tree ?stand|ladder|box)\b/i;

export function App() {
  const hub = useHubData();
  const mapRef = useRef<MapViewHandle>(null);
  const [layers, setLayers] = useState<MapLayersState>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [draftPoints, setDraftPoints] = useState<Position[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);

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

  const handleMapClick = (position: Position) => {
    if (mode.kind === 'draw') {
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

  return (
    <div className={`app${selection ? ' has-detail' : ''}`}>
      <Sidebar
        properties={hub.properties}
        areas={hub.areas}
        markers={hub.markers}
        selection={selection}
        dataPath={isDesktop ? dataPath : null}
        onShowDataFolder={window.hub ? () => void window.hub?.showDataFolder() : null}
        onPick={(next) => {
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
          selection={selection}
          interaction={mode.kind}
          draftPoints={draftPoints}
          draftColor={draftColor}
          onMapClick={handleMapClick}
          onSelect={setSelection}
          onMarkerMoved={handleMarkerMoved}
        />
        <MapToolbar
          disabled={mode.kind !== 'browse'}
          onDrawProperty={() => startMode({ kind: 'draw', target: 'property' })}
          onDrawArea={(areaType) => startMode({ kind: 'draw', target: 'area', areaType })}
          onPlaceMarker={(markerType) => startMode({ kind: 'place', markerType })}
          onImport={(file) => void handleImport(file)}
        />
        <LayerPanel layers={layers} onChange={setLayers} />
        {mode.kind !== 'browse' && (
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

      {renderDetail()}
    </div>
  );

  // Called as a function, not a component, so inputs keep focus while typing.
  function renderDetail() {
    if (!selection) return null;
    const common = {
      onZoom: () => zoomTo(selection),
      onClose: () => setSelection(null),
    };
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
