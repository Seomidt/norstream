import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../ui/theme.js';

export interface TrackOption {
  key: string;
  label: string;
  active: boolean;
  onPress: () => void;
}

/** Listen over spor, lagt oven paa afspilleren. Samme i film og live. */
export function TrackPicker({
  title,
  options,
  emptyText,
  onClose,
}: {
  title: string;
  options: TrackOption[];
  emptyText: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.picker}>
      <View style={styles.pickerHeader}>
        <Text style={styles.pickerTitle}>{title}</Text>
        <Pressable hitSlop={12} onPress={onClose}>
          <Text style={styles.pickerClose}>✕</Text>
        </Pressable>
      </View>
      <FlatList
        data={options}
        keyExtractor={(option) => option.key}
        ListEmptyComponent={<Text style={styles.pickerEmpty}>{emptyText}</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.pickerRow} onPress={item.onPress}>
            <Text style={[styles.pickerLabel, item.active && styles.pickerActive]}>
              {item.active ? '✓ ' : ''}
              {item.label}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: 96,
    maxHeight: 320,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderColor: theme.colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  pickerClose: { color: theme.colors.textMuted, fontSize: 18 },
  pickerRow: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm + 2 },
  pickerLabel: { color: theme.colors.text, fontSize: 15 },
  pickerActive: { color: theme.colors.accent, fontWeight: '700' },
  pickerEmpty: { color: theme.colors.textMuted, padding: theme.spacing.md },
});
