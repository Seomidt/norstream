import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { archiveTimeLabel } from './archiveProgress.js';
import type { ArchiveProgressTime } from './archiveProgress.js';

/** Kun visning: laeser det eksisterende afspilningsur uden seek eller netkald. */
export function ArchiveProgress({ read }: { read: () => ArchiveProgressTime | null }) {
  const styles = useStyles(makeStyles);
  const [time, setTime] = useState(read);
  useEffect(() => {
    const refresh = () => {
      const next = read();
      setTime((previous) => previous?.elapsed === next?.elapsed && previous?.duration === next?.duration ? previous : next);
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [read]);
  if (time === null) return null;
  const current = archiveTimeLabel(time.elapsed);
  const total = archiveTimeLabel(time.duration);
  const remaining = archiveTimeLabel(time.remaining);
  return (
    <View
      style={styles.container}
      focusable={false}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: time.duration, now: time.elapsed, text: `${current} af ${total}, ${remaining} tilbage` }}
    >
      <View style={styles.times}>
        <Text style={styles.elapsed}>{current} / {total}</Text>
        <Text style={styles.remaining}>{remaining} tilbage</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${time.elapsed / time.duration * 100}%` }]} />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { width: '100%', flexShrink: 0, paddingBottom: 4 },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  elapsed: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  remaining: { color: colors.textMuted, fontSize: 15, fontVariant: ['tabular-nums'] },
  track: { height: 3, marginTop: 6, backgroundColor: colors.border, borderRadius: 2 },
  fill: { height: 3, backgroundColor: colors.accent, borderRadius: 2 },
});
