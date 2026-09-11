import { StyleSheet, Text } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';

/**
 * Pause og spoling til appens egen bjaelke.
 *
 * Paa tv er afspillerens indbyggede knapper slaaet fra (de tog
 * fjernbetjeningen), og saa var der intet at spole med: en udsendelse
 * startet forfra kunne ikke springe reklamerne over. Tre spring: 10 s
 * tilbage, 30 s frem og 3 minutter frem — et reklameblok i ét tryk.
 * Live-kanaler faar dem ikke; der er intet at spole i.
 */
export function SeekButtons({ player, playing }: { player: VideoPlayer; playing: boolean }) {
  const styles = useStyles(makeStyles);
  const seek = (seconds: number): void => {
    try {
      player.seekBy(seconds);
    } catch {
      // Afspilleren er vaek.
    }
  };
  return (
    <>
      <TvPressable
        style={styles.button}
        onPress={() => {
          try {
            if (player.playing) player.pause();
            else player.play();
          } catch {
            // Afspilleren er vaek.
          }
        }}
      >
        <Text style={styles.buttonText}>{playing ? '❚❚ Pause' : '▶ Afspil'}</Text>
      </TvPressable>
      <TvPressable style={styles.button} onPress={() => seek(-10)}>
        <Text style={styles.buttonText}>« 10 s</Text>
      </TvPressable>
      <TvPressable style={styles.button} onPress={() => seek(30)}>
        <Text style={styles.buttonText}>30 s »</Text>
      </TvPressable>
      <TvPressable style={styles.button} onPress={() => seek(180)}>
        <Text style={styles.buttonText}>3 min »</Text>
      </TvPressable>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
