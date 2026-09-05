import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { clearCredentials } from '../../storage/credentials.js';
import {
  clearLastSyncMs,
  getLastSyncMs,
  getMiniPreviewEnabled,
} from '../../storage/settings.js';
import { syncChannels } from '../../sync/syncChannels.js';
import { theme } from '../../ui/theme.js';
import { BrowseScreen } from '../browse/BrowseScreen.js';
import { FavoritesScreen } from '../favorites/FavoritesScreen.js';
import { GuideScreen } from '../guide/GuideScreen.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { SettingsScreen } from '../settings/SettingsScreen.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel, startFrom?: Programme) => void;
  onSignedOut: (notice: string) => void;
}

type Tab = 'favorites' | 'browse' | 'guide' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'favorites', label: 'Favoritter', icon: '★' },
  { id: 'browse', label: 'Kanaler', icon: '☰' },
  { id: 'guide', label: 'Guide', icon: '▦' },
  { id: 'settings', label: 'Indstillinger', icon: '⚙' },
];

/** Kanallisten henter sig selv hoejst en gang i doegnet uden brugerens hjaelp. */
const CHANNEL_SYNC_INTERVAL_MS = 24 * 60 * 60_000;

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
export function HomeScreen({ session, onSelect, onSignedOut }: Props) {
  const [tab, setTab] = useState<Tab>('favorites');
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [favoritesToken, setFavoritesToken] = useState(0);

  // Deles af alle faneblade: kun ét preview maa nogensinde vaere i luften.
  const previewHandle = useRef<PreviewHandle | null>(null);

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
    await Promise.allSettled([clearCredentials(), clearLastSyncMs(session.db)]);
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
      const lastSync = await getLastSyncMs(session.db);
      const ageMs = lastSync === null ? Number.POSITIVE_INFINITY : Date.now() - lastSync;
      if (!force && ageMs < CHANNEL_SYNC_INTERVAL_MS) return;

      try {
        await syncChannels(session.db, session.creds, session.fetchImpl);
      } catch (cause) {
        if (cause instanceof XtreamAuthError) {
          await signOutFromPanel();
          return;
        }
        // Spec sec.9: panelet nede maa ikke toemme skaermen — vi viser cachen.
      }
      setFavoritesToken((value) => value + 1);
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
          />
        )}
        {tab === 'guide' && (
          <GuideScreen
            session={session}
            onPlay={(channel) => open(channel)}
            onRestart={(channel, programme) => open(channel, programme)}
            onAuthError={handleAuthError}
            onBrowse={() => setTab('browse')}
          />
        )}
        {tab === 'settings' && (
          <SettingsScreen
            session={session}
            previewEnabled={previewEnabled}
            onPreviewEnabledChange={setPreviewEnabled}
            onSignedOut={onSignedOut}
          />
        )}
      </View>

      <View style={styles.tabBar}>
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
