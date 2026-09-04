import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { XtreamAuthError } from '@uhf-play/core';
import type { Category } from '@uhf-play/core';
import type { AppSession } from '../../session.js';
import { listCategories, listChannels, setFavorite } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { clearCredentials } from '../../storage/credentials.js';
import { getNowNext } from '../../storage/programmes.js';
import { getLastSyncMs } from '../../storage/settings.js';
import { syncChannels } from '../../sync/syncChannels.js';
import { createHttpChunkSource, syncEpg } from '../../sync/syncEpg.js';
import { theme } from '../../ui/theme.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel) => void;
  /** Kaldes naar panelet har afvist credentials og de er ryddet fra Keychain. */
  onSignedOut: (message: string) => void;
}

const NOW_TITLE_LIMIT = 40;
/** Soegefeltet maa ikke koere en ny forespoergsel per taste-anslag. */
const SEARCH_DEBOUNCE_MS = 250;
/** Kanallisten henter sig selv hoejst en gang i doegnet uden brugerens hjaelp. */
const CHANNEL_SYNC_INTERVAL_MS = 24 * 60 * 60_000;
/** Spec sec.7: EPG fornys hver sjette time — ikke ved hver traek-ned-gestus. */
const EPG_SYNC_INTERVAL_MS = 6 * 60 * 60_000;

const SIGNED_OUT_MESSAGE =
  'Panelet afviste dine adgangsoplysninger. De er slettet fra enheden — log ind igen.';
const PANEL_UNREACHABLE = 'Kunne ikke nå panelet. Viser gemte data.';

export function ChannelListScreen({ session, onSelect, onSignedOut }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [nowTitles, setNowTitles] = useState<Record<string, string>>({});
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Soegningen forsinkes: hvert anslag koster listCategories + listChannels og
  // op til NOW_TITLE_LIMIT sekventielle getNowNext-kald.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Annulleringspolet: kun det nyeste kald maa skrive til state. Uden det kan
  // to overlappende koersler skrive resultater i den forkerte raekkefoelge.
  const runId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = runId.current + 1;
    runId.current = id;
    const stale = (): boolean => runId.current !== id;

    try {
      const [cats, chans] = await Promise.all([
        listCategories(session.db),
        listChannels(session.db, { categoryId, search: query, favouritesOnly }),
      ]);
      if (stale()) return;
      setCategories(cats);
      setChannels(chans);

      // Nu-titler hentes kun for det foerste udsnit: hele kanaludbuddet ville
      // vaere hundredvis af forespoergsler.
      const titles: Record<string, string> = {};
      for (const channel of chans.slice(0, NOW_TITLE_LIMIT)) {
        if (stale()) return;
        if (channel.epgChannelId === null) continue;
        const { now } = await getNowNext(session.db, channel.epgChannelId, new Date());
        if (now) titles[channel.id] = now.title;
      }
      if (stale()) return;
      setNowTitles(titles);
    } finally {
      // Spinneren skal forsvinde ogsaa naar forespoergslen kastede.
      if (!stale()) setLoading(false);
    }
  }, [session.db, categoryId, query, favouritesOnly]);

  useEffect(() => {
    void load();
    return () => {
      // Ugyldiggoer det igangvaerende kald, saa et sent svar ikke overskriver
      // resultatet af den nyeste soegning eller det nyeste filter.
      runId.current += 1;
    };
  }, [load]);

  /**
   * Henter fra panelet og opdaterer listen bagefter.
   *
   * `force` er traek-ned. Uden force springes hele turen over hvis kanallisten
   * er hentet inden for det sidste doegn. EPG-benet er altid alders-styret,
   * ogsaa ved traek-ned: XMLTV-filen er 10-50 MB, og spec sec.7 beder om den
   * hver sjette time, ikke ved hver gestus.
   */
  const syncFromPanel = useCallback(
    async (force: boolean): Promise<void> => {
      const lastSync = await getLastSyncMs(session.db);
      const ageMs =
        lastSync === null ? Number.POSITIVE_INFINITY : Date.now() - lastSync;
      if (!force && ageMs < CHANNEL_SYNC_INTERVAL_MS) return;

      try {
        await syncChannels(session.db, session.creds, session.fetchImpl);
        if (ageMs >= EPG_SYNC_INTERVAL_MS) {
          await syncEpg(session.db, session.creds, createHttpChunkSource());
        }
      } catch (cause) {
        if (cause instanceof XtreamAuthError) {
          // Spec sec.9: afviste credentials ryddes fra Keychain, og brugeren
          // sendes til onboarding med en forklarende besked. Et skiftet
          // panel-kodeord maa ikke kunne laase installationen fast.
          await clearCredentials();
          onSignedOut(SIGNED_OUT_MESSAGE);
          return;
        }
        // Spec sec.9: panelet nede maa ikke tomme skaermen — vi viser cachen.
        setNotice(PANEL_UNREACHABLE);
      }
      await load();
    },
    [session, onSignedOut, load],
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

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setNotice(null);
    try {
      await syncFromPanel(true);
    } finally {
      // refreshing skal ryddes uanset hvilken gren der returnerede eller kastede.
      setRefreshing(false);
    }
  }

  async function toggleFavorite(channel: StoredChannel): Promise<void> {
    await setFavorite(session.db, channel.id, !channel.isFavorite);
    await load();
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const chips = [
    { id: '__all__', name: 'Alle' },
    { id: '__fav__', name: 'Favoritter' },
    ...categories,
  ];

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Søg kanal"
        placeholderTextColor={theme.colors.textMuted}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
      />

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        data={chips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const active =
            (item.id === '__all__' && categoryId === undefined && !favouritesOnly) ||
            (item.id === '__fav__' && favouritesOnly) ||
            item.id === categoryId;
          return (
            <Pressable
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                if (item.id === '__all__') {
                  setCategoryId(undefined);
                  setFavouritesOnly(false);
                } else if (item.id === '__fav__') {
                  setCategoryId(undefined);
                  setFavouritesOnly(true);
                } else {
                  setCategoryId(item.id);
                  setFavouritesOnly(false);
                }
              }}
            >
              <Text style={styles.chipText}>{item.name}</Text>
            </Pressable>
          );
        }}
      />

      {notice !== null && <Text style={styles.notice}>{notice}</Text>}

      <FlatList
        data={channels}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refresh();
            }}
            tintColor={theme.colors.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Ingen kanaler. Træk ned for at hente fra panelet.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelect(item)}>
            {item.logoUrl !== null ? (
              <Image source={{ uri: item.logoUrl }} style={styles.logo} />
            ) : (
              <View style={styles.logo} />
            )}
            <View style={styles.rowText}>
              <Text style={styles.channelName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.nowTitle} numberOfLines={1}>
                {nowTitles[item.id] ?? 'Ingen programdata'}
              </Text>
            </View>
            <Pressable
              hitSlop={12}
              onPress={() => {
                void toggleFavorite(item);
              }}
            >
              <Text style={item.isFavorite ? styles.starOn : styles.starOff}>★</Text>
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  search: {
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    borderRadius: theme.radius,
    margin: theme.spacing.md,
    padding: theme.spacing.sm,
    fontSize: 16,
  },
  chipRow: { flexGrow: 0, paddingHorizontal: theme.spacing.sm },
  chip: {
    backgroundColor: theme.colors.surface,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    marginHorizontal: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  chipActive: { backgroundColor: theme.colors.accent },
  chipText: { color: theme.colors.text, fontSize: 13 },
  notice: {
    color: theme.colors.textMuted,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: { width: 44, height: 44, borderRadius: 6, backgroundColor: theme.colors.surface },
  rowText: { flex: 1, marginLeft: theme.spacing.md },
  channelName: { color: theme.colors.text, fontSize: 16 },
  nowTitle: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  starOn: { color: theme.colors.accent, fontSize: 22 },
  starOff: { color: theme.colors.border, fontSize: 22 },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
});
