import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { TvTextInput } from '../../ui/TvTextInput.js';
import { isTV } from '../../ui/tv.js';
import { QrCode } from './QrCode.js';
import { QrScanner } from './QrScanner.js';
import { sendToTv, startReceiver, stopReceiver, subscribeReceived } from '../../../modules/local-backup/index.js';

interface Props {
  /** Bygger filen der skal sendes (telefon). */
  buildBackup: () => Promise<string>;
  /** Gendanner en modtaget fil (tv). */
  onReceived: (json: string) => Promise<void>;
}

/** Praefiks paa QR-teksten, saa scanneren ved at det er en NorStream-adresse. */
const QR_PREFIX = 'NS';

/** En firecifret kode, saa kun den rigtige telefon rammer tv'et. */
function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Sikkerhedskopi direkte mellem telefon og tv paa det lokale wi-fi.
 *
 * Tv'et modtager: det starter en lille server og viser sin adresse og en
 * kode. Telefonen sender: man taster tv'ets adresse og kode og trykker
 * send. Ingen sky, ingen konto, intet USB.
 */
export function LocalTransfer({ buildBackup, onReceived }: Props) {
  const styles = useStyles(makeStyles);

  if (isTV) return <Receive onReceived={onReceived} styles={styles} />;
  return <Send buildBackup={buildBackup} styles={styles} />;
}

function Receive({ onReceived, styles }: { onReceived: (json: string) => Promise<void>; styles: Styles }) {
  const [state, setState] = useState<'off' | 'waiting' | 'done' | 'error'>('off');
  const [where, setWhere] = useState<{ ip: string | null; port: number; pin: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pin = useRef(randomPin());

  useEffect(() => () => stopReceiver(), []);

  const start = async (): Promise<void> => {
    setMessage(null);
    try {
      const receiver = await startReceiver(pin.current);
      if (receiver.ip === null) {
        setState('error');
        setMessage('Tv’et er ikke på wi-fi. Slut det til samme net som telefonen.');
        return;
      }
      setWhere({ ip: receiver.ip, port: receiver.port, pin: pin.current });
      setState('waiting');
    } catch {
      setState('error');
      setMessage('Modtageren kunne ikke startes.');
    }
  };

  useEffect(() => {
    if (state !== 'waiting') return;
    const unsubscribe = subscribeReceived((json) => {
      stopReceiver();
      setState('done');
      void onReceived(json);
    });
    return unsubscribe;
  }, [state, onReceived]);

  return (
    <>
      <Text style={styles.sectionTitle}>Hent fra telefonen</Text>
      <Text style={styles.hint}>
        Modtag sikkerhedskopien direkte fra telefonen på jeres eget wi-fi — uden sky, konto eller
        USB. Log ind på panelet her først, tryk Modtag, og skriv så tv’ets adresse og kode på
        telefonen under Send til tv.
      </Text>
      {state === 'off' || state === 'error' ? (
        <TvPressable style={styles.row} onPress={() => void start()} hasTVPreferredFocus={isTV}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Modtag fra telefon</Text>
            <Text style={styles.rowHint}>Tv’et begynder at lytte og viser sin adresse og kode.</Text>
          </View>
          <Text style={styles.action}>Modtag</Text>
        </TvPressable>
      ) : state === 'waiting' && where !== null ? (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>På telefonen: Send til tv → Scan QR</Text>
          <QrCode value={`${QR_PREFIX}:${where.ip}:${where.port}:${where.pin}`} size={240} />
          <Text style={styles.panelLabel}>Eller tast selv</Text>
          <Text style={styles.panelBig}>{where.ip}:{where.port}</Text>
          <Text style={styles.panelLabel}>Kode</Text>
          <Text style={styles.panelBig}>{where.pin}</Text>
          <Text style={styles.rowHint}>Venter på telefonen …</Text>
        </View>
      ) : (
        <Text style={styles.hint}>Sikkerhedskopien er modtaget og gendannet.</Text>
      )}
      {message !== null && <Text style={styles.hint}>{message}</Text>}
    </>
  );
}

function Send({ buildBackup, styles }: { buildBackup: () => Promise<string>; styles: Styles }) {
  const [address, setAddress] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const sendTo = async (ip: string, port: number, code: string): Promise<void> => {
    setBusy(true);
    setMessage('Sender …');
    try {
      await sendToTv(ip, port, code, await buildBackup());
      setMessage('Sendt. Tv\u2019et gendanner nu.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Kunne ikke sende.');
    } finally {
      setBusy(false);
    }
  };

  const onScanned = (value: string): void => {
    setScanning(false);
    const match = /^NS:(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5}):(\d{4})$/.exec(value.trim());
    if (match === null) {
      setMessage('Det var ikke en NorStream-kode. Prøv igen, eller tast adressen.');
      return;
    }
    setAddress(`${match[1]}:${match[2]}`);
    setPin(match[3]!);
    void sendTo(match[1]!, Number(match[2]), match[3]!);
  };

  const send = async (): Promise<void> => {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/.exec(address.trim());
    if (match === null) {
      setMessage('Skriv tv’ets adresse som fx 192.168.1.42:41234, sådan som tv’et viser den.');
      return;
    }
    if (pin.trim().length !== 4) {
      setMessage('Koden er fire cifre, som tv’et viser.');
      return;
    }
    await sendTo(match[1]!, Number(match[2]), pin.trim());
  };

  return (
    <>
      <Text style={styles.sectionTitle}>Send til tv</Text>
      <Text style={styles.hint}>
        Send sikkerhedskopien direkte til tv’et på jeres eget wi-fi. På tv’et: Indstillinger →
        Hent fra telefonen → Modtag. Scan så QR-koden, eller tast adressen og koden.
      </Text>
      <TvPressable style={styles.row} disabled={busy} onPress={() => setScanning(true)}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Scan QR fra tv’et</Text>
          <Text style={styles.rowHint}>Åbner kameraet. Ret det mod koden på tv’et, så sendes filen selv.</Text>
        </View>
        <Text style={styles.action}>Scan</Text>
      </TvPressable>
      <TvTextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="Tv’ets adresse, fx 192.168.1.42:41234"
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />
      <TvTextInput
        style={styles.input}
        value={pin}
        onChangeText={setPin}
        placeholder="Kode (fire cifre)"
        autoCorrect={false}
        keyboardType="number-pad"
        maxLength={4}
      />
      <TvPressable style={styles.row} disabled={busy} onPress={() => void send()}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Send til tv</Text>
          <Text style={styles.rowHint}>Filen sendes direkte over wi-fi. Tv’et gendanner den.</Text>
        </View>
        <Text style={styles.action}>Send</Text>
      </TvPressable>
      {message !== null && <Text style={styles.hint}>{message}</Text>}
      {scanning && <QrScanner onScanned={onScanned} onClose={() => setScanning(false)} />}
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: theme.spacing.lg, letterSpacing: 1 },
    hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: theme.spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    rowText: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: 15 },
    rowHint: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
    action: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      color: colors.text,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm + 2,
      fontSize: 16,
      marginTop: theme.spacing.sm,
    },
    panel: {
      backgroundColor: colors.surface,
      borderRadius: theme.radius,
      padding: theme.spacing.md,
      marginTop: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    panelLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
    panelBig: { color: colors.text, fontSize: 24, fontWeight: '800' },
  });
