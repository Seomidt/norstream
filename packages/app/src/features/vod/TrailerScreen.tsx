import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
 * i appens afspiller goer de ikke, og det ville braekke naar de aendrer
 * noget. Prisen er ét native modul mere, `react-native-webview`.
 *
 * `playsinline` holder afspilningen i rammen frem for i telefonens egen
 * fuldskaerm; `mediaPlaybackRequiresUserAction` slaas fra, saa traileren
 * starter ved tryk paa knappen og ikke kraever et tryk mere inde i rammen.
 */
export function TrailerScreen({ trailerId, title, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Kun id'et bygges ind. Det er et YouTube-id (11 tegn) og ikke fri tekst.
  const embed = `https://www.youtube.com/embed/${encodeURIComponent(trailerId)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        {!failed && (
          <WebView
            source={{ uri: embed }}
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
      </View>
    </View>
  );
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
