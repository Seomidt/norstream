import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { theme } from './theme.js';
import { isTV } from './tv.js';

/**
 * Et tekstfelt der viser hvor fjernbetjeningens fokus er.
 *
 * Paa tv er fokus det eneste man har: uden en ramme ved man ikke hvilket
 * felt tastaturet skriver i. Paa telefonen er det et almindeligt felt.
 */
export function TvTextInput({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={theme.colors.textMuted}
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
    />
  );
}

const styles = StyleSheet.create({
  focused: { borderColor: theme.colors.accent, borderWidth: 2 },
});
