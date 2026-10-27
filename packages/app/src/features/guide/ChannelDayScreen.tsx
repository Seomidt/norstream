import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { ensureFullEpg } from '../../sync/epgCache.js';
import { syncPanelEpg } from '../../sync/panelEpg.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { ProgrammeSheet } from './ProgrammeSheet.js';
import type { CellState } from './layout.js';
import { nowAndNext } from './nowNext.js';
import { archiveComplete } from '../player/archiveContinuation.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { keepInMiddle, useTvListTail } from '../../ui/tvScroll.js';
import { refocusLastPressed } from '../../ui/refocus.js';
import { isTV } from '../../ui/tv.js';
import { addReminder, hasReminder, removeReminder } from '../../storage/reminders.js';
import { logEvent } from '../../diagnostics/log.js';
import { channelEpgSummary } from '../../diagnostics/channelEpg.js';

interface Props {
  session: AppSession;
  channel: StoredChannel;
  hasDialect: boolean;
  /** Skjult af afspilleren: stop nye EPG-kald med det samme. */
  active?: boolean;
  onBack: () => void;
  onPlay: (channel: StoredChannel) => void;
  onRestart: (channel: StoredChannel, programme: Programme) => void;
}

/** Hvor mange dage frem oversigten typisk raekker. */
const DAYS_FORWARD = 2;
/** Laengere tilbage end det har intet panel gemt. */
const MAX_DAYS_BACK = 7;
/** Fast hoejde giver et praecist rul til nu, ogsaa foer raekken er tegnet. */
const PROGRAMME_ROW_HEIGHT = 76;

/**
 * Én kanal, hele dagen: i dag, i gaar, saa langt arkivet raekker, og et par
 * dage frem. Det er catch-up som paa udbydernes egne tjenester: vil man se
 * hvad DR1 sendte i gaar aften, skal man ikke traekke guiden baglaens i
 * mange omgange, men bladre til dagen og trykke paa udsendelsen.
 *
 * Programtabellen hentes frisk ved hver aabning. Dagsknapperne vaelger
 * derefter i denne hentning uden nye panelkald for hvert tryk.
 */
export function ChannelDayScreen({ session, channel, hasDialect, active = true, onBack, onPlay, onRestart }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const tail = useTvListTail();
  const [data, setData] = useState<{
    entry: object; programmes: Programme[]; error: string | null;
  } | null>(null);
  const appActive = useRef(AppState?.currentState == null || AppState.currentState === 'active');
  const [foreground, setForeground] = useState(appActive.current);
  useEffect(() => {
    const subscription = AppState?.addEventListener?.('change', state => {
      appActive.current = state === 'active';
      setForeground(appActive.current);
    });
    return () => subscription?.remove();
  }, []);
  const current = useRef({ session, channelId: channel.id, active, foreground });
  if (current.current.session !== session || current.current.channelId !== channel.id
    || current.current.active !== active || current.current.foreground !== foreground) {
    current.current = { session, channelId: channel.id, active, foreground };
  }
  // En tidligere aabnings tegning maa ikke blinke frem foer effekternes oprydning.
  const ownData = active && foreground && data?.entry === current.current ? data : null;
  const allProgrammes = ownData?.programmes ?? null;
  const error = ownData?.error ?? null;
  const [dayDelta, setDayDelta] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [listHeight, setListHeight] = useState(0);
  const [dayWantsFocus, setDayWantsFocus] = useState(isTV);
  const [sheet, setSheet] = useState<{ programme: Programme; state: CellState } | null>(null);
  // Naar arket lukker, tilbage til det der aabnede det: ellers gav Android
  // fokus til det foerste trykpunkt paa skaermen.
  const sheetWasOpen = useRef(false);
  useEffect(() => {
    if (sheet !== null) {
      sheetWasOpen.current = true;
      return;
    }
    if (!sheetWasOpen.current || !isTV) return;
    sheetWasOpen.current = false;
    const timer = setTimeout(() => refocusLastPressed(), 80);
    return () => clearTimeout(timer);
  }, [sheet]);
  const [sheetReminder, setSheetReminder] = useState<boolean | null>(null);
  useEffect(() => {
    setSheetReminder(null);
    if (sheet === null) return;
    let cancelled = false;
    void hasReminder(session.db, channel.id, sheet.programme.start.getTime()).then((set) => {
      if (!cancelled) setSheetReminder(set);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, channel.id, sheet]);
  // Nu tikker hvert minut mens siden staar aaben (v425): "Sendes nu" og
  // Start forfra-maerket foelger klokken, saa en udsendelse der lige er slut
  // faar sit maerke saa snart arkivet har de sidste minutter, uden at man
  // skal trykke paa noget. Samme nu bruges til tilstand, maerke og blad.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dayBounds = useCallback((delta: number): { from: Date; to: Date } => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() + delta);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }, []);

  // Den valgte dag skaeres ud af det hentede span — ingen nyt opslag pr. dag.
  const programmes = useMemo((): Programme[] | null => {
    if (allProgrammes === null) return null;
    const { from, to } = dayBounds(dayDelta);
    const f = from.getTime();
    const t = to.getTime();
    return allProgrammes.filter((p) => p.stop.getTime() > f && p.start.getTime() < t);
  }, [allProgrammes, dayDelta, dayBounds]);

  /**
   * Listen aabner ved det der sendes nu (i dag) og ikke ved midnat: det er
   * det man kom fra i guiden. De andre dage begynder ved dagens start.
   */
  const listRef = useRef<FlatList<Programme>>(null);
  const currentProgramme = nowAndNext(allProgrammes ?? [], now).now;
  const liveIndex = programmes === null || dayDelta !== 0 ? -1
    : currentProgramme !== null ? programmes.indexOf(currentProgramme)
      : programmes.findIndex(programme => programme.start.getTime() > now.getTime());
  const todayMs = dayBounds(0).from.getTime();
  useEffect(() => {
    if (!active || !foreground) return;
    let cancelled = false;
    const db = session.db;
    const channelId = channel.id;
    const entry = current.current;
    const stopped = (): boolean => cancelled || !appActive.current || current.current !== entry;
    setFetching(true);
    const from = dayBounds(-MAX_DAYS_BACK).from;
    const to = dayBounds(DAYS_FORWARD).to;
    void (async () => {
      // Det gemte foerst (v423): dagen staar med det samme, ogsaa uden net.
      let shown = 0;
      try {
        const cached = await listProgrammes(db, channelId, from, to);
        if (stopped()) return;
        shown = cached.length;
        setData({ entry, programmes: cached, error: null });
      } catch {
        // En lokal laesefejl: fornyelsen nedenfor proever stadig.
      }
      try {
        const access = session.access?.(channel.sourceId);
        const isM3u = access?.source.kind === 'm3u';
        if (!isM3u && session.credsBySource.has(channel.sourceId)) {
          // Kun naar tabellen er gammel (alder eller tidsskift); ellers intet kald.
          const result = await ensureFullEpg(db, session.credsBySource, session.fetchImpl, [channel], new Date(), {
            shouldContinue: () => !stopped(),
          });
          if (stopped()) return;
          if (result.failed > 0 && shown === 0) throw new Error('epg-refresh-failed');
          if (result.fetched > 0 && result.programmes === 0) {
            const creds = session.credsBySource.get(channel.sourceId)!;
            await syncPanelEpg(db, channel.sourceId, creds, {
              channelIds: [channelId], shouldContinue: () => !stopped(),
            });
          }
          if (stopped()) return;
          if (result.fetched > 0 || result.programmes > 0) {
            const items = await listProgrammes(db, channelId, from, to);
            if (!stopped()) setData({ entry, programmes: items, error: null });
          }
        } else if (shown === 0 && !isM3u) {
          throw new Error('missing-source');
        }
      } catch {
        if (!stopped() && shown === 0) {
          logEvent('guide', 'hele dagen v423: programoversigten kunne ikke hentes');
          setData({ entry, programmes: [], error: 'Programoversigten kunne ikke hentes. Gå tilbage, og åbn kanalen igen for at prøve på ny.' });
        }
      } finally {
        if (!stopped()) setFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, channel.id, channel.sourceId, active, foreground, dayBounds, todayMs]);

  useEffect(() => {
    if (allProgrammes === null) return;
    const at = Date.now();
    logEvent('epg', channelEpgSummary(channel, {
      hasDialect,
      hasCurrent: allProgrammes.some(p => p.start.getTime() <= at && p.stop.getTime() > at),
      programmeCount: allProgrammes.length,
    }));
  }, [channel, hasDialect, allProgrammes]);

  useEffect(() => {
    if (programmes !== null) {
      logEvent('guide', `hele dagen v386: dag ${dayDelta}, ${programmes.length} programmer, ${allProgrammes?.length ?? 0} i tabellen`);
    }
  }, [programmes, allProgrammes, dayDelta]);

  // Vis de arkivdage panelet oplyser, ogsaa mens historikken hentes.
  // EPG-huller maa ikke skjule dage der faktisk findes i kanalens arkiv.
  const daysBack = useMemo((): number => {
    if (allProgrammes === null || allProgrammes.length === 0) return Math.min(MAX_DAYS_BACK, Math.max(1, channel.archiveDays));
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const earliest = new Date(allProgrammes[0]!.start);
    earliest.setHours(0, 0, 0, 0);
    const diffDays = Math.round((todayStart.getTime() - earliest.getTime()) / 86_400_000);
    return Math.min(MAX_DAYS_BACK, Math.max(1, channel.archiveDays, diffDays));
  }, [allProgrammes, channel.archiveDays]);

  function stateOf(programme: Programme): CellState {
    const ms = now.getTime();
    if (programme.stop.getTime() <= ms) return 'past';
    if (programme.start.getTime() > ms) return 'future';
    // Ved overlap er kun det senest begyndte program aktuelt, som i guiden.
    return programme === currentProgramme ? 'live' : 'past';
  }

  function openSheet(programme: Programme): void {
    setSheet({ programme, state: stateOf(programme) });
  }

  const days: number[] = [];
  for (let delta = -daysBack; delta <= DAYS_FORWARD; delta += 1) days.push(delta);

  return (
    <TVFocusGuideView style={styles.container} autoFocus={isTV} trapFocusLeft={isTV} trapFocusRight={isTV}>
      <TvPressable style={styles.crumb} focusable={!isTV} onPress={onBack} hitSlop={8}>
        <Text style={styles.crumbBack}>‹</Text>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={28} />
        <Text style={styles.crumbLabel} numberOfLines={1}>
          {channel.name}
        </Text>
        {fetching && <ActivityIndicator color={colors.accent} />}
      </TvPressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayRow}
        contentContainerStyle={styles.dayRowContent}
        onLayout={({ nativeEvent: { layout } }) => logEvent('guide', `hele dagen v386: dagsvaelger ${Math.round(layout.width)}x${Math.round(layout.height)}, ${days.length} dage`)}
      >
        {days.map((delta) => (
          <TvPressable
            key={delta}
            style={[styles.dayChip, delta === dayDelta && styles.dayChipActive]}
            // Paa tv lander fjernbetjeningen paa den valgte dag naar siden aabner.
            hasTVPreferredFocus={dayWantsFocus && delta === dayDelta}
            onFocus={() => setDayWantsFocus(false)}
            onPress={() => setDayDelta(delta)}
          >
            <Text numberOfLines={1} style={[styles.dayChipText, delta === dayDelta && styles.dayChipTextActive]}>
              {dayLabel(now, delta)}
            </Text>
          </TvPressable>
        ))}
      </ScrollView>

      {channel.archiveDays === 0 && (
        <Text style={styles.hint}>Kanalen har intet arkiv hos udbyderen, så du kan se oversigten, men ikke starte tidligere udsendelser forfra.</Text>
      )}

      <View
        style={styles.programmeFrame}
        onLayout={({ nativeEvent: { layout } }) => {
          setListHeight(layout.height);
          logEvent('guide', `hele dagen v386: programfelt ${Math.round(layout.width)}x${Math.round(layout.height)}`);
        }}
      >
      {error !== null ? (
        <Text style={styles.empty} accessibilityRole="alert">{error}</Text>
      ) : programmes === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.empty}>Henter programoversigt …</Text>
        </View>
      ) : programmes.length === 0 ? (
        <Text style={styles.empty}>
          {fetching ? 'Henter programtabellen …' : 'Udbyderen har ingen tabel for denne dag.'}
        </Text>
      ) : listHeight > 0 ? (
        <FlatList
          key={dayDelta}
          // TV-FlatList har et ekstra fokuslag uden flex. En fast maalt
          // hoejde paa scrollfladen begraenser ogsaa dette ydre lag.
          style={{ height: listHeight }}
          removeClippedSubviews={false}
          ref={listRef}
          data={programmes}
          keyExtractor={(item) => String(item.start.getTime())}
          contentContainerStyle={tail}
          getItemLayout={(_, index) => ({ length: PROGRAMME_ROW_HEIGHT, offset: PROGRAMME_ROW_HEIGHT * index, index })}
          initialScrollIndex={Math.max(0, liveIndex)}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          renderItem={({ item, index }) => {
            const state = stateOf(item);
            // Kun en udsendelse der er slut OG helt i arkivet maerkes (v425).
            // En der lige er slut aabner stadig bladet, som forklarer at det
            // kommer om et oejeblik; den starter ikke arkivet fra raekken.
            const restartable = state === 'past' && channel.hasArchive && hasDialect && archiveComplete(item, now.getTime());
            return (
              <TvPressable
                style={[styles.row, state === 'live' && styles.rowLive]}
                // INGEN preferred focus paa raekken: den staal ellers fokus fra
                // dag-knapperne oeverst, saa de blinkede kort og ikke kunne
                // vaelges ("dag-valget forsvinder hurtigt"). Nu bliver fokus paa
                // dag-knappen, og man gaar ned i listen naar man vil.
                // Uden dette ruller listen ikke: Android holder kun raekken
                // inden for listens egne kanter, men listen er hoejere end
                // laerredet, saa den fokuserede raekke roeg uden for skaermen
                // og pilene saa ud til ikke at virke. Hold den i midten.
                onFocus={isTV ? () => keepInMiddle(listRef.current, index) : undefined}
                onPress={() => openSheet(item)}
              >
                <Text style={styles.time}>{clock(item.start)}</Text>
                <View style={styles.rowText}>
                  <Text style={[styles.title, state === 'past' && !restartable && styles.titleMuted]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.meta}>
                    {clock(item.start)} – {clock(item.stop)}
                    {state === 'live' ? ' · Sendes nu' : ''}
                    {restartable ? ' · ⏱ Start forfra' : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>{state === 'future' ? '' : '▶'}</Text>
              </TvPressable>
            );
          }}
        />
      ) : null}
      </View>

      {sheet !== null && (
        <ProgrammeSheet
          channel={channel}
          programme={sheet.programme}
          state={sheet.state}
          hasDialect={hasDialect}
          nowMs={now.getTime()}
          reminder={
            sheetReminder === null
              ? undefined
              : {
                  set: sheetReminder,
                  onToggle: () => {
                    void (sheetReminder
                      ? removeReminder(session.db, channel.id, sheet.programme.start.getTime())
                      : addReminder(session.db, channel.id, sheet.programme)
                    ).then(() => setSheetReminder(!sheetReminder));
                  },
                }
          }
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
        />
      )}
    </TVFocusGuideView>
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  crumb: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  crumbBack: { color: colors.accent, fontSize: 26 },
  crumbLabel: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  // ScrollView har flexShrink: 1 som standard. Programlisten maa ikke
  // presse denne raekke ned til nul, naar dens lange indhold lander.
  dayRow: { flexGrow: 0, flexShrink: 0, minHeight: 48 },
  dayRowContent: { alignItems: 'center', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm, gap: theme.spacing.xs },
  programmeFrame: { flex: 1, minHeight: 0, overflow: 'hidden' },
  dayChip: {
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 1,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  dayChipActive: { backgroundColor: colors.accent },
  dayChipText: { color: colors.textMuted, fontSize: isTV ? 14 : 12, fontWeight: '600' },
  dayChipTextActive: { color: colors.text },
  hint: { color: colors.textMuted, fontSize: 13, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  empty: { color: colors.textMuted, textAlign: 'center', padding: theme.spacing.lg },
  row: {
    height: PROGRAMME_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLive: { backgroundColor: colors.surface },
  time: { width: 52, color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1 },
  title: { color: colors.text, fontSize: 15, lineHeight: 18, fontWeight: '600' },
  titleMuted: { color: colors.textMuted, fontWeight: '400' },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 14, marginTop: 2 },
  chevron: { color: colors.accent, fontSize: 16, marginLeft: theme.spacing.sm, width: 18 },
});
