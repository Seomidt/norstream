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
  // Tydelig fra sofaen: hvid ramme uden om fladen, blaa toning af fladen,
  // og en anelse stoerre. Det er det eneste der viser hvor
  // fjernbetjeningen er. Rammen er en outline og ikke en border: en
  // border aendrer stoerrelsen, saa raekken hoppede naar den fik fokus,
  // og en blaa ramme paa en blaa flade (den valgte fane, en aktiv knap)
  // forsvandt. Hvid staar paa alt.
  focused: {
    outlineColor: '#ffffff',
    outlineWidth: 3,
    outlineOffset: 2,
    outlineStyle: 'solid',
    borderRadius: theme.radius,
    backgroundColor: 'rgba(76, 141, 255, 0.3)',
    transform: [{ scale: 1.03 }],
  },
});
