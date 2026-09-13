import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { theme } from './theme.js';
import type { ThemeColors } from './theme.js';
import { useStyles } from './ThemeContext.js';
import { isTV } from './tv.js';
import { forgetPressable, notePressed, registerPressable } from './refocus.js';

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
export function TvPressable({ style, onFocus, onBlur, onPress, onLongPress, hasTVPreferredFocus, children, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const styles = useStyles(makeStyles);
  // Paa tv huskes trykket, saa skaermen kan bede om fokus tilbage hertil
  // naar det der aabnede oven paa (afspiller, ark) lukker igen. Se refocus.ts.
  const [forced, setForced] = useState(false);
  const entry = useRef(isTV ? registerPressable(() => setForced(true)) : null);
  useEffect(() => {
    const own = entry.current;
    return () => {
      if (own !== null) forgetPressable(own);
    };
  }, []);
  useEffect(() => {
    if (!forced) return;
    const frame = requestAnimationFrame(() => setForced(false));
    return () => cancelAnimationFrame(frame);
  }, [forced]);
  const note = (): void => {
    if (entry.current !== null) notePressed(entry.current);
  };
  return (
    <Pressable
      {...rest}
      hasTVPreferredFocus={hasTVPreferredFocus === true || forced}
      onPress={
        onPress == null && onLongPress == null
          ? undefined
          : (event) => {
              note();
              onPress?.(event);
            }
      }
      onLongPress={
        onLongPress == null
          ? undefined
          : (event) => {
              note();
              onLongPress?.(event);
            }
      }
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
    // Googles fokusskalering: 1,025 til 1,1; knapper 1,1. 1,05 passer til raekker og kort.
    transform: [{ scale: 1.05 }],
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
    // Toningen ligger som et lag oven paa knappens egen farve, ikke i
    // stedet for den: som baggrund gjorde 18 % blaat en knap paa
    // afspillerens sorte bjaelke naesten sort ("bliver helt sort").
    backgroundColor: colors.focusTint,
  },
});
