import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import qrcode from 'qrcode-generator';

/**
 * En QR-kode tegnet med almindelige firkanter — intet SVG eller kamera.
 *
 * Bruges paa tv'et til at vise adressen og koden, saa telefonen kan scanne
 * dem i stedet for at taste. qrcode-generator laver selve moenstret; her
 * tegnes hver moerk firkant som en lille sort View paa hvid bund.
 */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let r = 0; r < count; r += 1) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c += 1) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }, [value]);

  const count = cells.length;
  // Hvid ramme rundt om (quiet zone), ellers er koden svaerere at laese.
  const quiet = 2;
  const cell = size / (count + quiet * 2);
  return (
    <View style={[styles.frame, { width: size, height: size, padding: cell * quiet }]}>
      {cells.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? '#000000' : '#ffffff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#ffffff', borderRadius: 8, alignSelf: 'flex-start' },
  row: { flexDirection: 'row' },
});
