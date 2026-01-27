/**
 * Sign Message Screen
 *
 * Demonstrates Phantom wallet message signing.
 */

import { useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { usePhantom } from '@phantom/react-native-wallet-sdk';
import { FontAwesome } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

export default function SignScreen() {
  const router = useRouter();
  const { phantom, addresses } = usePhantom();
  const [message, setMessage] = useState('Hello from zVault!');
  const [signature, setSignature] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const solanaAddress = addresses?.find((a) => a.chain === 'solana')?.address;

  const handleSign = async () => {
    if (!phantom || !solanaAddress) {
      Alert.alert('Error', 'Wallet not connected');
      return;
    }

    setIsLoading(true);
    try {
      const encodedMessage = new TextEncoder().encode(message);
      const result = await phantom.providers.solana.signMessage(encodedMessage);

      // Convert signature to base64
      const signatureBase64 = Buffer.from(result.signature).toString('base64');
      setSignature(signatureBase64);
    } catch (error) {
      console.error('Sign error:', error);
      Alert.alert('Error', 'Failed to sign message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySignature = async () => {
    if (signature) {
      await Clipboard.setStringAsync(signature);
      Alert.alert('Copied', 'Signature copied to clipboard');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.label}>Message to Sign</Text>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Enter message..."
            multiline
            numberOfLines={3}
          />
        </View>

        <TouchableOpacity
          style={[styles.signButton, isLoading && styles.buttonDisabled]}
          onPress={handleSign}
          disabled={isLoading || !message}
        >
          <FontAwesome name="pencil" size={18} color="#fff" style={styles.buttonIcon} />
          <Text style={styles.buttonText}>{isLoading ? 'Signing...' : 'Sign Message'}</Text>
        </TouchableOpacity>

        {signature && (
          <View style={styles.resultSection}>
            <View style={styles.resultHeader}>
              <Text style={styles.label}>Signature</Text>
              <TouchableOpacity onPress={handleCopySignature}>
                <FontAwesome name="copy" size={18} color="#9945FF" />
              </TouchableOpacity>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureText} numberOfLines={4}>
                {signature}
              </Text>
            </View>
            <View style={styles.successBadge}>
              <FontAwesome name="check-circle" size={16} color="#14F195" />
              <Text style={styles.successText}>Message signed successfully</Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 24,
  },
  section: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.6,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  signButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9945FF',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    marginRight: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultSection: {
    gap: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  signatureBox: {
    backgroundColor: 'rgba(153, 69, 255, 0.1)',
    padding: 16,
    borderRadius: 12,
  },
  signatureText: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    lineHeight: 18,
  },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    color: '#14F195',
    fontSize: 14,
    fontWeight: '500',
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
  },
  closeButtonText: {
    fontSize: 16,
    opacity: 0.6,
  },
});
