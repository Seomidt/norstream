import { useEffect, useReducer, useState } from 'react';
import type { ReactElement } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials, tileColour } from './initials.js';
import { cachedLogoUri, ensureLogo, logoFailedToRender, subscribeLogo } from './logoCache.js';
import { useStyles } from './ThemeContext.js';
import type { ThemeColors } from './theme.js';

interface Props {
  /**
   * Adresser at proeve, i raekkefoelge. Mere end én fordi paneler tit oplyser
   * logoer paa en vaert der ikke kan naas, mens panelet selv virker.
   */
  uris: readonly string[];
  name: string;
  size?: number;
  /**
   * Kanalens noegle. Med den hentes logoet ned paa telefonen én gang og
   * tegnes derefter fra filen, uden netvaerk. Uden den proeves adresserne
   * direkte, hver gang.
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
 *
 * Selve hentningen ligger i `logoCache`: logoet hentes én gang til en fil,
 * og her tegnes filen. Netvaerket roeres kun for kanaler uden fil.
 */
export function ChannelLogo({ uris, name, size = 44, memoryKey }: Props) {
  const styles = useStyles(makeStyles);
  const box = { width: size, height: size, borderRadius: Math.round(size / 6) };
  const fallback = (
    <View style={[styles.fallback, box, { backgroundColor: tileColour(name) }]}>
      <Text style={[styles.initials, { fontSize: Math.round(size / 2.6) }]}>{initials(name)}</Text>
    </View>
  );

  if (memoryKey === undefined) {
    return <DirectLogo uris={uris} box={box} fallback={fallback} />;
  }
  return <CachedLogo uris={uris} memoryKey={memoryKey} box={box} fallback={fallback} />;
}

interface Box {
  width: number;
  height: number;
  borderRadius: number;
}

function CachedLogo({
  uris,
  memoryKey,
  box,
  fallback,
}: {
  uris: readonly string[];
  memoryKey: string;
  box: Box;
  fallback: ReactElement;
}) {
  const styles = useStyles(makeStyles);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const key = uris.join('|');
  useEffect(() => {
    ensureLogo(memoryKey, uris);
    return subscribeLogo(memoryKey, redraw);
    // Adresserne sammenlignes paa indhold: listen bygges ny ved hver laesning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryKey, key]);

  const uri = cachedLogoUri(memoryKey);
  if (uri === null) return fallback;

  return (
    <Image
      source={{ uri }}
      style={[styles.image, box]}
      resizeMode="contain"
      onError={() => {
        void logoFailedToRender(memoryKey, uris);
      }}
    />
  );
}

/** Uden noegle: adresserne proeves i raekkefoelge, som `Image` nu engang goer det. */
function DirectLogo({
  uris,
  box,
  fallback,
}: {
  uris: readonly string[];
  box: Box;
  fallback: ReactElement;
}) {
  const styles = useStyles(makeStyles);
  const [attempt, setAttempt] = useState(0);
  const key = uris.join('|');
  useEffect(() => {
    setAttempt(0);
  }, [key]);

  const uri = uris[attempt];
  if (uri === undefined) return fallback;
  return (
    <Image
      source={{ uri }}
      style={[styles.image, box]}
      resizeMode="contain"
      onError={() => setAttempt((current) => current + 1)}
    />
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // Bag logoet: paa lyst en moerk plade, ellers forsvinder hvide logoer.
  image: { backgroundColor: colors.logoBackdrop },
  fallback: {
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: '#ffffff', fontWeight: '700' },
});
