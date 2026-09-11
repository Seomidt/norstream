import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { theme } from './theme.js';
import type { ThemeColors } from './theme.js';
import { useStyles } from './ThemeContext.js';
import { isTV } from './tv.js';

interface Props extends Omit<PressableProps, 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * En Pressable der viser hvor fjernbetjeningens fokus er.
 *
 * Paa tv er fokus det eneste man har: uden en synlig ramme ved man ikke
 * hvad et tryk rammer. Paa telefonen er den en almindelig Pressable, uden
 * ekstra stil, saa det samme kort kan bruges begge steder.
 */
export function TvPressable({ style, onFocus, onBlur, children, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      {...rest}
      style={[style, isTV && focused && styles.focused]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    >
      {children}
      {/* Rammen som et lag oven paa: outline er ny i React Native, og
          skulle den ikke tegnes paa denne Android, staar rammen her
          alligevel. Den tager ingen tryk og aendrer ikke stoerrelsen. */}
      {isTV && focused && <View pointerEvents="none" style={styles.ring} />}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // Tydelig fra sofaen: hvid ramme uden om fladen, blaa toning af fladen,
  // og en anelse stoerre. Det er det eneste der viser hvor
  // fjernbetjeningen er. Rammen er en outline og ikke en border: en
  // border aendrer stoerrelsen, saa raekken hoppede naar den fik fokus,
  // og en blaa ramme paa en blaa flade (den valgte fane, en aktiv knap)
  // forsvandt. Hvid staar paa alt.
  focused: {
    outlineColor: colors.focusRing,
    outlineWidth: 3,
    outlineOffset: 2,
    outlineStyle: 'solid',
    borderRadius: theme.radius,
    backgroundColor: colors.focusTint,
    transform: [{ scale: 1.03 }],
  },
  ring: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderWidth: 3,
    borderColor: colors.focusRing,
    borderRadius: theme.radius + 2,
  },
});
