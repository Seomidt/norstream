import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import type { SqlDatabase } from '../../storage/types.js';
import { dueReminder, removeReminder } from '../../storage/reminders.js';
import type { DueReminder } from '../../storage/reminders.js';
import type { StoredChannel } from '../../storage/channels.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';

/** Hvor tit der kigges efter paamindelser. */
const POLL_MS = 30_000;

/**
 * Bjaelken i hjoernet naar en udsendelse man bad om at blive mindet om er
 * ved at begynde. Ligger oven paa alt, ogsaa afspilleren. OK paa "Se nu"
 * skifter kanal; Tilbage (eller Luk paa telefonen) fjerner den, og saa
 * kommer den ikke igen for den udsendelse.
 */
export function ReminderBanner({ db, onOpen }: { db: SqlDatabase; onOpen: (channel: StoredChannel) => void }) {
  const styles = useStyles(makeStyles);
  const [due, setDue] = useState<DueReminder | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const next = await dueReminder(db);
        if (!cancelled) setDue((current) => (current !== null && next !== null && current.channelId === next.channelId && current.startMs === next.startMs ? current : next));
      } catch {
        // Databasen er vaek; naeste runde.
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [db]);

  const dismiss = (): void => {
    if (due === null) return;
    void removeReminder(db, due.channelId, due.startMs);
    setDue(null);
  };

  // Tilbage lukker bjaelken foer den goer noget andet.
  useEffect(() => {
    if (due === null) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);

  if (due === null) return null;
  const minutes = Math.round((due.startMs - Date.now()) / 60_000);
  const when = minutes > 0 ? `Om ${minutes} min` : minutes === 0 ? 'Nu' : `Begyndt for ${-minutes} min siden`;
  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.banner}>
        <ChannelLogo uris={due.channel.logoUrls} name={due.channel.name} memoryKey={due.channel.id} size={36} />
        <View style={styles.text}>
          <Text style={styles.when}>{when} på {due.channel.name}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {due.title}
          </Text>
        </View>
        <TvPressable
          style={[styles.button, styles.buttonAccent]}
          hasTVPreferredFocus={isTV}
          onPress={() => {
            const channel = due.channel;
            void removeReminder(db, due.channelId, due.startMs);
            setDue(null);
            onOpen(channel);
          }}
        >
          <Text style={styles.buttonText}>Se nu</Text>
        </TvPressable>
        {!isTV && (
          <TvPressable style={styles.button} onPress={dismiss}>
            <Text style={styles.buttonText}>Luk</Text>
          </TvPressable>
        )}
      </View>
      {isTV && <Text style={styles.hint}>Tilbage fjerner påmindelsen</Text>}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  host: {
    position: 'absolute',
    top: theme.spacing.md,
    right: theme.spacing.md,
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    maxWidth: 520,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderWidth: 2,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  text: { flexShrink: 1, minWidth: 120 },
  when: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  button: {
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  buttonAccent: { backgroundColor: colors.accent },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 11 },
});
