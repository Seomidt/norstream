import { Image, StyleSheet, View } from 'react-native';
import { theme } from './theme.js';

/**
 * Appens maerke som et afrundet felt.
 *
 * Ikonet er kvadratisk og gaar helt til kanten, saa det skal klippes for ikke
 * at se ud som et skaermbillede der er lagt ind ved en fejl. Kanten omkring
 * loefter det fra baggrunden, som er det samme billede.
 */
export function Logo({ size = 88 }: { size?: number }) {
  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: Math.round(size / 4) },
      ]}
    >
      <Image
        source={require('../../assets/icon.png')}
        style={styles.image}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245, 245, 247, 0.18)',
    backgroundColor: theme.colors.surface,
  },
  image: { width: '100%', height: '100%' },
});
