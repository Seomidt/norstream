import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from './ThemeContext.js';

/**
 * Hvor mange baand nedtoningen bygges af.
 *
 * React Native har ingen gradient uden et ekstra bibliotek. Stablede baand med
 * stigende uigennemsigtighed giver den samme bloede overgang, og paa den
 * halve skaerm det drejer sig om, kan man ikke se trinene. Et bibliotek mere
 * i en app der skal bygges paa EAS er en hoejere pris end tyve tomme Views.
 */
const BANDS = 20;

interface Props {
  /** Hvor stor en del af hoejden billedet fylder. */
  height: number | `${number}%`;
}

/**
 * Appens eget nordlys som baggrund.
 *
 * Billedet er appens ikon — samme nordlys, samme farver — vist stort og
 * nedtonet, med en overgang der loeber ud i baggrundsfarven. Der er ingen
 * fremmede billeder i appen, og der skal ikke hentes noget: filen ligger i
 * bundtet.
 */
export function Aurora({ height }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { height }]} pointerEvents="none">
      <Image
        source={require('../../assets/icon.png')}
        style={styles.image}
        resizeMode="cover"
      />
      <View style={styles.fade}>
        {Array.from({ length: BANDS }, (_, index) => (
          <View
            key={index}
            style={[
              styles.band,
              {
                backgroundColor: colors.background,
                // Kvadratisk frem for lineaert: overgangen begynder naesten
                // usynligt oppe i billedet og lukker helt i bunden, saa kanten
                // ikke tegner sig som en streg.
                opacity: ((index + 1) / BANDS) ** 2,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0 },
  image: { width: '100%', height: '100%', opacity: 0.75 },
  fade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'column' },
  band: { flex: 1 },
});
