import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWallet } from '@/contexts/WalletContext';
import { validateMnemonic } from '@/lib/keys';

export default function ImportWalletScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { importWallet } = useWallet();

  const [mnemonic, setMnemonic] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setError(null);

    // Validate mnemonic
    const cleanMnemonic = mnemonic.trim().toLowerCase();
    if (!validateMnemonic(cleanMnemonic)) {
      setError('Please enter a valid 12 or 24 word recovery phrase');
      return;
    }

    setIsImporting(true);
    try {
      await importWallet(cleanMnemonic);
      router.replace('/(tabs)/wallet');
    } catch (error) {
      console.error('Failed to import wallet:', error);
      setError('Failed to import wallet. Please check your recovery phrase and try again.');
    } finally {
      setIsImporting(false);
    }
  };

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const isValid = wordCount === 12 || wordCount === 24;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <FontAwesome name="arrow-left" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
            <FontAwesome name="download" size={32} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Import Wallet</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Enter your 12 or 24 word recovery phrase to restore your wallet.
          </Text>

          {/* Input */}
          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5',
                borderColor: error ? '#ef4444' : 'transparent',
              },
            ]}>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Enter your recovery phrase..."
              placeholderTextColor={isDark ? '#666' : '#999'}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              value={mnemonic}
              onChangeText={(text) => {
                setMnemonic(text);
                setError(null);
              }}
            />
          </View>

          {/* Word Count */}
          <View style={styles.wordCountContainer}>
            <Text
              style={[
                styles.wordCount,
                { color: isValid ? '#22c55e' : isDark ? '#666' : '#999' },
              ]}>
              {wordCount} / {wordCount > 12 ? 24 : 12} words
            </Text>
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorContainer}>
              <FontAwesome name="exclamation-circle" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Info */}
          <View style={[styles.infoBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <FontAwesome name="info-circle" size={18} color={colors.tint} />
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              Your recovery phrase will be stored securely on this device with Face ID protection.
              We never have access to your keys.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: isValid ? colors.tint : isDark ? '#333' : '#ddd' },
            ]}
            onPress={handleImport}
            disabled={!isValid || isImporting}>
            {isImporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Import Wallet</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    padding: 16,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  inputContainer: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
  },
  input: {
    fontSize: 16,
    lineHeight: 24,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  wordCountContainer: {
    width: '100%',
    alignItems: 'flex-end',
    marginTop: 8,
    marginBottom: 16,
  },
  wordCount: {
    fontSize: 14,
    fontWeight: '500',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  buttons: {
    padding: 24,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
