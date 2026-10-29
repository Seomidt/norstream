import { Modal, StyleSheet, Text, View } from 'react-native';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';

export function ContinueMenu({ title, busy, error, onRemove, onClear, onClose, listName = 'Se videre' }: {
  title: string; busy: boolean; error: string | null;
  listName?: 'Se videre' | 'Fortsæt';
  onRemove: () => void; onClear: () => void; onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.panel} accessibilityViewIsModal>
          <Text style={styles.title}>{listName}</Text>
          <Text style={styles.name} numberOfLines={2}>{title}</Text>
          <Text style={styles.hint}>Ryd visningen på denne boks. Gemte afspilningspositioner bevares.</Text>
          <TvPressable style={styles.button} hasTVPreferredFocus={isTV} disabled={busy} onPress={onRemove}>
            <Text style={styles.label}>Fjern denne fra {listName}</Text>
          </TvPressable>
          <TvPressable style={styles.button} disabled={busy} onPress={onClear}>
            <Text style={styles.label}>Ryd hele {listName}</Text>
          </TvPressable>
          <TvPressable style={styles.button} disabled={busy} onPress={onClose}>
            <Text style={styles.label}>Annuller</Text>
          </TvPressable>
          {error !== null && <Text style={styles.hint} accessibilityRole="alert">{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000bb', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { width: '100%', maxWidth: 480, backgroundColor: colors.surface, borderRadius: 8, padding: 18, gap: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  name: { color: colors.text, fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  button: { padding: 10, backgroundColor: colors.surfaceRaised, borderRadius: 6 },
  label: { color: colors.text, fontSize: 15 },
});
