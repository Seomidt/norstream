import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { theme } from '../../ui/theme.js';

interface Props {
  trailerId: string;
  title: string;
  onBack: () => void;
}

/**
 * Traileren, inde i appen.
 *
 * YouTubes egen indlejrede afspiller i en webvisning. Det er den maade
 * YouTube selv stiller til raadighed — at traekke videofilen ud og spille den
 * i appens afspiller goer de ikke, og det ville braekke naar de aendrer noget.
 *
 * **Afspilleren ligger i en lille side, ikke som en adresse for sig.** Foerste
 * udgave aabnede `youtube.com/embed/<id>` direkte, og YouTube svarede
 * "Konfigurationsfejl i videoafspiller, fejl 153". Fejl 153 er at der ikke
 * fulgte en `Referer` med: en indlejret afspiller vil vide hvilken side den
 * sidder paa. Med en side og en base-adresse sender webvisningen den, og
 * afspilleren starter.
 */
export function TrailerScreen({ trailerId, title, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        {!failed && (
          <WebView
            source={{ html: embedPage(trailerId), baseUrl: 'https://www.youtube.com' }}
            originWhitelist={['*']}
            style={styles.web}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
          />
        )}
        {loading && !failed && (
          <View style={styles.overlay}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        )}
        {failed && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>Traileren kunne ikke hentes fra YouTube.</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.hint}>Trailer fra YouTube</Text>
      </View>
      <View style={[styles.actions, { paddingBottom: theme.spacing.md + insets.bottom }]}>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Tilbage</Text>
        </Pressable>
        {/* Altid, ikke kun ved fejl: nogle trailere maa ifoelge deres ejer
            ikke vises uden for YouTube, og saa er det her den eneste vej. */}
        <Pressable
          style={styles.button}
          onPress={() => {
            void Linking.openURL(`https://www.youtube.com/watch?v=${trailerId}`).catch(() => undefined);
          }}
        >
          <Text style={styles.buttonText}>Åbn i YouTube</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Siden afspilleren sidder paa. Kun id'et bygges ind, og det er et
 * YouTube-id paa elleve tegn — aldrig fri tekst — saa der kan ikke lukkes
 * noget ind i siden gennem det.
 */
export function embedPage(trailerId: string): string {
  const id = trailerId.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1"
allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  errorText: { color: theme.colors.text, textAlign: 'center' },
  info: { flex: 1, padding: theme.spacing.md, backgroundColor: theme.colors.background },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4 },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  button: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
  },
  buttonText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
});
