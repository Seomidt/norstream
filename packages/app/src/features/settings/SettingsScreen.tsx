import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { deriveCountry } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { vodCounts } from '../../storage/vod.js';
import { createBackup, parseBackup, restoreBackup, serialiseBackup } from '../../storage/backup.js';
import { forgetLogoMisses, resetLogo } from '../../ui/logoCache.js';
import { readChosenBackupFile, saveBackupToChosenFolder } from './backupFiles.js';
import { listHiddenCountries, unhideCountry } from '../../storage/countries.js';
import { OTHER_COUNTRY_KEY } from '../../storage/countries.js';
import { clearSourceCredentials } from '../../storage/credentials.js';
import { deleteSource, listSources } from '../../storage/sources.js';
import {
  clearLastSyncMs,
  getStreamFormatSetting,
  getSubtitlePreference,
  getYoutubeApiKey,
  setSubtitlePreference,
  setYoutubeApiKey,
  setMiniPreviewEnabled,
  setStreamFormatSetting,
} from '../../storage/settings.js';
import type { StreamFormatSetting, SubtitlePreference } from '../../storage/settings.js';
import { applyStreamFormatSetting } from '../player/format.js';
import { theme } from '../../ui/theme.js';

interface Props {
  session: AppSession;
  onOpenSources: () => void;
  /** Aabner listen over kanaler uden logo, hvor man kan vaelge selv. */
  onOpenLogos: () => void;
  /** Aabner maalingen af vejen til panelet. */
  onOpenCheck: () => void;
  previewEnabled: boolean;
  onPreviewEnabledChange: (enabled: boolean) => void;
  onSignedOut: (notice: string) => void;
  /** En sikkerhedskopi er lagt ind: favoritter, logoer og indstillinger skal laeses igen. */
  onRestored: () => void;
}

const SIGNED_OUT_MESSAGE = 'Du er logget ud. Log ind igen for at fortsætte.';

const SUBTITLE_CHOICES: readonly { value: SubtitlePreference; label: string }[] = [
  { value: 'auto', label: 'Telefonens sprog' },
  { value: 'da', label: 'Dansk' },
  { value: 'en', label: 'Engelsk' },
  { value: 'sv', label: 'Svensk' },
  { value: 'no', label: 'Norsk' },
  { value: 'de', label: 'Tysk' },
  { value: 'off', label: 'Ingen' },
];

const STREAM_FORMATS: readonly { value: StreamFormatSetting; label: string }[] = [
  { value: 'auto', label: 'Automatisk' },
  { value: 'ts', label: 'TS' },
  { value: 'm3u8', label: 'HLS' },
];

export function SettingsScreen({
  session,
  onOpenSources,
  onOpenLogos,
  onOpenCheck,
  previewEnabled,
  onPreviewEnabledChange,
  onSignedOut,
  onRestored,
}: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  // Bekraeftelsen ligger i skaermen, ikke i en Alert: react-native-web
  // implementerer ikke Alert, saa udlogning ville doe stille paa web.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [streamFormat, setStreamFormat] = useState<StreamFormatSetting>('auto');
  const [vod, setVod] = useState<{ movies: number; series: number } | null>(null);
  /** Brugerens egen noegle til YouTubes Data API, til at soege efter trailere. */
  const [youtubeKey, setYoutubeKey] = useState('');
  const [subtitles, setSubtitles] = useState<SubtitlePreference>('auto');
  /** Hvad sidste sikkerhedskopiering eller gendannelse endte med. */
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [hiddenCountries, format, key, preferredSubtitles, counts] = await Promise.all([
      listHiddenCountries(session.db),
      getStreamFormatSetting(session.db),
      getYoutubeApiKey(session.db),
      getSubtitlePreference(session.db),
      vodCounts(session.db),
    ]);
    setHidden(hiddenCountries);
    setStreamFormat(format);
    setYoutubeKey(key ?? '');
    setSubtitles(preferredSubtitles);
    setVod(counts);
  }, [session.db]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBackup(): Promise<void> {
    setBackupBusy(true);
    try {
      const json = serialiseBackup(await createBackup(session.db));
      const saved = await saveBackupToChosenFolder(json);
      setBackupMessage(saved ? 'Sikkerhedskopien er gemt i den valgte mappe.' : null);
    } catch {
      setBackupMessage('Sikkerhedskopien kunne ikke gemmes.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromFile(): Promise<void> {
    setBackupBusy(true);
    try {
      const text = await readChosenBackupFile();
      if (text === null) return;
      const result = await restoreBackup(session.db, parseBackup(text));
      // De valgte logoer hentes om, saa filen paa telefonen er den valgte.
      for (const key of result.overrideKeys) await resetLogo(key);
      await forgetLogoMisses();
      await load();
      onRestored();
      const parts = [
        `${result.favorites} favoritter`,
        `${result.logoOverrides} egne logoer`,
        `${result.settings} indstillinger`,
      ];
      const missing =
        result.missingSources.length === 0
          ? ''
          : ` Kilden ${result.missingSources.join(', ')} findes ikke her, så dens favoritter blev sprunget over — log ind på den først, og gendan igen.`;
      setBackupMessage(`Gendannet: ${parts.join(', ')}.${missing}`);
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Filen kunne ikke læses.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function chooseSubtitles(value: SubtitlePreference): Promise<void> {
    setSubtitles(value);
    await setSubtitlePreference(session.db, value);
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
      <Pressable style={styles.row} onPress={onOpenCheck}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Tjek forbindelsen til panelet</Text>
          <Text style={styles.rowHint}>
            Virker appen på mobildata men ikke på Wi-Fi? Målingen siger om det er navnet,
            adressen eller panelet, der afviser.
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </Pressable>
      {/* Tallet siger om film og serier faktisk kom med ved sidste hentning —
          det eneste sted man kan se det uden at gaa ind paa fanen. */}
      <Text style={styles.hint}>
        {vod === null
          ? ''
          : vod.movies + vod.series === 0
            ? 'Ingen film eller serier hentet endnu. De følger med næste gang kanalerne opdateres.'
            : `${vod.movies} film og ${vod.series} serier hentet fra dine kilder.`}
      </Text>

      <Text style={styles.sectionTitle}>Kanallogoer</Text>
      <Pressable style={styles.row} onPress={onOpenLogos}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Kanaler uden logo</Text>
          <Text style={styles.rowHint}>
            Logoerne hentes selv, én gang, og gemmes på telefonen. Vælg selv et logo for dem
            arkiverne ikke kender — søg i registret eller indsæt en adresse. Du kan også holde
            fingeren på en kanal i listerne.
          </Text>
        </View>
        <Text style={styles.actionText}>Åbn</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Undertekster</Text>
      <Text style={styles.hint}>
        Sproget der vælges af sig selv, når en film eller et afsnit har det. Findes det ikke i
        filen, prøves engelsk. Du kan stadig skifte spor i afspilleren.
      </Text>
      <View style={styles.choices}>
        {SUBTITLE_CHOICES.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.choice, subtitles === option.value && styles.choiceSelected]}
            onPress={() => {
              void chooseSubtitles(option.value);
            }}
          >
            <Text
              style={[styles.choiceText, subtitles === option.value && styles.choiceTextSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

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

      <Text style={styles.sectionTitle}>Trailere</Text>
      <Text style={styles.hint}>
        Udbyderen oplyser én trailer per titel, og den er ikke altid en trailer: nogle er
        teasere på få sekunder. Er den under et minut, leder appen videre. Med en nøgle til
        YouTubes Data API vælger den selv en lang nok; uden nøgle åbnes YouTubes søgning
        inde i appen, så du vælger selv.
      </Text>
      <TextInput
        style={styles.input}
        value={youtubeKey}
        onChangeText={setYoutubeKey}
        onBlur={() => {
          void setYoutubeApiKey(session.db, youtubeKey);
        }}
        placeholder="YouTube API-nøgle (valgfri)"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <Text style={styles.hint}>
        Nøglen laves gratis i Google Cloud Console: opret et projekt, slå "YouTube Data API v3"
        til, og opret en API-nøgle under Legitimationsoplysninger. Den gemmes kun på telefonen.
      </Text>

      <Text style={styles.sectionTitle}>Sikkerhedskopi</Text>
      <Text style={styles.hint}>
        Favoritter i din rækkefølge, egne logoer, skjulte lande, undertekster og de andre valg,
        min liste og hvor langt film er set. Ikke adgangskoder: dem taster du igen. Gem filen
        et sted du kan nå fra en ny telefon, og gendan efter du er logget ind på panelet.
      </Text>
      <Pressable style={styles.row} disabled={backupBusy} onPress={() => void saveBackup()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Gem sikkerhedskopi</Text>
          <Text style={styles.rowHint}>Vælg en mappe. Filen hedder norstream-sikkerhedskopi.json.</Text>
        </View>
        <Text style={styles.actionText}>Gem</Text>
      </Pressable>
      <Pressable style={styles.row} disabled={backupBusy} onPress={() => void restoreFromFile()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Gendan fra fil</Text>
          <Text style={styles.rowHint}>
            Erstatter favoritter, egne logoer og skjulte lande med dem i filen.
          </Text>
        </View>
        <Text style={styles.actionText}>Vælg fil</Text>
      </Pressable>
      {backupMessage !== null && <Text style={styles.hint}>{backupMessage}</Text>}

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
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.sm + 2,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
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
