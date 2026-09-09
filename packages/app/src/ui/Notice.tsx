import { StyleSheet, Text, View } from 'react-native';
import { theme } from './theme.js';
import { TvPressable } from '../ui/TvPressable.js';

export interface NoticeState {
  text: string;
  /** Vises som en knap til hoejre, fx "Fortryd". */
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  notice: NoticeState | null;
  onDismiss: () => void;
}

/**
 * En besked i selve skaermen, med en valgfri handling.
 *
 * Bevidst ikke `Alert.alert`: react-native-web implementerer den ikke, saa
 * enhver flow der gik gennem en Alert doede **stille** paa web — opdaget ved
 * at koere appen i en browser, ikke ved at laese koden. Web er kun en
 * udviklingsflade her, men en bekraeftelse der ikke virker paa den flade er
 * ogsaa en bekraeftelse ingen kan afproeve.
 *
 * En notits med "Fortryd" er desuden bedre end en modal foer handlingen: den
 * afbryder ikke, og den kan tages tilbage.
 */
export function Notice({ notice, onDismiss }: Props) {
  if (notice === null) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{notice.text}</Text>
      {notice.actionLabel !== undefined && (
        <TvPressable
          hitSlop={8}
          onPress={() => {
            notice.onAction?.();
            onDismiss();
          }}
        >
          <Text style={styles.action}>{notice.actionLabel}</Text>
        </TvPressable>
      )}
      <TvPressable hitSlop={8} onPress={onDismiss}>
        <Text style={styles.dismiss}>✕</Text>
      </TvPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius,
    gap: theme.spacing.md,
  },
  text: { flex: 1, color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  action: { color: theme.colors.accent, fontSize: 13, fontWeight: '600' },
  dismiss: { color: theme.colors.textMuted, fontSize: 14 },
});
