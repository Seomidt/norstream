import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from './initials.js';
import { forgetLogo, recallLogo, rememberLogo } from './logoMemory.js';
import { theme } from './theme.js';

interface Props {
  /**
   * Adresser at proeve, i raekkefoelge. Mere end én fordi paneler tit oplyser
   * logoer paa en vaert der ikke kan naas, mens panelet selv virker.
   */
  uris: readonly string[];
  name: string;
  size?: number;
  /**
   * Kanalens noegle. Med den huskes hvilken adresse der virkede, saa naeste
   * gang begynder der frem for at proeve de doede forfra.
   */
  memoryKey?: string;
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
export function ChannelLogo({ uris, name, size = 44, memoryKey }: Props) {
  /** Der begyndes ved den adresse der virkede sidst, naar den stadig er i raekken. */
  const startAt = (): number => {
    if (memoryKey === undefined) return 0;
    const remembered = recallLogo(memoryKey);
    if (remembered === null) return 0;
    const index = uris.indexOf(remembered);
    return index === -1 ? 0 : index;
  };
  const [attempt, setAttempt] = useState(startAt);

  // Skifter raekken kanal — FlatList genbruger komponenter — skal et tidligere
  // mislykket forsoeg ikke haenge ved og skjule det naeste logo.
  const key = uris.join('|');
  useEffect(() => {
    setAttempt(startAt());
    // `startAt` laeser kun props der allerede er i afhaengighederne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, memoryKey]);

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
      onLoad={() => {
        if (memoryKey !== undefined) rememberLogo(memoryKey, uri);
      }}
      onError={() => {
        // Var det den huskede adresse der fejlede, huskes den ikke laengere —
        // ellers ville den blive proevet foerst igen naeste gang.
        if (memoryKey !== undefined && recallLogo(memoryKey) === uri) forgetLogo(memoryKey);
        setAttempt((current) => current + 1);
      }}
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
