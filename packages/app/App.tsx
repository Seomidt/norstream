import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ChannelListScreen } from './src/features/channels/ChannelListScreen.js';
import { OnboardingScreen } from './src/features/onboarding/OnboardingScreen.js';
import { PlayerScreen } from './src/features/player/PlayerScreen.js';
import { createSession } from './src/session.js';
import type { AppSession } from './src/session.js';
import { loadCredentials } from './src/storage/credentials.js';
import type { StoredChannel } from './src/storage/channels.js';
import { theme } from './src/ui/theme.js';

type Route =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'channels' }
  | { name: 'player'; channel: StoredChannel };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      const creds = await loadCredentials();
      if (cancelled) return;
      if (creds === null) {
        setRoute({ name: 'onboarding' });
        return;
      }
      const created = await createSession(creds);
      if (cancelled) return;
      setSession(created);
      setRoute({ name: 'channels' });
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function afterOnboarding(): Promise<void> {
    const creds = await loadCredentials();
    if (creds === null) return;
    setSession(await createSession(creds));
    setRoute({ name: 'channels' });
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {route.name === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      )}
      {route.name === 'onboarding' && (
        <OnboardingScreen
          onDone={() => {
            void afterOnboarding();
          }}
        />
      )}
      {route.name === 'channels' && session !== null && (
        <ChannelListScreen
          session={session}
          onSelect={(channel) => setRoute({ name: 'player', channel })}
        />
      )}
      {route.name === 'player' && session !== null && (
        <PlayerScreen
          session={session}
          channel={route.channel}
          onBack={() => setRoute({ name: 'channels' })}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
