import React, { useState, useCallback } from 'react';
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
import { useFormattedBalance, useWallet } from '@/contexts/WalletContext';
import { useNameRegistry, type ResolvedRecipient } from '@/hooks';

export default function SendStealthScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { sendToStealth } = useWallet();
  const { btc } = useFormattedBalance();
  const { resolveRecipient, isZkeyName, isResolving, error: resolveError } = useNameRegistry();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<ResolvedRecipient | null>(null);
  const [taprootAddress, setTaprootAddress] = useState<string | null>(null);

  const amountSats = parseFloat(amount || '0') * 100_000_000;
  const maxSats = parseFloat(btc) * 100_000_000;
  const isValidAmount = amountSats > 0 && amountSats <= maxSats;
  const isValidRecipient = resolvedRecipient !== null;

  // Handle recipient input change
  const handleRecipientChange = useCallback((text: string) => {
    setRecipient(text);
    setResolvedRecipient(null);
    setTaprootAddress(null);
  }, []);

  // Resolve recipient address or name
  const handleResolve = useCallback(async () => {
    if (!recipient.trim()) return;

    const resolved = await resolveRecipient(recipient);
    if (resolved) {
      setResolvedRecipient(resolved);
    }
  }, [recipient, resolveRecipient]);

  const handleSend = async () => {
    if (!isValidAmount || !resolvedRecipient) return;

    setIsSending(true);
    try {
      // Send to the resolved stealth address
      const address = await sendToStealth(resolvedRecipient.addressHex, amountSats);
      setTaprootAddress(address);

      Alert.alert(
        'Deposit Address Ready',
        `Send ${amount} BTC to the generated Taproot address. The recipient (${resolvedRecipient.displayName}) will be able to claim it privately.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to prepare transaction.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Header Icon */}
          <View style={[styles.iconCircle, { backgroundColor: '#8b5cf620' }]}>
            <FontAwesome name="user-secret" size={28} color="#8b5cf6" />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Send Privately</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            Send to another zVault user using their stealth address. Only you and the recipient will
            know about this transaction.
          </Text>

          {/* Recipient Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: isDark ? '#888' : '#666' }]}>
              Recipient zKey or .zkey name
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[
                  styles.textInput,
                  styles.textInputFlex,
                  { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5', color: colors.text },
                ]}
                placeholder="Enter zKey address or alice.zkey"
                placeholderTextColor={isDark ? '#444' : '#bbb'}
                value={recipient}
                onChangeText={handleRecipientChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.resolveButton,
                  {
                    backgroundColor: recipient.trim() ? colors.tint : isDark ? '#333' : '#ddd',
                  },
                ]}
                onPress={handleResolve}
                disabled={!recipient.trim() || isResolving}>
                {isResolving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <FontAwesome name="search" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {/* Resolution Result */}
            {resolvedRecipient && (
              <View style={[styles.resolvedBox, { backgroundColor: '#22c55e15' }]}>
                <FontAwesome name="check-circle" size={16} color="#22c55e" />
                <Text style={[styles.resolvedText, { color: colors.text }]}>
                  {resolvedRecipient.type === 'name' ? (
                    <>Resolved: <Text style={{ fontWeight: '600' }}>{resolvedRecipient.displayName}</Text></>
                  ) : (
                    <>Address: <Text style={{ fontWeight: '600' }}>{resolvedRecipient.displayName}</Text></>
                  )}
                </Text>
              </View>
            )}

            {/* Resolution Error */}
            {resolveError && !resolvedRecipient && (
              <View style={[styles.resolvedBox, { backgroundColor: '#ef444415' }]}>
                <FontAwesome name="exclamation-circle" size={16} color="#ef4444" />
                <Text style={[styles.resolvedText, { color: '#ef4444' }]}>{resolveError}</Text>
              </View>
            )}

            {/* Hint */}
            {!resolvedRecipient && !resolveError && isZkeyName(recipient) && (
              <Text style={[styles.hintText, { color: isDark ? '#666' : '#999' }]}>
                Tap the search button to resolve the .zkey name
              </Text>
            )}
          </View>

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

          {/* Privacy Info */}
          <View style={[styles.infoBox, { backgroundColor: '#8b5cf610' }]}>
            <FontAwesome name="shield" size={18} color="#8b5cf6" />
            <View style={styles.infoContent}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>Privacy Guaranteed</Text>
              <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
                This transaction uses ECDH to derive a one-time stealth address. The recipient can
                scan for their payments without revealing their identity.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor:
                  isValidAmount && isValidRecipient ? colors.tint : isDark ? '#333' : '#ddd',
              },
            ]}
            onPress={handleSend}
            disabled={!isValidAmount || !isValidRecipient || isSending}>
            {isSending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <FontAwesome name="lock" size={16} color="#fff" />
                <Text style={styles.primaryButtonText}>Send Privately</Text>
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
    marginBottom: 32,
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
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textInput: {
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
  },
  textInputFlex: {
    flex: 1,
  },
  resolveButton: {
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  resolvedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  resolvedText: {
    fontSize: 14,
    flex: 1,
  },
  hintText: {
    fontSize: 13,
    marginTop: 8,
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
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },
  buttons: {
    padding: 24,
    paddingTop: 0,
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
