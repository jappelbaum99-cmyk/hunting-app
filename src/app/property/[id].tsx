import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, Field, TextField } from '@/components/form';
import { useData } from '@/data/DataProvider';
import { getDraftGeometry } from '@/data/drafts';
import { deleteProperty, saveProperty } from '@/db/repo';
import { newId } from '@/lib/ids';
import { acresOf, formatAcres, isAreaGeometry, parseAreaGeometry, type AreaGeometry } from '@/map/geo';
import { colors } from '@/theme';

// /property/new takes its boundary from the draft the map just drew; /property/<id> edits one.
export default function PropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { properties, markers, areas, reload } = useData();

  const existing = properties.find((p) => p.id === id);
  const [boundary] = useState<AreaGeometry | null>(() => {
    if (existing) return parseAreaGeometry(existing.boundaryGeoJson);
    const draft = getDraftGeometry();
    return isAreaGeometry(draft) ? draft : null;
  });

  const [name, setName] = useState(existing?.name ?? '');
  const [owner, setOwner] = useState(existing?.owner ?? '');

  if (!existing && !boundary) {
    return <Text style={styles.error}>This property no longer exists.</Text>;
  }
  const acres = boundary ? acresOf(boundary) : (existing?.acres ?? null);

  async function save() {
    await saveProperty(db, {
      id: existing?.id ?? newId(),
      name: name.trim() || 'My property',
      boundaryGeoJson: boundary ? JSON.stringify(boundary) : null,
      source: existing?.source ?? 'drawn',
      parcelId: existing?.parcelId ?? null,
      owner: owner.trim() || null,
      acres,
    });
    await reload();
    router.back();
  }

  function confirmDelete() {
    if (!existing) return;
    const standCount = markers.filter((m) => m.propertyId === existing.id).length;
    const areaCount = areas.filter((a) => a.propertyId === existing.id).length;
    Alert.alert(
      `Delete ${existing.name}?`,
      standCount + areaCount > 0
        ? `Its ${standCount} marker(s) and ${areaCount} area(s) stay on the map.`
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteProperty(db, existing.id);
            await reload();
            router.back();
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? existing.name : 'New property' }} />

      <Text style={styles.acres}>{formatAcres(acres)}</Text>

      <Field label="Name">
        <TextField value={name} onChangeText={setName} placeholder="e.g. Home farm" />
      </Field>

      <Field label="Owner">
        <TextField value={owner} onChangeText={setOwner} placeholder="Optional" />
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
