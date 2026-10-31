import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, ChipSelect, Field, TextField } from '@/components/form';
import { useData } from '@/data/DataProvider';
import { getDraftGeometry } from '@/data/drafts';
import { deleteArea, saveArea } from '@/db/repo';
import { newId } from '@/lib/ids';
import { AREA_TYPES } from '@/map/featureTypes';
import { acresOf, formatAcres, isAreaGeometry, parseAreaGeometry, propertyContaining, type AreaGeometry } from '@/map/geo';
import { colors } from '@/theme';
import type { AreaType } from '@/types/models';

const TYPE_OPTIONS = (Object.keys(AREA_TYPES) as AreaType[]).map((value) => ({
  value,
  label: AREA_TYPES[value].label,
  color: AREA_TYPES[value].color,
}));

// /area/new takes its shape from the draft the map just drew; /area/<id> edits one.
export default function AreaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { areas, properties, reload } = useData();

  const existing = areas.find((a) => a.id === id);
  const [geometry] = useState<AreaGeometry | null>(() => {
    if (existing) return parseAreaGeometry(existing.geoJson);
    const draft = getDraftGeometry();
    return isAreaGeometry(draft) ? draft : null;
  });

  const [type, setType] = useState<AreaType>(existing?.type ?? 'food_plot');
  const [name, setName] = useState(existing?.name ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  if (!geometry) {
    return <Text style={styles.error}>This area no longer exists.</Text>;
  }
  const acres = acresOf(geometry);

  async function save() {
    if (!geometry) return;
    const firstVertex = geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0];
    await saveArea(db, {
      id: existing?.id ?? newId(),
      propertyId: propertyContaining(properties, firstVertex)?.id ?? null,
      type,
      name: name.trim() || AREA_TYPES[type].label,
      geoJson: JSON.stringify(geometry),
      acres,
      notes: notes.trim() || null,
    });
    await reload();
    router.back();
  }

  function confirmDelete() {
    if (!existing) return;
    Alert.alert(`Delete ${existing.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteArea(db, existing.id);
          await reload();
          router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? existing.name : 'New area' }} />

      <Text style={styles.acres}>{formatAcres(acres)}</Text>

      <Field label="Type">
        <ChipSelect options={TYPE_OPTIONS} value={type} onChange={setType} />
      </Field>

      <Field label="Name">
        <TextField value={name} onChangeText={setName} placeholder={`e.g. Creek bottom ${AREA_TYPES[type].label.toLowerCase()}`} />
      </Field>

      <Field label="Notes">
        <TextField
          value={notes}
          onChangeText={setNotes}
          placeholder={type === 'food_plot' ? 'Planting, seed, fertilizer, dates…' : 'Notes'}
          multiline
        />
      </Field>

      <Button title="Save" onPress={save} />
      {existing && <Button title="Delete" variant="danger" onPress={confirmDelete} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  acres: { color: colors.accent, fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 20 },
  error: { color: colors.text, padding: 24 },
});
