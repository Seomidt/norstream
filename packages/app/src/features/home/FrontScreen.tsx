import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { getChannel, listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import { ensureEpg } from '../../sync/epgCache.js';
import { describeError } from '../../sync/syncVod.js';
import { getHomeProviders, getLastChannelId, getTmdbApiKey } from '../../storage/settings.js';
import type { HomeProvider } from '../../storage/settings.js';
import { listVodItems } from '../../storage/vod.js';
import type { StoredVodItem } from '../../storage/vod.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { justWatchLink, providerShelf, serviceSearchUrl, trendingTitles } from '../../sync/tmdbHome.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
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
/** Plakatbredden i forsidens raekker. Mindre paa tv: 104 punkter er 208 pixel paa en 1080p-skaerm, og raekken tog en tredjedel af hoejden. */
const POSTER_WIDTH = isTV ? 96 : 104;

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

type Row =
  | { kind: 'continue' }
  | { kind: 'favourites' }
  | { kind: 'card'; card: 'key' | 'providers' }
  | { kind: 'provider'; provider: HomeProvider }
  | { kind: 'trending' }
  | { kind: 'newest' };

/** Bredden paa et kanalkort i raekken, til at regne placeringer ud uden at maale. */
const CHANNEL_WIDTH = 132;

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
  /** Forsiden staar oeverst hver gang man kommer til den; den bliver ellers staaende hvor man forlod den. */
  const listRef = useRef<FlatList<Row>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [reloadToken]);
  const [lastNow, setLastNow] = useState<Programme | null>(null);
  const [favourites, setFavourites] = useState<FavouriteNow[] | null>(null);
  const [inProgress, setInProgress] = useState<StoredVodItem[]>([]);
  const [newest, setNewest] = useState<StoredVodItem[]>([]);
  const [tmdbKey, setTmdbKey] = useState<string | null>(null);
  const [providers, setProviders] = useState<HomeProvider[]>([]);
  const [shelves, setShelves] = useState<Map<number, TmdbTitle[]>>(new Map());
  const [trending, setTrending] = useState<TmdbTitle[]>([]);
  const [loadingShelves, setLoadingShelves] = useState(false);
  /** Sidste fejl fra TMDB, uden adresser, til raekken. */
  const [shelfError, setShelfError] = useState<string | null>(null);
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
    const last = lastId === null ? null : await getChannel(session.db, lastId);
    // Opslaget sker paa kanalens eget id, som i kanallisten og guiden: det
    // er det programtabellen er skrevet under. Foer blev der slaaet op paa
    // epg_channel_id, som 87 % af kanalerne ikke har, saa kortene stod tomme.
    const nowFor = async (channel: StoredChannel): Promise<Programme | null> =>
      (await getNowNext(session.db, channel.id, now).catch(() => ({ now: null }))).now;
    const withNow = async (channels: StoredChannel[]) =>
      Promise.all(channels.map(async (channel) => ({ channel, now: await nowFor(channel) })));
    setLastChannel(last);
    setLastNow(last === null ? null : await nowFor(last));
    setFavourites(await withNow(favouriteChannels));

    // Bagefter: det panelet har, for de kanaler cachen ikke daekker. Cachen
    // foerst, saa kortene ikke staar tomme mens panelet svarer.
    const wanted = (last === null ? [] : [last]).concat(favouriteChannels);
    void (async () => {
      try {
        const result = await ensureEpg(session.db, session.credsBySource, session.fetchImpl, wanted.map((c) => c.id));
        if (result.fetched === 0) return;
      } catch {
        return;
      }
      setFavourites(await withNow(favouriteChannels));
      if (last !== null) setLastNow(await nowFor(last));
    })();
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
      // Fejler TMDB (forkert noegle, intet net), skal det staa i raekken
      // og ikke som en evig spinner: paa tv stod Netflix og snurrede uden
      // at sige hvorfor.
      for (const provider of providers) {
        try {
          const titles = await cachedShelf(`provider:${provider.id}:${provider.region}`, () =>
            providerShelf(tmdbFetch, tmdbKey, provider.id, undefined, provider.region),
          );
          if (cancelled) return;
          setShelves((current) => new Map(current).set(provider.id, titles));
        } catch (cause) {
          if (cancelled) return;
          setShelfError(describeError(cause));
          setShelves((current) => new Map(current).set(provider.id, []));
        }
      }
      try {
        const top = await cachedShelf('trending', () => trendingTitles(tmdbFetch, tmdbKey));
        if (cancelled) return;
        setTrending(top);
      } catch (cause) {
        if (cancelled) return;
        setShelfError(describeError(cause));
      }
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

  /**
   * Siden er en lodret liste af hylder, ikke én lang rulle: kun de hylder
   * der er paa skaermen (og en enkelt paa hver side) er tegnet. Med ti
   * tjenester a tyve plakater var alle 200 billeder ellers i live paa én
   * gang, og rulningen hakkede.
   */
  const rows: Row[] = [];
  if (hasContinue) rows.push({ kind: 'continue' });
  rows.push({ kind: 'favourites' });
  // Kortet om noeglen kun paa telefonen, og kortet "vaelg tjenester" slet
  // ikke: paa tv stod de som fremmede kasser midt paa forsiden, og valget
  // ligger under Indstillinger, hvor man alligevel skal hen.
  if (tmdbKey === null && !isTV) rows.push({ kind: 'card', card: 'key' });
  for (const provider of providers) rows.push({ kind: 'provider', provider });
  if (tmdbKey !== null && (trending.length > 0 || loadingShelves)) rows.push({ kind: 'trending' });
  if (newest.length > 0) rows.push({ kind: 'newest' });

  const renderRow = ({ item }: { item: Row }): React.ReactElement | null => {
    switch (item.kind) {
      case 'continue':
        return (
          <Section title="Se videre">
            <Shelf
              data={[...(lastChannel !== null ? [{ key: `channel:${lastChannel.id}`, channel: lastChannel }] : []), ...inProgress.map((vod) => ({ key: vod.key, vod }))]}
              width={POSTER_WIDTH}
              renderItem={(entry) =>
                'channel' in entry ? (
                  <ChannelCard channel={entry.channel} now={lastNow} wide onPress={() => onSelect(entry.channel, favouriteChannels)} />
                ) : (
                  <Poster item={entry.vod} width={POSTER_WIDTH} onOpen={onOpenVod} />
                )
              }
            />
          </Section>
        );
      case 'favourites':
        return (
          <Section title="Dine kanaler nu">
            {favourites === null ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : favourites.length === 0 ? (
              <TvPressable style={styles.card} onPress={onBrowse}>
                <Text style={styles.cardText}>Ingen favoritter endnu. Find dine kanaler, og tryk på stjernen.</Text>
                <Text style={styles.cardAction}>Kanaler ›</Text>
              </TvPressable>
            ) : (
              <Shelf
                data={favourites.map((entry) => ({ key: entry.channel.id, entry }))}
                width={CHANNEL_WIDTH}
                renderItem={({ entry }) => (
                  <ChannelCard channel={entry.channel} now={entry.now} onPress={() => onSelect(entry.channel, favouriteChannels)} />
                )}
              />
            )}
          </Section>
        );
      case 'card':
        return item.card === 'key' ? (
          <TvPressable style={styles.card} onPress={onOpenSettings}>
            <Text style={styles.cardTitle}>Se hvad der er på Netflix, Viaplay og de andre</Text>
            <Text style={styles.cardText}>
              Med en TMDB-nøgle viser forsiden en hylde for hver tjeneste du vælger, og ugens mest
              sete. Findes en titel i din egen pakke, spilles den herfra.
            </Text>
            <Text style={styles.cardAction}>Indstillinger ›</Text>
          </TvPressable>
        ) : (
          <TvPressable style={styles.card} onPress={onOpenSettings}>
            <Text style={styles.cardTitle}>Vælg dine streamingtjenester</Text>
            <Text style={styles.cardText}>Så får hver af dem en hylde her på forsiden.</Text>
            <Text style={styles.cardAction}>Indstillinger ›</Text>
          </TvPressable>
        );
      case 'provider': {
        const provider = item.provider;
        const titles = shelves.get(provider.id);
        return (
          <Section title={provider.name} logoUrl={provider.logoUrl}>
            {titles === undefined ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : titles.length === 0 ? (
              <Text style={styles.empty}>
                {shelfError === null ? 'TMDB gav ingen titler for tjenesten lige nu.' : `TMDB svarede ikke: ${shelfError}`}
              </Text>
            ) : (
              <Shelf
                data={titles.map((title) => ({ key: `${title.kind}:${title.id}`, title }))}
                width={POSTER_WIDTH}
                renderItem={({ title }) => <TitleCard title={title} onPress={() => openTitle(title, provider)} />}
              />
            )}
          </Section>
        );
      }
      case 'trending':
        return (
          <Section title="Populært lige nu">
            {trending.length === 0 ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : (
              <Shelf
                data={trending.map((title) => ({ key: `${title.kind}:${title.id}`, title }))}
                width={POSTER_WIDTH}
                renderItem={({ title }) => <TitleCard title={title} onPress={() => openTitle(title, null)} />}
              />
            )}
          </Section>
        );
      case 'newest':
        return (
          <Section title="Nyeste i din pakke">
            <Shelf
              data={newest.map((vod) => ({ key: vod.key, vod }))}
              width={POSTER_WIDTH}
              renderItem={({ vod }) => <Poster item={vod} width={POSTER_WIDTH} onOpen={onOpenVod} />}
            />
          </Section>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => (row.kind === 'provider' ? `provider:${row.provider.id}` : row.kind)}
        renderItem={renderRow}
        contentContainerStyle={styles.content}
        windowSize={3}
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
      />

      {sheet !== null && (
        <View style={styles.sheetBackdrop}>
          {/* Bagtaeppet maa ikke faa fokus paa tv: det var det foerste
              trykpunkt, saa OK lukkede bladet i stedet for at vaelge. */}
          <TvPressable style={StyleSheet.absoluteFill} focusable={!isTV} onPress={() => setSheet(null)} />
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
              <TvPressable
                style={styles.button}
                hasTVPreferredFocus={isTV}
                onPress={() => {
                  const item = sheet.inPanel;
                  setSheet(null);
                  if (item !== null && item !== undefined) onOpenVod(item);
                }}
              >
                <Text style={styles.buttonText}>Se i din pakke</Text>
              </TvPressable>
            )}
            <TvPressable
              style={[styles.button, styles.buttonSecondary]}
              hasTVPreferredFocus={isTV && sheet.inPanel === null}
              onPress={() => {
                void openExternally(sheet);
              }}
            >
              <Text style={styles.buttonText}>
                {sheet.provider === null ? 'Se hvor den kan ses' : `Åbn i ${sheet.provider.name}`}
              </Text>
            </TvPressable>
            {sheet.message !== null && <Text style={styles.sheetHint}>{sheet.message}</Text>}
            <TvPressable style={styles.close} onPress={() => setSheet(null)} hitSlop={8}>
              <Text style={styles.closeText}>Luk</Text>
            </TvPressable>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * En vandret hylde der kun tegner det der kan ses. Fast bredde per kort,
 * saa listen kender alle placeringer paa forhaand og ikke skal maale.
 */
function Shelf<T extends { key: string }>({
  data,
  width,
  renderItem,
}: {
  data: T[];
  width: number;
  renderItem: (item: T) => React.ReactElement;
}) {
  const stride = width + theme.spacing.sm;
  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={(item) => item.key}
      renderItem={({ item }) => renderItem(item)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={3}
      removeClippedSubviews
      getItemLayout={(_, index) => ({ length: stride, offset: stride * index, index })}
    />
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

const ChannelCard = memo(function ChannelCard({
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
    <TvPressable style={[styles.channel, wide === true && styles.channelWide]} onPress={onPress}>
      <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={40} />
      <Text style={styles.channelName} numberOfLines={1}>
        {channel.name}
      </Text>
      <Text style={styles.channelNow} numberOfLines={2}>
        {now === null ? (wide === true ? 'Sidst set' : ' ') : now.title}
      </Text>
    </TvPressable>
  );
});

const TitleCard = memo(function TitleCard({ title, onPress }: { title: TmdbTitle; onPress: () => void }) {
  return (
    <TvPressable style={styles.title} onPress={onPress}>
      <View style={styles.titleFrame}>
        {title.thumbUrl !== null ? (
          <Image source={{ uri: title.thumbUrl }} style={styles.titleImage} resizeMode="cover" />
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
    </TvPressable>
  );
});

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
