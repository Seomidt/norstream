import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from './initials.js';
import { theme } from './theme.js';

interface Props {
  /**
   * Adresser at proeve, i raekkefoelge. Mere end én fordi paneler tit oplyser
   * logoer paa en vaert der ikke kan naas, mens panelet selv virker.
   */
  uris: readonly string[];
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
export function ChannelLogo({ uris, name, size = 44 }: Props) {
  const [attempt, setAttempt] = useState(0);

  // Skifter raekken kanal — FlatList genbruger komponenter — skal et tidligere
  // mislykket forsoeg ikke haenge ved og skjule det naeste logo.
  const key = uris.join('|');
  useEffect(() => {
    setAttempt(0);
  }, [key]);

  const uri = uris[attempt];
  const box = { width: size, height: size, borderRadius: Math.round(size / 6) };

  if (uri === undefined) {
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
      onError={() => setAttempt((current) => current + 1)}
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
