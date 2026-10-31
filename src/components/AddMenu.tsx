import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

export type AddAction = 'stand-gps' | 'marker-tap' | 'draw-area' | 'draw-property';

const ACTIONS: { action: AddAction; title: string; subtitle: string }[] = [
  { action: 'stand-gps', title: 'Mark stand here', subtitle: 'Uses your GPS location' },
  { action: 'marker-tap', title: 'Place marker on map', subtitle: 'Stand, camera, rub, scrape…' },
  { action: 'draw-area', title: 'Draw area', subtitle: 'Food plot, bedding, sanctuary…' },
  { action: 'draw-property', title: 'Draw property boundary', subtitle: 'Trace your property lines' },
];

export function AddMenu({ onSelect, onClose }: { onSelect: (action: AddAction) => void; onClose: () => void }) {
  return (
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
      <View style={styles.panel}>
        {ACTIONS.map((item) => (
          <Pressable
            key={item.action}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onSelect(item.action)}
            accessibilityRole="button"
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.subtitle}>{item.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: 120,
  },
  panel: { backgroundColor: colors.panel, borderRadius: 16, overflow: 'hidden' },
  row: { paddingHorizontal: 18, paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { backgroundColor: colors.card },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
