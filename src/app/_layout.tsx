import Mapbox from '@rnmapbox/maps';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { DATABASE_NAME, migrateDbIfNeeded } from '@/db/database';
import { MAPBOX_TOKEN } from '@/lib/config';

Mapbox.setAccessToken(MAPBOX_TOKEN);

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </SQLiteProvider>
  );
}
