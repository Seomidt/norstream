import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import { ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { keepInMiddle } from '../../ui/tvScroll.js';
import { DRAG_MAX_MINUTES, DRAG_MIN_MINUTES, stateOf } from './layout.js';
import type { CellState } from './layout.js';

/**
 * Guiden paa tv: en lodret liste — ligesom favoritterne, som brugeren siger
 * "virker super godt ogsaa med at koere op og ned".
 *
 * En raekke per kanal. Ingen kasser og intet vandret gitter: bare kanalen og
 * hvad den sender paa det valgte tidspunkt — klokkeslaet og titel som ren
 * tekst. Op/ned er derfor helt almindelig listenavigation (den kan
 * fjernbetjeningen finde ud af), og den kanal der sender NU har en roed kant i
 * venstre side — "den roede linje".
 *
 * Tid vaelges med pil venstre/hoejre. Det flytter IKKE fokus (raekkerne er ét
 * trykpunkt hver, og der er intet fokuserbart til siderne — TVFocusGuideView
 * fanger fokus): et venstre/hoejre-tryk skruer bare paa tidsmarkoeren, og hele
 * listen viser hvad kanalerne sender paa det nye tidspunkt. Derfor ryger man
 * heller ikke laengere "ud i menuen" naar man gaar tilbage i tiden.
 *
 * Hurtigt fordi den — som favoritterne — kun laeser NU/naeste fra den lokale
 * cache foerst (ét indekseret opslag per kanal) og henter fra panelet bagefter.
 * Det gamle gitter hentede HELE programtabellen for ALLE kanaler foer det kunne
 * tegne, og det var derfor EPG'en "foerst kom efter et halvt minut".
 */

const ROW_HEIGHT = 64;
const CHANNEL_COL = 150;
/** Skridt i minutter pr. tryk paa pil venstre/hoejre. */
const STEP_MIN = 30;

interface Props {
  session: AppSession;
  channels: StoredChannel[];
  now: Date;
  hasDialectFor: (channel: StoredChannel) => boolean;
  /** Kaldes naar fjernbetjeningen staar paa en kanal — previewet foelger. */
  onFocusChannel: (channel: StoredChannel) => void;
  /** Aabner programbladet (eller kanalen paa et hul). */
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
  /** Pil hoejre fra menuen: den foerste raekke faar fokus. */
  focusFirstSignal: number;
}

interface Entry {
  programme: Programme | null;
  state: CellState;
}

export function TimelineGrid({
  session,
  channels,
  now,
  hasDialectFor,
  onFocusChannel,
  onOpen,
  focusFirstSignal,
}: Props) {
  const styles = useStyles(makeStyles);

  // Tidsmarkoeren: hvor mange minutter fra nu listen viser. 0 = nu.
  const [offsetMin, setOffsetMin] = useState(0);
  const nowMs = now.getTime();
  const cursorMs = nowMs + offsetMin * 60_000;

  // Pil venstre/hoejre skruer paa tiden. Det er et tastetryk, ikke en
  // fokusflytning — saa listen kan ikke "fise ud i menuen".
  useTVEventHandler((event) => {
    if (event.eventType !== 'right' && event.eventType !== 'left') return;
    // Android sender baade ned (0) og op (1); tael kun det ene, ellers to skridt.
    if (event.eventKeyAction !== undefined && Number(event.eventKeyAction) === 0) return;
    setOffsetMin((value) => {
      const next = value + (event.eventType === 'right' ? STEP_MIN : -STEP_MIN);
      return Math.min(DRAG_MAX_MINUTES, Math.max(DRAG_MIN_MINUTES, next));
    });
  });

  // Kanal -> hvad den sender paa markoertidspunktet. Cachen foerst (hurtigt),
  // panelet bagefter. Annulleringspolet saa kun det nyeste opslag skriver.
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const runId = useRef(0);

  const draw = useCallback(
    async (list: StoredChannel[], at: number): Promise<boolean> => {
      if (list.length === 0) return false;
      const id = runId.current + 1;
      runId.current = id;
      const when = new Date(at);
      const found = await Promise.all(list.map((c) => getNowNext(session.db, c.id, when)));
      if (runId.current !== id) return false;
      const map: Record<string, Entry> = {};
      list.forEach((c, i) => {
        // getNowNext giver den igangvaerende; er der hul, den kommende.
        const programme = found[i]?.now ?? found[i]?.next ?? null;
        map[c.id] = { programme, state: programme ? stateOf(programme, now) : 'gap' };
      });
      setEntries(map);
      return true;
    },
    [session.db, now],
  );

  // Tegn fra cachen med det samme, hver gang tiden eller listen skifter.
  useEffect(() => {
    void draw(channels, cursorMs);
  }, [draw, channels, cursorMs]);

  // Hent NU/naeste fra panelet for hele favoritlisten (den er kort), og tegn
  // igen. Kun naar listen skifter — ikke ved hvert tidsskridt, saa panelet ikke
  // spammes naar man bladrer i tid.
  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureEpg(session.db, session.credsBySource, session.fetchImpl, channels.map((c) => c.id));
      } catch {
        // Auth-/netfejl: det cachen har, staar.
      }
      if (!cancelled) void draw(channels, nowMs + offsetMin * 60_000);
    })();
    return () => {
      cancelled = true;
    };
    // Kun ved listeskift; tidsmarkoeren laeses frisk inde i effekten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, session]);

  // Rul listen saa den raekke fokus staar paa altid er synlig (som favoritterne).
  const listRef = useRef<FlatList<StoredChannel>>(null);
  const onRowFocus = useCallback(
    (channel: StoredChannel, index: number) => {
      onFocusChannel(channel);
      keepInMiddle(listRef.current, index);
    },
    [onFocusChannel],
  );

  // Fokuser foerste raekke naar guiden aabnes / menuen sender fokus ind.
  // Ét-skuds puls, ellers river den fokus tilbage ved hver tegning.
  const [focusPulse, setFocusPulse] = useState(true);
  const seenSignal = useRef(focusFirstSignal);
  useEffect(() => {
    if (focusFirstSignal === seenSignal.current) return;
    seenSignal.current = focusFirstSignal;
    setFocusPulse(true);
  }, [focusFirstSignal]);
  useEffect(() => {
    if (!focusPulse) return;
    const f = requestAnimationFrame(() => setFocusPulse(false));
    return () => cancelAnimationFrame(f);
  }, [focusPulse]);

  const renderItem = useCallback(
    ({ item, index }: { item: StoredChannel; index: number }) => (
      <GuideListRow
        channel={item}
        entry={entries[item.id] ?? EMPTY_ENTRY}
        index={index}
        hasDialect={hasDialectFor(item)}
        focusPulse={index === 0 && focusPulse}
        onFocusRow={onRowFocus}
        onOpen={onOpen}
      />
    ),
    [entries, hasDialectFor, focusPulse, onRowFocus, onOpen],
  );

  return (
    <View style={styles.root}>
      {/* Tidslinjens overskrift: hvad klokken er paa markoeren, og at man
          skruer paa tiden med pil venstre/hoejre. */}
      <View style={styles.header}>
        <Text style={styles.headerTime}>
          {offsetMin === 0 ? '● NU' : clock(new Date(cursorMs))}
          {offsetMin !== 0 && !sameDay(new Date(cursorMs), now) ? ` · ${dayName(new Date(cursorMs))}` : ''}
        </Text>
        <Text style={styles.headerHint} numberOfLines={1}>
          ‹ pil for tidligere · senere ›
        </Text>
      </View>
      {/* Fang fokus til siderne: pil venstre/hoejre skruer paa tiden (haandteret
          som tastetryk ovenfor) og maa ikke slippe ud i menuen. Op fra oeverste
          raekke naar stadig gruppe-chipsene; ned er almindelig listenavigation. */}
      <TVFocusGuideView style={styles.list} trapFocusLeft trapFocusRight>
        <FlatList
          ref={listRef}
          data={channels}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          removeClippedSubviews={false}
          initialNumToRender={Math.max(12, channels.length)}
          windowSize={Math.max(11, channels.length + 2)}
          maxToRenderPerBatch={Math.max(12, channels.length)}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          onScrollToIndexFailed={() => undefined}
          contentContainerStyle={{ paddingBottom: ROW_HEIGHT * 4 }}
        />
      </TVFocusGuideView>
    </View>
  );
}

const EMPTY_ENTRY: Entry = { programme: null, state: 'gap' };

const GuideListRow = memo(function GuideListRow({
  channel,
  entry,
  index,
  hasDialect,
  focusPulse,
  onFocusRow,
  onOpen,
}: {
  channel: StoredChannel;
  entry: Entry;
  index: number;
  hasDialect: boolean;
  focusPulse: boolean;
  onFocusRow: (channel: StoredChannel, index: number) => void;
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
}) {
  const styles = useStyles(makeStyles);
  const live = entry.state === 'live';
  return (
    <TvPressable
      style={[styles.row, live && styles.rowLive]}
      hasTVPreferredFocus={focusPulse}
      onFocus={() => onFocusRow(channel, index)}
      onPress={() => onOpen(channel, entry.programme, entry.state)}
    >
      <View style={styles.channelCell}>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={30} />
        <View style={styles.channelText}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.name}
          </Text>
          {hasDialect && channel.hasArchive && <Text style={styles.badge}>⏱</Text>}
        </View>
      </View>
      <View style={styles.progCell}>
        {entry.programme === null ? (
          <Text style={styles.progMuted} numberOfLines={1}>
            Ingen programoversigt
          </Text>
        ) : (
          <>
            <Text style={[styles.progTime, live && styles.progTimeLive]} numberOfLines={1}>
              {live ? '● NU' : clock(entry.programme.start)}
            </Text>
            <Text style={[styles.progTitle, entry.state === 'past' && styles.progPast]} numberOfLines={2}>
              {entry.programme.title}
            </Text>
          </>
        )}
      </View>
    </TvPressable>
  );
});

/** Klokkeslaet som HH:MM. */
function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
function dayName(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  headerTime: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  headerHint: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingHorizontal: theme.spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Venstre kant er gennemsigtig paa alle andre end den live; saa hopper
    // raekken ikke i bredden naar den bliver live.
    borderLeftColor: 'transparent',
    borderLeftWidth: 3,
  },
  // "Den roede linje": den kanal der sender nu har en roed venstrekant.
  rowLive: { borderLeftColor: colors.danger, backgroundColor: colors.surfaceRaised ?? colors.surface },
  channelCell: { width: CHANNEL_COL, flexDirection: 'row', alignItems: 'center', gap: 8 },
  channelText: { flex: 1 },
  channelName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  badge: { color: colors.accent, fontSize: 12 },
  progCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: theme.spacing.sm },
  progTime: { color: colors.textMuted, fontSize: 14, fontWeight: '700', width: 54 },
  progTimeLive: { color: colors.danger, width: 54 },
  progTitle: { flex: 1, color: colors.text, fontSize: 15 },
  progPast: { color: colors.textMuted },
  progMuted: { color: colors.textMuted, fontSize: 14, fontStyle: 'italic' },
});
