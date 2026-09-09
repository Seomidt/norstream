import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import {
  RADIO_TTL_MS,
  countRadioStationsByCountry,
  listRadioFavoriteIds,
  listRadioFavorites,
  listRadioStations,
  radioStationsFetchedMs,
  rememberRadioStation,
  saveRadioStations,
  setRadioFavorite,
} from '../../storage/radio.js';
import { getSetting, setSetting } from '../../storage/settings.js';
import { fetchRadioCountries, fetchRadioStations, radioFetch, radioLogoUrls, searchRadioStations, sortCountries, toRadioChannel } from '../../sync/radioBrowser.js';
import type { RadioCountry, RadioStation } from '../../sync/radioBrowser.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { RememberedList } from '../../ui/RememberedList.js';
import { theme } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';

interface Props {
  session: AppSession;
  /**
   * Landet der er aabnet, eller null for landelisten. Ligger hos
   * foraelderen (og i sidste ende i App.tsx), fordi hele Hjem afmonteres
   * naar afspilleren aabnes: uden det landede man paa landelisten hver
   * gang man kom tilbage fra en station.
   */
  country: RadioCountry | null;
  onCountryChange: (country: RadioCountry | null) => void;
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  /** Luft i bunden af listerne, til en bjaelke der ligger oven paa dem. */
  contentBottom?: number;
  /** Taelles op naar listen skal tilbage til sin gemte plads (afspilleren lukkede). */
  restoreSignal?: number;
  /** Hold fingeren paa en station: vaelg dens logo selv. */
  onPickLogo?: (channel: StoredChannel) => void;
  /** Udfyldes med det tilbage-knappen skal goere her. Falsk = intet at gaa op i. */
  backRef: { current: () => boolean };
}

const SEARCH_DEBOUNCE_MS = 350;
/** Landelisten gemmes som JSON i indstillingerne og hentes igen efter en uge. */
const COUNTRIES_KEY = 'radio_countries';
/** Fast hoejde paa en stationsraekke: logo paa 44 med luft. Saa kan listen rulle praecist tilbage. */
const STATION_ROW_HEIGHT = 64;
const stationLayout = (_: unknown, index: number) => ({ length: STATION_ROW_HEIGHT, offset: STATION_ROW_HEIGHT * index, index });
const COUNTRIES_AT_KEY = 'radio_countries_ms';

/**
 * Internetradio: alle verdens stationer fra Radio Browser, delt op i lande
 * med flag, Norden foerst. Favoritterne staar oeverst som deres egen
 * gruppe, og soegefeltet soeger paa tvaers af alle lande.
 */
export function InternetRadio({
  session,
  country,
  onCountryChange,
  onSelect,
  onPickLogo,
  backRef,
  contentBottom = 0,
  restoreSignal = 0,
}: Props) {
  const listPadding = { paddingBottom: contentBottom };
  /** Antal per hentet land efter sammenlaegning; registrets tal for de andre. */
  const [localCounts, setLocalCounts] = useState<Map<string, number>>(() => new Map());
  /** Forsiden: landene, eller ens egne stationer. Aabner altid paa landene. */
  const [tab, setTab] = useState<'countries' | 'mine'>('countries');
  const [countries, setCountries] = useState<RadioCountry[] | null>(null);
  const [stations, setStations] = useState<RadioStation[] | null>(null);
  const [favourites, setFavourites] = useState<RadioStation[]>([]);
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RadioStation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  backRef.current = (): boolean => {
    if (query.length > 0) {
      setSearch('');
      setQuery('');
      return true;
    }
    if (country !== null) {
      onCountryChange(null);
      setStations(null);
      return true;
    }
    if (tab === 'mine') {
      setTab('countries');
      return true;
    }
    return false;
  };

  const loadFavourites = useCallback(async (): Promise<void> => {
    const [list, ids, counts] = await Promise.all([
      listRadioFavorites(session.db),
      listRadioFavoriteIds(session.db),
      countRadioStationsByCountry(session.db),
    ]);
    setFavourites(list);
    setFavouriteIds(ids);
    setLocalCounts(counts);
  }, [session.db]);

  // Landene: fra indstillingerne naar de er friske, ellers fra registret.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, storedAt] = await Promise.all([getSetting(session.db, COUNTRIES_KEY), getSetting(session.db, COUNTRIES_AT_KEY)]);
      const fresh = storedAt !== null && Date.now() - Number(storedAt) < RADIO_TTL_MS;
      if (stored !== null && fresh) {
        try {
          const parsed = JSON.parse(stored) as RadioCountry[];
          if (!cancelled && Array.isArray(parsed) && parsed.length > 0) {
            setCountries(sortCountries(parsed));
            return;
          }
        } catch {
          // Ugyldigt; hentes igen.
        }
      }
      const fetched = await fetchRadioCountries(radioFetch);
      if (cancelled) return;
      if (fetched.length === 0) {
        setError('Kunne ikke hente landene fra Radio Browser. Prøv igen om lidt.');
        // Det gamle er bedre end ingenting.
        if (stored !== null) {
          try {
            setCountries(sortCountries(JSON.parse(stored) as RadioCountry[]));
          } catch {
            setCountries([]);
          }
        } else setCountries([]);
        return;
      }
      setCountries(fetched);
      await setSetting(session.db, COUNTRIES_KEY, JSON.stringify(fetched));
      await setSetting(session.db, COUNTRIES_AT_KEY, String(Date.now()));
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db]);

  useEffect(() => {
    void loadFavourites();
  }, [loadFavourites]);

  // Landets stationer: fra databasen naar de er friske, ellers fra registret.
  useEffect(() => {
    if (country === null) return;
    let cancelled = false;
    setStations(null);
    setError(null);
    void (async () => {
      const fetchedMs = await radioStationsFetchedMs(session.db, country.code);
      if (fetchedMs !== null && Date.now() - fetchedMs < RADIO_TTL_MS) {
        const stored = await listRadioStations(session.db, country.code);
        if (!cancelled) setStations(stored);
        return;
      }
      const fetched = await fetchRadioStations(radioFetch, country.code);
      if (cancelled) return;
      if (fetched.length === 0) {
        const stored = await listRadioStations(session.db, country.code);
        setStations(stored);
        if (stored.length === 0) setError('Kunne ikke hente stationerne. Prøv igen om lidt.');
        return;
      }
      await saveRadioStations(session.db, country.code, fetched);
      // Favoritternes stationer er lige blevet skrevet om; laes dem igen.
      await loadFavourites();
      if (!cancelled) setStations(fetched);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db, country, loadFavourites]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (query.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setResults(null);
    void searchRadioStations(radioFetch, query).then((found) => {
      if (!cancelled) setResults(found);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function toggleFavourite(station: RadioStation): Promise<void> {
    const next = !favouriteIds.has(station.id);
    if (next) await rememberRadioStation(session.db, station);
    await setRadioFavorite(session.db, station.id, next);
    await loadFavourites();
  }

  function play(station: RadioStation, list: RadioStation[]): void {
    onSelect(
      toRadioChannel(station),
      list.map((entry) => toRadioChannel(entry)),
    );
  }

  const searchField = (
    <TextInput
      style={styles.input}
      value={search}
      onChangeText={setSearch}
      placeholder="Søg station i hele verden"
      placeholderTextColor={theme.colors.textMuted}
      autoCorrect={false}
      autoCapitalize="none"
    />
  );

  function renderStation(station: RadioStation, list: RadioStation[]) {
    const favourite = favouriteIds.has(station.id);
    const meta = [station.codec, station.bitrate > 0 ? `${station.bitrate} kbps` : '', station.tags.slice(0, 3).join(' · ')]
      .filter((part) => part.length > 0)
      .join(' · ');
    return (
      <TvPressable
        style={styles.stationRow}
        onPress={() => play(station, list)}
        onLongPress={onPickLogo === undefined ? undefined : () => onPickLogo(toRadioChannel(station))}
      >
        <ChannelLogo uris={radioLogoUrls(station)} name={station.name} memoryKey={`rb:${station.id}`} size={44} />
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={1}>
            {station.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <TvPressable
          hitSlop={10}
          onPress={() => {
            void toggleFavourite(station);
          }}
        >
          <Text style={favourite ? styles.starOn : styles.starOff}>{favourite ? '★' : '☆'}</Text>
        </TvPressable>
      </TvPressable>
    );
  }

  if (query.length >= 2) {
    return (
      <View style={styles.container}>
        {searchField}
        {results === null ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
        ) : (
          <RememberedList
            memoryKey={`radio:search:${query}`}
            restoreSignal={restoreSignal}
            contentContainerStyle={listPadding}
            data={results}
            keyExtractor={(station) => station.id}
            getItemLayout={stationLayout}
            ListEmptyComponent={<Text style={styles.empty}>Ingen stationer med det navn.</Text>}
            renderItem={({ item }) => renderStation(item, results)}
          />
        )}
      </View>
    );
  }

  if (country !== null) {
    return (
      <View style={styles.container}>
        {searchField}
        <TvPressable style={styles.crumb} onPress={() => backRef.current()} hitSlop={8}>
          <Text style={styles.crumbBack}>‹</Text>
          <Text style={styles.crumbLabel} numberOfLines={1}>
            {country.flag} {country.name}
          </Text>
          <Text style={styles.count}>{stations === null ? '' : `${stations.length}`}</Text>
        </TvPressable>
        {stations === null ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
        ) : (
          <RememberedList
            memoryKey={`radio:country:${country.code}`}
            restoreSignal={restoreSignal}
            contentContainerStyle={listPadding}
            data={stations}
            keyExtractor={(station) => station.id}
            getItemLayout={stationLayout}
            initialNumToRender={20}
            ListEmptyComponent={<Text style={styles.empty}>{error ?? 'Ingen stationer i registret for landet.'}</Text>}
            renderItem={({ item }) => renderStation(item, stations)}
          />
        )}
      </View>
    );
  }

  // Forsiden: to faner. Landene foerst, saa favoritterne ikke skubber dem
  // ned ad siden; Mine stationer ved siden af med antallet.
  const tabs = (
    <View style={styles.tabs}>
      <TvPressable style={[styles.tab, tab === 'countries' && styles.tabActive]} onPress={() => setTab('countries')}>
        <Text style={[styles.tabText, tab === 'countries' && styles.tabTextActive]}>Lande</Text>
      </TvPressable>
      <TvPressable style={[styles.tab, tab === 'mine' && styles.tabActive]} onPress={() => setTab('mine')}>
        <Text style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>
          Mine stationer{favourites.length > 0 ? ` · ${favourites.length}` : ''}
        </Text>
      </TvPressable>
    </View>
  );

  if (tab === 'mine') {
    return (
      <View style={styles.container}>
        {searchField}
        {tabs}
        <RememberedList
          memoryKey="radio:mine"
          restoreSignal={restoreSignal}
          contentContainerStyle={listPadding}
          data={favourites}
          keyExtractor={(station) => station.id}
          getItemLayout={stationLayout}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Ingen stationer endnu. Tryk på ☆ ud for en station under Lande eller i en søgning, så lander den her — og i bilen.
            </Text>
          }
          renderItem={({ item }) => renderStation(item, favourites)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {searchField}
      {tabs}
      {countries === null ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
      ) : (
        <RememberedList
          memoryKey="radio:countries"
          restoreSignal={restoreSignal}
          contentContainerStyle={listPadding}
          data={countries}
          keyExtractor={(entry) => entry.code}
          initialNumToRender={30}
          ListHeaderComponent={error !== null ? <Text style={styles.empty}>{error}</Text> : null}
          ListEmptyComponent={<Text style={styles.empty}>Ingen lande endnu. Er der forbindelse til nettet?</Text>}
          renderItem={({ item }) => (
            <TvPressable style={styles.row} onPress={() => onCountryChange(item)}>
              <Text style={styles.flag}>{item.flag}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.count}>{localCounts.get(item.code) ?? item.stations}</Text>
              <Text style={styles.chevron}>›</Text>
            </TvPressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.sm + 2,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  spinner: { marginTop: theme.spacing.lg },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  crumbBack: { color: theme.colors.accent, fontSize: 26 },
  crumbLabel: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    height: STATION_ROW_HEIGHT,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  flag: { fontSize: 24, width: 34 },
  name: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  count: { color: theme.colors.textMuted, fontSize: 13 },
  chevron: { color: theme.colors.textMuted, fontSize: 22 },
  starOn: { color: theme.colors.accent, fontSize: 24, paddingHorizontal: theme.spacing.xs },
  starOff: { color: theme.colors.textMuted, fontSize: 24, paddingHorizontal: theme.spacing.xs },
  tabs: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  tab: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  tabActive: { backgroundColor: theme.colors.accent },
  tabText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: theme.colors.text },
  empty: { color: theme.colors.textMuted, textAlign: 'center', padding: theme.spacing.lg },
});
