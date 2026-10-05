import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { logEvent } from '../../diagnostics/log.js';
import { webView } from './webview.js';
import { buildMpd } from './youtubeStream.js';
import { completeProofFile, isProofResult, proofRequestAllowed } from './youtubeProof.js';
import { youtubeProofBundle, youtubeProofLicenses } from './generated/youtubeProofBundle.js';

const PROOF_ORIGIN = 'https://www.youtube.com';
const ProofWebView = webView();
const DEADLINE_MS = 90_000;

/** Beviset og adresserne oprettes paa samme boks/session, aldrig paa serveren. */
export function YoutubeProof({ id, onResolved, onFailed }: {
  id: string;
  onResolved: (result: { uri: string; seconds: number; height: number; files: File[] }) => void;
  onFailed: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [notice, setNotice] = useState('Forbereder trailer …');
  const web = useRef<WebView>(null);
  const alive = useRef(false);
  const finished = useRef(false);
  const transferred = useRef(false);
  const resolving = useRef(false);
  const files = useRef<File[]>([]);
  const controller = useRef(new AbortController());
  const handlers = useRef({ onResolved, onFailed });
  handlers.current = { onResolved, onFailed };
  const source = useMemo(() => ({ baseUrl: PROOF_ORIGIN, html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>${youtubeProofBundle}</script><!-- ${youtubeProofLicenses.replace(/--/g, '')} --></body></html>` }), []);

  function fail(reason: string) {
    if (!alive.current || finished.current) return;
    finished.current = true;
    controller.current.abort();
    logEvent('trailer', `YouTube PO: ${reason}; stopper uden reserveafspiller`);
    handlers.current.onFailed();
  }
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => fail('tidsfrist'), DEADLINE_MS);
    if (!ProofWebView) fail('ingen WebView');
    return () => {
      alive.current = false;
      clearTimeout(timer);
      controller.current.abort();
      if (!transferred.current) for (const file of files.current) { try { if (file.exists) file.delete(); } catch {} }
    };
    // Én ny komponent per video. Callbacks laeses via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function network(message: Record<string, unknown>) {
    const serial = message.serial;
    const url = message.url;
    const method = message.method;
    if (!Number.isSafeInteger(serial) || Number(serial) < 1 || Number(serial) > 100 || typeof url !== 'string' || typeof method !== 'string' || !proofRequestAllowed(url, method)) { fail('afvist forespoergsel'); return; }
    const local = new AbortController();
    const abort = () => local.abort();
    controller.current.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15_000);
    let reply: Record<string, unknown> = { serial, error: true };
    try {
      const headers: Record<string, string> = {};
      if (message.headers && typeof message.headers === 'object') for (const [key, value] of Object.entries(message.headers)) {
        if (typeof value === 'string' && !/[\r\n]/.test(value) && /^(?:accept|accept-language|content-type|user-agent|origin|x-[a-z0-9-]+)$/i.test(key)) headers[key] = value;
      }
      const r = await fetch(url, { method, headers, body: typeof message.body === 'string' ? message.body : undefined, signal: local.signal });
      const body = await r.text();
      if (body.length > 8 * 1024 * 1024) throw new Error('Stor krop');
      const responseHeaders: Record<string, string> = {};
      r.headers.forEach((value, key) => { if (key.toLowerCase() !== 'set-cookie') responseHeaders[key] = value; });
      reply = { serial, status: r.status, headers: responseHeaders, body };
    } catch { /* Broen sender en afvist forespoergsel, aldrig adresser/noegler i log. */ }
    finally { clearTimeout(timer); controller.current.signal.removeEventListener('abort', abort); }
    if (alive.current && !finished.current) web.current?.injectJavaScript(`window.NorStreamProofReply(${JSON.stringify(reply)});true;`);
  }
  async function resolved(message: Record<string, unknown>) {
    if (resolving.current) return;
    resolving.current = true;
    if (!isProofResult(message)) { fail('ugyldigt format'); return; }
    if (message.video.height! < 720) { fail('ingen HD-video'); return; }
    setNotice('Henter hele traileren …');
    try {
      const localMedia = await Promise.all([message.video, message.audio].map(async (media, index) => {
        const file = new File(Paths.cache, `trailer-proof-${id}-${Date.now()}-${index}.mp4`);
        files.current.push(file);
        await File.downloadFileAsync(media.url, file, { headers: { 'User-Agent': message.userAgent }, signal: controller.current.signal });
        if (!alive.current || finished.current) { try { if (file.exists) file.delete(); } catch {} throw new Error('Lukket'); }
        if (!completeProofFile(file.size, media.contentLength)) throw new Error('Ufuldstaendig fil');
        return { ...media, url: file.uri };
      }));
      if (!alive.current || finished.current) return;
      const mpd = new File(Paths.cache, `trailer-proof-${id}-${Date.now()}.mpd`);
      files.current.push(mpd);
      mpd.create(); mpd.write(buildMpd(localMedia[0], localMedia[1], message.seconds));
      finished.current = true;
      transferred.current = true;
      logEvent('trailer', `YouTube PO: hele video+lyd hentet, ${message.video.height}p, ${Math.round(message.seconds)} s`);
      const codec = /codecs="([A-Za-z0-9., ]+)"/.exec(message.video.mimeType ?? '')?.[1] ?? '?';
      logEvent('trailer', `YouTube PO: ${codec}, ${message.video.fps ?? '?'} fps, ${message.video.contentLength} videobytes`);
      handlers.current.onResolved({ uri: mpd.uri, seconds: message.seconds, height: message.video.height!, files: files.current });
    } catch { fail('filen kunne ikke hentes helt'); }
  }
  function onMessage(event: WebViewMessageEvent) {
    if (!alive.current || finished.current) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(event.nativeEvent.data); if (!message || typeof message !== 'object') return; } catch { return; }
    if (message.type === 'ready') web.current?.injectJavaScript(`window.NorStreamProofStart(${JSON.stringify(id)});true;`);
    else if (message.type === 'request') void network(message);
    else if (message.type === 'attested') logEvent('trailer', 'YouTube PO: aegte bevis modtaget');
    else if (message.type === 'resolved') void resolved(message);
    else if (message.type === 'failed') {
      const phase = typeof message.phase === 'string' && /^(session|challenge|interpreter|snapshot|integrity|player|formats|decipher)$/.test(message.phase) ? message.phase : 'ukendt';
      fail(`afvist i ${phase}`);
    }
  }
  return <View style={styles.root}>
    {ProofWebView && <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants"><ProofWebView
      ref={web} source={source} style={styles.root}
      javaScriptEnabled domStorageEnabled sharedCookiesEnabled
      originWhitelist={['https://*']} onMessage={onMessage}
      onError={() => fail('WebView-fejl')} onRenderProcessGone={() => fail('WebView-lukket')}
      onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url === PROOF_ORIGIN || r.url === `${PROOF_ORIGIN}/`}
    /></View>}
    <ActivityIndicator color={colors.accent} /><Text style={styles.notice}>{notice}</Text>
  </View>;
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
  hidden: { position: 'absolute', inset: 0, opacity: 0 },
  notice: { color: colors.textMuted, fontSize: 14, marginTop: 10 },
});
