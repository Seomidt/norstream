import { StyleSheet, Text, View } from 'react-native';
import { useStyles } from '../../ui/ThemeContext.js';
import { theme, type ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { ARCHIVE_END_MARGIN_MINUTES } from './archiveContinuation.js';

/** Et sluttet arkivstykke maa ikke ligne en fastlaast afspiller. Kun
 * brugerens tryk maa forlaenge arkivet eller skifte frem til live. */
export function ArchiveEnd({ onContinue, onLive }: { onContinue: () => void; onLive: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>Arkivstykket er slut</Text>
      <Text style={styles.hint}>Du kan hente mere fra samme sted eller se kanalen direkte.</Text>
      <View style={styles.actions}>
        <TvPressable hasTVPreferredFocus={isTV} style={styles.button} onPress={onContinue}>
          <Text style={styles.label}>Hent {ARCHIVE_END_MARGIN_MINUTES} min mere</Text>
        </TvPressable>
        <TvPressable style={styles.button} onPress={onLive}>
          <Text style={styles.label}>Se direkte</Text>
        </TvPressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, padding: theme.spacing.lg, backgroundColor: '#000000' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  hint: { color: colors.textMuted, fontSize: 14, textAlign: 'center', maxWidth: 440 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.spacing.md, marginTop: theme.spacing.sm },
  button: { backgroundColor: colors.surfaceRaised, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
