import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { theme } from './theme.js';
import { isTV } from './tv.js';

interface Props extends PressableProps {
  style?: StyleProp<ViewStyle>;
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  focused: {
    borderColor: theme.colors.accent,
    borderWidth: 2,
    transform: [{ scale: 1.04 }],
  },
});
