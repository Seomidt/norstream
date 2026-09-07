import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppSession } from '../../session.js';
import { getChannel } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import {
  clearLogoOverride,
  getLogoOverride,
  searchRegistryLogos,
  setLogoOverride,
} from '../../storage/logoOverrides.js';
import type { RegistryLogoHit } from '../../storage/logoOverrides.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { forgetLogo, rememberLogo } from '../../ui/logoMemory.js';
import { theme } from '../../ui/theme.js';

interface Props {
  session: AppSession;
  channelKey: string;
  onBack: () => void;
  /** Kaldes naar valget er aendret, saa listerne bagved kan tegne igen. */
  onChanged: () => void;
}

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Vaelg logo for én kanal.
 *
 * To veje: soeg i det register appen allerede har hentet — 61.000 logoer, i
 * databasen, ingen netvaerk — eller indsaet en adresse selv. Valget staar
 * foerst i logoraekken og roeres ikke af nogen opdatering.
 *
 * Soegefeltet er udfyldt med kanalens navn fra start, renset for praefiks,
 * saa det mest sandsynlige svar allerede staar der naar skaermen aabner.
 */
export function LogoPickerScreen({ session, channelKey, onBack, onChanged }: Props) {
  const insets = useSafeAreaInsets();
  const [channel, setChannel] = useState<StoredChannel | null | undefined>(undefined);
  const [current, setCurrent] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RegistryLogoHit[]>([]);
  const [manual, setManual] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const stored = await getChannel(session.db, channelKey);
    setChannel(stored);
    setCurrent(await getLogoOverride(session.db, channelKey));
    if (stored !== null) {
      // `DNK| TV 2 ECHO HD` -> `TV 2 ECHO HD`. Kvalitetsmaerkerne fjernes af
      // soegningen selv.
      const bare = stored.name.includes('|')
        ? stored.name.slice(stored.name.lastIndexOf('|') + 1).trim()
        : stored.name;
      setSearch(bare);
      setQuery(bare);
    }
  }, [session.db, channelKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void searchRegistryLogos(session.db, query).then((result) => {
      if (!cancelled) setHits(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, query]);

  async function choose(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setMessage('Adressen skal begynde med http:// eller https://');
      return;
    }
    await setLogoOverride(session.db, channelKey, trimmed);
    // Valget er ogsaa det der virkede sidst — saa listerne begynder der.
    rememberLogo(channelKey, trimmed);
    setCurrent(trimmed);
    setMessage('Logoet er gemt.');
    onChanged();
  }

  async function reset(): Promise<void> {
    await clearLogoOverride(session.db, channelKey);
    forgetLogo(channelKey);
    setCurrent(null);
    setMessage('Eget valg fjernet. Appen vælger igen selv.');
    onChanged();
  }

  if (channel === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }
  if (channel === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>Kanalen findes ikke længere.</Text>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Tilbage</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.crumb} onPress={onBack} hitSlop={8}>
        <Text style={styles.crumbBack}>‹</Text>
        <Text style={styles.crumbLabel} numberOfLines={1}>
          Vælg logo
        </Text>
      </Pressable>

      <View style={styles.channelRow}>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={56} />
        <View style={styles.channelText}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.name}
          </Text>
          <Text style={styles.hint}>
            {current === null ? 'Appen vælger selv.' : 'Du har valgt et logo selv.'}
          </Text>
        </View>
        {current !== null && (
          <Pressable
            hitSlop={8}
            onPress={() => {
              void reset();
            }}
          >
            <Text style={styles.actionText}>Fjern</Text>
          </Pressable>
        )}
      </View>

      {message !== null && <Text style={styles.message}>{message}</Text>}

      <Text style={styles.sectionTitle}>Søg i registret</Text>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Kanalnavn"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        data={hits}
        keyExtractor={(hit) => hit.url}
        numColumns={4}
        style={styles.grid}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        ListEmptyComponent={
          <Text style={styles.hint}>
            {query.trim().length === 0
              ? 'Skriv et navn.'
              : 'Ingen i registret med det navn. Prøv en kortere stavemåde, eller indsæt en adresse nedenfor.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.hit, item.url === current && styles.hitActive]}
            onPress={() => {
              void choose(item.url);
            }}
          >
            <Image source={{ uri: item.url }} style={styles.hitImage} resizeMode="contain" />
            <Text style={styles.hitName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.hitCountry}>{item.country === '*' ? '🌐' : item.country}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={[styles.manual, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
            <Text style={styles.sectionTitle}>Eller indsæt en adresse</Text>
            <TextInput
              style={styles.input}
              value={manual}
              onChangeText={setManual}
              placeholder="https://…/logo.png"
              placeholderTextColor={theme.colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              inputMode="url"
            />
            <Pressable
              style={[styles.button, manual.trim().length === 0 && styles.buttonDisabled]}
              disabled={manual.trim().length === 0}
              onPress={() => {
                void choose(manual);
              }}
            >
              <Text style={styles.buttonText}>Brug adressen</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  crumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  crumbBack: { color: theme.colors.accent, fontSize: 26, marginRight: theme.spacing.sm },
  crumbLabel: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  channelText: { flex: 1 },
  channelName: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  hint: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2, paddingHorizontal: theme.spacing.md },
  message: { color: theme.colors.accent, fontSize: 13, paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.xs },
  actionText: { color: theme.colors.danger, fontSize: 15, fontWeight: '600' },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.sm + 2,
    marginHorizontal: theme.spacing.md,
    fontSize: 15,
  },
  grid: { flex: 1, marginTop: theme.spacing.sm },
  gridContent: { paddingHorizontal: theme.spacing.sm },
  gridRow: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, marginBottom: theme.spacing.sm },
  hit: {
    flex: 1 / 4,
    alignItems: 'center',
    padding: theme.spacing.xs,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  hitActive: { borderColor: theme.colors.accent },
  hitImage: { width: 56, height: 56 },
  hitName: { color: theme.colors.text, fontSize: 10, marginTop: 4 },
  hitCountry: { color: theme.colors.textMuted, fontSize: 10 },
  manual: { marginTop: theme.spacing.md },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    padding: theme.spacing.sm + 2,
    alignItems: 'center',
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
});
