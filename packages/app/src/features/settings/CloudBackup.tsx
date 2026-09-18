import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { clearSky, getSkyConfig, getSkyLastMs, setSkyCode, setSkyEnabled } from '../../storage/settings.js';
import type { SkyBackupConfig } from '../../storage/settings.js';
import { runWeeklyCloudBackup } from '../../storage/cloudBackup.js';
import { loadSourceCredentials } from '../../storage/credentials.js';
import { loadFromCloud, saveToCloud, MIN_CODE_LENGTH } from './cloudSync.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';

interface Props {
  session: AppSession;
  /** Gendanner en hentet kopi (samme vej som Gendan fra link). */
  onRestore: (json: string) => Promise<void>;
}

function whenText(ms: number | null): string {
  if (ms === null) return 'Endnu ikke gemt.';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `Sidst gemt ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. kl. ${pad(d.getHours())}:${pad(d.getMinutes())}.`;
}

/**
 * Gem sikkerhedskopien i skyen — ogsaa fra tv, uden login.
 *
 * Brugeren vaelger ét kodeord. Kopien af grupper, favoritter og indstillinger
 * lgges krypteret op i skyen (kodeordet er noeglen; adressen ligger aldrig i
 * klartekst). Samme kodeord paa en ny boks henter den samme kopi ned igen.
 * Kun ét tekstfelt — ingen enhedskode, ingen Google, og ingen upaalidelig
 * pil-ned mellem felter paa tv.
 */
export function CloudBackup({ session, onRestore }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const db = session.db;
  const [config, setConfig] = useState<SkyBackupConfig | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [cfg, last] = await Promise.all([getSkyConfig(db), getSkyLastMs(db)]);
    setConfig(cfg);
    setLastMs(last);
    setCode((current) => (current.length === 0 ? cfg.code : current));
  }, [db]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function checkedCode(): string | null {
    const trimmed = code.trim();
    if (trimmed.length < MIN_CODE_LENGTH) {
      setMessage(`Vælg et kodeord på mindst ${MIN_CODE_LENGTH} tegn først.`);
      return null;
    }
    return trimmed;
  }

  async function saveNow(): Promise<void> {
    if (busy) return;
    const trimmed = checkedCode();
    if (trimmed === null) return;
    setBusy(true);
    setMessage('Gemmer i skyen …');
    await setSkyCode(db, trimmed);
    const result = await runWeeklyCloudBackup(
      db,
      (c, json) => saveToCloud(c, json),
      Date.now(),
      true,
      (id) => loadSourceCredentials(id),
    );
    await reload();
    setBusy(false);
    setMessage(
      result === 'written'
        ? 'Gemt i skyen. Skriv det samme kodeord på en ny boks for at hente alt ned.'
        : 'Kunne ikke gemme lige nu. Er der forbindelse? Prøv igen.',
    );
  }

  async function restore(): Promise<void> {
    if (busy) return;
    const trimmed = checkedCode();
    if (trimmed === null) return;
    setBusy(true);
    setMessage('Henter fra skyen …');
    try {
      const json = await loadFromCloud(trimmed);
      await onRestore(json);
      await setSkyCode(db, trimmed);
      setMessage('Hentet fra skyen. Grupper, favoritter og alt er gendannet.');
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : '';
      setMessage(
        msg === 'notfound'
          ? 'Der ligger ingen kopi under det kodeord. Tjek at det er skrevet præcis som på den anden boks — eller tryk "Gem nu" på den gamle boks først.'
          : msg === 'network'
            ? 'Ingen forbindelse til skyen. Prøv igen.'
            : 'Kunne ikke hente lige nu. Prøv igen.',
      );
    } finally {
      setBusy(false);
      await reload();
    }
  }

  async function toggleWeekly(): Promise<void> {
    if (config === null) return;
    await setSkyEnabled(db, !config.enabled);
    await reload();
  }

  async function forget(): Promise<void> {
    await clearSky(db);
    setCode('');
    await reload();
    setMessage('Kodeordet er glemt på denne boks. Kopien i skyen er der stadig.');
  }

  const connected = config !== null && config.code !== '';

  return (
    <View>
      <Text style={styles.sectionTitle}>Gem i skyen</Text>

      {connected ? (
        <>
          <Text style={styles.hint}>Kopien gemmes i skyen med dit kodeord. {whenText(lastMs)}</Text>
          <TvPressable style={styles.row} onPress={() => void toggleWeekly()}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Gem automatisk hver uge</Text>
              <Text style={styles.rowHint}>Kopien med grupper, favoritter og indstillinger lægges op af sig selv.</Text>
            </View>
            <Text style={[styles.actionText, config?.enabled === true && styles.on]}>
              {config?.enabled === true ? 'Til' : 'Fra'}
            </Text>
          </TvPressable>
          <TvPressable style={styles.row} onPress={() => void saveNow()}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Gem nu</Text>
            </View>
            <Text style={styles.actionText}>Gem</Text>
          </TvPressable>
          <TvPressable style={styles.row} onPress={() => void restore()}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Hent fra skyen</Text>
              <Text style={styles.rowHint}>På en ny boks: henter kopien ned og gendanner grupper, favoritter og alt.</Text>
            </View>
            <Text style={styles.actionText}>Hent</Text>
          </TvPressable>
          <TvPressable style={styles.row} onPress={() => void forget()}>
            <Text style={styles.rowTitle}>Glem kodeord på denne boks</Text>
          </TvPressable>
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            Vælg et kodeord, du kan huske. Så gemmes en kopi af grupper, favoritter og indstillinger krypteret i
            skyen — også fra tv'et, uden login. Skriv det <Text style={styles.bold}>samme kodeord</Text> på en ny boks
            og tryk "Hent" for at få det hele ned igen.
          </Text>
          <TvTextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Kodeord (dit eget, mindst 4 tegn)"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => void saveNow()}
          />
          <TvPressable style={[styles.row, styles.accentRow]} onPress={() => void saveNow()}>
            <Text style={styles.rowTitle}>Gem i skyen</Text>
            <Text style={styles.actionText}>Gem</Text>
          </TvPressable>
          <TvPressable style={styles.row} onPress={() => void restore()}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Hent fra skyen</Text>
              <Text style={styles.rowHint}>Ny boks? Skriv kodeordet ovenfor og hent alt ned.</Text>
            </View>
            <Text style={styles.actionText}>Hent</Text>
          </TvPressable>
        </>
      )}

      {message !== null && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sectionTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'uppercase',
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
    hint: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: theme.spacing.sm },
    bold: { color: colors.text, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: theme.radius,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    accentRow: { backgroundColor: colors.surfaceRaised },
    rowText: { flex: 1, marginRight: theme.spacing.md },
    rowTitle: { flex: 1, color: colors.text, fontSize: 15 },
    rowHint: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
    actionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    on: { color: colors.accent },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      color: colors.text,
      padding: theme.spacing.sm + 2,
      marginBottom: theme.spacing.sm,
      fontSize: 15,
    },
    message: { color: colors.accent, fontSize: 13, marginBottom: theme.spacing.sm, lineHeight: 18 },
  });
