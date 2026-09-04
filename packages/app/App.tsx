import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { buildLiveUrl } from '@uhf-play/core';

const demoUrl = buildLiveUrl(
  { baseUrl: 'http://panel.example:8080', username: 'USER', password: 'PASS' },
  '1',
  'm3u8',
);

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>UHF Play</Text>
      <Text style={styles.proof}>{demoUrl}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101014',
  },
  title: { color: '#ffffff', fontSize: 28, fontWeight: '600' },
  proof: { color: '#9aa0a6', fontSize: 12, marginTop: 12 },
});
