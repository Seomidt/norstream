import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from './initials.js';
import { theme } from './theme.js';

interface Props {
  /** Panelets `stream_icon`, eller null naar kanalen ingen har. */
  uri: string | null;
  name: string;
  size?: number;
}

/**
 * Kanalens logo, med kanalens forbogstaver som reserve.
 *
 * Der er to grunde til at det ikke bare er et `Image`.
 *
 * Den ene: mange kanaler paa dette panel har ingen `stream_icon`, og en tom
 * firkant ser ud som om appen har glemt at tegne noget. Forbogstaverne siger
 * "der er ikke noget logo" frem for ingenting.
 *
 * Den anden er vigtigere: et logo hvis URL svarer 404 eller ikke er et
 * billede, fejler **stille** i react-native. Uden `onError` staar der en tom
 * plads, og det ligner til forveksling en kanal uden logo — to fejl med hver
 * sin aarsag og samme udseende. Nu falder den tilbage til forbogstaverne, som
 * i det mindste er det samme udfald man kan forklare.
 */
export function ChannelLogo({ uri, name, size = 44 }: Props) {
  const [failed, setFailed] = useState(false);

  // Skifter raekken kanal — FlatList genbruger komponenter — skal en tidligere
  // fejl ikke haenge ved og skjule det naeste logo.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const box = { width: size, height: size, borderRadius: Math.round(size / 6) };

  if (uri === null || failed) {
    return (
      <View style={[styles.fallback, box]}>
        <Text style={[styles.initials, { fontSize: Math.round(size / 2.6) }]}>
          {initials(name)}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.image, box]}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: theme.colors.surface },
  fallback: {
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: theme.colors.textMuted, fontWeight: '700' },
});
