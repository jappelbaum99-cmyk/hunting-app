import { Camera, LineLayer, LocationPuck, MapView, VectorSource } from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import type { Position } from 'geojson';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddMenu, type AddAction } from '@/components/AddMenu';
import { BasemapToggle } from '@/components/BasemapToggle';
import { DrawToolbar } from '@/components/DrawToolbar';
import { DraftShapeLayers, SavedFeatureLayers } from '@/components/MapFeatureLayers';
import { useData } from '@/data/DataProvider';
import { setDraftGeometry } from '@/data/drafts';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAPBOX_TOKEN } from '@/lib/config';
import { BASEMAPS, type BasemapId } from '@/map/basemaps';
import { acresOf, boundsOf, formatAcres, parseAreaGeometry, pointsToPolygon } from '@/map/geo';
import { colors } from '@/theme';

type Mode =
  | { kind: 'browse' }
  | { kind: 'placeMarker' }
  | { kind: 'draw'; target: 'area' | 'property'; points: Position[] };

export default function MapScreen() {
  const camera = useRef<Camera>(null);
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { properties, areas } = useData();

  const [basemapId, setBasemapId] = useState<BasemapId>('satellite');
  const [hasLocation, setHasLocation] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  const basemap = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ granted }) => setHasLocation(granted));
  }, []);

  // Other screens open the map on a property or area with /?focus=<id>.
  useEffect(() => {
    if (!focus) return;
    const target = properties.find((p) => p.id === focus)?.boundaryGeoJson ?? areas.find((a) => a.id === focus)?.geoJson;
    const geometry = parseAreaGeometry(target ?? null);
    if (!geometry) return;
    const [sw, ne] = boundsOf(geometry);
    camera.current?.fitBounds(ne, sw, [80, 40, 160, 40], 800);
  }, [focus, properties, areas]);

  async function currentPosition(): Promise<Location.LocationObject | null> {
    if (!hasLocation) {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      setHasLocation(granted);
      if (!granted) {
        Alert.alert('Location is off', 'Allow location access in Settings to use GPS.');
        return null;
      }
    }
    setLocating(true);
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    } finally {
      setLocating(false);
    }
  }

  async function centerOnMe() {
    const position = await currentPosition();
    if (!position) return;
    camera.current?.setCamera({
      centerCoordinate: [position.coords.longitude, position.coords.latitude],
      zoomLevel: 16,
      animationDuration: 800,
    });
  }

  function openNewMarker(lng: number, lat: number, type?: 'stand') {
    router.push({ pathname: '/marker/[id]', params: { id: 'new', lat: String(lat), lng: String(lng), ...(type && { type }) } });
  }

  async function handleAdd(action: AddAction) {
    setMenuOpen(false);
    switch (action) {
      case 'stand-gps': {
        const position = await currentPosition();
        if (position) openNewMarker(position.coords.longitude, position.coords.latitude, 'stand');
        break;
      }
      case 'marker-tap':
        setMode({ kind: 'placeMarker' });
        break;
      case 'draw-area':
        setMode({ kind: 'draw', target: 'area', points: [] });
        break;
      case 'draw-property':
        setMode({ kind: 'draw', target: 'property', points: [] });
        break;
    }
  }

  function handleMapPress(position: Position) {
    if (mode.kind === 'placeMarker') {
      setMode({ kind: 'browse' });
      openNewMarker(position[0], position[1]);
    } else if (mode.kind === 'draw') {
      setMode({ ...mode, points: [...mode.points, position] });
    }
  }

  function finishDrawing() {
    if (mode.kind !== 'draw' || mode.points.length < 3) return;
    setDraftGeometry(pointsToPolygon(mode.points));
    const pathname = mode.target === 'area' ? '/area/[id]' : '/property/[id]';
    setMode({ kind: 'browse' });
    router.push({ pathname, params: { id: 'new' } });
  }

  if (!MAPBOX_TOKEN) {
    return (
      <View style={styles.missingToken}>
        <Text style={styles.missingTokenTitle}>Mapbox token missing</Text>
        <Text style={styles.missingTokenBody}>
          Add EXPO_PUBLIC_MAPBOX_TOKEN to a .env file (see .env.example), then restart the dev server.
        </Text>
      </View>
    );
  }

  const browsing = mode.kind === 'browse';

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL={basemap.styleURL}
        scaleBarEnabled
        compassEnabled
        compassViewPosition={1}
        logoPosition={{ bottom: 8, left: 8 }}
        attributionPosition={{ bottom: 8, right: 8 }}
        onPress={(feature) => handleMapPress(feature.geometry.coordinates)}
        onLongPress={(feature) => {
          if (browsing) openNewMarker(feature.geometry.coordinates[0], feature.geometry.coordinates[1]);
        }}
      >
        <Camera ref={camera} defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }} />

        {basemap.showContours && (
          <VectorSource id="terrain" url="mapbox://mapbox.mapbox-terrain-v2">
            <LineLayer
              id="contours"
              sourceLayerID="contour"
              minZoomLevel={12}
              style={{
                lineColor: '#fff3c4',
                lineOpacity: 0.55,
                // Every 5th contour (index) line is drawn thicker.
                lineWidth: ['match', ['get', 'index'], [5, 10], 1.4, 0.6],
              }}
            />
          </VectorSource>
        )}

        <SavedFeatureLayers
          onMarkerPress={browsing ? (id) => router.push({ pathname: '/marker/[id]', params: { id } }) : undefined}
          onAreaPress={browsing ? (id) => router.push({ pathname: '/area/[id]', params: { id } }) : undefined}
        />

        {mode.kind === 'draw' && <DraftShapeLayers points={mode.points} />}

        {hasLocation && <LocationPuck puckBearingEnabled puckBearing="heading" pulsing={{ isEnabled: true }} />}
      </MapView>

      <SafeAreaView style={styles.topBar} pointerEvents="box-none" edges={['top']}>
        <Pressable style={styles.roundButton} onPress={() => router.push('/properties')} accessibilityLabel="Properties">
          <Text style={styles.roundButtonIcon}>☰</Text>
        </Pressable>
        <BasemapToggle value={basemapId} onChange={setBasemapId} />
        <View style={styles.roundButtonSpacer} />
      </SafeAreaView>

      {browsing && (
        <>
          <Pressable style={[styles.roundButton, styles.locateButton]} onPress={centerOnMe} accessibilityLabel="Center on my location">
            {locating ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.roundButtonIcon}>◎</Text>}
          </Pressable>
          <Pressable style={styles.addButton} onPress={() => setMenuOpen(true)} accessibilityLabel="Add to map">
            <Text style={styles.addButtonText}>＋</Text>
          </Pressable>
        </>
      )}

      {mode.kind === 'placeMarker' && (
        <DrawToolbar hint="Tap the map where the marker goes" onCancel={() => setMode({ kind: 'browse' })} />
      )}

      {mode.kind === 'draw' && (
        <DrawToolbar
          hint={
            mode.points.length < 3
              ? `Tap each corner of the ${mode.target === 'area' ? 'area' : 'property'} (${mode.points.length}/3)`
              : 'Keep tapping corners, then Done'
          }
          detail={mode.points.length >= 3 ? formatAcres(acresOf(pointsToPolygon(mode.points))) : undefined}
          canUndo={mode.points.length > 0}
          canFinish={mode.points.length >= 3}
          onUndo={() => setMode({ ...mode, points: mode.points.slice(0, -1) })}
          onCancel={() => setMode({ kind: 'browse' })}
          onFinish={finishDrawing}
        />
      )}

      {menuOpen && <AddMenu onSelect={handleAdd} onClose={() => setMenuOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonSpacer: { width: 48 },
  roundButtonIcon: { color: colors.accent, fontSize: 22, fontWeight: '700' },
  locateButton: { position: 'absolute', right: 16, bottom: 120 },
  addButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 40,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  addButtonText: { color: colors.onAccent, fontSize: 34, fontWeight: '700', marginTop: -2 },
  missingToken: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  missingTokenTitle: { color: colors.accent, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  missingTokenBody: { color: colors.text, textAlign: 'center' },
});
