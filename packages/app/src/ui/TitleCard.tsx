import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { TmdbTitle } from '../sync/tmdbHome.js';
import { theme } from './theme.js';
import type { ThemeColors } from './theme.js';
import { useStyles } from './ThemeContext.js';
import { TvPressable } from './TvPressable.js';
import { isTV } from './tv.js';

/** Bredden paa en plakat i hylderne (forsiden, biografen). */
export const TITLE_WIDTH = isTV ? 96 : 104;

/** En titel fra TMDB som plakat med navn og aar; bruges paa forsiden og i biografen. */
export const TitleCard = memo(function TitleCard({
  title,
  onPress,
  meta,
  preferFocus,
}: {
  title: TmdbTitle;
  onPress: () => void;
  /** Linjen under navnet; ellers aar og karakter. */
  meta?: string;
  /** Tv: kortet beder om fokus (én tegning ad gangen, se hasTVPreferredFocus). */
  preferFocus?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={styles.title} onPress={onPress} hasTVPreferredFocus={preferFocus === true}>
      <View style={styles.titleFrame}>
        {title.thumbUrl !== null ? (
          <Image source={{ uri: title.thumbUrl }} style={styles.titleImage} resizeMode="cover" />
        ) : (
          <View style={styles.titleFallback}>
            <Text style={styles.titleFallbackText} numberOfLines={4}>
              {title.title}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.titleName} numberOfLines={1}>
        {title.title}
      </Text>
      <Text style={styles.titleMeta} numberOfLines={1}>
        {meta ?? `${title.year ?? ''}${title.rating !== null ? `  ★ ${title.rating.toFixed(1)}` : ''}`}
      </Text>
    </TvPressable>
  );
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  title: { width: TITLE_WIDTH },
  titleFrame: {
    width: TITLE_WIDTH,
    height: TITLE_WIDTH * 1.5,
    borderRadius: theme.radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  titleImage: { width: '100%', height: '100%' },
  titleFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.sm },
  titleFallbackText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  titleName: { color: colors.text, fontSize: 12, marginTop: 4 },
  titleMeta: { color: colors.textMuted, fontSize: 11 },
});
