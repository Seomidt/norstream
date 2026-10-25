import { deferredScreen } from '../../ui/deferredScreen.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import {
  clearLastSyncMs,
  getLastSyncMs,
  getMiniPreviewEnabled,
  getStreamFormatSetting,
  getTmdbApiKey,
  getVideoSurface,
} from '../../storage/settings.js';
import { CHANNEL_SYNC_INTERVAL_MS, syncAllSources } from '../../sync/syncAll.js';
import { useAutomaticChannelSync } from '../../sync/useAutomaticChannelSync.js';
import { prefetchFavouritesEpg } from '../../sync/prefetchEpg.js';
import { pauseBackgroundPanel } from '../../sync/panelGate.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { refocusLastPressed } from '../../ui/refocus.js';
import { NavigationRail } from './NavigationRail.js';
import type { NavigationRailControl } from './NavigationRail.js';
import { useFollowedSeriesRefresh } from '../../sync/useFollowedSeriesRefresh.js';
import { forgetPosterMisses } from '../../ui/posterFill.js';
import type { Level } from '../browse/BrowseScreen.js';
import { parentVodLevel } from '../vod/vodNavigation.js';
import { FrontScreen } from './FrontScreen.js';
import { RADIO_START, RadioScreen } from '../radio/RadioScreen.js';
import type { RadioPlace } from '../radio/RadioScreen.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Notice } from '../../ui/Notice.js';
import { applyStreamFormatSetting, applyVideoSurfaceSetting } from '../player/format.js';
import { runWeeklyCloudBackup } from '../../storage/cloudBackup.js';
import { loadSourceCredentials } from '../../storage/credentials.js';
import { loadFromCloud, saveToCloud } from '../settings/cloudSync.js';
import { runCloudSync } from '../../storage/cloudAutoSync.js';
import type { CloudSyncOutcome } from '../../storage/cloudAutoSync.js';
import { forgetLogoMisses, resetLogo } from '../../ui/logoCache.js';
import { VodScreen } from '../vod/VodScreen.js';
import { refreshSportEpg } from '../sport/findMatches.js';
import { enrichVodMeta } from '../../sync/vodMeta.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { logEvent } from '../../diagnostics/log.js';
import type { VodLevel } from '../vod/VodScreen.js';
import type { StoredVodItem } from '../../storage/vod.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';

// Sjaeldnere skaerme skal ikke forsinke opstarten.
const BrowseScreen = deferredScreen(
  () => (require('../browse/BrowseScreen.js') as typeof import('../browse/BrowseScreen.js')).BrowseScreen,
);
const FavoritesScreen = deferredScreen(
  () => (require('../favorites/FavoritesScreen.js') as typeof import('../favorites/FavoritesScreen.js')).FavoritesScreen,
);
const GuideScreen = deferredScreen(
  () => (require('../guide/GuideScreen.js') as typeof import('../guide/GuideScreen.js')).GuideScreen,
);
const SourcesScreen = deferredScreen(
  () => (require('../sources/SourcesScreen.js') as typeof import('../sources/SourcesScreen.js')).SourcesScreen,
);
const SettingsScreen = deferredScreen(
  () => (require('../settings/SettingsScreen.js') as typeof import('../settings/SettingsScreen.js')).SettingsScreen,
);
const LogoGapsScreen = deferredScreen(
  () => (require('../settings/LogoGapsScreen.js') as typeof import('../settings/LogoGapsScreen.js')).LogoGapsScreen,
);
const ConnectionCheckScreen = deferredScreen(
  () => (require('../settings/ConnectionCheckScreen.js') as typeof import('../settings/ConnectionCheckScreen.js')).ConnectionCheckScreen,
);
const LogoPickerScreen = deferredScreen(
  () => (require('../settings/LogoPickerScreen.js') as typeof import('../settings/LogoPickerScreen.js')).LogoPickerScreen,
);
const SportScreen = deferredScreen(
  () => (require('../sport/SportScreen.js') as typeof import('../sport/SportScreen.js')).SportScreen,
);
const TeletextScreen = deferredScreen(
  () => (require('../teletext/TeletextScreen.js') as typeof import('../teletext/TeletextScreen.js')).TeletextScreen,
);

/**
 * Hvor brugeren staar i Hjem.
 *
 * Ligger i App.tsx og ikke her, fordi denne skaerm afmonteres naar afspilleren
 * aabnes. Uden det landede "tilbage" altid paa Favoritter, ogsaa naar turen
 * begyndte tre niveauer nede i Kanaler.
 */
export interface HomePlace {
  tab: Tab;
  /** Browse-fanens niveau, eller null for dens udgangspunkt. */
  browse: Level | null;
  /** Film-fanens niveau, eller null for forsiden. */
  vod: VodLevel | null;
  /** Radio-fanens sted: del og aabent land. Null for udgangspunktet. */
  radio?: RadioPlace | null;
}

interface Props {
  session: AppSession;
  place: HomePlace;
  onPlaceChange: (place: HomePlace) => void;
  onSelect: (channel: StoredChannel, startFrom?: Programme, neighbours?: StoredChannel[], resumeAtSeconds?: number) => void;
  /** En film eller serie aabnes. Selve afspilningen sker fra dens egen skaerm. */
  onOpenVod: (item: StoredVodItem) => void;
  /** Biografen: traileren til en film der ikke er i panelet. */
  onTrailer: (title: TmdbTitle) => void;
  onSignedOut: (notice: string) => void;
  /** Kaldes naar kilderne er aendret, saa sessionen kan laeses om. */
  onSourcesChanged: () => void;
  /** Udfyldes med det telefonens tilbage-knap skal goere i Hjem. Falsk = lad Android lukke. */
  backRef: { current: () => boolean };
  /** Sand mens en afspiller eller filmside ligger over Hjem: previewet skal vaere afmonteret imens. */
  covered?: boolean;
}

export type Tab = 'home' | 'favorites' | 'browse' | 'guide' | 'sport' | 'vod' | 'radio' | 'teletext' | 'settings';

// Stabile standard-niveauer. Foer var de inline-objekter (`{ name: 'countries' }`),
// altsaa en ny reference ved HVER HomeScreen-render — og saa genindlaeste Browse
// (og VOD) sit tungeste opslag hver gang forsiden tegnede sig om.
const DEFAULT_BROWSE_LEVEL: Level = { name: 'countries' };
const DEFAULT_VOD_LEVEL: VodLevel = { name: 'home' };

const TABS: { id: Tab; label: string; icon: string }[] = [
  // Det man bruger hver dag oeverst. Favoritter staar lige under Guide —
  // de to hoerer sammen (guiden viser netop favoritterne), saa man kan
  // springe mellem dem. Kanaler er mest opsaetning og staar laengere nede.
  { id: 'home', label: 'Hjem', icon: '⌂' },
  { id: 'guide', label: 'Guide', icon: '▦' },
  { id: 'favorites', label: 'Favoritter', icon: '★' },
  // Find kampen (v339): soeg efter hold og liga paa tvaers af kanalerne.
  { id: 'sport', label: 'Sport', icon: '⚽\uFE0E' },
  { id: 'vod', label: 'Film', icon: '▶' },
  { id: 'radio', label: 'Radio', icon: '♪' },
  ...(isTV ? [{ id: 'teletext' as const, label: 'Tekst-tv', icon: '▤' }] : []),
  { id: 'browse', label: 'Kanaler', icon: '☰' },
  { id: 'settings', label: 'Indstil.', icon: '⚙' },
];

const SIGNED_OUT_MESSAGE =
  'Panelet afviste dine adgangsoplysninger. De er slettet fra enheden — log ind igen.';

/**
 * Fanebladsskallen.
 *
 * Fire faneblade er ikke nok til at traekke et navigationsbibliotek ind; ruterne
 * bliver i den `Route`-union `App.tsx` allerede har.
 *
 * Startskaermen er **Hjem**, forsiden som paa en tv-boks; Favoritter er
 * fanen ved siden af. EPG hentes ikke her: den henter sig selv per synlig
 * raekke gennem `epgCache`.
 */
export function HomeScreen({
  session,
  place,
  onPlaceChange,
  onSelect,
  onOpenVod,
  onTrailer,
  onSignedOut,
  onSourcesChanged,
  backRef,
  covered = false,
}: Props) {
  const styles = useStyles(makeStyles);
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  // En koesat EPG-runde maa ikke fortsaette kanal for kanal under video.
  useEffect(() => {
    if (covered) return pauseBackgroundPanel();
  }, [covered]);
  // Telefonens navigationslinje ligger oven i fanelinjen uden det her.
  // Maalt frem for gaettet: en fast polstring rammer forkert paa baade
  // gestus-navigation og de gammeldags tre knapper.
  const insets = useSafeAreaInsets();
  const tab = place.tab;
  const setTab = (next: Tab): void => onPlaceChange({ ...place, tab: next });
  // Seneste `place`, saa stabile callbacks (til memoiseret GuideScreen) kan
  // laese den uden selv at aendre reference hver render.
  const placeRef = useRef(place);
  placeRef.current = place;
  const [previewEnabled, setPreviewEnabled] = useState(false);
  /** Previewet vises kun mens Hjem er oeverst: under afspilleren skal dets videoflade vaere vaek. */
  const previewOn = previewEnabled && !covered;
  // Tilbage fra afspilleren (eller en films side): fokus tilbage paa det
  // kort, den raekke eller den celle man aabnede fra. Ellers gav Android
  // det til det foerste trykpunkt paa skaermen, oppe i toppen.
  const wasCovered = useRef(false);
  useEffect(() => {
    if (covered) {
      wasCovered.current = true;
      return;
    }
    if (!wasCovered.current || !isTV) return;
    wasCovered.current = false;
    const timer = setTimeout(() => refocusLastPressed(), 80);
    return () => clearTimeout(timer);
  }, [covered]);
  const [refreshing, setRefreshing] = useState(false);
  const [homeVisits, setHomeVisits] = useState(0);
  const [favoritesToken, setFavoritesToken] = useState(0);
  const followedChanged = useCallback(() => setFavoritesToken(value => value + 1), []);
  useFollowedSeriesRefresh(session, !covered, followedChanged);
  const [showingSources, setShowingSources] = useState(false);
  /** Indstillingers underskaerme til logoer: listen, og valget for én kanal. */
  const [showingLogos, setShowingLogos] = useState(false);
  const [showingCheck, setShowingCheck] = useState(false);
  /** Guidens egen tilbage-vej (dagssiden), foer fanens. */
  const guideBack = useRef<() => boolean>(() => false);
  const sportBack = useRef<() => boolean>(() => false);
  const teletextBack = useRef<() => boolean>(() => false);
  /** Radioens egen tilbage-vej (internetradioens land og soegning), foer fanens. */
  const radioBack = useRef<() => boolean>(() => false);
  const vodBack = useRef<() => boolean>(() => false);
  const railControl = useRef<NavigationRailControl | null>(null);
  const [pickingLogoFor, setPickingLogoFor] = useState<string | null>(null);
  const [logoToken, setLogoToken] = useState(0);

  const pickLogo = (channel: StoredChannel): void => {
    setPickingLogoFor(channel.id);
    onPlaceChange({ ...place, tab: 'settings' });
  };

  // Deles af alle faneblade: kun ét preview maa nogensinde vaere i luften.
  const previewHandle = useRef<PreviewHandle | null>(null);

  // Ét niveau op ad den vej man kom. Kilder-skaermen lukkes foerst; saa
  // land -> kategori -> kanaler i Kanaler, og forsiden -> land -> kategori ->
  // titler i Film. Paa forsiden af en fane: intet at gaa op i.
  backRef.current = (): boolean => {
    if ((tab === 'guide' && guideBack.current()) || (tab === 'sport' && sportBack.current()) || (tab === 'teletext' && teletextBack.current())) {
      // Et gammelt piltryk maa ikke skifte fane, mens undersiden lukkes og
      // Android kortvarigt leder efter fokus paa baggrunden.
      railControl.current?.cancelSelection();
      return true;
    }
    if (tab === 'radio' && radioBack.current()) return true;
    if (tab === 'settings' && pickingLogoFor !== null) {
      setPickingLogoFor(null);
      return true;
    }
    if (tab === 'settings' && showingLogos) {
      setShowingLogos(false);
      return true;
    }
    if (tab === 'settings' && showingCheck) {
      setShowingCheck(false);
      return true;
    }
    if (tab === 'settings' && showingSources) {
      setShowingSources(false);
      return true;
    }
    if (tab === 'browse' && place.browse !== null) {
      const level = place.browse;
      if (level.name === 'channels') {
        onPlaceChange({
          ...place,
          browse: { name: 'categories', sourceId: level.sourceId, country: level.country },
        });
        return true;
      }
      if (level.name === 'categories') {
        onPlaceChange({ ...place, browse: { name: 'countries' } });
        return true;
      }
    }
    if (tab === 'vod') {
      if (vodBack.current()) return true;
      const parent = parentVodLevel(place.vod ?? DEFAULT_VOD_LEVEL);
      if (parent !== null) {
        onPlaceChange({ ...place, vod: parent });
        return true;
      }
    }
    // Paa tv: foerst op i menuen (soejlen), saa videre som paa telefonen.
    // Ellers var menuen ikke til at naa fra guiden, som holder paa fokus.
    if (isTV && !railControl.current?.isFocused()) {
      railControl.current?.requestFocus();
      return true;
    }
    if (tab !== 'home') {
      onPlaceChange({ ...place, tab: 'home' });
      return true;
    }
    return false;
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [enabled, format, surface] = await Promise.all([
        getMiniPreviewEnabled(session.db),
        getStreamFormatSetting(session.db),
        getVideoSurface(session.db),
      ]);
      if (cancelled) return;
      setPreviewEnabled(enabled);
      // Afspillerens valg skal gaelde fra start, ikke foerst naar
      // Indstillinger har vaeret aabnet.
      applyStreamFormatSetting(format);
      applyVideoSurfaceSetting(surface);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db]);

  /**
   * Skyen (v340): holder enhederne ens. Koerer lidt efter start, naar appen
   * kommer frem igen, hvert tiende minut, og lidt efter at noget er aendret
   * her (favoritter, logoer) eller man kom tilbage fra en film. Er
   * synkroniseringen slaaet fra, koerer den ugentlige kopi som foer. Kom
   * skyen ind (en anden boks havde aendret noget), laeses favoritter, logoer
   * og indstillinger igen — som efter en gendannelse.
   */
  const cloudSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runCloud = useCallback(async (): Promise<CloudSyncOutcome> => {
    const startedAt = Date.now();
    const result = await runCloudSync(
      session.db,
      {
        upload: (code, json) => saveToCloud(code, json),
        download: async (code) => {
          try {
            return await loadFromCloud(code);
          } catch (cause) {
            if (cause instanceof Error && cause.message === 'notfound') return null;
            throw cause;
          }
        },
      },
      Date.now(),
      (id) => loadSourceCredentials(id),
    );
    if (result.outcome !== 'off' && result.outcome !== 'unchanged') {
      logEvent('baggrund', `sky-synk: ${result.outcome}, ${Math.round((Date.now() - startedAt) / 1000)} s`);
    }
    if (result.outcome === 'off') {
      // Ugentlig sikkerhedskopi til skyen, naar der er valgt et kodeord.
      void runWeeklyCloudBackup(session.db, (code, json) => saveToCloud(code, json), Date.now(), false, (id) => loadSourceCredentials(id));
    } else if (result.outcome === 'applied') {
      for (const key of result.restore?.overrideKeys ?? []) await resetLogo(key).catch(() => undefined);
      await forgetLogoMisses().catch(() => undefined);
      setFavoritesToken((value) => value + 1);
      setLogoToken((value) => value + 1);
      void getMiniPreviewEnabled(session.db).then(setPreviewEnabled);
      void getStreamFormatSetting(session.db).then(applyStreamFormatSetting);
    }
    return result.outcome;
  }, [session.db]);
  const scheduleCloudSync = useCallback(
    (delayMs: number): void => {
      if (cloudSyncTimer.current !== null) clearTimeout(cloudSyncTimer.current);
      cloudSyncTimer.current = setTimeout(() => {
        cloudSyncTimer.current = null;
        void runCloud().catch(() => undefined);
      }, delayMs);
    },
    [runCloud],
  );
  useEffect(() => {
    scheduleCloudSync(15_000);
    const interval = setInterval(() => scheduleCloudSync(0), 10 * 60_000);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') scheduleCloudSync(2_000);
    });
    return () => {
      clearInterval(interval);
      appState.remove();
      if (cloudSyncTimer.current !== null) clearTimeout(cloudSyncTimer.current);
    };
  }, [scheduleCloudSync]);
  // Noget er aendret her (favoritter, logoer): laeg op lidt efter. Ikke ved
  // monteringen — der koerer starten allerede.
  const tokensSeen = useRef(false);
  useEffect(() => {
    if (!tokensSeen.current) {
      tokensSeen.current = true;
      return;
    }
    scheduleCloudSync(20_000);
  }, [favoritesToken, logoToken, scheduleCloudSync]);
  // Tilbage fra afspilleren eller en film: fremdriften kan vaere ny.
  const cloudWasCovered = useRef(false);
  useEffect(() => {
    if (covered) {
      cloudWasCovered.current = true;
    } else if (cloudWasCovered.current) {
      cloudWasCovered.current = false;
      scheduleCloudSync(5_000);
    }
    // Foerste montering er ikke "tilbage fra afspiller": behold de 15 s
    // fra opstartseffekten, saa skyen ikke konkurrerer med forsiden.
  }, [covered, scheduleCloudSync]);

  // Sportskanalernes programoversigt hentes i baggrunden lidt efter start
  // (v346), saa Sport staar klar med det samme i stedet for at hente naar
  // man aabner den. Hoejst hvert 20. minut, og friske kanaler springes over.
  // v350: halvandet minut, ikke 30 s — forsiden, kanalhentningen og skyen
  // skal vaere faerdige foerst, og kaldene gaar i koe bag alt synligt.
  useEffect(() => {
    if (covered) return;
    const timer = setTimeout(() => {
      if (!coveredRef.current) void refreshSportEpg(session).catch(() => 0);
    }, 90_000);
    return () => clearTimeout(timer);
  }, [session, covered]);

  // Genre og aar fra TMDB til de nyeste film og serier (v367), til udvalget
  // under Film. To minutter efter start, nogle hundrede ad gangen; TMDB er
  // ikke panelet og tager ikke dets forbindelse.
  useEffect(() => {
    if (covered) return;
    const timer = setTimeout(() => {
      void (async () => {
        const apiKey = await getTmdbApiKey(session.db);
        if (apiKey !== null && !coveredRef.current) await enrichVodMeta(session.db, tmdbFetch, apiKey);
      })().catch(() => undefined);
    }, 120_000);
    return () => clearTimeout(timer);
  }, [session, covered]);

  /**
   * Panelet afviste et kald.
   *
   * Foer loggede det brugeren ud og slettede kilden, favoritterne og
   * adgangsoplysningerne — paa ét 403, som lige saa godt kan vaere et panel
   * der blokerer en adresse et kvarter. Nu siges det, og intet roeres. Er
   * kodeordet virkelig skiftet, er der en knap til at logge ind igen, og det
   * login lander oven i den kilde der findes, med favoritterne i behold.
   */
  const [rejected, setRejected] = useState(false);
  const handleAuthError = useCallback((): void => {
    setRejected(true);
  }, []);

  /**
   * Henter kanaler fra panelet. `force` er traek-ned; uden det springes turen
   * over hvis listen er hentet inden for det sidste doegn.
   *
   * EPG er ikke laengere med her. I v1 delte de taeller, saa hyppig
   * traek-ned forhindrede EPG i overhovedet at blive hentet.
   */
  const syncFromPanel = useCallback(
    async (force: boolean): Promise<void> => {
      // Hver kilde for sig: er det ene panel nede, skal de oevrige kanaler
      // stadig hentes. Et afvist kodeord paa én kilde logger heller ikke
      // brugeren ud af de andre.
      // Doegnrytmen ligger i syncAllSources og gaelder per kilde: en nyligt
      // tilfoejet kilde maa ikke arve de andres hentetid og staa tom.
      const result = await syncAllSources(session.db, session.sources, session.fetchImpl, {
        force,
      });
      if (result.rejected.length > 0) setRejected(true);
      // Kun naar noget FAKTISK blev hentet. Foer blev token'en haevet ved hver
      // synk — ogsaa naar alt var friskt og blev sprunget over — og saa
      // genindlaeste forsiden ALT en ekstra gang ved hver app-start.
      if (result.synced > 0) {
        setFavoritesToken((value) => value + 1);
        logEvent('baggrund', 'kanaler v390: arkivstatus opdateret fra udbyderen');
      }

      // Bagefter, og uden at nogen venter paa det: favoritternes programtabel
      // for det naeste doegn, saa guiden er fyldt naar den aabnes. Fejler det,
      // henter guiden selv som foer.
      if (!coveredRef.current) {
        void prefetchFavouritesEpg(session.db, session.credsBySource, session.fetchImpl).catch(
          () => undefined,
        );
      }
    },
    [session],
  );

  // Arkivflag maa ikke fryse paa startvaerdien, hvis appen bliver aaben i
  // flere dage. Tjek kun alderen naar Hjem er synlig, og hent hoejst dagligt.
  const refreshChannelsIfDue = useCallback(async (): Promise<void> => {
    const times = await Promise.all(session.sources.map(source => getLastSyncMs(session.db, source.source.id)));
    const now = Date.now();
    if (times.some(last => last === null || now - last >= CHANNEL_SYNC_INTERVAL_MS)) await syncFromPanel(false);
  }, [session, syncFromPanel]);
  useAutomaticChannelSync(refreshChannelsIfDue, covered !== true);

  const refresh = useCallback((): void => {
    void (async () => {
      setRefreshing(true);
      try {
        // "Hent alt forfra" gaelder ogsaa plakaterne TMDB ikke fandt sidst.
        await forgetPosterMisses();
        await syncFromPanel(true);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [syncFromPanel]);

  /**
   * Previewet skal have sluppet panelets ene forbindelse foer afspilleren beder
   * om den. Fejler frigivelsen, aabner vi alligevel: et tryk der ikke goer
   * noget er vaerre end en stream der maaske skal proeve igen.
   */
  const open = useCallback(
    (channel: StoredChannel, startFrom?: Programme, neighbours?: StoredChannel[], resumeAtSeconds?: number): void => {
      void (async () => {
        try {
          await previewHandle.current?.release();
        } catch {
          // Med vilje.
        }
        // Ingen ekstra pause her: den blev proevet (v292) for at give panelet tid
        // til at frigive sit ene slot, men gjorde hver aabning maerkbart
        // langsommere. Bliver den foerste stream alligevel afvist, fanger
        // afspillerens 4-sekunders start-timer det (INITIAL_STALL_TIMEOUT_MS).
        onSelect(channel, startFrom, neighbours, resumeAtSeconds);
      })();
    },
    [onSelect],
  );

  // Stabile callbacks til den memoiserede GuideScreen: uden dem faar guiden
  // nye props hver gang HomeScreen tegnes (fx naar soejlen tager fokus ved
  // Tilbage), og memoiseringen holder ikke — saa hele det tunge gitter blev
  // tegnet om, og menuen kom langsomt frem. `open` og `onPlaceChange` er selv
  // stabile; `placeRef` giver den nyeste place uden at aendre reference.
  const openGuidePlay = useCallback(
    (channel: StoredChannel, neighbours?: StoredChannel[]) => open(channel, undefined, neighbours),
    [open],
  );
  const openGuideRestart = useCallback(
    (channel: StoredChannel, programme: Programme) => open(channel, programme),
    [open],
  );
  const goBrowse = useCallback(() => onPlaceChange({ ...placeRef.current, tab: 'browse' }), [onPlaceChange]);

  /** Skifter faneblad. Previewet lever i kanallisten; forlader man den, skal
      forbindelsen slippes med det samme. */
  const selectTab = useCallback((id: Tab) => {
    const current = placeRef.current;
    if (id === current.tab) return;
    void previewHandle.current?.release().catch(() => undefined);
    // Forsiden staar skjult; genlaes indstillinger naar man vaelger den igen.
    if (id === 'home') setHomeVisits((value) => value + 1);
    if (id !== 'settings') {
      setShowingSources(false);
      setShowingLogos(false);
      setPickingLogoFor(null);
    }
    onPlaceChange({ ...current, tab: id });
  }, [onPlaceChange]);

  /** Faner der har vaeret aabne: de bliver staaende skjult, se kroppen nedenfor. */
  const visited = useRef(new Set<Tab>());
  visited.current.add(tab);
  const [, redraw] = useState(0);
  // Paa tv: Film og Radio bygges op i baggrunden lidt efter start, saa de
  // staar klar naar man kommer til dem, i stedet for at laese ind mens man
  // venter. Skjult, saa det ikke tager fokus.
  useEffect(() => {
    if (!isTV) return;
    const timer = setTimeout(() => {
      visited.current.add('vod');
      visited.current.add('radio');
      redraw((value) => value + 1);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Kun indgangen i indholdet aendrer HomeScreen. Menuens eget fokus,
  // aabning og foldning bor i NavigationRail og roerer ikke skjulte faner.
  const [enterSignal, setEnterSignal] = useState(0);
  const enterContent = useCallback(() => setEnterSignal(value => value + 1), []);

  const phoneTabs = !isTV && (
    <View style={[styles.tabBar, { paddingBottom: theme.spacing.sm + insets.bottom }]}>
      {TABS.map(item => (
        <TvPressable key={item.id} style={styles.tab} onPress={() => selectTab(item.id)}>
          <Text style={[styles.tabIcon, tab === item.id && styles.tabActive]}>{item.icon}</Text>
          <Text style={[styles.tabLabel, tab === item.id && styles.tabActive]} numberOfLines={1} adjustsFontSizeToFit>
            {item.label}
          </Text>
        </TvPressable>
      ))}
    </View>
  );

  return (
    <View style={isTV ? styles.containerTv : styles.container}>
      {/* Soejlen staar til venstre, men sidst i traeet (row-reverse):
          mister fjernbetjeningen sit fokus, giver Android det til det
          foerste trykpunkt i traeet, og det skal vaere i indholdet, ikke
          Hjem i menuen. */}
      <View style={styles.column}>
      {rejected && (
        <Notice
          notice={{
            text:
              'Panelet afviser appen lige nu. Det sker når det blokerer en adresse et stykke tid — appen venter ti minutter og prøver igen. Har du skiftet kodeord, så log ind igen under Kilder.',
            actionLabel: 'Kilder',
            onAction: () => {
              setTab('settings');
              setShowingSources(true);
            },
          }}
          onDismiss={() => setRejected(false)}
        />
      )}
      {/* Indholdet holder paa fokus opad, nedad og mod hoejre: naar en
          liste slipper op, ledte Android videre efter naermeste trykpunkt
          og fandt Hjem i menuen — og saa skiftede fanen. Kun venstre er
          aaben, ind i menuen. */}
      <TVFocusGuideView
        style={styles.body}
        // Ikke naar noget ligger ovenpaa (afspiller, en films side): saa
        // skal pilene kunne naa derop, hvis fokus blev staaende hernede.
        trapFocusUp={isTV && !covered}
        trapFocusDown={isTV && !covered}
        trapFocusRight={isTV && !covered}
      >
        {/* Hjem, Film og Radio bliver staaende naar man forlader dem, bare
            skjult: at bygge dem op igen ved hvert besoeg laeste alt ind
            forfra og var langsomt paa tv. Kanaler, Favoritter og Guide
            afmonteres stadig: de har previewet, som skal slippe panelets
            ene forbindelse naar man gaar. */}
        {visited.current.has('home') && (
          <View style={[styles.body, tab !== 'home' && styles.hiddenTab]}>
          <FrontScreen
            session={session}
            onSelect={(channel, neighbours) => open(channel, undefined, neighbours)}
            onResume={(channel, programme, positionSeconds) => open(channel, programme, undefined, positionSeconds)}
            onOpenVod={onOpenVod}
            onOpenSettings={() => setTab('settings')}
            onBrowse={() => setTab('browse')}
            refreshing={refreshing}
            onRefresh={refresh}
            reloadToken={favoritesToken + logoToken + homeVisits}
          />
          </View>
        )}
        {tab === 'favorites' && (
          <FavoritesScreen
            session={session}
            onSelect={(channel, neighbours) => open(channel, undefined, neighbours)}
            onAuthError={handleAuthError}
            onBrowse={() => setTab('browse')}
            previewEnabled={previewOn}
            previewHandle={previewHandle}
            onPickLogo={pickLogo}
            refreshing={refreshing}
            onRefresh={refresh}
            reloadToken={favoritesToken}
            focusFirstSignal={enterSignal}
          />
        )}
        {tab === 'browse' && (
          <BrowseScreen
            session={session}
            onSelect={(channel, neighbours) => open(channel, undefined, neighbours)}
            onAuthError={handleAuthError}
            previewEnabled={previewOn}
            previewHandle={previewHandle}
            onPickLogo={pickLogo}
            onFavoritesChanged={() => setFavoritesToken((value) => value + 1)}
            level={place.browse ?? DEFAULT_BROWSE_LEVEL}
            onLevelChange={(level) => onPlaceChange({ ...place, browse: level })}
            focusFirstSignal={enterSignal}
          />
        )}
        {tab === 'guide' && (
          <GuideScreen
            session={session}
            backRef={guideBack}
            onPlay={openGuidePlay}
            onRestart={openGuideRestart}
            onAuthError={handleAuthError}
            onBrowse={goBrowse}
            active={!covered}
            reloadToken={favoritesToken}
            previewEnabled={previewOn}
            previewHandle={previewHandle}
            focusFirstSignal={enterSignal}
          />
        )}
        {tab === 'sport' && (
          <SportScreen
            backRef={sportBack}
            session={session}
            onPlay={(channel, neighbours) => open(channel, undefined, neighbours)}
            focusFirstSignal={enterSignal}
          />
        )}
        {tab === 'teletext' && <TeletextScreen backRef={teletextBack} active={!covered} focusFirstSignal={enterSignal} />}
        {visited.current.has('vod') && (
          <View style={[styles.body, tab !== 'vod' && styles.hiddenTab]}>
          <VodScreen
            session={session}
            reloadToken={favoritesToken}
            active={tab === 'vod' && !covered}
            backRef={vodBack}
            level={place.vod ?? DEFAULT_VOD_LEVEL}
            onLevelChange={(level) => onPlaceChange({ ...place, vod: level })}
            onOpen={onOpenVod}
            onTrailer={onTrailer}
            onOpenSettings={() => setTab('settings')}
          />
          </View>
        )}
        {visited.current.has('radio') && (
          <View style={[styles.body, tab !== 'radio' && styles.hiddenTab]}>
          <RadioScreen
            session={session}
            onSelect={(channel, neighbours) => open(channel, undefined, neighbours)}
            onAuthError={handleAuthError}
            previewHandle={previewHandle}
            onPickLogo={pickLogo}
            backRef={radioBack}
            place={place.radio ?? RADIO_START}
            onPlaceChange={(radio) => onPlaceChange({ ...place, radio })}
          />
          </View>
        )}

        {tab === 'settings' && pickingLogoFor !== null && (
          <LogoPickerScreen
            session={session}
            channelKey={pickingLogoFor}
            onBack={() => setPickingLogoFor(null)}
            onChanged={() => {
              setLogoToken((value) => value + 1);
              setFavoritesToken((value) => value + 1);
            }}
          />
        )}
        {tab === 'settings' && pickingLogoFor === null && showingLogos && (
          <LogoGapsScreen
            session={session}
            onBack={() => setShowingLogos(false)}
            onPick={(channelKey) => setPickingLogoFor(channelKey)}
            reloadToken={logoToken}
            onChanged={() => {
              setLogoToken((value) => value + 1);
              setFavoritesToken((value) => value + 1);
            }}
          />
        )}
        {tab === 'settings' && pickingLogoFor === null && !showingLogos && showingCheck && (
          <ConnectionCheckScreen session={session} onBack={() => setShowingCheck(false)} />
        )}
        {tab === 'settings' && pickingLogoFor === null && !showingLogos && !showingCheck && showingSources && (
          <SourcesScreen
            session={session}
            onSourcesChanged={() => {
              // Kilderne er skiftet; kanallisten skal hentes forfra, og
              // sessionen skal laese legitimation for den nye kilde.
              onSourcesChanged();
              void refresh();
            }}
          />
        )}

        {tab === 'settings' && pickingLogoFor === null && !showingLogos && !showingCheck && !showingSources && (
          <SettingsScreen
            session={session}
            onRefresh={refresh}
            refreshing={refreshing}
            previewEnabled={previewEnabled}
            onPreviewEnabledChange={setPreviewEnabled}
            onOpenSources={() => setShowingSources(true)}
            onOpenLogos={() => setShowingLogos(true)}
            onOpenCheck={() => setShowingCheck(true)}
            onSignedOut={onSignedOut}
            onRestored={() => {
              setFavoritesToken((value) => value + 1);
              setLogoToken((value) => value + 1);
              void getMiniPreviewEnabled(session.db).then(setPreviewEnabled);
              void getStreamFormatSetting(session.db).then(applyStreamFormatSetting);
            }}
            onCloudSync={runCloud}
          />
        )}
      </TVFocusGuideView>

      {phoneTabs}
      </View>
      {isTV && <NavigationRail
        tabs={TABS}
        activeTab={tab}
        enabled={!covered}
        onSelect={selectTab}
        onEnter={enterContent}
        controlRef={railControl}
      />}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  containerTv: { flex: 1, flexDirection: 'row-reverse', backgroundColor: colors.background },
  column: { flex: 1, overflow: 'hidden' },
  // Klippes: paa tv stod listens sidste raekker oven i menulinjen og under
  // laerredets kant. Paa telefonen laa det samme skjult under skaermens kant.
  body: { flex: 1, overflow: 'hidden' },
  hiddenTab: { display: 'none' },
  tabBar: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm },
  tabIcon: { color: colors.textMuted, fontSize: 18 },
  tabLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tabActive: { color: colors.accent },
});
