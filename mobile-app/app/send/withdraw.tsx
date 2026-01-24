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
import { useFormattedBalance } from '@/contexts/WalletContext';

export default function WithdrawScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { btc } = useFormattedBalance();

  const [btcAddress, setBtcAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const amountSats = parseFloat(amount || '0') * 100_000_000;
  const maxSats = parseFloat(btc) * 100_000_000;
  const networkFee = 5000; // Placeholder: ~5000 sats
  const totalSats = amountSats + networkFee;

  const isValidAmount = amountSats > 0 && totalSats <= maxSats;
  const isValidAddress = btcAddress.startsWith('bc1') || btcAddress.startsWith('tb1') ||
                         btcAddress.startsWith('1') || btcAddress.startsWith('3');

  const handleWithdraw = async () => {
    if (!isValidAmount || !isValidAddress) return;

    Alert.alert(
      'Confirm Withdrawal',
      `You will receive ${amount} BTC at:\n\n${btcAddress}\n\nNetwork fee: ~${networkFee.toLocaleString()} sats\n\nNote: This transaction will be visible on the Bitcoin blockchain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setIsWithdrawing(true);
            try {
              // TODO: Call backend redemption API
              await new Promise((resolve) => setTimeout(resolve, 2000));
              Alert.alert(
                'Withdrawal Initiated',
                'Your BTC withdrawal is being processed. This usually takes 10-30 minutes.',
                [{ text: 'OK', onPress: () => router.back() }]
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to process withdrawal. Please try again.');
            } finally {
              setIsWithdrawing(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: '#f59e0b20' }]}>
            <FontAwesome name="bitcoin" size={28} color="#f59e0b" />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Withdraw to BTC</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Convert your private sbBTC back to regular Bitcoin. This transaction will be visible on
            the Bitcoin blockchain.
          </Text>

          {/* Warning */}
          <View style={[styles.warningBox, { backgroundColor: '#fef3c7' }]}>
            <FontAwesome name="exclamation-triangle" size={18} color="#f59e0b" />
            <Text style={styles.warningText}>
              Withdrawals are public transactions. Your privacy ends when you convert to BTC.
            </Text>
          </View>

          {/* BTC Address Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: isDark ? '#888' : '#666' }]}>
              Bitcoin Address
            </Text>
            <TextInput
              style={[
                styles.textInput,
                { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5', color: colors.text },
              ]}
              placeholder="bc1q... or 1... or 3..."
              placeholderTextColor={isDark ? '#444' : '#bbb'}
              value={btcAddress}
              onChangeText={setBtcAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {btcAddress && !isValidAddress && (
              <Text style={styles.errorText}>Please enter a valid Bitcoin address</Text>
            )}
          </View>

          {/* Amount Input */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={[styles.inputLabel, { color: isDark ? '#888' : '#666' }]}>Amount</Text>
              <TouchableOpacity
                onPress={() => setAmount(((maxSats - networkFee) / 100_000_000).toFixed(8))}>
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
          </View>

          {/* Fee Summary */}
          <View style={[styles.feeBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <View style={styles.feeRow}>
              <Text style={[styles.feeLabel, { color: isDark ? '#888' : '#666' }]}>Amount</Text>
              <Text style={[styles.feeValue, { color: colors.text }]}>
                {amountSats.toLocaleString()} sats
              </Text>
            </View>
            <View style={styles.feeRow}>
              <Text style={[styles.feeLabel, { color: isDark ? '#888' : '#666' }]}>
                Network Fee (est.)
              </Text>
              <Text style={[styles.feeValue, { color: colors.text }]}>
                ~{networkFee.toLocaleString()} sats
              </Text>
            </View>
            <View style={[styles.feeDivider, { backgroundColor: isDark ? '#333' : '#ddd' }]} />
            <View style={styles.feeRow}>
              <Text style={[styles.feeLabel, { color: colors.text, fontWeight: '600' }]}>
                Total
              </Text>
              <Text style={[styles.feeValue, { color: colors.text, fontWeight: '600' }]}>
                {totalSats.toLocaleString()} sats
              </Text>
            </View>
            {totalSats > maxSats && (
              <Text style={styles.errorText}>Insufficient balance (including fees)</Text>
            )}
          </View>
        </ScrollView>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor:
                  isValidAmount && isValidAddress ? '#f59e0b' : isDark ? '#333' : '#ddd',
              },
            ]}
            onPress={handleWithdraw}
            disabled={!isValidAmount || !isValidAddress || isWithdrawing}>
            {isWithdrawing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <FontAwesome name="bitcoin" size={16} color="#fff" />
                <Text style={styles.primaryButtonText}>Withdraw to Bitcoin</Text>
              </>
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
  content: {
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
    marginBottom: 24,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    gap: 10,
    marginBottom: 24,
    alignItems: 'center',
    width: '100%',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  inputGroup: {
    width: '100%',
    marginBottom: 20,
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
    marginBottom: 8,
  },
  maxButton: {
    fontSize: 13,
    fontWeight: '500',
  },
  textInput: {
    padding: 16,
    borderRadius: 12,
    fontSize: 15,
    fontFamily: 'SpaceMono',
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
  feeBox: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  feeLabel: {
    fontSize: 14,
  },
  feeValue: {
    fontSize: 14,
  },
  feeDivider: {
    height: 1,
    marginVertical: 8,
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
});
