import { StyleSheet, Text, View } from 'react-native';
import type { Programme } from '@norstream/core';
import type { StoredChannel } from '../../storage/channels.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { formatClock, formatSpan, minutesLeft, nowAndNext, progressRatio, relativeDay, upcoming } from './nowNext.js';

/** Knapperne i boksen paa tv: se kanalen, start forfra, hele dagen. */
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
  /**
   * Tv: boksen er en soejle med hele hoejden. Minutter tilbage, to
   * udsendelser frem, knapperne lige ved siden af og en linje om
   * tasterne. Boksen selv kan ikke trykkes; det kan knapperne.
   */
  rich?: boolean;
  /** Tv: udsendelsen fjernbetjeningen staar paa i gitteret. Saa handler soejlen om den, ikke om det der er i gang lige nu. */
  focus?: Programme | null;
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
export function NowNextBox({ channel, programmes, now, compact, onOpen, rich = false, focus = null }: Props) {
  const styles = useStyles(makeStyles);
  const live = nowAndNext(programmes, now);
  // Med en udsendelse i fokus er det den der beskrives, og "naeste" er
  // dem efter den. Uden er det den der er i gang.
  const current = focus ?? live.now;
  const next = live.next;
  const isLive = current !== null && current.start.getTime() <= now.getTime() && current.stop.getTime() > now.getTime();
  const later = rich
    ? focus !== null
      ? [...programmes]
          .filter((p) => p !== focus && p.start.getTime() >= focus.stop.getTime() - 1)
          .sort((a, b) => a.start.getTime() - b.start.getTime())
          .slice(0, 2)
      : upcoming(programmes, now, 2)
    : next === null
      ? []
      : [next];
  const kicker =
    current === null || isLive ? 'NU' : current.stop.getTime() <= now.getTime() ? 'SENDT' : 'SENERE';
  // Dagen ved siden af klokkeslaettet, naar man har bladret vaek fra det der
  // sender nu: saa ved man baade hvornaar OG hvilken dag. Ogsaa "i dag" — en
  // udsendelse sendt tidligere i dag skal sige "SENDT · i dag", ikke bare
  // "SENDT". Kun det der sender live faar ingen dag (den er underforstaaet nu).
  const day = current === null || isLive ? null : relativeDay(current.start, now);

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
            {current === null ? 'Ingen programdata' : `${day !== null ? `${day} · ` : ''}${formatSpan(current)} · ${current.title}`}
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

  const body = (
    <>
      <View style={styles.head}>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={28} />
        <Text style={styles.channel} numberOfLines={1}>
          {channel.name}
        </Text>
      </View>

      <Text style={styles.kicker}>{kicker}{day !== null ? ` · ${day}` : ''}</Text>
      {current === null ? (
        <Text style={styles.muted}>Ingen programdata for kanalen lige nu.</Text>
      ) : (
        <>
          <Text style={styles.title} numberOfLines={2}>
            {current.title}
          </Text>
          <View style={styles.timeRow}>
            <Text style={styles.time}>{formatSpan(current)}</Text>
            {rich && isLive && <Text style={styles.time}>{minutesLeft(current, now)} min tilbage</Text>}
          </View>
          {isLive && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(progressRatio(current, now) * 100)}%` }]} />
            </View>
          )}
          {current.description !== null && current.description.length > 0 && (
            <Text style={styles.description} numberOfLines={rich ? 5 : 4}>
              {current.description}
            </Text>
          )}
        </>
      )}

      {later.length > 0 && (
        <View style={styles.next}>
          <Text style={styles.kicker}>NÆSTE</Text>
          {later.map((programme) => (
            <View key={programme.start.getTime()} style={styles.nextLine}>
              <Text style={styles.nextClock}>{formatClock(programme.start)}</Text>
              <Text style={styles.nextTitle} numberOfLines={1}>
                {programme.title}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Ingen knapper her paa tv: gitteret holder paa fokus mod hoejre,
          saa knapperne kunne ikke naas — og OK paa udsendelsen giver de
          samme valg. Kun vinket staar tilbage. */}
      {rich && <Text style={styles.hint}>OK: se kanalen, start forfra, hele dagen · Pil højre/venstre i kanten: frem og tilbage i tiden · Pil op: favoritgrupper · Tilbage: til nu, og så menuen</Text>}
    </>
  );

  if (rich) return <View style={styles.box}>{body}</View>;
  return (
    <TvPressable style={styles.box} onPress={() => onOpen(channel, current)} accessibilityLabel="Nu og næste">
      {body}
    </TvPressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  strip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  stripLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  stripLabel: { color: colors.accent, fontSize: 11, fontWeight: '800', width: 40 },
  stripText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  stripTextMuted: { flex: 1, color: colors.textMuted, fontSize: 13 },
  box: {
    flex: 1,
    padding: theme.spacing.md,
    backgroundColor: colors.surface,
    gap: theme.spacing.xs,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
  channel: { flex: 1, color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', marginVertical: 2 },
  fill: { height: 3, backgroundColor: colors.accent },
  description: { color: colors.text, fontSize: 13, lineHeight: 18, opacity: 0.85 },
  muted: { color: colors.textMuted, fontSize: 13 },
  next: { marginTop: 'auto', paddingTop: theme.spacing.sm, gap: 2 },
  nextLine: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'baseline' },
  nextClock: { color: colors.textMuted, fontSize: 14, width: 44, fontVariant: ['tabular-nums'] },
  nextTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 11, paddingTop: theme.spacing.xs },
});
