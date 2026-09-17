import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { useTheme } from './ThemeContext.js';
import { isTV } from './tv.js';

/**
 * Et tekstfelt der viser hvor fjernbetjeningens fokus er.
 *
 * Paa tv er fokus det eneste man har: uden en ramme ved man ikke hvilket
 * felt tastaturet skriver i. Paa telefonen er det et almindeligt felt.
 *
 * Videresender sin ref, saa flere felter kan kaedes sammen: pil-ned mellem
 * to tekstfelter er upaalidelig paa tv, saa "naeste" paa tastaturet flytter
 * i stedet fokus til det naeste felt med .focus().
 */
export const TvTextInput = forwardRef<TextInput, TextInputProps>(function TvTextInput(
  { style, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textMuted}
      {...rest}
      style={[style, isTV && focused && [styles.focused, { outlineColor: colors.focusRing, backgroundColor: colors.focusTint }]]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
});

const styles = StyleSheet.create({
  focused: { outlineWidth: 3, outlineOffset: 2, outlineStyle: 'solid' },
});
