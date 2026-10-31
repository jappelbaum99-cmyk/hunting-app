import Mapbox from '@rnmapbox/maps';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { DataProvider } from '@/data/DataProvider';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/db/database';
import { MAPBOX_TOKEN } from '@/lib/config';
import { colors } from '@/theme';

Mapbox.setAccessToken(MAPBOX_TOKEN);

const modal = {
  presentation: 'modal',
  headerShown: true,
} as const;

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
      <DataProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="marker/[id]" options={{ ...modal, title: 'Marker' }} />
          <Stack.Screen name="area/[id]" options={{ ...modal, title: 'Area' }} />
          <Stack.Screen name="property/[id]" options={{ ...modal, title: 'Property' }} />
          <Stack.Screen name="properties" options={{ headerShown: true, title: 'Properties' }} />
        </Stack>
      </DataProvider>
    </SQLiteProvider>
  );
}
