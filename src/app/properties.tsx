import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/form';
import { useData } from '@/data/DataProvider';
import { saveMarker, saveProperty } from '@/db/repo';
import { newId } from '@/lib/ids';
import { importGeoFile } from '@/lib/importGeo';
import { acresOf, formatAcres, propertyContaining } from '@/map/geo';
import { colors } from '@/theme';
import type { Property } from '@/types/models';

// Whole-county parcel layers have thousands of shapes; those get their own
// tap-to-select layer later instead of becoming saved properties.
const MAX_IMPORTED_SHAPES = 50;

export default function PropertiesScreen() {
  const db = useSQLiteContext();
  const { properties, markers, areas, reload } = useData();
  const [importing, setImporting] = useState(false);

  async function importFile() {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    const baseName = file.name.replace(/\.[^.]+$/, '');

    setImporting(true);
    try {
      const { shapes, points } = await importGeoFile(file.uri, file.name);
      if (shapes.length > MAX_IMPORTED_SHAPES) {
        Alert.alert(
          'Too many shapes',
          `This file has ${shapes.length} shapes, which looks like a whole parcel layer. Import a file with just your property boundary.`,
        );
        return;
      }
      if (shapes.length === 0 && points.length === 0) {
        Alert.alert('Nothing to import', 'No boundaries or waypoints were found in this file.');
        return;
      }

      const imported: Property[] = shapes.map((shape, i) => ({
        id: newId(),
        name: shape.name ?? (shapes.length === 1 ? baseName : `${baseName} ${i + 1}`),
        boundaryGeoJson: JSON.stringify(shape.geometry),
        source: 'imported',
        parcelId: null,
        owner: shape.owner,
        acres: acresOf(shape.geometry),
      }));
      const allProperties = [...properties, ...imported];

      await db.withTransactionAsync(async () => {
        for (const property of imported) await saveProperty(db, property);
        for (const point of points) {
          const name = point.name ?? 'Waypoint';
          await saveMarker(db, {
            id: newId(),
            propertyId: propertyContaining(allProperties, point.position)?.id ?? null,
            type: /stand|blind/i.test(name) ? 'stand' : 'other',
            name,
            lat: point.position[1],
            lng: point.position[0],
            notes: `Imported from ${file.name}`,
            goodWinds: [],
          });
        }
      });
      await reload();

      Alert.alert('Imported', `${imported.length} boundary(s) and ${points.length} waypoint(s) from ${file.name}.`);
      if (imported.length === 1) router.navigate({ pathname: '/', params: { focus: imported[0].id } });
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={properties}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No properties yet. Draw a boundary from the ＋ menu on the map, or import a KML, GPX or GeoJSON file
            (Google Earth, onX and most county GIS sites can export these).
          </Text>
        }
        renderItem={({ item }) => {
          const standCount = markers.filter((m) => m.propertyId === item.id && m.type === 'stand').length;
          const areaCount = areas.filter((a) => a.propertyId === item.id).length;
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.navigate({ pathname: '/', params: { focus: item.id } })}
              accessibilityHint="Shows this property on the map"
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {[formatAcres(item.acres), `${standCount} stand(s)`, `${areaCount} area(s)`].filter(Boolean).join(' · ')}
                </Text>
                {item.owner && <Text style={styles.meta}>Owner: {item.owner}</Text>}
              </View>
              <Pressable
                hitSlop={12}
                onPress={() => router.push({ pathname: '/property/[id]', params: { id: item.id } })}
                accessibilityLabel={`Edit ${item.name}`}
              >
                <Text style={styles.edit}>Edit</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />
      <View style={styles.footer}>
        <Button title={importing ? 'Importing…' : 'Import KML / GPX / GeoJSON'} onPress={importFile} disabled={importing} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, flexGrow: 1 },
  empty: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.muted, marginTop: 3 },
  edit: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  footer: { padding: 16, paddingBottom: 32 },
});
