import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, ChipSelect, Field, TextField, WindPicker } from '@/components/form';
import { useData } from '@/data/DataProvider';
import { deleteMarker, saveMarker } from '@/db/repo';
import { newId } from '@/lib/ids';
import { MARKER_TYPES, WIND_MARKER_TYPES } from '@/map/featureTypes';
import { propertyContaining } from '@/map/geo';
import { colors } from '@/theme';
import type { CompassPoint, MarkerType } from '@/types/models';

const TYPE_OPTIONS = (Object.keys(MARKER_TYPES) as MarkerType[]).map((value) => ({
  value,
  label: MARKER_TYPES[value].label,
  color: MARKER_TYPES[value].color,
}));

// /marker/new?lat=..&lng=..&type=stand creates a marker; /marker/<id> edits one.
export default function MarkerScreen() {
  const params = useLocalSearchParams<{ id: string; lat?: string; lng?: string; type?: MarkerType }>();
  const db = useSQLiteContext();
  const { markers, properties, reload } = useData();

  const existing = markers.find((m) => m.id === params.id);
  const isNew = !existing;
  const lat = existing?.lat ?? Number(params.lat);
  const lng = existing?.lng ?? Number(params.lng);

  const [type, setType] = useState<MarkerType>(existing?.type ?? params.type ?? 'stand');
  const [name, setName] = useState(existing?.name ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [goodWinds, setGoodWinds] = useState<CompassPoint[]>(existing?.goodWinds ?? []);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return <Text style={styles.error}>This marker no longer exists.</Text>;
  }

  async function save() {
    const property = propertyContaining(properties, [lng, lat]);
    await saveMarker(db, {
      id: existing?.id ?? newId(),
      propertyId: property?.id ?? null,
      type,
      name: name.trim() || MARKER_TYPES[type].label,
      lat,
      lng,
      notes: notes.trim() || null,
      goodWinds: WIND_MARKER_TYPES.includes(type) ? goodWinds : [],
    });
    await reload();
    router.back();
  }

  function confirmDelete() {
    if (!existing) return;
    Alert.alert(`Delete ${existing.name}?`, 'Past hunt reports from this stand are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMarker(db, existing.id);
          await reload();
          router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isNew ? 'New marker' : existing.name }} />

      <Field label="Type">
        <ChipSelect options={TYPE_OPTIONS} value={type} onChange={setType} />
      </Field>

      <Field label="Name">
        <TextField value={name} onChangeText={setName} placeholder={`e.g. Ridge ${MARKER_TYPES[type].label}`} />
      </Field>

      {WIND_MARKER_TYPES.includes(type) && (
        <Field label="Good winds">
          <WindPicker value={goodWinds} onChange={setGoodWinds} />
          <Text style={styles.hint}>Wind directions (where the wind blows from) that keep your scent off the deer.</Text>
        </Field>
      )}

      <Field label="Notes">
        <TextField value={notes} onChangeText={setNotes} placeholder="Access route, height, shooting lanes…" multiline />
      </Field>

      <Text style={styles.coords}>
        {lat.toFixed(6)}, {lng.toFixed(6)}
      </Text>

      <Button title="Save" onPress={save} />
      {!isNew && <Button title="Delete" variant="danger" onPress={confirmDelete} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 8 },
  coords: { color: colors.muted, fontVariant: ['tabular-nums'], marginBottom: 20, textAlign: 'center' },
  error: { color: colors.text, padding: 24 },
});
