import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { sourcesWithDialect } from '../../storage/settings.js';
import { ensureFullEpg, ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { MiniPreview } from '../preview/MiniPreview.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { ProgrammeSheet } from './ProgrammeSheet.js';
import { ChannelDayScreen } from './ChannelDayScreen.js';
import {
  DRAG_MAX_MINUTES,
  DRAG_MIN_MINUTES,
  WINDOW_MINUTES,
  dragMinutes,
  guideAction,
  layoutRow,
  nowRatio,
  offsetForTarget,
  shiftedWindow,
} from './layout.js';
import type { GuideCell } from './layout.js';

interface Props {
  session: AppSession;
  onPlay: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  /** Telefonens tilbage-knap: lukker dagssiden foer noget andet. */
  backRef?: { current: () => boolean };
  onRestart: (channel: StoredChannel, programme: Programme) => void;
  onAuthError: () => void;
  onBrowse: () => void;
  previewEnabled: boolean;
  previewHandle: { current: PreviewHandle | null };
}

/**
 * Hvor laenge der ventes efter en rulning foer der hentes.
 *
 * FlatList melder synlige raekker flere gange under ét sving med fingeren.
 * Uden ventetiden blev hvert af dem til en tur til panelet.
 */
const SCROLL_SETTLE_MS = 300;

/** Bredden paa kanalkolonnen. Fast, saa alle raekker staar praecist under hinanden. */
const CHANNEL_COLUMN = 96;
const ROW_HEIGHT = 56;

/**
 * Hvor fint tiden trappes under et traek, i minutter.
 *
 * Ikke pixel for pixel: hver aendring tegner hele gitteret om, og et minuttal
 * paa fem minutters noejagtighed kan ingen se forskel paa i en celle der er et
 * par centimeter bred.
 */
const DRAG_STEP_MINUTES = 5;

/** Hvor langt fingeren skal flytte sig foer et traek regnes for vandret. */
const DRAG_SLOP = 10;

/**
 * Guiden: vandret tid, lodret kanaler.
 *
 * Gitteret viser **favoritterne** — den maengde brugeren allerede er i — aldrig
 * alle 22.142 kanaler. Kun synlige raekker henter programdata, og de rammer
 * cachen i `epgCache`.
 *
 * Tiden flyttes ved at **traekke i gitteret**. Vinduet er lige saa bredt som
 * gitteret, saa en finger der flytter sig en gitterbredde flytter tiden et helt
 * vindue — programmet under fingeren foelger med fingeren. Pilene staar der
 * stadig og springer et vindue ad gangen, men de skal ikke bruges.
 *
 * Der er ikke en vandret `ScrollView` under. Med en saadan skulle kanalkolonnen
 * laases fast og to lister holdes synkroniseret i haanden; her er der ét tal —
 * hvor mange minutter vinduet er forskudt — og resten er den samme udregning
 * som foer. Lodret rulning er uroert: bevaegelsen skal vaere overvejende
 * vandret foer guiden tager den.
 */
export function GuideScreen({
  session,
  onPlay,
  backRef,
  onRestart,
  onAuthError,
  onBrowse,
  previewEnabled,
  previewHandle,
}: Props) {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [rows, setRows] = useState<Record<string, Programme[]>>({});
  /**
   * Kilderne der har fundet en timeshift-dialekt.
   *
   * Per kilde, ikke ét ja/nej. Det var ét ja/nej foer, og det blev endda
   * laest paa en noegle der aldrig blev skrevet — derfor stod uret aldrig paa
   * nogen kanal, uanset hvor mange af dem der havde arkiv.
   */
  const [dialectSources, setDialectSources] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  /** Hvor mange minutter vinduet er forskudt fra nu. Negativt er bagud. */
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  /** Kanalen hvis hele dag vises, i stedet for gitteret. */
  const [dayFor, setDayFor] = useState<StoredChannel | null>(null);
  if (backRef !== undefined) {
    backRef.current = (): boolean => {
      if (dayFor === null) return false;
      setDayFor(null);
      return true;
    };
  }
  /** Kanalen previewet viser, eller null. Foelger den oeverste synlige raekke. */
  const [previewChannel, setPreviewChannel] = useState<StoredChannel | null>(null);
  /**
   * Kanalen brugeren selv har valgt til previewet, ved et tryk paa navnet.
   * Saa laenge den er sat, foelger previewet ikke rulningen: de nederste
   * raekker kan aldrig rulles op i toppen, og uden et eget valg kunne de
   * derfor aldrig vises i previewet.
   */
  const pinnedPreview = useRef<StoredChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  /** Den celle bladet er aabnet for, eller null naar det er lukket. */
  const [sheet, setSheet] = useState<{
    channel: StoredChannel;
    cell: GuideCell;
  } | null>(null);

  // Nu-tidspunktet fastholdes mens skaermen er aaben, saa cellerne ikke
  // hopper mellem tilstande midt i et tryk. Det opdateres hvert minut.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const window = shiftedWindow(now, offsetMinutes);
  const liveRatio = nowRatio(now, window.start, window.end);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [favourites, withDialect] = await Promise.all([
          listChannels(session.db, { favouritesOnly: true }),
          sourcesWithDialect(session.db),
        ]);
        if (cancelled) return;
        setChannels(favourites);
        setDialectSources(withDialect);
        setPreviewChannel((current) => current ?? favourites[0] ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db]);

  /** Om kanalens kilde kan bygge arkiv-URLer. Uden det: intet ur, ingen optagelse. */
  const hasDialectFor = useCallback(
    (channel: StoredChannel): boolean => dialectSources.has(channel.sourceId),
    [dialectSources],
  );

  /**
   * Bestiller en kommende udsendelse til optagelse.
   *
   * Bekraeftelsen staar i skaermen og ikke i en Alert: react-native-web
   * implementerer ikke Alert, og et tryk der ikke kvitterer for sig foeles
   * som et tryk der ikke virkede.
   */
  const openSheet = useCallback(
    async (channel: StoredChannel, cell: GuideCell): Promise<void> => {
      // Et hul — kanalen uden programdata — aabner ogsaa bladet. Foer var
      // hullerne doede, og en kanal uden oversigt kunne ikke aabnes fra
      // guiden overhovedet. Bladet siger hvad der mangler og tilbyder kanalen.
      setSheet({ channel, cell });
    },
    [],
  );

  /**
   * Det vindue der staar paa skaermen lige nu.
   *
   * Hentningerne fletter deres resultater ind i den samme raekke-tabel, og to
   * kan sagtens vaere i luften ad gangen naar man ruller. De maa bare ikke
   * skrive programmer fra et *andet* tidsvindue ind — derfor sammenlignes der
   * med vinduet frem for med et loebenummer, som ville kassere det ene af to
   * gyldige svar.
   */
  const currentWindow = useRef({ from: 0, to: 0 });

  /**
   * Tegner det cachen har for et vindue. Ingen netvaerk.
   *
   * Den koeres **uden ventetid** hver gang vinduet flytter sig. Traekker man
   * gennem aftenen, er det den her der fylder cellerne ud under fingeren;
   * ventetiden nedenfor gaelder kun turen til panelet, som ikke maa ske paa
   * hvert femte minut man traekker forbi.
   */
  const drawFromCache = useCallback(
    async (visible: readonly StoredChannel[], from: Date, to: Date): Promise<boolean> => {
      if (visible.length === 0) return false;
      const loaded: Record<string, Programme[]> = {};
      for (const channel of visible) {
        loaded[channel.id] = await listProgrammes(session.db, channel.id, from, to);
      }
      if (
        currentWindow.current.from !== from.getTime() ||
        currentWindow.current.to !== to.getTime()
      ) {
        return false;
      }
      setRows((previous) => ({ ...previous, ...loaded }));
      return true;
    },
    [session.db],
  );

  const drawFromCacheRef = useRef(drawFromCache);
  drawFromCacheRef.current = drawFromCache;

  const loadVisible = useCallback(
    async (visible: StoredChannel[], from: Date, to: Date): Promise<void> => {
      if (visible.length === 0) return;
      const streamIds = visible.map((channel) => channel.id);
      const draw = (): Promise<boolean> => drawFromCache(visible, from, to);

      // **Cachen foerst.** Foer tegnede guiden efter hentningen, saa hver gang
      // programdata var mere end en halv time gamle, stod skaermen tom mens
      // panelet svarede — ogsaa naar cachen laa med aftenens programmer klar.
      // Det man har, skal vises med det samme; hentningen er en opdatering.
      if (!(await draw())) return;

      try {
        await ensureEpg(session.db, session.credsBySource, session.fetchImpl, streamIds);
      } catch (cause) {
        if (cause instanceof XtreamAuthError) {
          onAuthError();
          return;
        }
        // Panelet kunne ikke naas; det tegnede staar.
      }
      if (!(await draw())) return;

      // Foerst nu den fulde programtabel. Den er stoerre og langsommere, og
      // guiden skal ikke staa tom imens — men uden den er cellerne bag "nu"
      // tomme, og en udsendelse der allerede er sendt kan ikke startes.
      try {
        const result = await ensureFullEpg(
          session.db,
          session.credsBySource,
          session.fetchImpl,
          visible,
        );
        if (result.programmes === 0) return;
      } catch (cause) {
        if (cause instanceof XtreamAuthError) onAuthError();
        return;
      }
      await draw();
    },
    [session, onAuthError, drawFromCache],
  );

  const loadVisibleRef = useRef(loadVisible);
  useEffect(() => {
    loadVisibleRef.current = loadVisible;
  }, [loadVisible]);

  // Vinduet i primitive tal, saa effekten nedenfor ikke koerer igen bare fordi
  // guideWindow gav to nye Date-objekter med samme vaerdi.
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();

  const visibleChannels = useRef<StoredChannel[]>([]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current;
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowRef = useRef({ start: windowStartMs, end: windowEndMs });
  windowRef.current = { start: windowStartMs, end: windowEndMs };

  /**
   * Rulning skal hente programdata for de raekker der kommer frem.
   *
   * Foer skrev denne kun til en ref. En ref udloeser ingen render og ingen
   * effekt, saa **kun de foerste tolv favoritter fik nogensinde programdata** —
   * alt hvad man rullede ned til stod tomt for altid. Det saa ud som om
   * panelet manglede EPG for de kanaler.
   *
   * Ventetiden er der fordi FlatList kalder her flere gange under ét sving med
   * fingeren, og hvert kald ellers ville blive til en tur til panelet.
   */
  /**
   * Bestiller en hentning naar der har vaeret ro et oejeblik.
   *
   * Baade rulning og traek gaar gennem den her. Et traek gennem aftenen giver
   * et nyt vindue hvert femte minut af tid, og uden ventetiden ville hvert af
   * dem blive til en tur til panelet — som kun tillader én forbindelse.
   */
  const scheduleLoad = useCallback((): void => {
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      const { start, end } = windowRef.current;
      currentWindow.current = { from: start, to: end };
      void loadVisibleRef.current(visibleChannels.current, new Date(start), new Date(end));
    }, SCROLL_SETTLE_MS);
  }, []);

  const scheduleLoadRef = useRef(scheduleLoad);
  scheduleLoadRef.current = scheduleLoad;

  const onViewableItemsChanged = useRef(
    (info: { viewableItems: { item: StoredChannel }[] }): void => {
      visibleChannels.current = info.viewableItems
        .map((entry) => entry.item)
        .filter((channel): channel is StoredChannel => channel !== undefined);

      // Previewet foelger den oeverste synlige raekke, som i kanallisten —
      // medmindre brugeren har peget paa en kanal selv.
      if (pinnedPreview.current === null) setPreviewChannel(visibleChannels.current[0] ?? null);
      void drawFromCacheRef.current(
        visibleChannels.current,
        new Date(windowRef.current.start),
        new Date(windowRef.current.end),
      );
      scheduleLoadRef.current();
    },
  ).current;

  useEffect(() => {
    return () => {
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    };
  }, []);

  // Foerste skaermfuld og hver gang vinduet flytter sig: hent for de raekker
  // der er fremme. Tegningen af det cachen allerede har sker med det samme —
  // ventetiden gaelder kun turen til panelet.
  useEffect(() => {
    if (visibleChannels.current.length === 0) {
      visibleChannels.current = channels.slice(0, 12);
    }
    currentWindow.current = { from: windowStartMs, to: windowEndMs };
    // Cachen tegnes med det samme; kun panelet maa vente paa at fingeren
    // staar stille.
    void drawFromCacheRef.current(
      visibleChannels.current,
      new Date(windowStartMs),
      new Date(windowEndMs),
    );
    scheduleLoadRef.current();
  }, [channels, windowStartMs, windowEndMs]);

  /**
   * Traekket i gitteret.
   *
   * `onMoveShouldSetPanResponder` uden capture: den bliver kun spurgt saa
   * laenge ingen anden har taget bevaegelsen, saa den lodrette liste beholder
   * sine egne rulninger. Kravet om at den vandrette bevaegelse er stoerst
   * afgoer hvem der faar en skraa bevaegelse.
   *
   * Bredden maales af gitteret selv frem for af skaermen: kanalkolonnen er
   * ikke en del af tidsaksen, og et traek skal flytte tiden lige saa langt som
   * fingeren flytter sig **i gitteret**.
   */
  const gridWidth = useRef(0);
  /**
   * Samme bredde som en tilstand.
   *
   * Traekket laeser den fra `gridWidth` mange gange i sekundet og maa ikke
   * udloese en optegning; nu-stregen skal tegnes naar bredden bliver kendt.
   * To veje til det samme tal, hver med sin grund.
   */
  const [cellsWidth, setCellsWidth] = useState(0);
  /**
   * Gitterets hoejde. Listen faar luft i bunden svarende til hoejden minus
   * én raekke, saa enhver raekke — ogsaa den sidste — kan rulles helt op i
   * toppen. Uden det stod de nederste raekker for evigt nederst, halvt
   * bag fanelinjen, og kunne aldrig blive den oeverste synlige.
   */
  const [gridHeight, setGridHeight] = useState(0);
  const dragStart = useRef(0);
  const offsetRef = useRef(offsetMinutes);
  offsetRef.current = offsetMinutes;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > DRAG_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        // Den lodrette liste maa ikke tage bevaegelsen tilbage midt i et
        // traek. Sker det, staar guiden stille mens fingeren bliver ved, og
        // det foeles som om traekket satte sig fast.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragStart.current = offsetRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const moved = dragMinutes(gesture.dx, gridWidth.current, DRAG_STEP_MINUTES);
          const next = Math.min(
            DRAG_MAX_MINUTES,
            Math.max(DRAG_MIN_MINUTES, dragStart.current + moved),
          );
          setOffsetMinutes((current) => (current === next ? current : next));
        },
      }),
    [],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (channels.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Guiden viser dine favoritter</Text>
        <Text style={styles.emptyText}>
          Læg nogle kanaler i favoritter, så står de her med aftenens programmer.
        </Text>
        <Pressable style={styles.button} onPress={onBrowse}>
          <Text style={styles.buttonText}>Gå til Kanaler</Text>
        </Pressable>
      </View>
    );
  }

  // Dagssiden laegges oven paa guiden, ikke i stedet for den: saa staar
  // guiden praecis hvor man var, rullet og det hele, naar man gaar tilbage.
  const dayView =
    dayFor !== null ? (
      <View style={styles.dayOverlay}>
        <ChannelDayScreen
          session={session}
          channel={dayFor}
          hasDialect={hasDialectFor(dayFor)}
          onBack={() => setDayFor(null)}
          onPlay={(channel) => onPlay(channel, channels)}
          onRestart={(channel, programme) => onRestart(channel, programme)}
        />
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      {notice !== null && <Notice notice={notice} onDismiss={() => setNotice(null)} />}
      <MiniPreview
        session={session}
        channel={dayFor === null ? previewChannel : null}
        enabled={previewEnabled}
        handle={previewHandle}
        onOpen={(channel) => onPlay(channel, channels)}
      />

      <View style={styles.toolbar}>
        <Pressable
          hitSlop={12}
          onPress={() => setOffsetMinutes((value) => Math.max(DRAG_MIN_MINUTES, value - WINDOW_MINUTES))}
        >
          <Text style={styles.pager}>‹</Text>
        </Pressable>
        {/* Etiketten er ogsaa vejen tilbage til nu. Efter et traek gennem tre
            doegn er en knap hurtigere end den samme vej tilbage. */}
        <Pressable hitSlop={8} disabled={offsetMinutes === 0} onPress={() => setOffsetMinutes(0)}>
          <Text style={styles.windowLabel}>
            {formatTime(window.start)} – {formatTime(window.end)}
            {isSameDay(window.start, now) ? '' : ` · ${formatDay(window.start)}`}
            {offsetMinutes === 0 ? '' : '  ↺ Nu'}
          </Text>
        </Pressable>
        <Pressable
          hitSlop={12}
          onPress={() => setOffsetMinutes((value) => Math.min(DRAG_MAX_MINUTES, value + WINDOW_MINUTES))}
        >
          <Text style={styles.pager}>›</Text>
        </Pressable>
      </View>

      {/* Dagsknapperne: ét tryk til "i morgen aften" i stedet for tolv traek.
          Det er ogsaa den eneste maade guiden kan styres med en
          fjernbetjening. I dag = nu; de andre dage lander paa kl. 20. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayRow}
        contentContainerStyle={styles.dayRowContent}
      >
        {DAY_CHIPS.map((chip) => {
          const active =
            chip.dayDelta === dayDeltaOf(window.start, now) &&
            (chip.hour === null ? offsetMinutes === 0 || chip.dayDelta !== 0 : window.start.getHours() >= chip.hour);
          return (
            <Pressable
              key={`${chip.dayDelta}:${chip.hour ?? 'day'}`}
              style={[styles.dayChip, active && styles.dayChipActive]}
              onPress={() =>
                setOffsetMinutes(chip.hour === null && chip.dayDelta === 0 ? 0 : offsetForTarget(now, chip.dayDelta, chip.hour ?? 20))
              }
            >
              <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                {chip.hour !== null ? chip.label : dayLabel(now, chip.dayDelta)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.timeHeader}>
        <View style={styles.timeSpacer} />
        {halfHourMarks(window.start).map((mark) => (
          <Text key={mark.getTime()} style={styles.timeMark}>
            {formatTime(mark)}
          </Text>
        ))}
        {liveRatio !== null && cellsWidth > 0 && (
          <View
            pointerEvents="none"
            style={[styles.nowDot, { left: CHANNEL_COLUMN + liveRatio * cellsWidth - 4 }]}
          />
        )}
      </View>

      {sheet !== null && (
        <ProgrammeSheet
          channel={sheet.channel}
          programme={sheet.cell.programme}
          state={sheet.cell.state}
          hasDialect={hasDialectFor(sheet.channel)}
          onClose={() => setSheet(null)}
          onPlay={() => {
            setSheet(null);
            onPlay(sheet.channel, channels);
          }}
          onRestart={() => {
            const programme = sheet.cell.programme;
            setSheet(null);
            if (programme !== null) onRestart(sheet.channel, programme);
          }}
          onDay={() => {
            const channel = sheet.channel;
            setSheet(null);
            setDayFor(channel);
          }}
        />
      )}

      {/* Traekfladen ligger om hele gitteret, ogsaa om kanalkolonnen: en
          finger der begynder paa et kanalnavn og trækker til siden mener
          stadig tiden. Bredden maales paa cellerne alene — se panResponder. */}
      <View
        style={styles.grid}
        onLayout={(event) => setGridHeight(event.nativeEvent.layout.height)}
        {...panResponder.panHandlers}
      >
        {/* Nu-stregen. Den ligger over gitteret og tager ingen tryk, saa en
            celle under den stadig kan aabnes. Den tegnes kun naar nu er inde i
            vinduet — en streg klistret til kanten ville paastaa at klokken er
            noget den ikke er. */}
        {liveRatio !== null && cellsWidth > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.nowLine,
              { left: CHANNEL_COLUMN + liveRatio * cellsWidth },
            ]}
          />
        )}
        <FlatList
          data={channels}
          keyExtractor={(item) => item.id}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          contentContainerStyle={{ paddingBottom: Math.max(ROW_HEIGHT, gridHeight - ROW_HEIGHT) }}
          extraData={previewChannel?.id}
          renderItem={({ item }) => (
            <GuideRow
              channel={item}
              cells={layoutRow(rows[item.id] ?? [], window.start, window.end, now)}
              hasDialect={hasDialectFor(item)}
              previewing={previewChannel?.id === item.id}
              onPreview={(channel) => {
                pinnedPreview.current = channel;
                setPreviewChannel(channel);
              }}
              onMeasureCells={(width) => {
                gridWidth.current = width;
                setCellsWidth((current) => (current === width ? current : width));
              }}
              onOpen={(channel, cell) => {
                void openSheet(channel, cell);
              }}
            />
          )}
        />
      </View>
      {dayView}
    </View>
  );
}

/** Cellen et tryk paa kanalnavnet aabner bladet med: ingen udsendelse, bare kanalen. */
const CHANNEL_CELL: GuideCell = {
  key: 'channel',
  programme: null,
  state: 'gap',
  weight: 0,
  clippedStart: false,
  clippedEnd: false,
};

function GuideRow({
  channel,
  cells,
  hasDialect,
  previewing,
  onPreview,
  onOpen,
  onMeasureCells,
}: {
  channel: StoredChannel;
  cells: GuideCell[];
  hasDialect: boolean;
  /** Sand for den kanal previewet viser lige nu. */
  previewing: boolean;
  /** Et tryk paa kanalnavnet: vis kanalen i previewet. */
  onPreview: (channel: StoredChannel) => void;
  onOpen: (channel: StoredChannel, cell: GuideCell) => void;
  /** Bredden paa tidsaksen. Traekket regner minutter ud af den. */
  onMeasureCells: (width: number) => void;
}) {
  return (
    <View style={styles.row}>
      {/* Et tryk paa kanalen viser den i previewet; hold fingeren for
          bladet med "se kanalen". Previewet fulgte kun den oeverste synlige
          raekke, og de nederste kan aldrig rulles derop. */}
      <Pressable
        style={[styles.channelCell, previewing && styles.channelCellPreviewing]}
        onPress={() => onPreview(channel)}
        onLongPress={() => onOpen(channel, CHANNEL_CELL)}
        delayLongPress={400}
      >
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={26} />
        <View style={styles.channelText}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.name}
          </Text>
          {/* Uret siger at kanalen kan startes forfra. Det afhaenger af
              udbyderens arkiv, og det gaelder langtfra alle kanaler — foer
              kunne man kun se det ved at proeve. */}
          {hasDialect && channel.hasArchive && <Text style={styles.channelBadges}>⏱</Text>}
        </View>
      </Pressable>
      <View
        style={styles.cells}
        onLayout={(event) => onMeasureCells(event.nativeEvent.layout.width)}
      >
        {cells.map((cell) => {
          const action = guideAction(cell, channel, hasDialect);
          return (
            <Pressable
              key={cell.key}
              style={[
                styles.cell,
                { flexGrow: cell.weight, flexShrink: cell.weight, flexBasis: 0 },
                cell.state === 'live' && styles.cellLive,
                action === 'restart' && styles.cellRestartable,
                action === 'none' && styles.cellInactive,
              ]}
              onPress={() => onOpen(channel, cell)}
            >
              {/* Uden maerket kan man ikke se hvilke afsluttede udsendelser
                  der kan startes igen. Cellerne ser ens ud, og forskellen —
                  om kanalen har arkiv — er usynlig indtil man har trykket. */}
              <Text
                style={[styles.cellText, cell.programme === null && styles.cellTextMuted]}
                numberOfLines={2}
              >
                {action === 'restart' ? '▶ ' : ''}
                {cell.programme?.title ?? (cell.weight >= 30 ? 'Ingen programdata' : '')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Kolonneoverskrifter for vinduet: én per halve time. */
function halfHourMarks(start: Date): Date[] {
  const marks: Date[] = [];
  for (let minutes = 0; minutes < WINDOW_MINUTES; minutes += 30) {
    marks.push(new Date(start.getTime() + minutes * 60_000));
  }
  return marks;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Enhedens lokale tid: guiden laeses af et menneske, ikke af panelet. */
function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Er de to tidspunkter samme dag? Dagen skrives kun naar den ikke er i dag. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDay(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

/** Dagsknapperne: en uge tilbage (arkivet), seks dage frem (oversigten), og "Aften" for i dag. */
const DAY_CHIPS: ReadonlyArray<{ dayDelta: number; hour: number | null; label: string }> = [
  ...Array.from({ length: 7 }, (_, i) => ({ dayDelta: i - 7, hour: null, label: '' })),
  { dayDelta: 0, hour: null, label: 'I dag' },
  { dayDelta: 0, hour: 20, label: 'Aften' },
  ...Array.from({ length: 6 }, (_, i) => ({ dayDelta: i + 1, hour: null, label: '' })),
];

const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];

function dayLabel(now: Date, dayDelta: number): string {
  if (dayDelta === 0) return 'I dag';
  if (dayDelta === -1) return 'I går';
  if (dayDelta === 1) return 'I morgen';
  const date = new Date(now);
  date.setDate(date.getDate() + dayDelta);
  return `${WEEKDAYS[date.getDay()]} ${formatDay(date)}`;
}

/** Hvor mange dage vinduets start ligger fra i dag. */
function dayDeltaOf(start: Date, now: Date): number {
  const a = new Date(start);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  dayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 21,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  pager: { color: theme.colors.accent, fontSize: 26, paddingHorizontal: theme.spacing.sm },
  dayRow: { flexGrow: 0 },
  dayRowContent: { paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.xs, gap: theme.spacing.xs },
  dayChip: {
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 1,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
  },
  dayChipActive: { backgroundColor: theme.colors.accent },
  dayChipText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  dayChipTextActive: { color: theme.colors.text },
  windowLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  timeHeader: {
    flexDirection: 'row',
    paddingBottom: theme.spacing.xs,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeSpacer: { width: CHANNEL_COLUMN },
  timeMark: { flex: 1, color: theme.colors.textMuted, fontSize: 11 },
  grid: { flex: 1 },
  // Bredden er ét fysisk punkt bred paa alle skaerme. En streg paa 2 dp ville
  // daekke et par minutter i et to timers vindue og saaledes lyve en smule om
  // hvor nu er.
  nowLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: theme.colors.danger,
    zIndex: 2,
  },
  nowDot: {
    position: 'absolute',
    bottom: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.danger,
  },
  row: { flexDirection: 'row', height: ROW_HEIGHT },
  channelCell: {
    width: CHANNEL_COLUMN,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    borderRightColor: theme.colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  channelCellPreviewing: { backgroundColor: theme.colors.surfaceRaised },
  channelText: { flex: 1, marginLeft: theme.spacing.xs },
  channelName: { color: theme.colors.text, fontSize: 11 },
  channelBadges: { color: theme.colors.accent, fontSize: 9, marginTop: 1 },
  cells: { flex: 1, flexDirection: 'row' },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
    marginRight: 1,
    marginVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  cellLive: { backgroundColor: theme.colors.surfaceRaised },
  cellRestartable: { borderLeftColor: theme.colors.accent, borderLeftWidth: 2 },
  cellInactive: { opacity: 0.45 },
  cellText: { color: theme.colors.text, fontSize: 11 },
  cellTextMuted: { color: theme.colors.textMuted },
});
