import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { clearSourceCredentials } from '../../storage/credentials.js';
import { deleteSource, listSources } from '../../storage/sources.js';
import {
  clearLastSyncMs,
  getMiniPreviewEnabled,
} from '../../storage/settings.js';
import { syncAllSources } from '../../sync/syncAll.js';
import { prefetchFavouritesEpg } from '../../sync/prefetchEpg.js';
import { theme } from '../../ui/theme.js';
import { BrowseScreen } from '../browse/BrowseScreen.js';
import type { Level } from '../browse/BrowseScreen.js';
import { FavoritesScreen } from '../favorites/FavoritesScreen.js';
import { GuideScreen } from '../guide/GuideScreen.js';
import { RecordingsScreen } from '../recordings/RecordingsScreen.js';
import { SourcesScreen } from '../sources/SourcesScreen.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsScreen } from '../settings/SettingsScreen.js';
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
}

interface Props {
  session: AppSession;
  place: HomePlace;
  onPlaceChange: (place: HomePlace) => void;
  onSelect: (channel: StoredChannel, startFrom?: Programme) => void;
  /** En film eller serie aabnes. Selve afspilningen sker fra dens egen skaerm. */
  onOpenVod: (item: StoredVodItem) => void;
  onSignedOut: (notice: string) => void;
  /** Kaldes naar kilderne er aendret, saa sessionen kan laeses om. */
  onSourcesChanged: () => void;
  /** Udfyldes med det telefonens tilbage-knap skal goere i Hjem. Falsk = lad Android lukke. */
  backRef: { current: () => boolean };
}

export type Tab = 'favorites' | 'browse' | 'guide' | 'vod' | 'recordings' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'favorites', label: 'Favoritter', icon: '★' },
  { id: 'browse', label: 'Kanaler', icon: '☰' },
  { id: 'guide', label: 'Guide', icon: '▦' },
  { id: 'vod', label: 'Film', icon: '▶' },
  { id: 'recordings', label: 'Optag.', icon: '●' },
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
 * Startskaermen er **Favoritter**, som spec sec.5 beder om. EPG hentes ikke
 * her: den henter sig selv per synlig raekke gennem `epgCache`.
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
  // Telefonens navigationslinje ligger oven i fanelinjen uden det her.
  // Maalt frem for gaettet: en fast polstring rammer forkert paa baade
  // gestus-navigation og de gammeldags tre knapper.
  const insets = useSafeAreaInsets();
  const tab = place.tab;
  const setTab = (next: Tab): void => onPlaceChange({ ...place, tab: next });
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [favoritesToken, setFavoritesToken] = useState(0);
  const [showingSources, setShowingSources] = useState(false);

  // Deles af alle faneblade: kun ét preview maa nogensinde vaere i luften.
  const previewHandle = useRef<PreviewHandle | null>(null);

  // Ét niveau op ad den vej man kom. Kilder-skaermen lukkes foerst; saa
  // land -> kategori -> kanaler i Kanaler, og forsiden -> land -> kategori ->
  // titler i Film. Paa forsiden af en fane: intet at gaa op i.
  backRef.current = (): boolean => {
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
    if (tab !== 'favorites') {
      onPlaceChange({ ...place, tab: 'favorites' });
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

  const signOutFromPanel = useCallback(async (): Promise<void> => {
    // Spec sec.9: afviste credentials ryddes fra enheden, og brugeren sendes
    // til onboarding. Et skiftet panel-kodeord maa ikke laase installationen.
    // Begge oprydninger koeres uanset om den anden fejler; en fejlende
    // keychain-sletning maa ikke afbryde udlogningen stille.
    const sources = await listSources(session.db);
    await Promise.allSettled([
      ...sources.map((source) => clearSourceCredentials(source.id)),
      ...sources.map((source) => deleteSource(session.db, source.id)),
      clearLastSyncMs(session.db),
    ]);
    onSignedOut(SIGNED_OUT_MESSAGE);
  }, [session.db, onSignedOut]);

  const handleAuthError = useCallback((): void => {
    void signOutFromPanel();
  }, [signOutFromPanel]);

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
      if (result.synced === 0 && result.rejected.length > 0) {
        await signOutFromPanel();
        return;
      }
      setFavoritesToken((value) => value + 1);

      // Bagefter, og uden at nogen venter paa det: favoritternes programtabel
      // for det naeste doegn, saa guiden er fyldt naar den aabnes. Fejler det,
      // henter guiden selv som foer.
      void prefetchFavouritesEpg(session.db, session.credsBySource, session.fetchImpl).catch(
        () => undefined,
      );
    },
    [session, signOutFromPanel],
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
    (channel: StoredChannel, startFrom?: Programme): void => {
      void (async () => {
        try {
          await previewHandle.current?.release();
        } catch {
          // Med vilje.
        }
        onSelect(channel, startFrom);
      })();
    },
    [onSelect],
  );

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        {tab === 'favorites' && (
          <FavoritesScreen
            session={session}
            onSelect={open}
            onAuthError={handleAuthError}
            onBrowse={() => setTab('browse')}
            previewEnabled={previewEnabled}
            previewHandle={previewHandle}
            refreshing={refreshing}
            onRefresh={refresh}
            reloadToken={favoritesToken}
          />
        )}
        {tab === 'browse' && (
          <BrowseScreen
            session={session}
            onSelect={open}
            onAuthError={handleAuthError}
            previewEnabled={previewEnabled}
            previewHandle={previewHandle}
            onFavoritesChanged={() => setFavoritesToken((value) => value + 1)}
            level={place.browse ?? { name: 'countries' }}
            onLevelChange={(level) => onPlaceChange({ ...place, browse: level })}
          />
        )}
        {tab === 'guide' && (
          <GuideScreen
            session={session}
            onPlay={(channel) => open(channel)}
            onRestart={(channel, programme) => open(channel, programme)}
            onAuthError={handleAuthError}
            onBrowse={() => setTab('browse')}
            previewEnabled={previewEnabled}
            previewHandle={previewHandle}
          />
        )}
        {tab === 'vod' && (
          <VodScreen
            session={session}
            level={place.vod ?? { name: 'home' }}
            onLevelChange={(level) => onPlaceChange({ ...place, vod: level })}
            onOpen={onOpenVod}
          />
        )}
        {tab === 'recordings' && <RecordingsScreen session={session} />}

        {tab === 'settings' && showingSources && (
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

        {tab === 'settings' && !showingSources && (
          <SettingsScreen
            session={session}
            previewEnabled={previewEnabled}
            onPreviewEnabledChange={setPreviewEnabled}
            onOpenSources={() => setShowingSources(true)}
            onSignedOut={onSignedOut}
          />
        )}
      </View>

      <View style={[styles.tabBar, { paddingBottom: theme.spacing.sm + insets.bottom }]}>
        {TABS.map((item) => (
          <Pressable
            key={item.id}
            style={styles.tab}
            onPress={() => {
              // Previewet lever i kanallisten; forlader man den, skal
              // forbindelsen slippes med det samme.
              if (item.id !== tab) {
                void previewHandle.current?.release().catch(() => undefined);
              }
              if (item.id !== 'settings') setShowingSources(false);
              setTab(item.id);
            }}
          >
            <Text style={[styles.tabIcon, tab === item.id && styles.tabActive]}>
              {item.icon}
            </Text>
            <Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.surface,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm },
  tabIcon: { color: theme.colors.textMuted, fontSize: 18 },
  tabLabel: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  tabActive: { color: theme.colors.accent },
});
