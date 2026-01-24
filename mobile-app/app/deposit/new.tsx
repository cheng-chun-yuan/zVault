import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWallet, useWalletStore } from '@/contexts/WalletContext';

export default function NewDepositScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { createDeposit } = useWallet();

  const [step, setStep] = useState<'amount' | 'address'>('amount');
  const [amount, setAmount] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amountSats = parseFloat(amount || '0') * 100_000_000;
  const isValidAmount = amountSats >= 10000; // Min 10k sats

  const handleCreateDeposit = async () => {
    if (!isValidAmount) return;

    setIsCreating(true);
    try {
      const deposit = await createDeposit(amountSats);
      setDepositAddress(deposit.taprootAddress);
      setStep('address');
    } catch (error) {
      console.error('Failed to create deposit:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const copyAddress = async () => {
    if (depositAddress) {
      await Clipboard.setStringAsync(depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareAddress = async () => {
    if (depositAddress) {
      await Share.share({
        message: `Send ${amount} BTC to this address:\n${depositAddress}`,
      });
    }
  };

  if (step === 'address' && depositAddress) {
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
              <QRCode value={`bitcoin:${depositAddress}?amount=${amount}`} size={200} />
            </View>
          </View>

          {/* Address Display */}
          <View
            style={[styles.addressContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <Text
              style={[styles.addressText, { color: colors.text }]}
              numberOfLines={2}
              ellipsizeMode="middle">
              {depositAddress}
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

          {/* Info */}
          <View style={[styles.infoBox, { backgroundColor: '#fef3c720' }]}>
            <FontAwesome name="info-circle" size={18} color="#f59e0b" />
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              This is a Taproot address. Make sure your wallet supports sending to bc1p addresses.
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
  addressText: {
    fontSize: 13,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
    lineHeight: 20,
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
