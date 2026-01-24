import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function ScanScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [showManual, setShowManual] = useState(false);

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);

    // Parse the claim link
    if (data.startsWith('zvault://claim/')) {
      const noteId = data.replace('zvault://claim/', '');
      router.push(`/claim/${encodeURIComponent(noteId)}`);
    } else {
      Alert.alert('Invalid QR Code', 'This QR code is not a valid zVault claim link.', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    }
  };

  const handleManualSubmit = () => {
    const input = manualInput.trim();
    if (!input) return;

    if (input.startsWith('zvault://claim/')) {
      const noteId = input.replace('zvault://claim/', '');
      router.push(`/claim/${encodeURIComponent(noteId)}`);
    } else {
      // Assume it's just the note data
      router.push(`/claim/${encodeURIComponent(input)}`);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.text, { color: colors.text }]}>Loading camera...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
            <FontAwesome name="camera" size={32} color={colors.tint} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Camera Permission</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            We need camera access to scan claim QR codes.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint }]}
            onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => setShowManual(true)}>
            <Text style={[styles.linkText, { color: colors.tint }]}>
              Or enter claim link manually
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (showManual) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
            <FontAwesome name="paste" size={28} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Enter Claim Link</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Paste the claim link you received to claim your Bitcoin.
          </Text>

          <TextInput
            style={[
              styles.textInput,
              { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5', color: colors.text },
            ]}
            placeholder="zvault://claim/..."
            placeholderTextColor={isDark ? '#444' : '#bbb'}
            value={manualInput}
            onChangeText={setManualInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: isDark ? '#333' : '#ddd' }]}
              onPress={() => setShowManual(false)}>
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Scan QR</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: manualInput.trim() ? colors.tint : isDark ? '#333' : '#ddd' },
              ]}
              onPress={handleManualSubmit}
              disabled={!manualInput.trim()}>
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.scannerContainer}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}>
        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Header */}
          <SafeAreaView style={styles.scanHeader}>
            <Text style={styles.scanTitle}>Scan Claim QR</Text>
            <Text style={styles.scanSubtitle}>
              Point your camera at a zVault claim QR code
            </Text>
          </SafeAreaView>

          {/* Viewfinder */}
          <View style={styles.viewfinderContainer}>
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </View>

          {/* Footer */}
          <View style={styles.scanFooter}>
            <TouchableOpacity
              style={styles.manualButton}
              onPress={() => setShowManual(true)}>
              <FontAwesome name="keyboard-o" size={20} color="#fff" />
              <Text style={styles.manualButtonText}>Enter manually</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    paddingTop: 48,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  text: {
    fontSize: 16,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 24,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
  },
  textInput: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    fontSize: 14,
    fontFamily: 'SpaceMono',
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scannerContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scanHeader: {
    paddingTop: 60,
    paddingBottom: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  scanTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  scanSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 8,
  },
  viewfinderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#fff',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scanFooter: {
    paddingVertical: 40,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
  },
  manualButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
