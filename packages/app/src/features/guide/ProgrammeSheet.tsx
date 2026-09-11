import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Programme } from '@norstream/core';
import type { StoredChannel } from '../../storage/channels.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { programmeOptions } from './layout.js';
import type { CellState } from './layout.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';

interface Props {
  channel: StoredChannel;
  /** Null naar bladet er aabnet paa et hul: kanalen uden programdata. */
  programme: Programme | null;
  state: CellState;
  hasDialect: boolean;
  onPlay: () => void;
  onRestart: () => void;
  onClose: () => void;
  /** Aabner kanalens hele dag: arkivet dag for dag. */
  onDay?: () => void;
}

/**
 * Udsendelsens detaljer og hvad man kan goere ved den.
 *
 * Gitteret har plads til en titel og ikke mere. Beskrivelsen — som panelet
 * leverer sammen med titlen og som ellers aldrig blev vist — hoerer hjemme her,
 * og det samme goer handlingerne: foer udfoerte et tryk paa en celle **én**
 * handling, som afhang af om udsendelsen var sendt, om kanalen havde arkiv og
 * om dialekten var fundet. Det kunne man ikke se paa cellen, og man opdagede
 * det foerst efter at have trykket.
 */
export function ProgrammeSheet({
  channel,
  programme,
  state,
  hasDialect,
  onPlay,
  onRestart,
  onClose,
  onDay,
}: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const options = programmeOptions(state, channel, hasDialect);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Paa tv maa bagtaeppet ikke kunne faa fokus: det var det foerste
          trykpunkt i bladet, saa OK lukkede bladet i stedet for at vaelge. */}
      <TvPressable style={styles.backdrop} onPress={onClose} focusable={!isTV} />
      <View style={[styles.sheet, { paddingBottom: theme.spacing.lg + insets.bottom }]}>
        <View style={styles.grabber} />

        <View style={styles.header}>
          <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={40} />
          <View style={styles.headerText}>
            <Text style={styles.channel} numberOfLines={1}>
              {channel.name}
            </Text>
            <Text style={styles.time}>
              {programme === null
                ? 'Ingen programdata'
                : `${clock(programme.start)} – ${clock(programme.stop)} · ${minutes(programme)} min`}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{programme === null ? channel.name : programme.title}</Text>

        <ScrollView style={styles.descriptionBox}>
          <Text style={styles.description}>
            {programme === null
              ? 'Udbyderen har ingen programoversigt for kanalen i dette tidsrum. Kanalen kan ses direkte.'
              : (programme.description ?? 'Udbyderen har ingen beskrivelse af denne udsendelse.')}
          </Text>
        </ScrollView>

        {/* Paa tv staar fjernbetjeningen paa Start forfra naar den findes:
            det er dét man aabner bladet for paa en udsendelse der er i
            gang eller sendt, og Se kanalen kostede et tryk ned hver gang. */}
        <View style={styles.actions}>
          {options.play && (
            <TvPressable
              style={[styles.button, !options.restart && styles.buttonAccent]}
              onPress={onPlay}
              hasTVPreferredFocus={isTV && !options.restart}
            >
              <Text style={styles.buttonText}>Se {channel.name}</Text>
            </TvPressable>
          )}
          {options.restart && (
            <TvPressable style={[styles.button, styles.buttonAccent]} onPress={onRestart} hasTVPreferredFocus={isTV}>
              <Text style={styles.buttonText}>▶ Start forfra</Text>
            </TvPressable>
          )}
          {!options.restart && programme !== null && (
            <Text style={styles.hint}>
              {channel.hasArchive
                ? 'Appen har ikke fundet vejen til udbyderens arkiv endnu, så udsendelsen kan ikke startes forfra.'
                : 'Kanalen har intet arkiv hos udbyderen, så kun direkte visning er mulig.'}
            </Text>
          )}
        </View>

        {onDay !== undefined && (
          <TvPressable style={styles.button} onPress={onDay}>
            <Text style={styles.buttonText}>Hele dagen på {channel.name.includes('|') ? channel.name.slice(channel.name.lastIndexOf('|') + 1).trim() : channel.name}</Text>
          </TvPressable>
        )}
        <TvPressable style={styles.close} onPress={onClose}>
          <Text style={styles.closeText}>Luk</Text>
        </TvPressable>
      </View>
    </Modal>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function minutes(programme: Programme): number {
  return Math.round((programme.stop.getTime() - programme.start.getTime()) / 60_000);
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000cc' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: theme.spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerText: { flex: 1, marginLeft: theme.spacing.sm },
  channel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  time: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: theme.spacing.md,
  },
  descriptionBox: { maxHeight: 160, marginTop: theme.spacing.sm },
  description: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  actions: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  buttonAccent: { backgroundColor: colors.accent },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  close: { alignSelf: 'center', paddingVertical: theme.spacing.md },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
