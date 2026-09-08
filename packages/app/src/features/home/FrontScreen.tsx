import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { getChannel, listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import { getHomeProviders, getLastChannelId, getTmdbApiKey } from '../../storage/settings.js';
import type { HomeProvider } from '../../storage/settings.js';
import { listVodItems } from '../../storage/vod.js';
import type { StoredVodItem } from '../../storage/vod.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { justWatchLink, providerShelf, serviceSearchUrl, trendingTitles } from '../../sync/tmdbHome.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { Poster } from '../vod/VodScreen.js';
import { findInPanel } from './panelMatch.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  onOpenVod: (item: StoredVodItem) => void;
  onOpenSettings: () => void;
  onBrowse: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Aendres naar favoritter eller logoer er aendret, saa raekkerne laeses igen. */
  reloadToken: number;
}

/** Hvor mange favoritter der vises i raekken. Resten er paa deres egen fane. */
const FAVOURITES_LIMIT = 12;
const IN_PROGRESS_LIMIT = 10;
const NEWEST_LIMIT = 15;
const POSTER_WIDTH = 104;

/**
 * TMDB-hylderne huskes i appens levetid, saa et skift af fane ikke koster
 * et opslag per tjeneste hver gang. Seks timer: det der er "populaert paa
 * Netflix" skifter ikke i loebet af en aften.
 */
const SHELF_TTL_MS = 6 * 60 * 60_000;
const shelfCache = new Map<string, { at: number; titles: TmdbTitle[] }>();

async function cachedShelf(key: string, load: () => Promise<TmdbTitle[]>): Promise<TmdbTitle[]> {
  const known = shelfCache.get(key);
  if (known !== undefined && Date.now() - known.at < SHELF_TTL_MS) return known.titles;
  const titles = await load();
  if (titles.length > 0) shelfCache.set(key, { at: Date.now(), titles });
  return titles;
}

interface FavouriteNow {
  channel: StoredChannel;
  now: Programme | null;
}

interface Sheet {
  title: TmdbTitle;
  /** Tjenesten hylden hoerer til, eller null for "populaert lige nu". */
  provider: HomeProvider | null;
  /** undefined mens der soeges i panelet. */
  inPanel: StoredVodItem | null | undefined;
  message: string | null;
}

/**
 * Forsiden, som paa en tv-boks.
 *
 * Det man var i gang med foerst, saa favoritkanalerne med det de sender nu,
 * saa en hylde per streamingtjeneste man har valgt, og ugens mest sete.
 * Hylderne kommer fra TMDB; trykker man paa en titel, spilles den fra
 * panelet naar det har den, ellers aabnes tjenestens egen app.
 */
export function FrontScreen({
  session,
  onSelect,
  onOpenVod,
  onOpenSettings,
  onBrowse,
  refreshing,
  onRefresh,
  reloadToken,
}: Props) {
  const [lastChannel, setLastChannel] = useState<StoredChannel | null>(null);
  const [favourites, setFavourites] = useState<FavouriteNow[] | null>(null);
  const [inProgress, setInProgress] = useState<StoredVodItem[]>([]);
  const [newest, setNewest] = useState<StoredVodItem[]>([]);
  const [tmdbKey, setTmdbKey] = useState<string | null>(null);
  const [providers, setProviders] = useState<HomeProvider[]>([]);
  const [shelves, setShelves] = useState<Map<number, TmdbTitle[]>>(new Map());
  const [trending, setTrending] = useState<TmdbTitle[]>([]);
  const [loadingShelves, setLoadingShelves] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const loadLocal = useCallback(async (): Promise<void> => {
    const now = new Date();
    const [lastId, favouriteChannels, progress, added, key, chosen] = await Promise.all([
      getLastChannelId(session.db),
      listChannels(session.db, { favouritesOnly: true, limit: FAVOURITES_LIMIT }),
      listVodItems(session.db, { inProgressOnly: true, limit: IN_PROGRESS_LIMIT }),
      listVodItems(session.db, { newestFirst: true, limit: NEWEST_LIMIT }),
      getTmdbApiKey(session.db),
      getHomeProviders(session.db),
    ]);
    setLastChannel(lastId === null ? null : await getChannel(session.db, lastId));
    setFavourites(
      await Promise.all(
        favouriteChannels.map(async (channel) => ({
          channel,
          now:
            channel.epgChannelId === null
              ? null
              : (await getNowNext(session.db, channel.epgChannelId, now).catch(() => ({ now: null }))).now,
        })),
      ),
    );
    setInProgress(progress);
    setNewest(added);
    setTmdbKey(key);
    setProviders(chosen);
  }, [session.db]);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal, reloadToken, refreshing]);

  // Hylderne fra TMDB, naar der er en noegle. Hver tjeneste for sig, saa
  // den foerste staar der mens de naeste hentes.
  useEffect(() => {
    if (tmdbKey === null) {
      setShelves(new Map());
      setTrending([]);
      return;
    }
    let cancelled = false;
    setLoadingShelves(true);
    void (async () => {
      for (const provider of providers) {
        const titles = await cachedShelf(`provider:${provider.id}:${provider.region}`, () =>
          providerShelf(tmdbFetch, tmdbKey, provider.id, undefined, provider.region),
        );
        if (cancelled) return;
        setShelves((current) => new Map(current).set(provider.id, titles));
      }
      const top = await cachedShelf('trending', () => trendingTitles(tmdbFetch, tmdbKey));
      if (cancelled) return;
      setTrending(top);
      setLoadingShelves(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tmdbKey, providers]);

  function openTitle(title: TmdbTitle, provider: HomeProvider | null): void {
    setSheet({ title, provider, inPanel: undefined, message: null });
    void findInPanel(session.db, title).then((found) => {
      setSheet((current) => (current !== null && current.title.id === title.id ? { ...current, inPanel: found } : current));
    });
  }

  async function openExternally(current: Sheet): Promise<void> {
    const provider = current.provider;
    let url = provider === null ? null : serviceSearchUrl(provider.name, current.title.title);
    if (url === null && tmdbKey !== null) url = await justWatchLink(tmdbFetch, tmdbKey, current.title, provider?.region);
    if (url === null) {
      const q = encodeURIComponent(`${current.title.title} ${provider?.name ?? 'streaming'}`);
      url = `https://www.google.com/search?q=${q}`;
    }
    try {
      await Linking.openURL(url);
      setSheet(null);
    } catch {
      setSheet((value) => (value === null ? null : { ...value, message: 'Kunne ikke åbne tjenesten på denne enhed.' }));
    }
  }

  const favouriteChannels = (favourites ?? []).map((entry) => entry.channel);
  const hasContinue = lastChannel !== null || inProgress.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
      >
        {hasContinue && (
          <Section title="Se videre">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {lastChannel !== null && (
                <ChannelCard
                  channel={lastChannel}
                  now={null}
                  wide
                  onPress={() => onSelect(lastChannel, favouriteChannels)}
                />
              )}
              {inProgress.map((item) => (
                <Poster key={item.key} item={item} width={POSTER_WIDTH} onOpen={onOpenVod} />
              ))}
            </ScrollView>
          </Section>
        )}

        <Section title="Dine kanaler nu">
          {favourites === null ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
          ) : favourites.length === 0 ? (
            <Pressable style={styles.card} onPress={onBrowse}>
              <Text style={styles.cardText}>Ingen favoritter endnu. Find dine kanaler, og tryk på stjernen.</Text>
              <Text style={styles.cardAction}>Kanaler ›</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {favourites.map((entry) => (
                <ChannelCard
                  key={entry.channel.id}
                  channel={entry.channel}
                  now={entry.now}
                  onPress={() => onSelect(entry.channel, favouriteChannels)}
                />
              ))}
            </ScrollView>
          )}
        </Section>

        {tmdbKey === null ? (
          <Pressable style={styles.card} onPress={onOpenSettings}>
            <Text style={styles.cardTitle}>Se hvad der er på Netflix, Viaplay og de andre</Text>
            <Text style={styles.cardText}>
              Med en TMDB-nøgle viser forsiden en hylde for hver tjeneste du vælger, og ugens mest
              sete. Findes en titel i din egen pakke, spilles den herfra.
            </Text>
            <Text style={styles.cardAction}>Indstillinger ›</Text>
          </Pressable>
        ) : providers.length === 0 ? (
          <Pressable style={styles.card} onPress={onOpenSettings}>
            <Text style={styles.cardTitle}>Vælg dine streamingtjenester</Text>
            <Text style={styles.cardText}>Så får hver af dem en hylde her på forsiden.</Text>
            <Text style={styles.cardAction}>Indstillinger ›</Text>
          </Pressable>
        ) : null}

        {providers.map((provider) => {
          const titles = shelves.get(provider.id);
          return (
            <Section key={provider.id} title={provider.name} logoUrl={provider.logoUrl}>
              {titles === undefined ? (
                <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
              ) : titles.length === 0 ? (
                <Text style={styles.empty}>TMDB gav ingen titler for tjenesten lige nu.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {titles.map((title) => (
                    <TitleCard key={`${title.kind}:${title.id}`} title={title} onPress={() => openTitle(title, provider)} />
                  ))}
                </ScrollView>
              )}
            </Section>
          );
        })}

        {tmdbKey !== null && (trending.length > 0 || loadingShelves) && (
          <Section title="Populært lige nu">
            {trending.length === 0 ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {trending.map((title) => (
                  <TitleCard key={`${title.kind}:${title.id}`} title={title} onPress={() => openTitle(title, null)} />
                ))}
              </ScrollView>
            )}
          </Section>
        )}

        {newest.length > 0 && (
          <Section title="Nyeste i din pakke">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {newest.map((item) => (
                <Poster key={item.key} item={item} width={POSTER_WIDTH} onOpen={onOpenVod} />
              ))}
            </ScrollView>
          </Section>
        )}
      </ScrollView>

      {sheet !== null && (
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              {sheet.title.posterUrl !== null && (
                <Image source={{ uri: sheet.title.posterUrl }} style={styles.sheetPoster} resizeMode="cover" />
              )}
              <View style={styles.sheetText}>
                <Text style={styles.sheetTitle} numberOfLines={2}>
                  {sheet.title.title}
                </Text>
                <Text style={styles.sheetMeta}>
                  {sheet.title.kind === 'series' ? 'Serie' : 'Film'}
                  {sheet.title.year !== null ? ` · ${sheet.title.year}` : ''}
                  {sheet.title.rating !== null ? ` · ★ ${sheet.title.rating.toFixed(1)}` : ''}
                </Text>
                {sheet.title.overview.length > 0 && (
                  <Text style={styles.sheetOverview} numberOfLines={4}>
                    {sheet.title.overview}
                  </Text>
                )}
              </View>
            </View>
            {sheet.inPanel === undefined ? (
              <Text style={styles.sheetHint}>Søger i din pakke …</Text>
            ) : sheet.inPanel === null ? (
              <Text style={styles.sheetHint}>Findes ikke i din pakke.</Text>
            ) : (
              <Pressable
                style={styles.button}
                onPress={() => {
                  const item = sheet.inPanel;
                  setSheet(null);
                  if (item !== null && item !== undefined) onOpenVod(item);
                }}
              >
                <Text style={styles.buttonText}>Se i din pakke</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={() => {
                void openExternally(sheet);
              }}
            >
              <Text style={styles.buttonText}>
                {sheet.provider === null ? 'Se hvor den kan ses' : `Åbn i ${sheet.provider.name}`}
              </Text>
            </Pressable>
            {sheet.message !== null && <Text style={styles.sheetHint}>{sheet.message}</Text>}
            <Pressable style={styles.close} onPress={() => setSheet(null)} hitSlop={8}>
              <Text style={styles.closeText}>Luk</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function Section({ title, logoUrl, children }: { title: string; logoUrl?: string | null; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        {logoUrl !== undefined && logoUrl !== null && (
          <Image source={{ uri: logoUrl }} style={styles.sectionLogo} resizeMode="contain" />
        )}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ChannelCard({
  channel,
  now,
  wide,
  onPress,
}: {
  channel: StoredChannel;
  now: Programme | null;
  wide?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.channel, wide === true && styles.channelWide]} onPress={onPress}>
      <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={40} />
      <Text style={styles.channelName} numberOfLines={1}>
        {channel.name}
      </Text>
      <Text style={styles.channelNow} numberOfLines={2}>
        {now === null ? (wide === true ? 'Sidst set' : ' ') : now.title}
      </Text>
    </Pressable>
  );
}

function TitleCard({ title, onPress }: { title: TmdbTitle; onPress: () => void }) {
  return (
    <Pressable style={styles.title} onPress={onPress}>
      <View style={styles.titleFrame}>
        {title.posterUrl !== null ? (
          <Image source={{ uri: title.posterUrl }} style={styles.titleImage} resizeMode="cover" />
        ) : (
          <View style={styles.titleFallback}>
            <Text style={styles.titleFallbackText} numberOfLines={4}>
              {title.title}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.titleName} numberOfLines={1}>
        {title.title}
      </Text>
      <Text style={styles.titleMeta}>
        {title.year ?? ''}
        {title.rating !== null ? `  ★ ${title.rating.toFixed(1)}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingBottom: theme.spacing.lg },
  section: { marginTop: theme.spacing.md },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  sectionLogo: { width: 24, height: 24, borderRadius: 6 },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  row: { paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm },
  spinner: { marginVertical: theme.spacing.md },
  empty: { color: theme.colors.textMuted, fontSize: 13, paddingHorizontal: theme.spacing.md },
  card: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.xs,
  },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  cardText: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  cardAction: { color: theme.colors.accent, fontSize: 14, fontWeight: '600', marginTop: theme.spacing.xs },
  channel: {
    width: 132,
    padding: theme.spacing.sm,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
    gap: 4,
  },
  channelWide: { width: 160 },
  channelName: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  channelNow: { color: theme.colors.textMuted, fontSize: 12, minHeight: 32 },
  title: { width: POSTER_WIDTH },
  titleFrame: {
    width: POSTER_WIDTH,
    height: POSTER_WIDTH * 1.5,
    borderRadius: theme.radius,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  titleImage: { width: '100%', height: '100%' },
  titleFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.sm },
  titleFallbackText: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  titleName: { color: theme.colors.text, fontSize: 12, marginTop: 4 },
  titleMeta: { color: theme.colors.textMuted, fontSize: 11 },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: '#00000099',
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius * 2,
    borderTopRightRadius: theme.radius * 2,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  sheetHead: { flexDirection: 'row', gap: theme.spacing.md },
  sheetPoster: { width: 72, height: 108, borderRadius: theme.radius },
  sheetText: { flex: 1 },
  sheetTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  sheetMeta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  sheetOverview: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: theme.spacing.xs },
  sheetHint: { color: theme.colors.textMuted, fontSize: 13 },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    padding: theme.spacing.sm + 2,
    alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: theme.colors.background },
  buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  close: { alignItems: 'center', padding: theme.spacing.sm },
  closeText: { color: theme.colors.textMuted, fontSize: 15 },
});
