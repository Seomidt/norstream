import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';

/**
 * Scan QR-koden fra tv'et med telefonens kamera.
 *
 * Kun telefon (tv'et har intet kamera). Foerste gang beder den om lov til
 * kameraet. Naar en QR laeses, gives dens tekst tilbage, og kameraet lukker.
 */
export function QrScanner({ onScanned, onClose }: { onScanned: (value: string) => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [done, setDone] = useState(false);

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted !== true ? (
          <View style={styles.center}>
            <Text style={styles.text}>NorStream skal bruge kameraet for at scanne QR-koden fra tv'et.</Text>
            <TvPressable style={styles.button} onPress={() => void requestPermission()}>
              <Text style={styles.buttonText}>Giv adgang til kameraet</Text>
            </TvPressable>
            <TvPressable style={[styles.button, styles.buttonGhost]} onPress={onClose}>
              <Text style={styles.buttonText}>Annullér</Text>
            </TvPressable>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(event) => {
                if (done) return;
                setDone(true);
                onScanned(event.data);
              }}
            />
            <View style={styles.overlay} pointerEvents="none">
              <View style={styles.reticle} />
              <Text style={styles.hint}>Ret kameraet mod QR-koden på tv'et</Text>
            </View>
            <View style={styles.bottom}>
              <TvPressable style={[styles.button, styles.buttonGhost]} onPress={onClose}>
                <Text style={styles.buttonText}>Luk</Text>
              </TvPressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg, gap: theme.spacing.md },
    text: { color: '#ffffff', fontSize: 16, textAlign: 'center', lineHeight: 22 },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    reticle: { width: 220, height: 220, borderColor: '#ffffff', borderWidth: 3, borderRadius: 16 },
    hint: { color: '#ffffff', fontSize: 15, marginTop: theme.spacing.lg, textAlign: 'center' },
    bottom: { position: 'absolute', left: 0, right: 0, bottom: theme.spacing.xl, alignItems: 'center' },
    button: { backgroundColor: colors.accent, borderRadius: theme.radius, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm + 2, alignItems: 'center' },
    buttonGhost: { backgroundColor: '#ffffff22' },
    buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  });
