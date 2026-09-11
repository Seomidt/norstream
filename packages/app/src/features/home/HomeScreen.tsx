import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useTVEventHandler } from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import {
  clearLastSyncMs,
  getMiniPreviewEnabled,
  getStreamFormatSetting,
} from '../../storage/settings.js';
import { syncAllSources } from '../../sync/syncAll.js';
import { prefetchFavouritesEpg } from '../../sync/prefetchEpg.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { forgetPosterMisses } from '../../ui/posterFill.js';
import { BrowseScreen } from '../browse/BrowseScreen.js';
import type { Level } from '../browse/BrowseScreen.js';
import { FavoritesScreen } from '../favorites/FavoritesScreen.js';
import { FrontScreen } from './FrontScreen.js';
import { GuideScreen } from '../guide/GuideScreen.js';
import { RADIO_START, RadioScreen } from '../radio/RadioScreen.js';
import type { RadioPlace } from '../radio/RadioScreen.js';
import { SourcesScreen } from '../sources/SourcesScreen.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsScreen } from '../settings/SettingsScreen.js';
import { LogoGapsScreen } from '../settings/LogoGapsScreen.js';
import { ConnectionCheckScreen } from '../settings/ConnectionCheckScreen.js';
import { LogoPickerScreen } from '../settings/LogoPickerScreen.js';
import { Notice } from '../../ui/Notice.js';
import { applyStreamFormatSetting } from '../player/format.js';
import { VodScreen } from '../vod/VodScreen.js';
import type { VodLevel } from '../vod/VodScreen.js';
import type { StoredVodItem } from '../../storage/vod.js';

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
  onSelect: (channel: StoredChannel, startFrom?: Programme, neighbours?: StoredChannel[]) => void;
  /** En film eller serie aabnes. Selve afspilningen sker fra dens egen skaerm. */
  onOpenVod: (item: StoredVodItem) => void;
  onSignedOut: (notice: string) => void;
  /** Kaldes naar kilderne er aendret, saa sessionen kan laeses om. */
  onSourcesChanged: () => void;
  /** Udfyldes med det telefonens tilbage-knap skal goere i Hjem. Falsk = lad Android lukke. */
  backRef: { current: () => boolean };
}

export type Tab = 'home' | 'favorites' | 'browse' | 'guide' | 'vod' | 'radio' | 'settings';

/** Tryk paa fjernbetjeningen der kan have flyttet fokus ind i eller langs menusoejlen. */
const RAIL_KEYS = new Set(['left', 'longLeft', 'up', 'longUp', 'down', 'longDown']);

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Hjem', icon: '⌂' },
  { id: 'favorites', label: 'Favoritter', icon: '★' },
  { id: 'browse', label: 'Kanaler', icon: '☰' },
  { id: 'guide', label: 'Guide', icon: '▦' },
  { id: 'vod', label: 'Film', icon: '▶' },
  { id: 'radio', label: 'Radio', icon: '♪' },
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
  onSignedOut,
  onSourcesChanged,
  backRef,
}: Props) {
  const styles = useStyles(makeStyles);
  // Telefonens navigationslinje ligger oven i fanelinjen uden det her.
  // Maalt frem for gaettet: en fast polstring rammer forkert paa baade
  // gestus-navigation og de gammeldags tre knapper.
  const insets = useSafeAreaInsets();
  const tab = place.tab;
  const setTab = (next: Tab): void => onPlaceChange({ ...place, tab: next });
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [homeVisits, setHomeVisits] = useState(0);
  const [favoritesToken, setFavoritesToken] = useState(0);
  const [showingSources, setShowingSources] = useState(false);
  /** Indstillingers underskaerme til logoer: listen, og valget for én kanal. */
  const [showingLogos, setShowingLogos] = useState(false);
  const [showingCheck, setShowingCheck] = useState(false);
  /** Guidens egen tilbage-vej (dagssiden), foer fanens. */
  const guideBack = useRef<() => boolean>(() => false);
  /** Radioens egen tilbage-vej (internetradioens land og soegning), foer fanens. */
  const radioBack = useRef<() => boolean>(() => false);
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
    if (tab === 'guide' && guideBack.current()) return true;
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
        onPlaceChange({ ...place, browse: { name: 'categories', country: level.country } });
        return true;
      }
      if (level.name === 'categories') {
        onPlaceChange({ ...place, browse: { name: 'countries' } });
        return true;
      }
    }
    if (tab === 'vod' && place.vod !== null) {
      const level = place.vod;
      if (level.name === 'items') {
        onPlaceChange({ ...place, vod: { name: 'categories', kind: level.kind, country: level.country } });
        return true;
      }
      if (level.name === 'categories') {
        onPlaceChange({ ...place, vod: { name: 'countries', kind: level.kind } });
        return true;
      }
      if (level.name === 'countries') {
        onPlaceChange({ ...place, vod: { name: 'home' } });
        return true;
      }
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
      const enabled = await getMiniPreviewEnabled(session.db);
      if (!cancelled) setPreviewEnabled(enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db]);

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
      setFavoritesToken((value) => value + 1);

      // Bagefter, og uden at nogen venter paa det: favoritternes programtabel
      // for det naeste doegn, saa guiden er fyldt naar den aabnes. Fejler det,
      // henter guiden selv som foer.
      void prefetchFavouritesEpg(session.db, session.credsBySource, session.fetchImpl).catch(
        () => undefined,
      );
    },
    [session],
  );

  // Foerste gang skaermen vises: hent hvis cachen er gammel eller tom. Det
  // daekker ogsaa foerste start efter onboarding, hvor der aldrig har vaeret
  // en synkronisering — uden det landede brugeren paa en tom liste.
  const autoSyncStarted = useRef(false);
  useEffect(() => {
    if (autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    void syncFromPanel(false);
  }, [syncFromPanel]);

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
    (channel: StoredChannel, startFrom?: Programme, neighbours?: StoredChannel[]): void => {
      void (async () => {
        try {
          await previewHandle.current?.release();
        } catch {
          // Med vilje.
        }
        onSelect(channel, startFrom, neighbours);
      })();
    },
    [onSelect],
  );

  /** Skifter faneblad. Previewet lever i kanallisten; forlader man den, skal
      forbindelsen slippes med det samme. */
  const selectTab = (id: Tab) => {
    if (id !== tab) {
      void previewHandle.current?.release().catch(() => undefined);
      // Forsiden bliver staaende skjult; naar man kommer tilbage til den,
      // skal den laese noegle, tjenester og favoritter igen, ellers stod
      // et valg fra Indstillinger der foerst ved naeste start.
      if (id === 'home') setHomeVisits((value) => value + 1);
    }
    if (id !== 'settings') {
      setShowingSources(false);
      setShowingLogos(false);
      setPickingLogoFor(null);
    }
    setTab(id);
  };

  /**
   * Hvornaar fjernbetjeningen sidst blev trykket. Fanerne skifter paa fokus,
   * men kun naar fokus kom af et tryk: forsvinder den raekke der havde
   * fokus (en favorit fjernet), flytter Android selv fokus til det
   * foerste trykpunkt, som er Hjem i soejlen, og saa roeg man til
   * forsiden hver gang man fjernede en favorit.
   */
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

  const lastKey = useRef<{ type: string; at: number }>({ type: '', at: 0 });
  useTVEventHandler((event) => {
    if (event.eventType !== 'focus' && event.eventType !== 'blur') lastKey.current = { type: event.eventType, at: Date.now() };
  });
  /** Fanen skifter foerst naar fjernbetjeningen har staaet stille et oejeblik: at koere hen over fire faner skal ikke montere fire skaerme. */
  const pendingTab = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTab = (id: Tab) => {
    // Kun pil-venstre (ind i soejlen) og op/ned (langs den) taeller. Et
    // tryk paa OK i indholdet der skifter liste (land under Film) mistede
    // ogsaa fokus, og saa roeg man til Hjem selv om man lige havde trykket.
    const { type, at } = lastKey.current;
    if (Date.now() - at > 600 || !RAIL_KEYS.has(type)) return;
    if (pendingTab.current !== null) clearTimeout(pendingTab.current);
    pendingTab.current = setTimeout(() => {
      pendingTab.current = null;
      selectTab(id);
    }, 250);
  };
  useEffect(
    () => () => {
      if (pendingTab.current !== null) clearTimeout(pendingTab.current);
    },
    [],
  );

  /**
   * Tv: soejlen folder sig sammen til ikoner et par sekunder efter at
   * fjernbetjeningen har forladt den, og folder sig ud igen naar den
   * kommer tilbage (pil-venstre). Saa faar indholdet pladsen.
   */
  const [railOpen, setRailOpen] = useState(true);
  const railTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRailFocus = () => {
    if (railTimer.current !== null) clearTimeout(railTimer.current);
    railTimer.current = null;
    setRailOpen(true);
  };
  const onRailBlur = () => {
    if (railTimer.current !== null) clearTimeout(railTimer.current);
    railTimer.current = setTimeout(() => setRailOpen(false), 2000);
  };

  /* Fanerne: nederst paa telefonen, som en soejle til venstre paa tv. Fra
     en liste paa hundrede raekker var menulinjen nederst hundrede tryk
     vaek; til venstre er den ét tryk paa pil-venstre, som i de andre
     tv-apps. Se selectTab for hvad et fanevalg goer. */
  const tabs = (
    <View style={isTV ? [styles.rail, !railOpen && styles.railFolded] : [styles.tabBar, { paddingBottom: theme.spacing.sm + (isTV ? 0 : insets.bottom) }]}>
      {TABS.map((item) => (
        <TvPressable
          key={item.id}
          style={isTV ? styles.railTab : styles.tab}
          onPress={() => {
            if (pendingTab.current !== null) clearTimeout(pendingTab.current);
            selectTab(item.id);
          }}
          // Paa tv skifter fanen naar fjernbetjeningen lander paa den,
          // uden et tryk paa OK: saadan goer de andre tv-apps, og at
          // skulle trykke OK for at se hvad der er under Film foeltes
          // som om intet skete. Se focusTab for de to forbehold.
          onFocus={
            isTV
              ? () => {
                  onRailFocus();
                  focusTab(item.id);
                }
              : undefined
          }
          onBlur={isTV ? onRailBlur : undefined}
        >
          <Text style={[styles.tabIcon, tab === item.id && styles.tabActive]}>
            {item.icon}
          </Text>
          {(!isTV || railOpen) && (
            <Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>
              {item.label}
            </Text>
          )}
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
      <View style={styles.body}>
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
            previewEnabled={previewEnabled}
            previewHandle={previewHandle}
            onPickLogo={pickLogo}
            refreshing={refreshing}
            onRefresh={refresh}
            reloadToken={favoritesToken}
          />
        )}
        {tab === 'browse' && (
          <BrowseScreen
            session={session}
            onSelect={(channel, neighbours) => open(channel, undefined, neighbours)}
            onAuthError={handleAuthError}
            previewEnabled={previewEnabled}
            previewHandle={previewHandle}
            onPickLogo={pickLogo}
            onFavoritesChanged={() => setFavoritesToken((value) => value + 1)}
            level={place.browse ?? { name: 'countries' }}
            onLevelChange={(level) => onPlaceChange({ ...place, browse: level })}
          />
        )}
        {tab === 'guide' && (
          <GuideScreen
            session={session}
            backRef={guideBack}
            onPlay={(channel, neighbours) => open(channel, undefined, neighbours)}
            onRestart={(channel, programme) => open(channel, programme)}
            onAuthError={handleAuthError}
            onBrowse={() => setTab('browse')}
            previewEnabled={previewEnabled}
            previewHandle={previewHandle}
          />
        )}
        {visited.current.has('vod') && (
          <View style={[styles.body, tab !== 'vod' && styles.hiddenTab]}>
          <VodScreen
            session={session}
            level={place.vod ?? { name: 'home' }}
            onLevelChange={(level) => onPlaceChange({ ...place, vod: level })}
            onOpen={onOpenVod}
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
          />
        )}
      </View>

      {!isTV && tabs}
      </View>
      {isTV && tabs}
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
  rail: {
    width: 84,
    paddingTop: theme.spacing.md,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
  },
  railFolded: { width: 44 },
  railTab: { alignItems: 'center', paddingVertical: theme.spacing.sm, marginHorizontal: theme.spacing.xs, marginBottom: theme.spacing.xs },
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
