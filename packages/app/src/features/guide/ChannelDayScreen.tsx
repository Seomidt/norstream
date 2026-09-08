import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { isScheduled } from '../../storage/recordings.js';
import { ensureFullEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { ProgrammeSheet } from './ProgrammeSheet.js';
import type { CellState } from './layout.js';

interface Props {
  session: AppSession;
  channel: StoredChannel;
  hasDialect: boolean;
  onBack: () => void;
  onPlay: (channel: StoredChannel) => void;
  onRestart: (channel: StoredChannel, programme: Programme) => void;
  onRecord: (channel: StoredChannel, programme: Programme) => void;
}

/** Hvor mange dage frem oversigten typisk raekker. */
const DAYS_FORWARD = 2;
/** Laengere tilbage end det har intet panel gemt. */
const MAX_DAYS_BACK = 7;

/**
 * Én kanal, hele dagen: i dag, i gaar, saa langt arkivet raekker, og et par
 * dage frem. Det er catch-up som paa udbydernes egne tjenester: vil man se
 * hvad DR1 sendte i gaar aften, skal man ikke traekke guiden baglaens i
 * mange omgange, men bladre til dagen og trykke paa udsendelsen.
 *
 * Programtabellen hentes én gang for kanalen (arkivets fulde tabel), saa
 * dagene bagud er fyldt; derefter laeses hver dag fra cachen.
 */
export function ChannelDayScreen({ session, channel, hasDialect, onBack, onPlay, onRestart, onRecord }: Props) {
  const daysBack = Math.min(MAX_DAYS_BACK, Math.max(0, channel.archiveDays));
  const [dayDelta, setDayDelta] = useState(0);
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [fetching, setFetching] = useState(true);
  const [sheet, setSheet] = useState<{ programme: Programme; state: CellState; recorded: boolean } | null>(null);
  const now = new Date();

  const dayBounds = useCallback((delta: number): { from: Date; to: Date } => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() + delta);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const { from, to } = dayBounds(dayDelta);
    setProgrammes(await listProgrammes(session.db, channel.id, from, to));
  }, [session.db, channel.id, dayDelta, dayBounds]);

  // Foerst det cachen har, saa hele tabellen fra panelet, saa igen.
  useEffect(() => {
    let cancelled = false;
    void load();
    void ensureFullEpg(session.db, session.credsBySource, session.fetchImpl, [channel])
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setFetching(false);
        void load();
      });
    return () => {
      cancelled = true;
    };
    // Kun ved aabning; dagsskift laeser fra cachen nedenfor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, channel.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function stateOf(programme: Programme): CellState {
    const ms = now.getTime();
    if (programme.stop.getTime() <= ms) return 'past';
    if (programme.start.getTime() > ms) return 'future';
    return 'live';
  }

  async function openSheet(programme: Programme): Promise<void> {
    const recorded = await isScheduled(session.db, channel.id, programme.start);
    setSheet({ programme, state: stateOf(programme), recorded });
  }

  const days: number[] = [];
  for (let delta = -daysBack; delta <= DAYS_FORWARD; delta += 1) days.push(delta);

  return (
    <View style={styles.container}>
      <Pressable style={styles.crumb} onPress={onBack} hitSlop={8}>
        <Text style={styles.crumbBack}>‹</Text>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={28} />
        <Text style={styles.crumbLabel} numberOfLines={1}>
          {channel.name}
        </Text>
        {fetching && <ActivityIndicator color={theme.colors.accent} />}
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayRow} contentContainerStyle={styles.dayRowContent}>
        {days.map((delta) => (
          <Pressable
            key={delta}
            style={[styles.dayChip, delta === dayDelta && styles.dayChipActive]}
            onPress={() => setDayDelta(delta)}
          >
            <Text style={[styles.dayChipText, delta === dayDelta && styles.dayChipTextActive]}>
              {dayLabel(now, delta)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {daysBack === 0 && (
        <Text style={styles.hint}>Kanalen har intet arkiv hos udbyderen, så kun det kommende kan ses her.</Text>
      )}

      {programmes === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          data={programmes}
          keyExtractor={(item) => String(item.start.getTime())}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {fetching ? 'Henter programtabellen …' : 'Udbyderen har ingen tabel for denne dag.'}
            </Text>
          }
          renderItem={({ item }) => {
            const state = stateOf(item);
            const restartable = state === 'past' && channel.hasArchive && hasDialect;
            return (
              <Pressable
                style={[styles.row, state === 'live' && styles.rowLive]}
                onPress={() => {
                  void openSheet(item);
                }}
              >
                <Text style={styles.time}>{clock(item.start)}</Text>
                <View style={styles.rowText}>
                  <Text style={[styles.title, state === 'past' && !restartable && styles.titleMuted]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.meta}>
                    {clock(item.start)} – {clock(item.stop)}
                    {state === 'live' ? ' · Sendes nu' : ''}
                    {restartable ? ' · ⏱ Start forfra' : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>{state === 'future' ? '' : '▶'}</Text>
              </Pressable>
            );
          }}
        />
      )}

      {sheet !== null && (
        <ProgrammeSheet
          channel={channel}
          programme={sheet.programme}
          state={sheet.state}
          hasDialect={hasDialect}
          alreadyRecorded={sheet.recorded}
          onClose={() => setSheet(null)}
          onPlay={() => {
            setSheet(null);
            onPlay(channel);
          }}
          onRestart={() => {
            const programme = sheet.programme;
            setSheet(null);
            onRestart(channel, programme);
          }}
          onRecord={() => {
            const programme = sheet.programme;
            setSheet(null);
            onRecord(channel, programme);
          }}
        />
      )}
    </View>
  );
}

const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];

function dayLabel(now: Date, delta: number): string {
  if (delta === 0) return 'I dag';
  if (delta === -1) return 'I går';
  if (delta === 1) return 'I morgen';
  const date = new Date(now);
  date.setDate(date.getDate() + delta);
  return `${WEEKDAYS[date.getDay()]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  crumbBack: { color: theme.colors.accent, fontSize: 26 },
  crumbLabel: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  dayRow: { flexGrow: 0 },
  dayRowContent: { paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.sm, gap: theme.spacing.xs },
  dayChip: {
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 1,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
  },
  dayChipActive: { backgroundColor: theme.colors.accent },
  dayChipText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  dayChipTextActive: { color: theme.colors.text },
  hint: { color: theme.colors.textMuted, fontSize: 13, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  empty: { color: theme.colors.textMuted, textAlign: 'center', padding: theme.spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLive: { backgroundColor: theme.colors.surface },
  time: { width: 52, color: theme.colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  titleMuted: { color: theme.colors.textMuted, fontWeight: '400' },
  meta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { color: theme.colors.accent, fontSize: 16, marginLeft: theme.spacing.sm, width: 18 },
});
