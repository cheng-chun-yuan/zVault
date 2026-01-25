import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWallet, useWalletStore, type Deposit } from '@/contexts/WalletContext';
import { getCachedItem } from '@/lib/storage';

export default function NewDepositScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { createDeposit } = useWallet();

  const [step, setStep] = useState<'amount' | 'address'>('amount');
  const [amount, setAmount] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [claimLink, setClaimLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const amountSats = parseFloat(amount || '0') * 100_000_000;
  const isValidAmount = amountSats >= 10000; // Min 10k sats

  const handleCreateDeposit = async () => {
    if (!isValidAmount) return;

    setIsCreating(true);
    try {
      const newDeposit = await createDeposit(amountSats);
      setDeposit(newDeposit);

      // Load the claim link (stored separately for security)
      const link = await getCachedItem<string>(`claim_link_${newDeposit.id}`);
      setClaimLink(link);

      setStep('address');
    } catch (error) {
      console.error('Failed to create deposit:', error);
      Alert.alert('Error', 'Failed to create deposit. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const copyAddress = async () => {
    if (deposit?.taprootAddress) {
      await Clipboard.setStringAsync(deposit.taprootAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyClaimLink = async () => {
    if (claimLink) {
      await Clipboard.setStringAsync(claimLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const shareAddress = async () => {
    if (deposit?.taprootAddress) {
      await Share.share({
        message: `Send ${amount} BTC to this address:\n${deposit.taprootAddress}`,
      });
    }
  };

  const shareClaimLink = async () => {
    if (claimLink) {
      await Share.share({
        message: `zVault Claim Link (keep this safe!):\n${claimLink}`,
      });
    }
  };

  if (step === 'address' && deposit) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.content}>
          <View style={[styles.successIcon, { backgroundColor: '#22c55e20' }]}>
            <FontAwesome name="check" size={32} color="#22c55e" />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Deposit Address Ready</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Send exactly {amount} BTC to this address. The deposit will be detected automatically.
          </Text>

          {/* QR Code */}
          <View style={styles.qrContainer}>
            <View style={[styles.qrWrapper, { backgroundColor: '#fff' }]}>
              <QRCode value={`bitcoin:${deposit.taprootAddress}?amount=${amount}`} size={200} />
            </View>
          </View>

          {/* Address Display */}
          <View
            style={[styles.addressContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <Text style={[styles.addressLabel, { color: isDark ? '#666' : '#999' }]}>
              Taproot Address
            </Text>
            <Text
              style={[styles.addressText, { color: colors.text }]}
              numberOfLines={2}
              ellipsizeMode="middle">
              {deposit.taprootAddress}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}
              onPress={copyAddress}>
              <FontAwesome name={copied ? 'check' : 'copy'} size={18} color={colors.tint} />
              <Text style={[styles.actionText, { color: colors.text }]}>
                {copied ? 'Copied!' : 'Copy'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}
              onPress={shareAddress}>
              <FontAwesome name="share" size={18} color={colors.tint} />
              <Text style={[styles.actionText, { color: colors.text }]}>Share</Text>
            </TouchableOpacity>
          </View>

          {/* Claim Link Section */}
          {claimLink && (
            <View style={styles.claimLinkSection}>
              <View style={[styles.warningBox, { backgroundColor: '#ef444415' }]}>
                <FontAwesome name="exclamation-triangle" size={18} color="#ef4444" />
                <View style={styles.warningContent}>
                  <Text style={[styles.warningTitle, { color: colors.text }]}>
                    Save Your Claim Link!
                  </Text>
                  <Text style={[styles.warningDescription, { color: isDark ? '#888' : '#666' }]}>
                    This link is required to claim your deposit. If you lose it, your funds cannot
                    be recovered.
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#ef444420' }]}
                  onPress={copyClaimLink}>
                  <FontAwesome name={copiedLink ? 'check' : 'key'} size={18} color="#ef4444" />
                  <Text style={[styles.actionText, { color: '#ef4444' }]}>
                    {copiedLink ? 'Copied!' : 'Copy Link'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#ef444420' }]}
                  onPress={shareClaimLink}>
                  <FontAwesome name="share" size={18} color="#ef4444" />
                  <Text style={[styles.actionText, { color: '#ef4444' }]}>Save Link</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Info */}
          <View style={[styles.infoBox, { backgroundColor: '#fef3c720' }]}>
            <FontAwesome name="info-circle" size={18} color="#f59e0b" />
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              This is a Taproot address. Make sure your wallet supports sending to tb1p addresses.
              Deposits require 6 confirmations (~1 hour).
            </Text>
          </View>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={() => router.push('/(tabs)/deposits')}>
            <Text style={styles.primaryButtonText}>View in Deposits</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
          <FontAwesome name="bitcoin" size={32} color={colors.tint} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>New Deposit</Text>
        <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
          Enter the amount of BTC you want to deposit. You'll receive a unique address for this
          deposit.
        </Text>

        {/* Amount Input */}
        <View
          style={[styles.inputContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
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

        {/* Sats equivalent */}
        <Text style={[styles.satsText, { color: isDark ? '#666' : '#999' }]}>
          = {amountSats.toLocaleString()} sats
        </Text>

        {/* Min amount warning */}
        {amount && !isValidAmount && (
          <Text style={styles.warningText}>Minimum deposit is 10,000 sats (0.0001 BTC)</Text>
        )}

        {/* Quick amounts */}
        <View style={styles.quickAmounts}>
          {['0.001', '0.01', '0.1'].map((val) => (
            <TouchableOpacity
              key={val}
              style={[
                styles.quickButton,
                { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' },
              ]}
              onPress={() => setAmount(val)}>
              <Text style={[styles.quickButtonText, { color: colors.text }]}>{val} BTC</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: isValidAmount ? colors.tint : isDark ? '#333' : '#ddd' },
          ]}
          onPress={handleCreateDeposit}
          disabled={!isValidAmount || isCreating}>
          {isCreating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Generate Deposit Address</Text>
          )}
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
    paddingHorizontal: 24,
    alignItems: 'center',
    paddingTop: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successIcon: {
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
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    width: '100%',
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: 'bold',
  },
  btcLabel: {
    fontSize: 20,
    fontWeight: '600',
  },
  satsText: {
    marginTop: 8,
    fontSize: 14,
  },
  warningText: {
    marginTop: 8,
    fontSize: 14,
    color: '#ef4444',
  },
  quickAmounts: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  quickButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  quickButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  qrContainer: {
    marginBottom: 24,
  },
  qrWrapper: {
    padding: 16,
    borderRadius: 16,
  },
  addressContainer: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  addressLabel: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 13,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
    lineHeight: 20,
  },
  claimLinkSection: {
    width: '100%',
    marginBottom: 16,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  warningDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
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
    fontSize: 13,
    lineHeight: 18,
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
