import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { listChannels, setFavorite } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { theme } from '../../ui/theme.js';
import { ChannelList } from '../channels/ChannelList.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';
import type { RadioCountry } from '../../sync/radioBrowser.js';
import { InternetRadio } from './InternetRadio.js';
import type { FrontTab } from './InternetRadio.js';
import { TvPressable } from '../../ui/TvPressable.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  onAuthError: () => void;
  previewHandle: { current: PreviewHandle | null };
  onPickLogo: (channel: StoredChannel) => void;
  /** Udfyldes med det tilbage-knappen skal goere her (internetradioens land). */
  backRef: { current: () => boolean };
  /** Hvor man staar i Radio. Ligger i App.tsx, saa det overlever afspilleren. */
  place: RadioPlace;
  onPlaceChange: (place: RadioPlace) => void;
}

export type RadioPart = 'panel' | 'internet';

export interface RadioPlace {
  part: RadioPart;
  /** Internetradioens aabne land, eller null for landelisten. */
  country: RadioCountry | null;
  /** Internetradioens forside: landene eller ens egne stationer. */
  tab?: FrontTab;
}

export const RADIO_START: RadioPlace = { part: 'internet', country: null, tab: 'countries' };

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Radiokanalerne, samlet ét sted.
 *
 * Panelet skiller ikke radio ud; det er navnet der siger det, typisk med
 * "(RADIO)" i parentes, eller kategorien. Listen er den samme som for
 * kanaler — logo, favoritstjerne, zap i afspilleren — men uden preview:
 * previewet er lydloest, og for radio er der intet at se.
 */
export function RadioScreen({ session, onSelect, onAuthError, previewHandle, onPickLogo, backRef, place, onPlaceChange }: Props) {
  /** Panelets radiokanaler, eller internetradio fra Radio Browser. */
  const part = place.part;
  const setPart = (next: RadioPart): void => onPlaceChange({ ...place, part: next });
  const internetBack = useRef<() => boolean>(() => false);
  backRef.current = (): boolean => (part === 'internet' ? internetBack.current() : false);
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  /** Antal gemte internetstationer, til knappen Mine stationer. */
  const [mineCount, setMineCount] = useState(0);
  /** Taelles op naar Mine stationer eller Lande trykkes: forsiden frem. */
  const [frontSignal, setFrontSignal] = useState(0);
  const frontTab = place.tab ?? 'countries';
  const showFront = (tab: FrontTab): void => {
    onPlaceChange({ part: 'internet', country: null, tab });
    setFrontSignal((value) => value + 1);
  };

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void listChannels(session.db, { radioOnly: true, search: query }).then((list) => {
      if (cancelled) return;
      setChannels(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, query]);

  async function toggleFavorite(channel: StoredChannel): Promise<void> {
    await setFavorite(session.db, channel.id, !channel.isFavorite);
    setChannels((current) =>
      current.map((entry) => (entry.id === channel.id ? { ...entry, isFavorite: !entry.isFavorite } : entry)),
    );
  }

  /**
   * Knapperne i toppen: Internetradio, saa dens to forsider Mine stationer
   * og Lande lige ved siden af, og til sidst panelets radiokanaler. Foer
   * laa Mine stationer og Lande som en raekke nede over listen; oppe i
   * toppen er de ét tryk vaek uanset hvor man staar.
   */
  const chips: { id: string; label: string; active: boolean; onPress: () => void }[] = [
    { id: 'internet', label: 'Internetradio', active: part === 'internet', onPress: () => setPart('internet') },
    {
      id: 'mine',
      label: `Mine stationer${mineCount > 0 ? ` · ${mineCount}` : ''}`,
      active: part === 'internet' && frontTab === 'mine',
      onPress: () => showFront('mine'),
    },
    { id: 'countries', label: 'Lande', active: part === 'internet' && frontTab === 'countries', onPress: () => showFront('countries') },
    { id: 'panel', label: `Fra panelet${loading ? '' : ` (${channels.length})`}`, active: part === 'panel', onPress: () => setPart('panel') },
  ];
  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Radio</Text>
      <View style={styles.parts}>
        {chips.map((entry) => (
          <TvPressable
            key={entry.id}
            style={[styles.part, entry.active && styles.partActive]}
            onPress={entry.onPress}
          >
            <Text style={[styles.partText, entry.active && styles.partTextActive]}>{entry.label}</Text>
          </TvPressable>
        ))}
      </View>
    </View>
  );

  if (part === 'internet') {
    return (
      <View style={styles.container}>
        {header}
        <InternetRadio
          session={session}
          country={place.country}
          onCountryChange={(country) => onPlaceChange({ ...place, country })}
          tab={frontTab}
          onTabChange={(tab) => onPlaceChange({ ...place, tab })}
          frontSignal={frontSignal}
          onFavouritesCount={setMineCount}
          onSelect={onSelect}
          onPickLogo={onPickLogo}
          backRef={internetBack}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Søg radiokanal"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <ChannelList
        session={session}
        channels={channels}
        loading={loading}
        emptyText="Ingen radiokanaler fundet. Panelet mærker dem med “radio” i navnet eller kategorien."
        onSelect={onSelect}
        onToggleFavorite={(channel) => {
          void toggleFavorite(channel);
        }}
        onAuthError={onAuthError}
        previewEnabled={false}
        previewHandle={previewHandle}
        onLongPress={onPickLogo}
        allowRestartFilter={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  part: {
    paddingHorizontal: theme.spacing.sm + 4,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  partActive: { backgroundColor: theme.colors.accent },
  partText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  partTextActive: { color: theme.colors.text },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.sm + 2,
    margin: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
});
