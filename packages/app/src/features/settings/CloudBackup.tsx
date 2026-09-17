import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import {
  clearGoogleDrive,
  getGoogleDriveConfig,
  getGoogleDriveLastMs,
  setGoogleDriveClient,
  setGoogleDriveEnabled,
  setGoogleDriveRefreshToken,
} from '../../storage/settings.js';
import type { GoogleDriveConfig } from '../../storage/settings.js';
import { runWeeklyCloudBackup } from '../../storage/cloudBackup.js';
import { requestDeviceCode, pollToken, saveBackupToDrive } from './googleDrive.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';

interface Props {
  session: AppSession;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function whenText(ms: number | null): string {
  if (ms === null) return 'Endnu ikke gemt.';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `Sidst gemt ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. kl. ${pad(d.getHours())}:${pad(d.getMinutes())}.`;
}

/**
 * Gem sikkerhedskopien i Google Drev — ogsaa fra tv, hvor der ingen browser er.
 *
 * Login er OAuth-enhedsflowet: tv'et viser en kode, brugeren godkender paa
 * telefonen paa google.com/device, og tv'et venter paa svaret. Derefter
 * lgger appen kopien op selv, hver uge og paa "Gem nu". `drive.file` betyder
 * at appen kun kan se sine egne filer, ikke resten af Drevet.
 */
export function CloudBackup({ session }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const db = session.db;
  const [config, setConfig] = useState<GoogleDriveConfig | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState('https://www.google.com/device');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const polling = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    const [cfg, last] = await Promise.all([getGoogleDriveConfig(db), getGoogleDriveLastMs(db)]);
    setConfig(cfg);
    setLastMs(last);
    setClientId((current) => (current.length === 0 ? cfg.clientId : current));
    setClientSecret((current) => (current.length === 0 ? cfg.clientSecret : current));
  }, [db]);

  useEffect(() => {
    void reload();
    return () => {
      polling.current = false;
    };
  }, [reload]);

  async function login(): Promise<void> {
    if (busy) return;
    const cid = clientId.trim();
    const csec = clientSecret.trim();
    if (cid.length === 0 || csec.length === 0) {
      setMessage('Skriv både klient-id og klient-hemmelighed først.');
      return;
    }
    await setGoogleDriveClient(db, cid, csec);
    setBusy(true);
    setMessage('Henter en kode fra Google …');
    let device;
    try {
      device = await requestDeviceCode(cid);
    } catch (cause) {
      setBusy(false);
      setMessage(cause instanceof Error ? cause.message : 'Kunne ikke starte login.');
      return;
    }
    setUserCode(device.userCode);
    setVerifyUrl(device.verificationUrl);
    setMessage(null);
    let intervalMs = device.intervalSeconds * 1000;
    const deadline = Date.now() + device.expiresInSeconds * 1000;
    polling.current = true;
    while (polling.current && Date.now() < deadline) {
      await sleep(intervalMs);
      if (!polling.current) return;
      const poll = await pollToken(cid, csec, device.deviceCode);
      if (poll.status === 'ok') {
        polling.current = false;
        setUserCode(null);
        if (poll.refreshToken !== null) await setGoogleDriveRefreshToken(db, poll.refreshToken);
        await reload();
        setBusy(false);
        setMessage('Forbundet. Gemmer den første kopi …');
        await saveNow();
        return;
      }
      if (poll.status === 'slow_down') {
        intervalMs += 5000;
        continue;
      }
      if (poll.status === 'pending') continue;
      polling.current = false;
      setUserCode(null);
      setBusy(false);
      setMessage(poll.status === 'expired' ? 'Koden udløb. Prøv igen.' : 'Login blev afvist på telefonen.');
      return;
    }
    if (polling.current) {
      polling.current = false;
      setUserCode(null);
      setBusy(false);
      setMessage('Koden udløb, før den blev godkendt. Prøv igen.');
    }
  }

  function cancelLogin(): void {
    polling.current = false;
    setUserCode(null);
    setBusy(false);
    setMessage(null);
  }

  async function saveNow(): Promise<void> {
    setBusy(true);
    setMessage('Gemmer på Google Drev …');
    const result = await runWeeklyCloudBackup(db, (cfg, json) => saveBackupToDrive(cfg, json), Date.now(), true);
    await reload();
    setBusy(false);
    setMessage(
      result === 'written'
        ? 'Gemt på Google Drev.'
        : result === 'reauth'
          ? 'Login er udløbet. Log ind igen.'
          : result === 'off'
            ? 'Log ind først.'
            : 'Kunne ikke gemme lige nu. Prøv igen.',
    );
  }

  async function toggleWeekly(): Promise<void> {
    if (config === null) return;
    await setGoogleDriveEnabled(db, !config.enabled);
    await reload();
  }

  async function logout(): Promise<void> {
    cancelLogin();
    await clearGoogleDrive(db);
    await reload();
    setMessage('Logget ud af Google Drev.');
  }

  const connected = config !== null && config.refreshToken !== null;

  return (
    <View>
      <Text style={styles.sectionTitle}>Gem i skyen (Google Drev)</Text>

      {connected ? (
        <>
          <Text style={styles.hint}>Forbundet til Google Drev. {whenText(lastMs)}</Text>
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
          <TvPressable style={styles.row} onPress={() => void logout()}>
            <Text style={styles.rowTitle}>Log ud af Google Drev</Text>
          </TvPressable>
        </>
      ) : userCode !== null ? (
        <View style={styles.codeBox}>
          <Text style={styles.hint}>Gå til {verifyUrl} på din telefon eller computer, og skriv koden:</Text>
          <Text style={styles.code}>{userCode}</Text>
          <Text style={styles.hint}>Vælg din Google-konto og sig ja. Så er tv'et forbundet.</Text>
          <TvPressable style={styles.row} onPress={cancelLogin}>
            <Text style={styles.rowTitle}>Annullér</Text>
          </TvPressable>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            Så ligger en kopi af grupper, favoritter og indstillinger på dit eget Google Drev — også fra tv'et. Du
            logger ind én gang med en kode. Det kræver et Google-login til appen (klient-id og
            klient-hemmelighed); fremgangsmåden står i vejledningen.
          </Text>
          <TvTextInput
            style={styles.input}
            value={clientId}
            onChangeText={setClientId}
            placeholder="Klient-id"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <TvTextInput
            style={styles.input}
            value={clientSecret}
            onChangeText={setClientSecret}
            placeholder="Klient-hemmelighed"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <TvPressable style={[styles.row, styles.accentRow]} onPress={() => void login()}>
            <Text style={styles.rowTitle}>Log ind på Google Drev</Text>
            <Text style={styles.actionText}>Log ind</Text>
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
    codeBox: {
      backgroundColor: colors.surface,
      borderRadius: theme.radius,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    code: {
      color: colors.accent,
      fontSize: 34,
      fontWeight: '800',
      letterSpacing: 4,
      textAlign: 'center',
      marginVertical: theme.spacing.sm,
      fontVariant: ['tabular-nums'],
    },
    message: { color: colors.accent, fontSize: 13, marginBottom: theme.spacing.sm, lineHeight: 18 },
  });
