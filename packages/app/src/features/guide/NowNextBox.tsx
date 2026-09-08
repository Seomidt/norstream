import { StyleSheet, Text, View } from 'react-native';
import type { Programme } from '@norstream/core';
import type { StoredChannel } from '../../storage/channels.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { formatClock, formatSpan, nowAndNext, progressRatio } from './nowNext.js';

interface Props {
  /** Kanalen previewet viser; null naar der ikke er nogen. */
  channel: StoredChannel | null;
  /** Kanalens udsendelser omkring nu. Boksen finder selv nu og naeste. */
  programmes: readonly Programme[];
  now: Date;
  /**
   * Smal skaerm: en tynd stribe under previewet med nu og naeste paa hver
   * sin linje. Bred skaerm: en boks ved siden af previewet med beskrivelse.
   */
  compact: boolean;
  /** Et tryk: aabn udsendelsens blad, eller kanalen naar der ingen udsendelse er. */
  onOpen: (channel: StoredChannel, programme: Programme | null) => void;
}

/**
 * Hvad kanalen sender nu og hvad der kommer bagefter.
 *
 * Paa en telefon paa hoejkant er previewet en stribe over guiden, og
 * boksen maa ikke aede mere hoejde: to linjer. Paa en bred skaerm — en
 * foldet telefon slaaet ud, en tablet, et tv — staar previewet til venstre
 * og boksen fylder resten af bredden med beskrivelsen, som ellers kun kan
 * ses ved at aabne bladet.
 */
export function NowNextBox({ channel, programmes, now, compact, onOpen }: Props) {
  const { now: current, next } = nowAndNext(programmes, now);

  if (channel === null) {
    return compact ? null : (
      <View style={styles.box}>
        <Text style={styles.muted}>Vælg en kanal i guiden, så står programmet her.</Text>
      </View>
    );
  }

  if (compact) {
    return (
      <TvPressable style={styles.strip} onPress={() => onOpen(channel, current)} accessibilityLabel="Nu og næste">
        <View style={styles.stripLine}>
          <Text style={styles.stripLabel}>Nu</Text>
          <Text style={styles.stripText} numberOfLines={1}>
            {current === null ? 'Ingen programdata' : `${formatSpan(current)} · ${current.title}`}
          </Text>
        </View>
        {next !== null && (
          <View style={styles.stripLine}>
            <Text style={styles.stripLabel}>Næste</Text>
            <Text style={styles.stripTextMuted} numberOfLines={1}>
              {formatClock(next.start)} · {next.title}
            </Text>
          </View>
        )}
      </TvPressable>
    );
  }

  return (
    <TvPressable style={styles.box} onPress={() => onOpen(channel, current)} accessibilityLabel="Nu og næste">
      <View style={styles.head}>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={28} />
        <Text style={styles.channel} numberOfLines={1}>
          {channel.name}
        </Text>
      </View>

      <Text style={styles.kicker}>NU</Text>
      {current === null ? (
        <Text style={styles.muted}>Ingen programdata for kanalen lige nu.</Text>
      ) : (
        <>
          <Text style={styles.title} numberOfLines={2}>
            {current.title}
          </Text>
          <Text style={styles.time}>{formatSpan(current)}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progressRatio(current, now) * 100)}%` }]} />
          </View>
          {current.description !== null && current.description.length > 0 && (
            <Text style={styles.description} numberOfLines={4}>
              {current.description}
            </Text>
          )}
        </>
      )}

      {next !== null && (
        <View style={styles.next}>
          <Text style={styles.kicker}>NÆSTE</Text>
          <Text style={styles.nextTitle} numberOfLines={1}>
            {formatClock(next.start)} · {next.title}
          </Text>
        </View>
      )}
    </TvPressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.surface,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  stripLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  stripLabel: { color: theme.colors.accent, fontSize: 11, fontWeight: '800', width: 40 },
  stripText: { flex: 1, color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  stripTextMuted: { flex: 1, color: theme.colors.textMuted, fontSize: 13 },
  box: {
    flex: 1,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.xs,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
  channel: { flex: 1, color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  kicker: { color: theme.colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  time: { color: theme.colors.textMuted, fontSize: 13 },
  track: { height: 3, borderRadius: 2, backgroundColor: theme.colors.border, overflow: 'hidden', marginVertical: 2 },
  fill: { height: 3, backgroundColor: theme.colors.accent },
  description: { color: theme.colors.text, fontSize: 13, lineHeight: 18, opacity: 0.85 },
  muted: { color: theme.colors.textMuted, fontSize: 13 },
  next: { marginTop: 'auto', paddingTop: theme.spacing.sm, gap: 2 },
  nextTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
});
