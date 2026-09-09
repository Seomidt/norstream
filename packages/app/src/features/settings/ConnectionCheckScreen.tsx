import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { runConnectionCheck } from '../../net/connectionCheck.js';
import type { CheckReport, Probe } from '../../net/connectionCheck.js';
import { theme } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';

interface Props {
  session: AppSession;
  onBack: () => void;
}

const TIMEOUT_MS = 10_000;

/**
 * Ét kald med tidsgraense og egne hoveder. Ikke appens saedvanlige
 * `fetchImpl`: den kender ingen hoveder, og maalingen skal kunne sende et
 * `Host`-hoved til en adresse, saa panelet svarer som var det kaldt paa
 * sit navn. Nedkoelingen springes ogsaa over med vilje — det er netop et
 * afvist panel der skal maales paa.
 */
const probe: Probe = async (url, headers) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
};

const VERDICT_TITLES = {
  ok: 'Panelet kan nås herfra',
  'panel-refuses': 'Panelet afviser dette netværk',
  'dns-block': 'Navnet blokeres på dette netværk',
  'ip-block': 'Adressen er spærret på dette netværk',
  'no-internet': 'Intet internet',
  unknown: 'Kunne ikke afgøres',
} as const;

/**
 * Maalingen af vejen til panelet, koert fra telefonen paa det netvaerk den
 * staar paa. Meningen er at koere den to gange — paa Wi-Fi og paa mobildata
 * — og sammenligne. Rapporten rummer ingen adgangsoplysninger og kan sendes
 * videre som den er.
 */
export function ConnectionCheckScreen({ session, onBack }: Props) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const panelUrl = session.sources[0]?.source.url ?? null;

  async function run(): Promise<void> {
    if (panelUrl === null) return;
    setRunning(true);
    try {
      setReport(await runConnectionCheck(probe, panelUrl));
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={styles.container}>
      <TvPressable style={styles.crumb} onPress={onBack} hitSlop={8}>
        <Text style={styles.crumbBack}>‹</Text>
        <Text style={styles.crumbLabel}>Tjek forbindelsen</Text>
      </TvPressable>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Måler vejen fra telefonen til panelet, trin for trin: er der internet, svarer panelet
          på sit navn, hvad siger krypteret DNS at adressen er, og svarer panelet direkte på den.
          Kør den på Wi-Fi og på mobildata og sammenlign. Der sendes ingen adgangsoplysninger.
        </Text>
        {panelUrl === null ? (
          <Text style={styles.hint}>Ingen kilde at måle på.</Text>
        ) : (
          <TvPressable style={[styles.button, running && styles.buttonBusy]} disabled={running} onPress={() => void run()}>
            {running ? (
              <ActivityIndicator color={theme.colors.text} />
            ) : (
              <Text style={styles.buttonText}>{report === null ? 'Kør målingen' : 'Kør igen'}</Text>
            )}
          </TvPressable>
        )}
        {report !== null && (
          <View style={styles.report}>
            <Text style={styles.verdict}>{VERDICT_TITLES[report.verdict]}</Text>
            <Text style={styles.advice}>{report.advice}</Text>
            {report.steps.map((step, index) => (
              <View key={index} style={styles.step}>
                <Text style={[styles.mark, step.ok ? styles.markOk : styles.markBad]}>
                  {step.ok ? '✓' : '✕'}
                </Text>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDetail} selectable>
                    {step.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  crumbBack: { color: theme.colors.accent, fontSize: 26, marginRight: theme.spacing.sm },
  crumbLabel: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
  hint: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: theme.spacing.md },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm + 4,
    alignItems: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  report: { marginTop: theme.spacing.lg },
  verdict: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  advice: { color: theme.colors.text, fontSize: 14, lineHeight: 20, marginTop: theme.spacing.sm, marginBottom: theme.spacing.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: theme.spacing.sm },
  mark: { width: 24, fontSize: 16, fontWeight: '700' },
  markOk: { color: '#4ade80' },
  markBad: { color: '#f87171' },
  stepText: { flex: 1 },
  stepTitle: { color: theme.colors.text, fontSize: 15 },
  stepDetail: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
