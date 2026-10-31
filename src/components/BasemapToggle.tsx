import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BASEMAPS, type BasemapId } from '@/map/basemaps';

interface Props {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
}

export function BasemapToggle({ value, onChange }: Props) {
  return (
    <View style={styles.container}>
      {BASEMAPS.map((basemap) => {
        const selected = basemap.id === value;
        return (
          <Pressable
            key={basemap.id}
            onPress={() => onChange(basemap.id)}
            style={[styles.option, selected && styles.optionSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{basemap.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(20, 24, 20, 0.85)',
    borderRadius: 10,
    padding: 3,
  },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  optionSelected: {
    backgroundColor: '#f28c28',
  },
  label: {
    color: '#e8e8e8',
    fontWeight: '600',
  },
  labelSelected: {
    color: '#1a1a1a',
  },
});
