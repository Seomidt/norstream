import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
  useTVEventHandler,
} from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { getFavoriteGroup, getGuideInfoMode, setFavoriteGroup, sourcesWithDialect } from '../../storage/settings.js';
import type { GuideInfoMode } from '../../storage/settings.js';
import { listFavoriteGroups } from '../../storage/favoriteGroups.js';
import { addReminder, hasReminder, removeReminder } from '../../storage/reminders.js';
import type { FavoriteGroup } from '../../storage/favoriteGroups.js';
import { ensureFullEpg, ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV, useCanvasSize } from '../../ui/tv.js';
import { MiniPreview } from '../preview/MiniPreview.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { ClockWeather } from './ClockWeather.js';
import { NewsTicker } from './NewsTicker.js';
import { loadCachedWeather, refreshWeather } from '../../sync/weather.js';
import type { Weather } from '../../sync/weather.js';
import { loadCachedNews, refreshNews } from '../../sync/news.js';
import { ProgrammeSheet } from './ProgrammeSheet.js';
import { TimelineGrid } from './TimelineGrid.js';
import { ChannelDayScreen } from './ChannelDayScreen.js';
import { NowNextBox } from './NowNextBox.js';
import { guideTopLayout, sidePreviewFraction } from './nowNext.js';
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
  stateOf,
} from './layout.js';
import type { GuideCell } from './layout.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { refocusLastPressed } from '../../ui/refocus.js';

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
  /** Tv: pil hoejre fra menuen; den foerste raekkes foerste udsendelse faar fokus. */
  focusFirstSignal?: number;
}

/**
 * Hvor laenge der ventes efter en rulning foer der hentes.
 *
 * FlatList melder synlige raekker flere gange under ét sving med fingeren.
 * Uden ventetiden blev hvert af dem til en tur til panelet.
 */
const SCROLL_SETTLE_MS = 300;

/** Bredden paa kanalkolonnen. Fast, saa alle raekker staar praecist under hinanden. */
// Stoerre paa tv: 11 punkter i cellerne var smaat fra sofaen.
const CHANNEL_COLUMN = isTV ? 112 : 96;
const ROW_HEIGHT = isTV ? 64 : 56;
const GUIDE_TEXT = isTV ? 14 : 11;

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
export const GuideScreen = memo(function GuideScreen({
  session,
  onPlay,
  backRef,
  onRestart,
  onAuthError,
  onBrowse,
  previewEnabled,
  previewHandle,
  focusFirstSignal = 0,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
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

  /**
   * Tv: pil hoejre paa den sidste udsendelse i en raekke flytter vinduet
   * en time frem og bliver paa samme udsendelse, saa man kan koere hen ad
   * en kanal og se hvad der kommer senere, som paa udbydernes egne guider.
   * Gitteret holder paa fokus mod hoejre (TVFocusGuideView), saa Android
   * ikke hopper over i soejlen; den naas fra dagsknapperne.
   */
  const focusedCell = useRef<{ channelId: string; index: number; count: number; key: string } | null>(null);
  /** Udsendelsen fjernbetjeningen staar paa: soejlen til hoejre beskriver den. */
  const [focusedProgramme, setFocusedProgramme] = useState<Programme | null>(null);
  const onCellFocus = useCallback((channelId: string, index: number, count: number, key: string, programme: Programme | null) => {
    focusedCell.current = { channelId, index, count, key };
    setFocusedProgramme(programme);
  }, []);
  // Uden dette huskede gitteret den sidste celle efter en tur i menuen, og
  // pil hoejre fra menuen ind i guiden bladrede en time frem med det samme.
  const onCellBlur = useCallback(() => {
    focusedCell.current = null;
  }, []);
  const [focusTarget, setFocusTarget] = useState<{ channelId: string; key: string } | null>(null);
  // Maalet slippes igen en tegning senere: saa gaar hasTVPreferredFocus
  // falsk -> sand ved naeste maal, ogsaa paa samme celle. Cellen tegnes
  // ikke forfra (ingen ny key): det tabte fokus et oejeblik, og ved hurtige
  // tryk landede det oppe i hjoernet paa dagsknapperne.
  useEffect(() => {
    if (focusTarget === null) return;
    const frame = requestAnimationFrame(() => setFocusTarget(null));
    return () => cancelAnimationFrame(frame);
  }, [focusTarget]);
  // Fra menuen ind i guiden: den foerste raekkes foerste udsendelse (den
  // der er i gang) faar fokus. Noeglen '' findes ikke, saa raekken tager
  // sin foerste celle.
  const signalAtMount = useRef(focusFirstSignal);
  useEffect(() => {
    if (!isTV || focusFirstSignal === signalAtMount.current) return;
    // Ind i guiden fra menuen: stil altid vinduet paa "nu" igen, saa man aabner
    // paa nutiden (og ikke skal bruge Tilbage til at komme hjem — Tilbage gaar
    // nu direkte til menuen).
    setOffsetMinutes(0);
    const first = channels[0];
    if (first === undefined) return;
    setFocusTarget({ channelId: first.id, key: '' });
    // Kun signalet skal udloese det; kanalerne laeses naar det kommer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFirstSignal]);
  useTVEventHandler((event) => {
    if (!isTV || (event.eventType !== 'right' && event.eventType !== 'left')) return;
    // Android sender tryk ned (0) og op (1); kun det ene skal taelle.
    if (event.eventKeyAction !== undefined && Number(event.eventKeyAction) === 0) return;
    const cell = focusedCell.current;
    if (cell === null) return;
    // Pil hoejre paa den sidste udsendelse: en time frem. Pil venstre paa
    // den foerste: en time tilbage, saa man kan lede efter noget der har
    // vaeret uden at vide hvilken kanal. Gitteret holder paa fokus til begge
    // sider (TVFocusGuideView), saa man ikke ryger ud paa logoet eller i menuen.
    if (event.eventType === 'right' && cell.index === cell.count - 1) {
      setFocusTarget({ channelId: cell.channelId, key: cell.key });
      setOffsetMinutes((value) => Math.min(DRAG_MAX_MINUTES, value + 60));
    } else if (event.eventType === 'left' && cell.index === 0) {
      setFocusTarget({ channelId: cell.channelId, key: cell.key });
      setOffsetMinutes((value) => Math.max(DRAG_MIN_MINUTES, value - 60));
    }
  });
  /** Kanalen hvis hele dag vises, i stedet for gitteret. */
  const [dayFor, setDayFor] = useState<StoredChannel | null>(null);
  if (backRef !== undefined) {
    backRef.current = (): boolean => {
      if (dayFor !== null) {
        setDayFor(null);
        return true;
      }
      // Tilbage gaar DIREKTE til menuen (ét tryk). Foer stillede det foerst
      // vinduet paa "nu" og kraevede et tryk til for at naa menuen — det foeltes
      // som om foerste tryk ikke gjorde noget ("et par sekunder, i tvivl om man
      // har trykket"). Vinduet stilles i stedet paa nu, naar man kommer ind i
      // guiden fra menuen igen (se focusFirstSignal nedenfor).
      return false;
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
  /**
   * Previewkanalens udsendelser omkring nu, til boksen ved siden af.
   * Ikke gitterets vindue: traekker man guiden til i morgen aften, skal
   * boksen stadig sige hvad der sendes *nu*.
   */
  const [previewProgrammes, setPreviewProgrammes] = useState<Programme[]>([]);

  // Vejret ved uret (kun tv). Det sidst gemte vises straks; et frisk hentes i
  // baggrunden (open-meteo ud fra boksens IP) og opdateres et par gange i timen.
  // Fejler noget, staar der bare intet vejr — aldrig en raa fejl.
  const [weather, setWeather] = useState<Weather | null>(null);
  // Info-omraadet i guiden (kun tv): uret+vejr, nyhedsstribe eller intet. Kan
  // vaelges i Indstillinger; standard er uret. 'off' er guiden som foer uret.
  const [infoMode, setInfoMode] = useState<GuideInfoMode>('clock');
  useEffect(() => {
    let cancelled = false;
    void getGuideInfoMode(session.db).then((mode) => {
      if (!cancelled) setInfoMode(mode);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db]);
  const showClockWeather = isTV && infoMode === 'clock';
  const showNews = isTV && infoMode === 'news';
  // Vejret bruges baade af ur-kassen og af nyhedsstriben, saa det hentes til begge.
  const wantWeather = showClockWeather || showNews;
  useEffect(() => {
    if (!wantWeather) return;
    let cancelled = false;
    void loadCachedWeather(session.db).then((w) => {
      if (!cancelled && w !== null) setWeather(w);
    });
    const run = (): void => {
      void refreshWeather(session.db, session.fetchImpl).then((w) => {
        if (!cancelled && w !== null) setWeather(w);
      });
    };
    run();
    const timer = setInterval(run, 30 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, wantWeather]);

  // Nyhedsoverskrifterne til striben. Det sidst gemte vises straks; friske
  // hentes fra DR's RSS i baggrunden og opdateres et par gange i timen. Fejler
  // noget, staar de gamle — aldrig en raa fejl.
  const [headlines, setHeadlines] = useState<string[]>([]);
  useEffect(() => {
    if (!showNews) return;
    let cancelled = false;
    void loadCachedNews(session.db).then((n) => {
      if (!cancelled && n !== null) setHeadlines(n.headlines);
    });
    const run = (): void => {
      void refreshNews(session.db, session.fetchImpl).then((n) => {
        if (!cancelled && n !== null) setHeadlines(n.headlines);
      });
    };
    run();
    const timer = setInterval(run, 15 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, showNews]);
  // Laerredets bredde, ikke vinduets: paa tv er de ikke ens (se ui/tv.ts).
  const sideBySide = guideTopLayout(useCanvasSize().width) === 'side';
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  /** Den celle bladet er aabnet for, eller null naar det er lukket. */
  const [sheet, setSheet] = useState<{
    channel: StoredChannel;
    cell: GuideCell;
  } | null>(null);
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
  /** Om der er sat paamindelse paa bladets udsendelse; null mens det slaas op. */
  const [sheetReminder, setSheetReminder] = useState<boolean | null>(null);
  useEffect(() => {
    setSheetReminder(null);
    if (sheet === null || sheet.cell.programme === null) return;
    let cancelled = false;
    void hasReminder(session.db, sheet.channel.id, sheet.cell.programme.start.getTime()).then((set) => {
      if (!cancelled) setSheetReminder(set);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, sheet]);

  // Nu-tidspunktet fastholdes mens skaermen er aaben, saa cellerne ikke
  // hopper mellem tilstande midt i et tryk. Det opdateres hvert minut.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const window = shiftedWindow(now, offsetMinutes);
  const liveRatio = nowRatio(now, window.start, window.end);

  // Boksen laeser fra cachen, som gitteret; den opdateres naar kanalen
  // skifter, naar minuttet skifter, og naar en hentning har skrevet nye
  // programmer for kanalen (rows aendrer sig).
  const previewId = previewChannel?.id ?? null;
  const previewRows = previewId === null ? undefined : rows[previewId];
  useEffect(() => {
    if (previewId === null) {
      setPreviewProgrammes([]);
      return;
    }
    let cancelled = false;
    const from = new Date(now.getTime() - 6 * 60 * 60_000);
    const to = new Date(now.getTime() + 12 * 60 * 60_000);
    void listProgrammes(session.db, previewId, from, to).then((found) => {
      if (!cancelled) setPreviewProgrammes(found);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.db, previewId, now, previewRows]);

  /** Favoritgruppen guiden viser (null = alle), og alle grupperne til at skifte imellem. */
  const [group, setGroup] = useState<FavoriteGroup | null>(null);
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [groupTick, setGroupTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [chosen, groupList, withDialect] = await Promise.all([
          getFavoriteGroup(session.db),
          listFavoriteGroups(session.db),
          sourcesWithDialect(session.db),
        ]);
        const current = groupList.find((entry) => entry.id === chosen) ?? null;
        const favourites = await listChannels(session.db, { favouritesOnly: true, groupId: current?.id ?? null });
        if (cancelled) return;
        setGroups(groupList);
        setGroup(current);
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
  }, [session.db, groupTick]);
  // Efter et gruppeskift: fokus paa den nye foerste raekke naar den er der.
  useEffect(() => {
    if (loading || groupTick === 0) return;
    const first = channels[0];
    if (first === undefined) return;
    const frame = requestAnimationFrame(() => setFocusTarget({ channelId: first.id, key: '' }));
    return () => cancelAnimationFrame(frame);
    // Kun naar en ny liste er laest ind efter et skift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groupTick]);

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
  /**
   * Hvilket vindue hver kanal sidst blev tegnet for. Rulning melder de
   * synlige raekker igen og igen, og foer blev hver melding til én
   * forespoergsel per synlig raekke og en omtegning af hele gitteret —
   * paa en bred skaerm med mange raekker fremme hakkede det. Nu springes
   * raekker over der allerede staar tegnet for vinduet; kun en hentning
   * fra panelet tvinger dem laest igen.
   */
  const drawFromCache = useCallback(
    async (visible: readonly StoredChannel[], from: Date, to: Date, _force = false): Promise<boolean> => {
      if (visible.length === 0) return false;
      // Altid genindlaes de synlige kanaler for DETTE vindue fra den lokale
      // database. Foer sprang den kanaler over der "allerede var tegnet" for
      // vinduet (drawnFor), men rows holder kun ét vindues programmer ad
      // gangen og bliver overskrevet naar man ruller til et andet tidspunkt.
      // Kom man saa tilbage til nu, troede den at nu-vinduet var tegnet og
      // genindlaeste ikke — cellerne stod tomme ("naar jeg gaar tilbage og
      // frem er alt vaek"). listProgrammes er en hurtig indekseret opslag.
      const found = await Promise.all(visible.map((channel) => listProgrammes(session.db, channel.id, from, to)));
      if (
        currentWindow.current.from !== from.getTime() ||
        currentWindow.current.to !== to.getTime()
      ) {
        return false;
      }
      const loaded: Record<string, Programme[]> = {};
      visible.forEach((channel, index) => {
        loaded[channel.id] = found[index] ?? [];
      });
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
      const draw = (): Promise<boolean> => drawFromCache(visible, from, to, true);

      // **Cachen foerst.** Foer tegnede guiden efter hentningen, saa hver gang
      // programdata var mere end en halv time gamle, stod skaermen tom mens
      // panelet svarede — ogsaa naar cachen laa med aftenens programmer klar.
      // Det man har, skal vises med det samme; hentningen er en opdatering.
      if (!(await drawFromCache(visible, from, to))) return;

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

  // Fyld ALLE favoritters programdata i baggrunden, naar listen er laest.
  //
  // Ellers staar en raekke laengere nede tom, til man ruller til den — og naar
  // dens data saa lander mens fjernbetjeningen staar paa den, skifter cellen
  // fra "Ingen programdata" til udsendelser, den fokuserede celle forsvinder,
  // og fokus faldt til oeverste raekke ("springer til toppen"). Er dataene der
  // paa forhaand, sker det skift ikke under fokus. ensureFullEpg springer selv
  // de friske kanaler over, saa det koster kun det der mangler, og det
  // blokerer ikke de synlige hentninger. Kun én gang per liste.
  const prefetchedList = useRef<StoredChannel[] | null>(null);
  useEffect(() => {
    if (channels.length === 0 || prefetchedList.current === channels) return;
    prefetchedList.current = channels;
    let cancelled = false;
    void (async () => {
      try {
        await ensureFullEpg(session.db, session.credsBySource, session.fetchImpl, channels);
      } catch {
        // Auth-/netfejl haandteres af de synlige hentninger.
      }
      if (cancelled) return;
      void drawFromCacheRef.current(
        visibleChannels.current,
        new Date(windowRef.current.start),
        new Date(windowRef.current.end),
        true,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [channels, session]);

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

  // Raekkens tilbagekald er stabile, saa den memoiserede raekke kun tegnes
  // om naar dens egne data aendrer sig, ikke ved hver rulning.
  const onPreviewRow = useCallback((channel: StoredChannel): void => {
    pinnedPreview.current = channel;
    setPreviewChannel(channel);
  }, []);
  // Tv-guiden (TimelineGrid) skruer paa den samme tidsforskydning som telefonen,
  // saa hardware-Tilbage (backRef ovenfor) stadig stiller vinduet paa nu.
  const stepGuideTime = useCallback((deltaMin: number): void => {
    setOffsetMinutes((value) => Math.min(DRAG_MAX_MINUTES, Math.max(DRAG_MIN_MINUTES, value + deltaMin)));
  }, []);
  const onMeasureCells = useCallback((width: number): void => {
    gridWidth.current = width;
    setCellsWidth((current) => (current === width ? current : width));
  }, []);
  const onOpenCell = useCallback(
    (channel: StoredChannel, cell: GuideCell): void => {
      void openSheet(channel, cell);
    },
    [openSheet],
  );
  const nowMs = now.getTime();
  const previewingId = previewChannel?.id ?? null;
  const renderRow = useCallback(
    ({ item }: { item: StoredChannel }) => (
      <GuideRow
        channel={item}
        programmes={rows[item.id] ?? NO_PROGRAMMES}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        nowMs={nowMs}
        hasDialect={hasDialectFor(item)}
        previewing={previewingId === item.id}
        onPreview={onPreviewRow}
        onMeasureCells={onMeasureCells}
        onOpen={onOpenCell}
        onCellFocus={onCellFocus}
        onCellBlur={onCellBlur}
        focusKey={focusTarget !== null && focusTarget.channelId === item.id ? focusTarget.key : null}
      />
    ),
    [rows, windowStartMs, windowEndMs, nowMs, hasDialectFor, previewingId, onPreviewRow, onMeasureCells, onOpenCell, onCellFocus, onCellBlur, focusTarget],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
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
        <TvPressable style={styles.button} onPress={onBrowse}>
          <Text style={styles.buttonText}>Gå til Kanaler</Text>
        </TvPressable>
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

  /* Dagsknapperne: ét tryk til "i morgen aften" i stedet for tolv traek.
     Det er ogsaa den eneste maade guiden kan styres med en
     fjernbetjening. I dag = nu; de andre dage lander paa kl. 20. */
  const dayChips = (
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
            <TvPressable
              key={`${chip.dayDelta}:${chip.hour ?? 'day'}`}
              style={[styles.dayChip, active && styles.dayChipActive]}
              onPress={() =>
                setOffsetMinutes(chip.hour === null && chip.dayDelta === 0 ? 0 : offsetForTarget(now, chip.dayDelta, chip.hour ?? 20))
              }
            >
              <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                {chip.hour !== null ? chip.label : dayLabel(now, chip.dayDelta)}
              </Text>
            </TvPressable>
          );
        })}
    </ScrollView>
  );

  /* Preview og nu/naeste. Paa tv en soejle til hoejre; ellers over gitteret. */
  const topBlock = (
    <>
      {/* Smal skaerm: previewet som en stribe, boksen som to linjer under.
          Bred skaerm (foldet telefon slaaet ud, tablet, tv): previewet til
          venstre i 42 % af bredden, boksen ved siden af, og guiden faar
          resten af hoejden i stedet for to raekker. */}
      <View style={isTV ? styles.topColumn : sideBySide ? styles.topSide : undefined}>
        {showClockWeather ? (
          // Variant A: uret + vejret i den tomme plads til VENSTRE for preview,
          // saa intet skubbes nedad (hoejden er knap paa tv). Preview faar resten.
          <View style={styles.previewRow}>
            <View style={styles.clockCol}>
              <ClockWeather now={now} weather={weather} />
            </View>
            <View style={styles.previewFill}>
              <MiniPreview
                session={session}
                channel={dayFor === null ? previewChannel : null}
                enabled={previewEnabled}
                handle={previewHandle}
                onOpen={(channel) => onPlay(channel, channels)}
              />
            </View>
          </View>
        ) : (
          // Uden ur/vejr: previewet i fuld bredde igen, som foer. Paa tv INTET
          // bredde-loft (kun paa smalle skaerme deles der op i procent) — ellers
          // stod previewet paa 42 % og var lille, selv naar uret var slaaet fra.
          <View style={!isTV && sideBySide ? { width: `${Math.round(sidePreviewFraction(false) * 100)}%` } : undefined}>
            <MiniPreview
              session={session}
              channel={dayFor === null ? previewChannel : null}
              enabled={previewEnabled}
              handle={previewHandle}
              onOpen={(channel) => onPlay(channel, channels)}
            />
          </View>
        )}
        <NowNextBox
          channel={previewChannel}
          programmes={previewProgrammes}
          now={now}
          compact={!sideBySide && !isTV}
          rich={isTV}
          focus={isTV && focusedProgramme !== null && previewChannel !== null ? focusedProgramme : null}
          onOpen={(channel, programme) =>
            setSheet({
              channel,
              cell:
                programme === null
                  ? CHANNEL_CELL
                  : { key: 'now', programme, state: stateOf(programme, now), weight: 0, clippedStart: false, clippedEnd: false },
            })
          }
        />
      </View>

    </>
  );

  /* Bladreknapper, dagsknapper, tidslinje og selve gitteret. */
  const guideBlock = (
    <TVFocusGuideView style={styles.guideBlock} trapFocusUp={isTV}>
      {/* Bred skaerm: bladreknapperne og dagsknapperne deler én linje, saa
          gitteret faar hoejden. Paa tv er laerredet 405 punkter hoejt, og
          med preview, to linjer knapper og tidslinje var der ingen raekker
          tilbage. */}
      {/* Ikke paa tv: bladre- og dagsknapperne var det fjernbetjeningen
          landede paa naar den koerte op, og pil venstre/hoejre i gitteret
          bladrer alligevel. Tilbage saetter vinduet til nu. */}
      {!isTV && (
      <View style={sideBySide ? styles.toolbarSide : styles.toolbar}>
        <TvPressable
          hitSlop={12}
          onPress={() => setOffsetMinutes((value) => Math.max(DRAG_MIN_MINUTES, value - WINDOW_MINUTES))}
        >
          <Text style={styles.pager}>‹</Text>
        </TvPressable>
        {/* Etiketten er ogsaa vejen tilbage til nu. Efter et traek gennem tre
            doegn er en knap hurtigere end den samme vej tilbage. */}
        <TvPressable hitSlop={8} disabled={offsetMinutes === 0} onPress={() => setOffsetMinutes(0)}>
          <Text style={styles.windowLabel}>
            {formatTime(window.start)} – {formatTime(window.end)}
            {isSameDay(window.start, now) ? '' : ` · ${formatDay(window.start)}`}
            {offsetMinutes === 0 ? '' : '  ↺ Nu'}
          </Text>
        </TvPressable>
        <TvPressable
          hitSlop={12}
          onPress={() => setOffsetMinutes((value) => Math.min(DRAG_MAX_MINUTES, value + WINDOW_MINUTES))}
        >
          <Text style={styles.pager}>›</Text>
        </TvPressable>
        {sideBySide && dayChips}
      </View>
      )}
      {!isTV && !sideBySide && dayChips}


      {/* Favoritgrupperne over gitteret paa tv, som Googles "kategorier
          paa den lodrette akse": pil op fra oeverste raekke, pil ned igen.
          Kun naar der er grupper. Tilbage gaar til menuen. */}
      {isTV && groups.length > 0 && (
        <View style={styles.groupRow}>
          {[null, ...groups].map((entry) => {
            const active = (entry?.id ?? null) === (group?.id ?? null);
            return (
              <TvPressable
                key={entry?.id ?? 'all'}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => {
                  void setFavoriteGroup(session.db, entry?.id ?? null).then(() => {
                    setLoading(true);
                    setGroupTick((value) => value + 1);
                  });
                }}
              >
                <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{entry === null ? 'Alle' : entry.name}</Text>
              </TvPressable>
            );
          })}
        </View>
      )}
      {isTV && (
        <TimelineGrid
          session={session}
          channels={channels}
          now={now}
          hasDialectFor={hasDialectFor}
          onFocusChannel={onPreviewRow}
          onFocusProgramme={setFocusedProgramme}
          offsetMinutes={offsetMinutes}
          onStepTime={stepGuideTime}
          onOpen={(channel, programme, state) =>
            setSheet({
              channel,
              cell:
                programme === null
                  ? CHANNEL_CELL
                  : {
                      key: `p-${programme.start.getTime()}`,
                      programme,
                      state,
                      weight: 0,
                      clippedStart: false,
                      clippedEnd: false,
                    },
            })
          }
          focusFirstSignal={focusFirstSignal}
        />
      )}
      {!isTV && (
      <>
      <View style={styles.timeHeader}>
        <View style={styles.timeSpacer}>
          {/* Paa tv staar dagen her, naar vinduet ikke er i dag. */}
          {isTV && (
            <Text style={styles.timeMark} numberOfLines={1}>
              {isSameDay(window.start, now) ? 'I dag' : formatDay(window.start)}
              {group !== null ? ` · ${group.name}` : groups.length > 0 ? ' · Alle' : ''}
            </Text>
          )}
        </View>
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
        {/* autoFocus: forsvinder den celle fjernbetjeningen staar paa (raekken
            faar data, eller vinduet flytter sig), traekker gitteret selv fokus
            tilbage til en celle herinde i stedet for at lade Android sende det
            ud i menuen til venstre. Sammen med trap'ene til side og op er
            gitteret nu lukket om fokus. */}
        <TVFocusGuideView style={styles.grid} trapFocusRight={isTV} trapFocusLeft={isTV} autoFocus={isTV}>
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
          // Paa tv tegnes ALLE favorit-raekker fra start og holdes i live.
          // Ellers virtualiserer FlatList: naar man ruller forbi de foerste
          // ~16 raekker, afmonteres/genbruges raekker uden for vinduet — og
          // forsvinder den raekke fjernbetjeningen staar paa, ryger fokus, og
          // autoFocus kaster det til oeverste raekke ("springer til toppen ca.
          // 18 kanaler nede"). Guiden viser kun favoritterne, saa det er faa,
          // lette raekker (fast hoejde + getItemLayout). Paa telefon er
          // virtualiseringen fin — dér er der ingen fokus at miste.
          windowSize={isTV ? Math.max(11, channels.length + 2) : 5}
          maxToRenderPerBatch={isTV ? Math.max(16, channels.length) : 8}
          initialNumToRender={isTV ? Math.max(16, channels.length) : 16}
          // Aldrig afmontere en raekke fjernbetjeningen kan staa paa: paa
          // Android afmonterer FlatList som standard raekker der klippes ved
          // kanten, og forsvinder den fokuserede raekke, ryger fokus ud i
          // menuen.
          removeClippedSubviews={false}
          renderItem={renderRow}
        />
        </TVFocusGuideView>
      </View>
      </>
      )}
    </TVFocusGuideView>
  );

  return (
    <View style={styles.container}>
      {notice !== null && <Notice notice={notice} onDismiss={() => setNotice(null)} />}
      {/* Tv: gitteret til venstre med hele hoejden (otte-ni raekker i stedet
          for fem), preview og programoplysninger i en soejle til hoejre.
          Det var brugerens forslag, og det er saadan de fleste tv-guider
          er bygget. Ellers preview og boks over gitteret. */}
      {isTV ? (
        // Skjult mens hele dagen staar ovenpaa: gitterets celler og knapper
        // ligger ellers stadig under laget og faar fjernbetjeningens fokus,
        // saa dagsknapperne i laget ikke kunne vaelges.
        <>
          <View style={[styles.tvSplit, dayFor !== null && styles.hidden]}>
            <View style={styles.tvLeft}>{guideBlock}</View>
            <View style={[styles.tvRight, !showClockWeather && styles.tvRightNarrow]}>{topBlock}</View>
          </View>
          {/* Nyhedsstriben ligger i bunden i fuld bredde (uden for delingen),
              som paa en nyhedskanal. Kun i nyheds-tilstand og ikke mens hele
              dagen staar ovenpaa. */}
          {showNews && dayFor === null && (
            <NewsTicker now={now} weather={weather} headlines={headlines} />
          )}
        </>
      ) : (
        <>
          {topBlock}
          {guideBlock}
        </>
      )}
      {sheet !== null && (
        <ProgrammeSheet
          channel={sheet.channel}
          programme={sheet.cell.programme}
          state={sheet.cell.state}
          hasDialect={hasDialectFor(sheet.channel)}
          reminder={
            sheetReminder === null
              ? undefined
              : {
                  set: sheetReminder,
                  onToggle: () => {
                    const programme = sheet.cell.programme;
                    if (programme === null) return;
                    void (sheetReminder
                      ? removeReminder(session.db, sheet.channel.id, programme.start.getTime())
                      : addReminder(session.db, sheet.channel.id, programme)
                    ).then(() => setSheetReminder(!sheetReminder));
                  },
                }
          }
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

      {dayView}
    </View>
  );
});

/** Én tom liste til alle kanaler uden programdata, saa raekken ser de samme props igen. */
const NO_PROGRAMMES: Programme[] = [];

/** Cellen et tryk paa kanalnavnet aabner bladet med: ingen udsendelse, bare kanalen. */
const CHANNEL_CELL: GuideCell = {
  key: 'channel',
  programme: null,
  state: 'gap',
  weight: 0,
  clippedStart: false,
  clippedEnd: false,
};

/**
 * Én raekke i gitteret. Memoiseret: ved rulning aendrer kun previewet sig,
 * og saa skal kun to raekker tegnes om, ikke alle dem der er i live.
 * Cellerne regnes ud her fra tal, saa to renders med samme vindue giver
 * samme props.
 */
const GuideRow = memo(function GuideRow({
  channel,
  programmes,
  windowStartMs,
  windowEndMs,
  nowMs,
  hasDialect,
  previewing,
  onPreview,
  onOpen,
  onMeasureCells,
  onCellFocus,
  onCellBlur,
  focusKey,
}: {
  channel: StoredChannel;
  programmes: readonly Programme[];
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  hasDialect: boolean;
  /** Sand for den kanal previewet viser lige nu. */
  previewing: boolean;
  /** Et tryk paa kanalnavnet: vis kanalen i previewet. */
  onPreview: (channel: StoredChannel) => void;
  onOpen: (channel: StoredChannel, cell: GuideCell) => void;
  /** Bredden paa tidsaksen. Traekket regner minutter ud af den. */
  onMeasureCells: (width: number) => void;
  /** Tv: hvilken celle fjernbetjeningen staar paa, til pil-hoejre-bladring. */
  onCellFocus: (channelId: string, index: number, count: number, key: string, programme: Programme | null) => void;
  onCellBlur: () => void;
  /** Tv: cellen der skal have fokus efter et vinduesskift; null for alle andre raekker. */
  focusKey: string | null;
}) {
  const styles = useStyles(makeStyles);
  const cells = useMemo(
    () => layoutRow(programmes, new Date(windowStartMs), new Date(windowEndMs), new Date(nowMs)),
    [programmes, windowStartMs, windowEndMs, nowMs],
  );
  // Efter et vinduesskift: samme udsendelse hvis den stadig er i vinduet,
  // ellers den foerste celle i raekken.
  const targetIndex = focusKey === null ? -1 : Math.max(0, cells.findIndex((cell) => cell.key === focusKey));
  /**
   * Fokus maa ikke forsvinde naar cellerne skifter under fjernbetjeningen.
   *
   * Bladrer man tilbage til en time hvis programmer ikke er laest endnu,
   * er raekken foerst huller; naar programmerne kommer, faar cellerne nye
   * noegler, den celle der havde fokus forsvinder, og Android giver fokus
   * til det foerste trykpunkt paa skaermen — oppe i toppen. Samme sag hver
   * gang vinduet flytter sig mens man staar paa et hul. Derfor: staar
   * fjernbetjeningen i raekken, og dens celle er vaek efter et skift, faar
   * cellen paa samme plads fokus i én tegning. Layout-effekten koerer foer
   * blur-haendelsen fra den fjernede celle naar frem, saa pladsen er kendt.
   */
  const focusedIndex = useRef<number | null>(null);
  const [recoverKey, setRecoverKey] = useState<string | null>(null);
  /**
   * Live-cellen i raekken (den der sender nu) som fokus-maal.
   *
   * Naar fjernbetjeningen kommer ind i raekken oppefra/nedefra, omdirigerer
   * TVFocusGuideView fokus hertil — saa ned/op rammer det der sender nu, ikke
   * en nabocelle. Androids egen mekanik (UIFocusGuide), som IKKE kaemper mod
   * fokus som en JS-omdirigering ville. En tilbagevendende ref-funktion saettes
   * paa den celle hvis state er 'live'; flytter live sig (tiden gaar, data
   * lander), peger maalet paa den nye.
   */
  const [liveNode, setLiveNode] = useState<View | null>(null);
  const previousCells = useRef(cells);
  useLayoutEffect(() => {
    const before = previousCells.current;
    previousCells.current = cells;
    const index = focusedIndex.current;
    if (!isTV || index === null || before === cells) return;
    const key = before[index]?.key;
    if (key !== undefined && cells.some((cell) => cell.key === key)) return;
    const next = cells[Math.min(index, cells.length - 1)];
    if (next !== undefined) setRecoverKey(next.key);
  }, [cells]);
  useEffect(() => {
    if (recoverKey === null) return;
    const frame = requestAnimationFrame(() => setRecoverKey(null));
    return () => cancelAnimationFrame(frame);
  }, [recoverKey]);
  return (
    <View style={styles.row}>
      {/* Et tryk paa kanalen viser den i previewet; hold fingeren for
          bladet med "se kanalen". Previewet fulgte kun den oeverste synlige
          raekke, og de nederste kan aldrig rulles derop. */}
      <TvPressable
        style={[styles.channelCell, previewing && styles.channelCellPreviewing]}
        // Paa tv kan logoet ikke faa fokus: fjernbetjeningen bliver blandt
        // udsendelserne, og previewet foelger dem alligevel. Kanalens valg
        // (se, start forfra, hele dagen) ligger paa OK paa en udsendelse.
        focusable={!isTV}
        onPress={() => (isTV ? onOpen(channel, CHANNEL_CELL) : onPreview(channel))}
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
      </TvPressable>
      <TVFocusGuideView
        style={styles.cells}
        onLayout={(event) => onMeasureCells(event.nativeEvent.layout.width)}
        // Kommer fokus ind i raekken (op/ned), sendes det til live-cellen.
        destinations={isTV && liveNode !== null ? [liveNode] : undefined}
      >
        {cells.map((cell, index) => {
          const action = guideAction(cell, channel, hasDialect);
          return (
            <TvPressable
              ref={isTV && cell.state === 'live' ? setLiveNode : undefined}
              // Noeglen er PLADSEN i raekken, ikke indholdet. Ellers: naar et
              // hul bliver til en udsendelse (data lander), eller vinduet
              // flytter sig, faar cellen en ny indholdsnoegle (gap-… -> p-…),
              // React afmonterer den fokuserede celle, fokus mistes, og
              // gitterets autoFocus kaster det til oeverste raekke ("springer
              // til toppen naar man scroller hen til det der sendes nu").
              // Med pladsen som noegle opdateres samme celle paa stedet, og
              // fokus bliver siddende.
              key={`cell-${index}`}
              hasTVPreferredFocus={index === targetIndex || cell.key === recoverKey}
              style={[
                styles.cell,
                { flexGrow: cell.weight, flexShrink: cell.weight, flexBasis: 0 },
                cell.state === 'live' && styles.cellLive,
                action === 'restart' && styles.cellRestartable,
                action === 'none' && styles.cellInactive,
              ]}
              onPress={() => onOpen(channel, cell)}
              // Paa tv foelger previewet den raekke fjernbetjeningen staar
              // i, ogsaa naar den staar paa en udsendelse og ikke paa navnet.
              onFocus={
                isTV
                  ? () => {
                      focusedIndex.current = index;
                      onPreview(channel);
                      onCellFocus(channel.id, index, cells.length, cell.key, cell.programme);
                    }
                  : undefined
              }
              onBlur={
                isTV
                  ? () => {
                      // Kun naar det er dén celle der slipper: blur fra en
                      // fjernet celle kommer efter at en ny har faaet fokus.
                      if (focusedIndex.current === index) focusedIndex.current = null;
                      onCellBlur();
                    }
                  : undefined
              }
            >
              {/* Uden maerket kan man ikke se hvilke afsluttede udsendelser
                  der kan startes igen. Cellerne ser ens ud, og forskellen —
                  om kanalen har arkiv — er usynlig indtil man har trykket. */}
              <Text
                style={[styles.cellText, cell.programme === null && styles.cellTextMuted]}
                numberOfLines={2}
              >
                {index === 0 && cell.clippedStart && cell.programme !== null ? '‹ ' : ''}
                {action === 'restart' ? '▶ ' : ''}
                {cell.programme?.title ?? (cell.weight >= 30 ? 'Ingen programdata' : '')}
              </Text>
            </TvPressable>
          );
        })}
      </TVFocusGuideView>
    </View>
  );
});

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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topSide: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface },
  // flex: 1, saa boksen med nu/naeste (som selv har flex: 1) faar hoejde:
  // uden det havde soejlen kun previewets hoejde, og boksen blev nul
  // punkter hoej med alt indhold klippet vaek. "Ser meget tomt ud."
  topColumn: { flex: 1, backgroundColor: colors.surface },
  // Uret + vejret til venstre for preview (Variant A): en fast, smal soejle,
  // saa preview faar resten af bredden og intet skubbes nedad.
  // Lille mellemrum, saa previewet naar naesten helt hen til ur/vejr-kassen.
  previewRow: { flexDirection: 'row', alignItems: 'stretch', gap: theme.spacing.xs },
  // Smal soejle, saa uret ikke dominerer over preview: previewet faar resten.
  clockCol: { width: 90 },
  previewFill: { flex: 1, minWidth: 0 },
  tvSplit: { flex: 1, flexDirection: 'row' },
  hidden: { display: 'none' },
  tvLeft: { flex: 1 },
  // Lidt bredere paa tv end foer (28%), saa der er plads til uret ved siden af
  // preview uden at klemme selve previewet. Uden ur/vejr: tilbage til 28%.
  tvRight: { width: '33%', marginLeft: theme.spacing.sm, backgroundColor: colors.surface },
  tvRightNarrow: { width: '28%' },
  dayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: colors.background,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 21,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  toolbarSide: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  pager: { color: colors.accent, fontSize: 26, paddingHorizontal: theme.spacing.sm },
  dayRow: { flexGrow: 0, flexShrink: 1 },
  groupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.xs },
  dayRowContent: { paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.xs, gap: theme.spacing.xs },
  dayChip: {
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 1,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  dayChipActive: { backgroundColor: colors.accent },
  dayChipText: { color: colors.textMuted, fontSize: isTV ? 14 : 12, fontWeight: '600' },
  dayChipTextActive: { color: colors.text },
  windowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  timeHeader: {
    flexDirection: 'row',
    paddingBottom: theme.spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeSpacer: { width: CHANNEL_COLUMN },
  timeMark: { flex: 1, color: colors.textMuted, fontSize: isTV ? 13 : 11 },
  grid: { flex: 1 },
  guideBlock: { flex: 1 },
  // Bredden er ét fysisk punkt bred paa alle skaerme. En streg paa 2 dp ville
  // daekke et par minutter i et to timers vindue og saaledes lyve en smule om
  // hvor nu er.
  nowLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: colors.danger,
    zIndex: 2,
  },
  nowDot: {
    position: 'absolute',
    bottom: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  row: { flexDirection: 'row', height: ROW_HEIGHT },
  channelCell: {
    width: CHANNEL_COLUMN,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  channelCellPreviewing: { backgroundColor: colors.surfaceRaised },
  channelText: { flex: 1, marginLeft: theme.spacing.xs },
  channelName: { color: colors.text, fontSize: GUIDE_TEXT },
  channelBadges: { color: colors.accent, fontSize: 9, marginTop: 1 },
  cells: { flex: 1, flexDirection: 'row' },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
    marginRight: 1,
    marginVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cellLive: { backgroundColor: colors.surfaceRaised },
  cellRestartable: { borderLeftColor: colors.accent, borderLeftWidth: 2 },
  cellInactive: { opacity: 0.45 },
  cellText: { color: colors.text, fontSize: GUIDE_TEXT },
  cellTextMuted: { color: colors.textMuted },
});
