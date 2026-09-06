import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { XtreamAuthError, XtreamClient, detectTimeshiftDialect } from '@norstream/core';
import type { XtreamCredentials } from '@norstream/core';
import { createFetchImpl } from '../../net/fetchImpl.js';
import { saveSourceCredentials } from '../../storage/credentials.js';
import { addSource } from '../../storage/sources.js';
import { openDatabase } from '../../storage/db.js';
import { setPanelOffsetMinutes, setTimeshiftDialect } from '../../storage/settings.js';
import { theme } from '../../ui/theme.js';

interface Props {
  onDone: () => void;
  /**
   * Forklaring fra den rute der sendte brugeren hertil — f.eks. at panelet
   * afviste credentials, saa de blev slettet fra enheden.
   */
  notice?: string;
}

/**
 * Kort, sanitiseret beskrivelse af en forbindelsesfejl, saa brugeren kan
 * skelne "Android blokerede forespoergslen" fra "panelet er nede" fra
 * "forkert protokol". Credentials filtreres fra: stream- og API-URLer
 * indeholder adgangskoden, og fejl fra netvaerkslaget citerer ofte URLen.
 */
function describeFailure(cause: unknown, creds: XtreamCredentials): string {
  const raw = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  let safe = raw;
  if (creds.password.length > 0) safe = safe.split(creds.password).join('***');
  if (creds.username.length > 0) safe = safe.split(creds.username).join('***');
  return safe.slice(0, 300);
}

/** Et brugbart navn til kilden, taget af adressen. */
function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(url.trim());
  return match?.[1] ?? 'Panel';
}

export function OnboardingScreen({ onDone, notice }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);

    const creds: XtreamCredentials = {
      baseUrl: baseUrl.trim(),
      username: username.trim(),
      password,
    };
    const fetchImpl = createFetchImpl();

    // busy skal altid ryddes, uanset hvilken gren der returnerer eller
    // kaster — ellers kan skærmen gaa i staa med en spinner der aldrig
    // stopper og ingen mulighed for at proeve igen.
    try {
      try {
        await new XtreamClient(creds, fetchImpl).authenticate();
      } catch (cause) {
        setError(
          cause instanceof XtreamAuthError
            ? 'Brugernavn eller adgangskode blev afvist af panelet.'
            : `Kunne ikke nå panelet. Tjek adressen og din forbindelse.

Detalje: ${describeFailure(cause, creds)}`,
        );
        return;
      }

      // Kilden oprettes foerst, saa dens id findes at gemme kodeordet under.
      // Adgangskoden hoerer i Keychain; `sources`-tabellen har ingen kolonne
      // til den, og SQLite-filen er ikke krypteret.
      let sourceId: string;
      try {
        const db = await openDatabase();
        const source = await addSource(db, {
          kind: 'xtream',
          name: hostOf(creds.baseUrl),
          url: creds.baseUrl,
          username: creds.username,
        });
        sourceId = source.id;
        await saveSourceCredentials(sourceId, creds);
      } catch {
        // Uden gemte credentials kan appen ikke fortsaette — brugeren maa
        // blive paa skærmen og proeve igen, saa vi kalder ikke onDone().
        setError('Kunne ikke gemme dine adgangsoplysninger på denne enhed.');
        return;
      }

      // Probingen maa ikke kunne blokere onboardingen: uden arkiv virker alt
      // andet stadig, kun start-forfra er utilgaengeligt.
      try {
        const db = await openDatabase();
        const client = new XtreamClient(creds, fetchImpl);

        // Panelets offset fra UTC laeses foerst: bliver det gemt inden
        // probingen, bygger probe-URLerne paa det rigtige tidspunkt.
        // Null betyder at panelet ikke oplyste nok — saa beholder vi de
        // gemte 0 minutter, og probingen daekker afvigelsen med sit
        // 13-timers forsoeg.
        const offset = await client.getPanelOffsetMinutes();
        if (offset !== null) await setPanelOffsetMinutes(db, offset, sourceId);

        const streams = await client.getLiveStreams();
        const withArchive = streams.find((s) => s.hasArchive);
        if (withArchive) {
          const dialect = await detectTimeshiftDialect(
            creds,
            withArchive.id,
            fetchImpl,
            new Date(),
            offset ?? 0,
          );
          await setTimeshiftDialect(db, dialect, sourceId);
        }
      } catch {
        // Ignoreres med vilje — se kommentaren ovenfor.
      }

      onDone();
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    baseUrl.trim().length > 0 && username.trim().length > 0 && password.length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NorStream</Text>
      <Text style={styles.subtitle}>Forbind til dit panel</Text>

      {notice !== undefined && <Text style={styles.notice}>{notice}</Text>}

      <TextInput
        style={styles.input}
        placeholder="http://panel.example:8080"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        value={baseUrl}
        onChangeText={setBaseUrl}
      />
      <TextInput
        style={styles.input}
        placeholder="Brugernavn"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Adgangskode"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
        disabled={!canSubmit || busy}
        onPress={() => {
          void connect();
        }}
      >
        {busy ? (
          <ActivityIndicator color={theme.colors.text} />
        ) : (
          <Text style={styles.buttonText}>Forbind</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  title: { color: theme.colors.text, fontSize: 32, fontWeight: '700' },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 16,
  },
  notice: {
    color: theme.colors.textMuted,
    fontSize: 14,
    marginBottom: theme.spacing.md,
  },
  error: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    padding: theme.spacing.md,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
});
