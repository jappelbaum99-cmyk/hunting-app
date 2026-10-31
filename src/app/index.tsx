import { Camera, LineLayer, LocationPuck, MapView, VectorSource } from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BasemapToggle } from '@/components/BasemapToggle';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAPBOX_TOKEN } from '@/lib/config';
import { BASEMAPS, type BasemapId } from '@/map/basemaps';

export default function MapScreen() {
  const camera = useRef<Camera>(null);
  const [basemapId, setBasemapId] = useState<BasemapId>('satellite');
  const [hasLocation, setHasLocation] = useState(false);

  const basemap = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ granted }) => setHasLocation(granted));
  }, []);

  async function centerOnMe() {
    if (!hasLocation) {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      setHasLocation(granted);
      if (!granted) return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    camera.current?.setCamera({
      centerCoordinate: [position.coords.longitude, position.coords.latitude],
      zoomLevel: 16,
      animationDuration: 800,
    });
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
      >
        <Camera
          ref={camera}
          defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }}
        />

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

        {hasLocation && <LocationPuck puckBearingEnabled puckBearing="heading" pulsing={{ isEnabled: true }} />}
      </MapView>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none" edges={['top']}>
        <BasemapToggle value={basemapId} onChange={setBasemapId} />
      </SafeAreaView>

      <Pressable style={styles.locateButton} onPress={centerOnMe} accessibilityLabel="Center on my location">
        <Text style={styles.locateIcon}>◎</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 8,
  },
  locateButton: {
    position: 'absolute',
    right: 16,
    bottom: 48,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(20, 24, 20, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locateIcon: { color: '#f28c28', fontSize: 26, fontWeight: '700' },
  missingToken: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#141814' },
  missingTokenTitle: { color: '#f28c28', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  missingTokenBody: { color: '#e8e8e8', textAlign: 'center' },
});
