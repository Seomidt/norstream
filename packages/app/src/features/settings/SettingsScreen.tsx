import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { deriveCountry, logoCandidates } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { logoCoverage, registryCoverage } from '../../storage/channels.js';
import { listLogoHosts } from '../../storage/logoHosts.js';
import type { LogoHostRecord } from '../../storage/logoHosts.js';
import { checkLogoHosts } from '../../sync/logoHosts.js';
import { listHiddenCountries, unhideCountry } from '../../storage/countries.js';
import { OTHER_COUNTRY_KEY } from '../../storage/countries.js';
import { clearSourceCredentials } from '../../storage/credentials.js';
import { deleteSource, listSources } from '../../storage/sources.js';
import {
  clearLastSyncMs,
  getRegistryError,
  getStreamFormatSetting,
  setMiniPreviewEnabled,
  setStreamFormatSetting,
} from '../../storage/settings.js';
import type { StreamFormatSetting } from '../../storage/settings.js';
import { applyStreamFormatSetting } from '../player/format.js';
import { theme } from '../../ui/theme.js';
import { probeLogo } from './logoProbe.js';
import type { LogoProbeResult } from './logoProbe.js';
import { redactCredentials } from './redact.js';

interface Props {
  session: AppSession;
  onOpenSources: () => void;
  previewEnabled: boolean;
  onPreviewEnabledChange: (enabled: boolean) => void;
  onSignedOut: (notice: string) => void;
}

const SIGNED_OUT_MESSAGE = 'Du er logget ud. Log ind igen for at fortsætte.';

/** Kun vaerten, saa linjen kan laeses paa en telefon. */
function shortHost(url: string): string {
  return /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url;
}

const STREAM_FORMATS: readonly { value: StreamFormatSetting; label: string }[] = [
  { value: 'auto', label: 'Automatisk' },
  { value: 'ts', label: 'TS' },
  { value: 'm3u8', label: 'HLS' },
];

export function SettingsScreen({
  session,
  onOpenSources,
  previewEnabled,
  onPreviewEnabledChange,
  onSignedOut,
}: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  // Bekraeftelsen ligger i skaermen, ikke i en Alert: react-native-web
  // implementerer ikke Alert, saa udlogning ville doe stille paa web.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [streamFormat, setStreamFormat] = useState<StreamFormatSetting>('auto');
  const [logos, setLogos] = useState<{
    withLogo: number;
    total: number;
    example: string | null;
  } | null>(null);
  /** Hvad der faktisk kom tilbage fra logo-adressen. */
  const [probe, setProbe] = useState<LogoProbeResult | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  /** Vaerterne logoerne ligger paa, og om telefonen kan naa dem. */
  const [hosts, setHosts] = useState<LogoHostRecord[]>([]);
  const [registry, setRegistry] = useState<{ rows: number; matched: number } | null>(null);
  /** Hvorfor registret ikke kunne hentes. Uden den er en tom liste uforklarlig. */
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [hiddenCountries, format, coverage, knownHosts, fromRegistry, lastError] =
      await Promise.all([
        listHiddenCountries(session.db),
        getStreamFormatSetting(session.db),
        logoCoverage(session.db),
        listLogoHosts(session.db),
        registryCoverage(session.db),
        getRegistryError(session.db),
      ]);
    setHidden(hiddenCountries);
    setStreamFormat(format);
    setLogos(coverage);
    setHosts(knownHosts);
    setRegistry(fromRegistry);
    setRegistryError(lastError);

    // Et rigtigt kald frem for at laene sig op ad om et Image tegner noget:
    // en tom firkant kan lige saa godt vaere en hentning der venter som et
    // svar der ikke er et billede.
    //
    // Begge adresser proeves — panelets egen vaert er andet forsoeg, og det
    // er den der redder logoerne naar billed-vaerten ikke kan naas.
    const candidates = logoCandidates(coverage.example, session.sources[0]?.source.url ?? '');
    for (const candidate of candidates) {
      const result = await probeLogo(candidate, session.fetchImpl);
      setProbe({ ...result, text: `${shortHost(candidate)}: ${result.text}` });
      if (result.ok) break;
    }
  }, [session.db, session.fetchImpl]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Maaler vaerterne forfra.
   *
   * En vaert der var nede i det oejeblik der blev maalt, bliver sprunget over
   * indtil naeste maaling — og med seks timer imellem er det for laenge at
   * vente naar man staar med telefonen og kan se at logoerne mangler.
   */
  async function recheckHosts(): Promise<void> {
    setRechecking(true);
    try {
      await checkLogoHosts(session.db, session.fetchImpl, new Date(), true);
      await load();
    } finally {
      setRechecking(false);
    }
  }

  async function togglePreview(enabled: boolean): Promise<void> {
    await setMiniPreviewEnabled(session.db, enabled);
    onPreviewEnabledChange(enabled);
  }

  async function chooseStreamFormat(value: StreamFormatSetting): Promise<void> {
    await setStreamFormatSetting(session.db, value);
    applyStreamFormatSetting(value);
    setStreamFormat(value);
  }

  async function signOut(): Promise<void> {
    // Rydder credentials **og** tidspunktet for sidste synkronisering. Uden
    // det sidste ville et nyt panel vise det gamles kanaler i op til et doegn,
    // fordi kanal-synken springes over naar last_sync_ms er frisk.
    const sources = await listSources(session.db);
    const results = await Promise.allSettled([
      ...sources.map((source) => clearSourceCredentials(source.id)),
      ...sources.map((source) => deleteSource(session.db, source.id)),
      clearLastSyncMs(session.db),
    ]);
    // En fejlende keychain-sletning maa ikke afbryde udlogningen stille: vi
    // logger brugeren ud uanset, men siger det hvis noget ikke lykkedes.
    const failed = results.some((result) => result.status === 'rejected');
    onSignedOut(
      failed
        ? 'Du er logget ud, men noget kunne ikke ryddes fra enheden. Log ind igen.'
        : SIGNED_OUT_MESSAGE,
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Forhåndsvisning</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Vis kanalen mens du bladrer</Text>
          <Text style={styles.rowHint}>
            Panelet tillader kun én forbindelse ad gangen. Slå fra, hvis
            afspilningen driller.
          </Text>
        </View>
        <Switch
          value={previewEnabled}
          onValueChange={(value) => {
            void togglePreview(value);
          }}
          trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
        />
      </View>

      <Text style={styles.sectionTitle}>Kilder</Text>
      <Pressable style={styles.row} onPress={onOpenSources}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Paneler og M3U-lister</Text>
          <Text style={styles.rowHint}>
            Tilføj flere udbydere. Kanalerne står side om side, og favoritter
            kan blandes på tværs.
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Kanallogoer</Text>
      <Text style={styles.hint}>
        {logos === null
          ? 'Tæller …'
          : logos.total === 0
            ? 'Ingen kanaler hentet endnu.'
            : `${logos.withLogo} af ${logos.total} kanaler har en logo-adresse fra udbyderen.`}
      </Text>
      {logos !== null && logos.example !== null && (
        <View style={styles.logoProbe}>
          <Image
            source={{ uri: logos.example }}
            style={styles.logoSample}
            resizeMode="contain"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(false)}
          />
          <View style={styles.logoProbeText}>
            <Text style={styles.rowHint}>
              {probe === null ? 'Prøver adressen …' : probe.text}
            </Text>
            <Text style={styles.rowHint}>
              {imageLoaded
                ? 'Billedet blev tegnet, så visningen virker.'
                : 'Billedet er endnu ikke tegnet.'}
            </Text>
            <Text style={styles.logoUrl} numberOfLines={3}>
              {redactCredentials(logos.example)}
            </Text>
          </View>
        </View>
      )}
      {/* Vaerterne staar for sig. En tom firkant kan skyldes tre ting — en
          vaert uden rute, et navn registret ikke kender, eller et billede der
          ikke kunne tegnes — og de tre linjer her skiller dem ad. */}
      {hosts.map((host) => (
        <Text key={host.origin} style={styles.hint}>
          {host.state === 'unreachable' ? '✕ ' : '✓ '}
          {shortHost(host.origin)}: {host.detail}
          {host.state === 'unreachable' ? ' — springes over' : ''}
        </Text>
      ))}
      <Text style={styles.hint}>
        {registry === null
          ? ''
          : registry.rows === 0
            ? registryError === null
              ? 'Det åbne kanalregister er ikke hentet endnu.'
              : `Det åbne kanalregister kunne ikke hentes: ${registryError}`
            : `Registret har ${registry.rows} logoer, og ${registry.matched} af dine kanaler passer på et af dem.`}
      </Text>
      <Pressable
        style={styles.row}
        disabled={rechecking}
        onPress={() => {
          void recheckHosts();
        }}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Prøv logo-værterne igen</Text>
          <Text style={styles.rowHint}>
            Måles ellers hver sjette time. En vært der var nede netop da,
            springes over indtil næste måling.
          </Text>
        </View>
        <Text style={styles.actionText}>{rechecking ? 'Måler …' : 'Mål'}</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Streamformat</Text>
      <Text style={styles.hint}>
        Automatisk vælger det formatet der plejer at virke bedst på enheden.
        Løber underteksterne foran billedet, er HLS værd at prøve: rå TS
        bærer ingen tidslinje, så afspilleren må gætte sig frem.
      </Text>
      <View style={styles.choices}>
        {STREAM_FORMATS.map((option) => (
          <Pressable
            key={option.value}
            style={[
              styles.choice,
              streamFormat === option.value && styles.choiceSelected,
            ]}
            onPress={() => {
              void chooseStreamFormat(option.value);
            }}
          >
            <Text
              style={[
                styles.choiceText,
                streamFormat === option.value && styles.choiceTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        Skiftet gælder næste gang du åbner en kanal.
      </Text>

      <Text style={styles.sectionTitle}>Skjulte lande</Text>
      {hidden.length === 0 ? (
        <Text style={styles.hint}>
          Ingen. Hold fingeren nede på et land under Kanaler for at skjule det.
        </Text>
      ) : (
        hidden.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowTitle}>{countryLabel(key)}</Text>
            <Pressable
              style={styles.action}
              onPress={() => {
                void (async () => {
                  await unhideCountry(session.db, key);
                  await load();
                })();
              }}
            >
              <Text style={styles.actionText}>Vis igen</Text>
            </Pressable>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Konto</Text>
      {confirmingSignOut ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Dine adgangsoplysninger slettes fra enheden.
          </Text>
          <View style={styles.confirmActions}>
            <Pressable style={styles.action} onPress={() => setConfirmingSignOut(false)}>
              <Text style={styles.actionText}>Annullér</Text>
            </Pressable>
            <Pressable
              style={styles.action}
              onPress={() => {
                void signOut();
              }}
            >
              <Text style={styles.dangerText}>Log ud</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.dangerButton} onPress={() => setConfirmingSignOut(true)}>
          <Text style={styles.dangerText}>Log ud</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

/**
 * Landekoden tilbage til flag og dansk navn. `deriveCountry` genkender koden
 * selv — den staar i landets egen aliasliste — saa der er ingen anden tabel at
 * holde i takt.
 */
function countryLabel(key: string): string {
  if (key === OTHER_COUNTRY_KEY) return 'Øvrige';
  const country = deriveCountry(key);
  return country === null ? key : `${country.flag} ${country.name}`;
}

const styles = StyleSheet.create({
  logoProbe: { flexDirection: 'row', alignItems: 'flex-start', marginTop: theme.spacing.sm },
  logoSample: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: theme.colors.surfaceRaised,
  },
  logoProbeText: { flex: 1, marginLeft: theme.spacing.sm },
  logoUrl: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.spacing.xs },
  choices: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  choice: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
  },
  choiceSelected: { backgroundColor: theme.colors.accent },
  choiceText: { color: theme.colors.textMuted, fontSize: 15, fontWeight: '600' },
  choiceTextSelected: { color: theme.colors.text },
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  rowText: { flex: 1, marginRight: theme.spacing.md },
  rowTitle: { flex: 1, color: theme.colors.text, fontSize: 15 },
  rowHint: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  hint: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  action: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  actionText: { color: theme.colors.text, fontSize: 13 },
  confirmBox: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
  },
  confirmText: { color: theme.colors.text, fontSize: 14, marginBottom: theme.spacing.md },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm },
  dangerButton: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  dangerText: { color: theme.colors.danger, fontSize: 15, fontWeight: '600' },
});
