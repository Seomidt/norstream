import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TvPressable } from '../../ui/TvPressable.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { activateDiagnostics, diagnosticState, sendDiagnosticReport, stopDiagnostics } from '../../diagnostics/runtime.js';

type State = Awaited<ReturnType<typeof diagnosticState>>;
export function DiagnosticSettings() {
  const styles = useStyles(makeStyles);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void diagnosticState().then(s => { if (alive) setState(s); }).catch(() => undefined); };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await action(); setState(await diagnosticState()); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Kunne ikke udføre handlingen. Prøv igen.'); }
    finally { setBusy(false); }
  }
  const enabled = state?.supportCode != null;
  return <View>
    <Text style={styles.title}>Automatisk fejlrapport</Text>
    <Text style={styles.hint}>Starter automatisk efter denne opdatering. Sender appversion, loglinjer og afspillerens tider og billedtællere. Ingen streamadresser, kodeord eller udsendelsestitler sendes. Stopper automatisk efter syv dage.</Text>
    {enabled ? <>
      <Text style={styles.hint}>Boks-id: {state.supportCode}{'\n'}Aktiv til {new Date(state.expiresAt!).toLocaleString('da-DK')}{'\n'}{state.failed ? 'Offline eller upload fejlede. Rapporten gemmes og forsøges igen.' : state.lastSent === null ? 'Venter på første upload.' : `Sidst sendt denne gang: ${new Date(state.lastSent).toLocaleTimeString('da-DK')}`}</Text>
      <View style={styles.actions}>
        <TvPressable style={styles.row} disabled={busy} onPress={() => { void run(sendDiagnosticReport); }}><Text style={styles.text}>Send rapport nu</Text></TvPressable>
        <TvPressable style={styles.row} disabled={busy} onPress={() => { void run(stopDiagnostics); }}><Text style={styles.text}>Slå fejlfinding fra</Text></TvPressable>
      </View>
    </> : <>
      <Text style={styles.hint}>{state?.phase === 'expired' ? 'Den syv dage lange fejlfinding er afsluttet.' : state?.phase === 'off' ? 'Automatisk fejlrapport er slået fra.' : 'Starter automatisk, når boksen har internet.'}</Text>
      <TvPressable style={styles.row} disabled={busy || state === null || state.phase === 'expired'} onPress={() => { void run(state?.phase === 'off' ? activateDiagnostics : stopDiagnostics); }}><Text style={styles.text}>{state?.phase === 'off' ? 'Slå fejlfinding til' : 'Slå fejlfinding fra'}</Text></TvPressable>
    </>}
    {busy && <Text style={styles.hint}>Arbejder…</Text>}
    {message !== null && <Text style={styles.hint}>{message}</Text>}
  </View>;
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  title: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  hint: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { backgroundColor: colors.surface, padding: 14, borderRadius: 8, marginBottom: 8 },
  text: { color: colors.text, fontSize: 15 },
});
