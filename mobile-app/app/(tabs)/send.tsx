/**
 * Send Screen
 *
 * Simple form to send zkBTC to a stealth address.
 */

import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { useWallet, WalletNote } from '@/contexts/WalletContext';

function formatBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8);
}

export default function SendScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { isConnected, keysDerived, notes, availableBalance, deriveKeys, isDerivingKeys } = useWallet();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedNote, setSelectedNote] = useState<WalletNote | null>(null);
  const [isSending, setIsSending] = useState(false);

  const bgColor = isDark ? '#0a0a0a' : '#fff';
  const cardBg = isDark ? '#151515' : '#f8f8f8';
  const inputBg = isDark ? '#1a1a1a' : '#f0f0f0';
  const textColor = isDark ? '#fff' : '#000';
  const mutedColor = isDark ? '#888' : '#666';
  const borderColor = isDark ? '#333' : '#ddd';

  const availableNotes = notes.filter((n) => n.status === 'available');
  const amountSats = parseFloat(amount || '0') * 100_000_000;
  const isValid = recipient.startsWith('zkey:') && amountSats > 0 && amountSats <= availableBalance;

  const handleSend = async () => {
    if (!isValid) {
      Alert.alert('Invalid', 'Please enter a valid recipient and amount');
      return;
    }

    setIsSending(true);
    try {
      // TODO: Implement real sending via SDK
      await new Promise((r) => setTimeout(r, 2000)); // Simulate
      Alert.alert('Sent!', `Successfully sent ${amount} BTC (Demo)`);
      setRecipient('');
      setAmount('');
      setSelectedNote(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to send');
    } finally {
      setIsSending(false);
    }
  };

  // Not ready
  if (!isConnected) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="user-times" size={48} color={mutedColor} />
          <Text style={[styles.message, { color: mutedColor }]}>
            Connect wallet first
          </Text>
        </View>
      </View>
    );
  }

  if (!keysDerived) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="key" size={48} color={mutedColor} />
          <Text style={[styles.message, { color: mutedColor }]}>
            Derive keys to send zkBTC
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={deriveKeys}
            disabled={isDerivingKeys}
          >
            <Text style={styles.buttonText}>
              {isDerivingKeys ? 'Signing...' : 'Derive Keys'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (availableNotes.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="inbox" size={48} color={mutedColor} />
          <Text style={[styles.message, { color: mutedColor }]}>
            No zkBTC available to send
          </Text>
          <Text style={[styles.subMessage, { color: mutedColor }]}>
            Receive some zkBTC first
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: bgColor }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {/* Available Balance */}
        <View style={[styles.balanceBox, { backgroundColor: cardBg }]}>
          <Text style={[styles.balanceLabel, { color: mutedColor }]}>Available</Text>
          <Text style={[styles.balanceValue, { color: textColor }]}>
            {formatBtc(availableBalance)} BTC
          </Text>
        </View>

        {/* Recipient Input */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: textColor }]}>Recipient</Text>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor }]}
            placeholder="zkey:abc123..."
            placeholderTextColor={mutedColor}
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Amount Input */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: textColor }]}>Amount (BTC)</Text>
            <Pressable onPress={() => setAmount(formatBtc(availableBalance))}>
              <Text style={styles.maxButton}>MAX</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor }]}
            placeholder="0.00000000"
            placeholderTextColor={mutedColor}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        {/* Note Selection */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: textColor }]}>From Note</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.notesScroll}>
            {availableNotes.map((note) => (
              <Pressable
                key={note.id}
                style={[
                  styles.noteChip,
                  {
                    backgroundColor: selectedNote?.id === note.id ? '#9945FF' : cardBg,
                    borderColor: selectedNote?.id === note.id ? '#9945FF' : borderColor,
                  },
                ]}
                onPress={() => setSelectedNote(note)}
              >
                <Text
                  style={[
                    styles.noteChipText,
                    { color: selectedNote?.id === note.id ? '#fff' : textColor },
                  ]}
                >
                  {formatBtc(note.amount)} BTC
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Send Button */}
        <Pressable
          style={[styles.sendButton, !isValid && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!isValid || isSending}
        >
          {isSending ? (
            <Text style={styles.sendButtonText}>Sending...</Text>
          ) : (
            <>
              <FontAwesome name="paper-plane" size={18} color="#fff" />
              <Text style={styles.sendButtonText}>Send</Text>
            </>
          )}
        </Pressable>

        {/* Privacy Notice */}
        <View style={[styles.notice, { backgroundColor: '#14F19510' }]}>
          <FontAwesome name="eye-slash" size={14} color="#14F195" />
          <Text style={[styles.noticeText, { color: mutedColor }]}>
            This transaction is private. The recipient will receive zkBTC at their stealth address.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
  },
  subMessage: {
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#9945FF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    padding: 20,
  },
  balanceBox: {
    padding: 16,
    borderRadius: 12,
    borderCurve: 'continuous',
    marginBottom: 24,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  balanceValue: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: 'SpaceMono',
  },
  inputGroup: {
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  maxButton: {
    color: '#9945FF',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    height: 52,
    borderRadius: 10,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  notesScroll: {
    flexDirection: 'row',
  },
  noteChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderCurve: 'continuous',
    marginRight: 8,
    borderWidth: 1,
  },
  noteChipText: {
    fontSize: 14,
    fontFamily: 'SpaceMono',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9945FF',
    paddingVertical: 16,
    borderRadius: 12,
    borderCurve: 'continuous',
    gap: 8,
    marginTop: 8,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderCurve: 'continuous',
    marginTop: 24,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
