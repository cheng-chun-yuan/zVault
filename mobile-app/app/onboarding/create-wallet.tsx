import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWallet } from '@/contexts/WalletContext';

export default function CreateWalletScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { createWallet } = useWallet();

  const [isCreating, setIsCreating] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [step, setStep] = useState<'info' | 'generating' | 'display'>('info');

  const handleCreate = async () => {
    setStep('generating');
    setIsCreating(true);
    try {
      const newMnemonic = await createWallet();
      setMnemonic(newMnemonic);
      setStep('display');
    } catch (error) {
      console.error('Failed to create wallet:', error);
      setStep('info');
    } finally {
      setIsCreating(false);
    }
  };

  const handleContinue = () => {
    router.push({
      pathname: '/onboarding/backup',
      params: { mnemonic },
    });
  };

  if (step === 'generating') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.generatingText, { color: colors.text }]}>
            Generating your wallet...
          </Text>
          <Text style={[styles.generatingSubtext, { color: isDark ? '#666' : '#999' }]}>
            Creating secure keys with Face ID protection
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'display' && mnemonic) {
    const words = mnemonic.split(' ');

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <FontAwesome name="arrow-left" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>Your Recovery Phrase</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Write down these 24 words in order. They are the only way to recover your wallet.
          </Text>

          {/* Warning */}
          <View style={[styles.warningBox, { backgroundColor: '#fef3c7' }]}>
            <FontAwesome name="exclamation-triangle" size={20} color="#f59e0b" />
            <Text style={styles.warningText}>
              Never share your recovery phrase with anyone. Anyone with these words can access your
              funds.
            </Text>
          </View>

          {/* Mnemonic Grid */}
          <View style={styles.mnemonicGrid}>
            {words.map((word, index) => (
              <View
                key={index}
                style={[styles.wordBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
                <Text style={[styles.wordNumber, { color: isDark ? '#666' : '#999' }]}>
                  {index + 1}
                </Text>
                <Text style={[styles.wordText, { color: colors.text }]}>{word}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={handleContinue}>
            <Text style={styles.primaryButtonText}>I've Written It Down</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
          <FontAwesome name="key" size={32} color={colors.tint} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Create New Wallet</Text>
        <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
          We'll generate a secure 24-word recovery phrase that only you will have access to.
        </Text>

        <View style={styles.infoCards}>
          <View style={[styles.infoCard, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <FontAwesome name="shield" size={20} color="#22c55e" />
            <View style={styles.infoCardContent}>
              <Text style={[styles.infoCardTitle, { color: colors.text }]}>
                Protected by Face ID
              </Text>
              <Text style={[styles.infoCardText, { color: isDark ? '#666' : '#999' }]}>
                Your keys are stored securely and require biometric authentication.
              </Text>
            </View>
          </View>

          <View style={[styles.infoCard, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <FontAwesome name="user-secret" size={20} color="#8b5cf6" />
            <View style={styles.infoCardContent}>
              <Text style={[styles.infoCardTitle, { color: colors.text }]}>
                Privacy by Default
              </Text>
              <Text style={[styles.infoCardText, { color: isDark ? '#666' : '#999' }]}>
                All transactions use stealth addresses for maximum privacy.
              </Text>
            </View>
          </View>

          <View style={[styles.infoCard, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <FontAwesome name="lock" size={20} color="#3b82f6" />
            <View style={styles.infoCardContent}>
              <Text style={[styles.infoCardTitle, { color: colors.text }]}>Self-Custody</Text>
              <Text style={[styles.infoCardText, { color: isDark ? '#666' : '#999' }]}>
                Only you control your funds. We never have access to your keys.
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.tint }]}
          onPress={handleCreate}
          disabled={isCreating}>
          <Text style={styles.primaryButtonText}>Generate Recovery Phrase</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
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
  generatingText: {
    fontSize: 18,
    fontWeight: '600',
  },
  generatingSubtext: {
    fontSize: 14,
  },
  infoCards: {
    width: '100%',
    gap: 12,
  },
  infoCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoCardText: {
    fontSize: 13,
    lineHeight: 18,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: '#92400e',
    lineHeight: 20,
  },
  mnemonicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  wordBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    minWidth: 100,
  },
  wordNumber: {
    fontSize: 12,
    fontWeight: '500',
    width: 20,
  },
  wordText: {
    fontSize: 14,
    fontWeight: '500',
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
