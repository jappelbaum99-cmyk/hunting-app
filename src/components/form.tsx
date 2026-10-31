import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors } from '@/theme';
import type { CompassPoint } from '@/types/models';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.input, props.multiline && styles.multiline, props.style]}
    />
  );
}

interface ChipOption<T extends string> {
  value: T;
  label: string;
  color?: string;
}

export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, selected && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            {option.color && <View style={[styles.swatch, { backgroundColor: option.color }]} />}
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const COMPASS: CompassPoint[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Pick the wind directions a stand can be hunted on.
export function WindPicker({ value, onChange }: { value: CompassPoint[]; onChange: (value: CompassPoint[]) => void }) {
  function toggle(point: CompassPoint) {
    onChange(value.includes(point) ? value.filter((p) => p !== point) : COMPASS.filter((p) => p === point || value.includes(p)));
  }
  return (
    <View style={styles.chips}>
      {COMPASS.map((point) => {
        const selected = value.includes(point);
        return (
          <Pressable
            key={point}
            onPress={() => toggle(point)}
            style={[styles.windChip, selected && styles.chipSelected]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{point}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, styles[variant], disabled && styles.disabled]}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText, variant === 'primary' && styles.primaryText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 18 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  windChip: {
    width: 52,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 7,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: colors.onAccent },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
  danger: { backgroundColor: 'transparent', borderColor: colors.danger, borderWidth: 1 },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  primaryText: { color: colors.onAccent },
});
