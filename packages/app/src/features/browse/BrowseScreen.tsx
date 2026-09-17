import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppSession } from '../../session.js';
import { listChannels, setFavorite } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import {
  OTHER_COUNTRY_FLAG,
  hideCountry,
  listCategoriesInCountry,
  listCountryGroups,
  unhideCountry,
} from '../../storage/countries.js';
import type { CategorySummary, CountryGroup } from '../../storage/countries.js';
import { keepInMiddle, useTvListTail } from '../../ui/tvScroll.js';
import { addCategoryToFavorites } from '../../storage/favorites.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { ChannelList } from '../channels/ChannelList.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { cameBySelect } from '../../ui/tvKeys.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  onAuthError: () => void;
  previewEnabled: boolean;
  previewHandle: { current: PreviewHandle | null };
  onPickLogo: (channel: StoredChannel) => void;
  /** Kaldes naar favoritterne har aendret sig, saa favoritfanen kan opdatere. */
  onFavoritesChanged: () => void;
  /** Hvor langt ned i land -> kategori -> kanaler brugeren staar. */
  level: Level;
  onLevelChange: (level: Level) => void;
  /** Tv: pil hoejre fra menuen; foerste raekke faar fokus. */
  focusFirstSignal?: number;
}

/** Soegefeltet maa ikke koere en ny forespoergsel per taste-anslag. */
const SEARCH_DEBOUNCE_MS = 250;

/** Soegning paa tvaers af 22.142 kanaler skal have en oevre graense. */
const SEARCH_LIMIT = 200;

/**
 * Hvor langt man er naaet ned i land -> kategori -> kanaler.
 *
 * Eksporteret og styret udefra, fordi skaermen afmonteres naar afspilleren
 * aabnes. Laa niveauet herinde, landede "tilbage" fra en kanal altid paa
 * landelisten — uanset at man kom fra en kategori tre niveauer nede.
 */
export type Level =
  | { name: 'countries' }
  | { name: 'categories'; country: CountryGroup }
  | { name: 'channels'; country: CountryGroup; category: CategorySummary };

/**
 * Browse i to niveauer med soegning oeverst.
 *
 * Spec sec.5: en vandret raekke designet til en haandfuld kategorier indeholder
 * 285 paa dette panel, og 22.142 kanaler laa i én flad liste. Landegruppering
 * goer maengden navigerbar; soegningen ligger oeverst fordi den i praksis er
 * den hurtigste vej til en kendt kanal.
 */
export function BrowseScreen({
  session,
  onSelect,
  onAuthError,
  previewEnabled,
  previewHandle,
  onPickLogo,
  onFavoritesChanged,
  level,
  onLevelChange,
  focusFirstSignal = 0,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const setLevel = onLevelChange;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [countries, setCountries] = useState<CountryGroup[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const countryList = useRef<FlatList<CountryGroup>>(null);
  const categoryList = useRef<FlatList<CategorySummary>>(null);
  const tail = useTvListTail();
  // Én gang per niveau, ikke ved hver tegning (se ChannelList).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const focusFirstHere = useMemo(() => isTV && cameBySelect(), [level]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      if (query.length > 0) {
        // Soegningen gaar paa tvaers af alt, ogsaa skjulte lande — spec sec.5.
        setChannels(await listChannels(session.db, { search: query, limit: SEARCH_LIMIT }));
        return;
      }
      if (level.name === 'countries') {
        setCountries(await listCountryGroups(session.db));
        return;
      }
      if (level.name === 'categories') {
        setCategories(await listCategoriesInCountry(session.db, level.country.key));
        return;
      }
      setChannels(await listChannels(session.db, { categoryId: level.category.id }));
    } finally {
      setLoading(false);
    }
  }, [session.db, level, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFavorite(channel: StoredChannel): Promise<void> {
    await setFavorite(session.db, channel.id, !channel.isFavorite);
    onFavoritesChanged();
    // Kun stjernen paa raekken skifter. At hente listen forfra viste
    // hjulet, byggede listen op igen og satte den til toppen — og paa tv
    // roeg fokus med op i den foerste raekke ved hvert valg.
    setChannels((current) =>
      current.map((entry) => (entry.id === channel.id ? { ...entry, isFavorite: !channel.isFavorite } : entry)),
    );
  }

  async function addAll(category: CategorySummary): Promise<void> {
    const added = await addCategoryToFavorites(session.db, category.id);
    onFavoritesChanged();
    setNotice({
      text:
        added === 0
          ? 'Der var ingen nye kanaler at tilføje.'
          : `${added} kanaler fra ${category.name} er lagt i favoritter.`,
    });
  }

  /**
   * Skjuler landet med det samme og tilbyder at fortryde.
   *
   * En bekraeftelse foerst ville vaere en `Alert`, og den er ikke
   * implementeret paa react-native-web — flowet ville doe stille der. En
   * fortryd-mulighed bagefter afbryder desuden ikke brugeren.
   */
  function hide(country: CountryGroup): void {
    void (async () => {
      await hideCountry(session.db, country.key);
      await load();
      setNotice({
        text: `${country.name} er skjult. Kanalerne kan stadig findes via søgning.`,
        actionLabel: 'Fortryd',
        onAction: () => {
          void (async () => {
            await unhideCountry(session.db, country.key);
            await load();
          })();
        },
      });
    })();
  }

  const searching = query.length > 0;

  const noticeBar = <Notice notice={notice} onDismiss={() => setNotice(null)} />;

  const searchField = (
    <TextInput
      style={styles.search}
      placeholder="Søg blandt alle kanaler"
      placeholderTextColor={colors.textMuted}
      value={search}
      onChangeText={setSearch}
      autoCorrect={false}
      autoCapitalize="none"
    />
  );

  if (searching || level.name === 'channels') {
    const emptyText = searching
      ? 'Ingen kanaler matcher søgningen.'
      : 'Ingen kanaler i denne kategori.';

    return (
      <View style={styles.container}>
        {searchField}
        {noticeBar}
        {!searching && level.name === 'channels' && (
          <Crumb
            label={`${level.country.flag} ${level.category.name}`}
            onBack={() => setLevel({ name: 'categories', country: level.country })}
          />
        )}
        <ChannelList
          session={session}
          channels={channels}
          loading={loading}
          emptyText={emptyText}
          onSelect={onSelect}
          onToggleFavorite={(channel) => {
            void toggleFavorite(channel);
          }}
          onAuthError={onAuthError}
          previewEnabled={previewEnabled}
          previewHandle={previewHandle}
          onLongPress={onPickLogo}
          // Ikke mens man soeger: aabner man tastaturet med OK paa feltet,
          // taeller det som et "valg", og listen greb saa fokus paa den
          // foerste kanal, saa snart det foerste resultat kom — tastaturet
          // lukkede midt i et ord. Foerst naar man selv trykker pil ned.
          focusFirst={!searching}
          focusFirstSignal={searching ? 0 : focusFirstSignal}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        {searchField}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (level.name === 'categories') {
    return (
      <View style={styles.container}>
        {searchField}
        {noticeBar}
        <Crumb
          label={`${level.country.flag} ${level.country.name}`}
          onBack={() => setLevel({ name: 'countries' })}
        />
        <FlatList
          ref={categoryList}
          data={categories}
          keyExtractor={(item) => item.id}
          contentContainerStyle={tail}
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={
            <Text style={styles.empty}>Ingen kategorier i dette land.</Text>
          }
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              {/* Ogsaa inde i Øvrige: kategorierne der er havnet der er ikke
                  ens, og enkelte af dem *kan* stedfaestes ud fra kanalerne.
                  Kloden staar hvor intet land kunne udledes. */}
              <Text style={styles.categoryFlag}>
                {item.country?.flag ?? OTHER_COUNTRY_FLAG}
              </Text>
              {/* Paa tv faar den foerste raekke fokus naar listen kommer
                  frem: ellers mistede fjernbetjeningen sit fokus ved
                  skiftet og landede i menuen. */}
              <TvPressable
                style={styles.rowMain}
                hasTVPreferredFocus={index === 0 && focusFirstHere}
                onFocus={isTV ? () => keepInMiddle(categoryList.current, index) : undefined}
                onPress={() =>
                  setLevel({ name: 'channels', country: level.country, category: item })
                }
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowCount}>{item.channelCount} kanaler</Text>
              </TvPressable>
              <TvPressable
                style={styles.action}
                hitSlop={8}
                onFocus={isTV ? () => keepInMiddle(categoryList.current, index) : undefined}
                onPress={() => {
                  void addAll(item);
                }}
              >
                <Text style={styles.actionText}>Tilføj alle</Text>
              </TvPressable>
            </View>
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {searchField}
      {noticeBar}
      <FlatList
        ref={countryList}
        data={countries}
        keyExtractor={(item) => item.key}
        contentContainerStyle={tail}
        onScrollToIndexFailed={() => undefined}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Ingen kanaler hentet endnu. Træk ned på favoritskærmen for at hente fra panelet.
          </Text>
        }
        renderItem={({ item, index }) => (
          <TvPressable
            style={styles.row}
            onFocus={isTV ? () => keepInMiddle(countryList.current, index) : undefined}
            onPress={() => setLevel({ name: 'categories', country: item })}
            onLongPress={() => hide(item)}
          >
            <Text style={styles.flag}>{item.flag}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowCount}>
                {item.channelCount} kanaler i {item.categoryCount} kategorier
              </Text>
            </View>
          </TvPressable>
        )}
      />
    </View>
  );
}

function Crumb({ label, onBack }: { label: string; onBack: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={styles.crumb} focusable={!isTV} onPress={onBack}>
      <Text style={styles.crumbText} numberOfLines={1}>
        ‹ {label}
      </Text>
    </TvPressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: theme.radius,
    margin: theme.spacing.md,
    padding: theme.spacing.sm,
    fontSize: 16,
  },
  crumb: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  crumbText: { color: colors.accent, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  flag: { fontSize: 26, marginRight: theme.spacing.md },
  categoryFlag: { fontSize: 20, marginRight: theme.spacing.sm },
  rowTitle: { color: colors.text, fontSize: 16 },
  rowCount: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  action: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  actionText: { color: colors.text, fontSize: 13 },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    lineHeight: 20,
  },
});
