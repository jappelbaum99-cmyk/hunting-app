import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

interface Props {
  hint: string;
  detail?: string;
  canUndo?: boolean;
  canFinish?: boolean;
  onUndo?: () => void;
  onCancel: () => void;
  onFinish?: () => void;
}

// Bottom bar shown while placing a marker or drawing a shape.
export function DrawToolbar({ hint, detail, canUndo, canFinish, onUndo, onCancel, onFinish }: Props) {
  return (
    <View style={styles.bar}>
      <Text style={styles.hint}>{hint}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <View style={styles.buttons}>
        <ToolbarButton title="Cancel" onPress={onCancel} />
        {onUndo && <ToolbarButton title="Undo" onPress={onUndo} disabled={!canUndo} />}
        {onFinish && <ToolbarButton title="Done" onPress={onFinish} disabled={!canFinish} primary />}
      </View>
    </View>
  );
}

function ToolbarButton({
  title,
  onPress,
  disabled,
  primary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 32,
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 14,
  },
  hint: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  detail: { color: colors.accent, fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  primaryText: { color: colors.onAccent },
});
