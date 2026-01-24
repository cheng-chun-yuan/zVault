import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useFormattedBalance, useWallet } from '@/contexts/WalletContext';

export default function SendNoteScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { sendByNote } = useWallet();
  const { btc } = useFormattedBalance();

  const [step, setStep] = useState<'amount' | 'share'>('amount');
  const [amount, setAmount] = useState('');
  const [claimLink, setClaimLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amountSats = parseFloat(amount || '0') * 100_000_000;
  const maxSats = parseFloat(btc) * 100_000_000;
  const isValidAmount = amountSats > 0 && amountSats <= maxSats;

  const handleCreateNote = async () => {
    if (!isValidAmount) return;

    try {
      const result = await sendByNote(amountSats);
      setClaimLink(result.claimLink);
      setStep('share');
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const copyLink = async () => {
    if (claimLink) {
      await Clipboard.setStringAsync(claimLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareLink = async () => {
    if (claimLink) {
      await Share.share({
        message: `Claim ${amount} BTC from zVault:\n${claimLink}`,
      });
    }
  };

  if (step === 'share' && claimLink) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]} edges={['bottom']}>
        <View style={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: '#22c55e20' }]}>
            <FontAwesome name="check" size={28} color="#22c55e" />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Note Created!</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Share this link with anyone. The first person to claim it will receive {amount} BTC.
          </Text>

          {/* Warning */}
          <View style={[styles.warningBox, { backgroundColor: '#fef3c7' }]}>
            <FontAwesome name="exclamation-triangle" size={18} color="#f59e0b" />
            <Text style={styles.warningText}>
              This is a bearer instrument. Anyone with this link can claim the funds!
            </Text>
          </View>

          {/* QR Code */}
          <View style={styles.qrWrapper}>
            <QRCode value={claimLink} size={180} />
          </View>

          {/* Link Display */}
          <View
            style={[styles.linkContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <Text style={[styles.linkText, { color: isDark ? '#888' : '#666' }]} numberOfLines={2}>
              {claimLink}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}
              onPress={copyLink}>
              <FontAwesome name={copied ? 'check' : 'copy'} size={18} color={colors.tint} />
              <Text style={[styles.actionText, { color: colors.text }]}>
                {copied ? 'Copied!' : 'Copy Link'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.tint }]}
              onPress={shareLink}>
              <FontAwesome name="share" size={18} color="#fff" />
              <Text style={[styles.actionText, { color: '#fff' }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: isDark ? '#333' : '#ddd' }]}
            onPress={() => router.back()}>
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]} edges={['bottom']}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: '#3b82f620' }]}>
          <FontAwesome name="link" size={28} color="#3b82f6" />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Send by Note</Text>
        <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
          Create a shareable claim link that anyone can use to receive the funds. Perfect for
          gifting or payments to people without a zKey.
        </Text>

        {/* Amount Input */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text style={[styles.inputLabel, { color: isDark ? '#888' : '#666' }]}>Amount</Text>
            <TouchableOpacity onPress={() => setAmount(btc)}>
              <Text style={[styles.maxButton, { color: colors.tint }]}>Max: {btc} BTC</Text>
            </TouchableOpacity>
          </View>
          <View
            style={[
              styles.amountInputContainer,
              { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' },
            ]}>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              placeholder="0.00"
              placeholderTextColor={isDark ? '#444' : '#bbb'}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <Text style={[styles.btcLabel, { color: colors.text }]}>BTC</Text>
          </View>
          {amount && amountSats > maxSats && (
            <Text style={styles.errorText}>Insufficient balance</Text>
          )}
        </View>

        {/* Info */}
        <View style={[styles.infoBox, { backgroundColor: '#3b82f610' }]}>
          <FontAwesome name="info-circle" size={18} color="#3b82f6" />
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>How it works</Text>
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              1. We create a note with a secret key{'\n'}
              2. You share the claim link{'\n'}
              3. The recipient claims via the link{'\n'}
              4. ZK proof verifies ownership
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: isValidAmount ? colors.tint : isDark ? '#333' : '#ddd' },
          ]}
          onPress={handleCreateNote}
          disabled={!isValidAmount}>
          <FontAwesome name="link" size={16} color="#fff" />
          <Text style={styles.primaryButtonText}>Create Claim Link</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    gap: 10,
    marginBottom: 24,
    alignItems: 'center',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  qrWrapper: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  linkContainer: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  linkText: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 24,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  maxButton: {
    fontSize: 13,
    fontWeight: '500',
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    paddingVertical: 16,
  },
  btcLabel: {
    fontSize: 18,
    fontWeight: '600',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginTop: 8,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    width: '100%',
    alignItems: 'flex-start',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 20,
  },
  buttons: {
    padding: 24,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
