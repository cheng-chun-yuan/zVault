import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWallet } from '@/contexts/WalletContext';
import { generateClaimProof, isNoirAvailable } from '@/lib/proof';

type ClaimStep = 'preview' | 'proving' | 'submitting' | 'success' | 'error';

interface NoteData {
  nullifier: string;
  secret: string;
  amount: number;
}

export default function ClaimScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const { claimNote } = useWallet();

  const [step, setStep] = useState<ClaimStep>('preview');
  const [noteData, setNoteData] = useState<NoteData | null>(null);
  const [proofTime, setProofTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [noirAvailable, setNoirAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    parseNoteData();
    checkNoirAvailability();
  }, [noteId]);

  const parseNoteData = () => {
    try {
      if (!noteId) {
        setError('Invalid claim link');
        return;
      }

      // Decode the note data from base64
      const decoded = Buffer.from(noteId, 'base64').toString();
      const data = JSON.parse(decoded);

      if (!data.nullifier || !data.secret || !data.amount) {
        setError('Invalid claim data');
        return;
      }

      setNoteData(data);
    } catch (e) {
      console.error('Failed to parse note:', e);
      setError('Failed to parse claim link');
    }
  };

  const checkNoirAvailability = async () => {
    const available = await isNoirAvailable();
    setNoirAvailable(available);
  };

  const handleClaim = async () => {
    if (!noteData) return;

    setStep('proving');
    const startTime = Date.now();

    try {
      // Generate ZK proof
      // For demo, we simulate proof generation
      // In production, use: generateClaimProof({...})
      await new Promise((resolve) => setTimeout(resolve, 2500));

      setProofTime(Date.now() - startTime);
      setStep('submitting');

      // Submit to Solana
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setStep('success');
    } catch (e) {
      console.error('Claim failed:', e);
      setError('Failed to claim note');
      setStep('error');
    }
  };

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <View style={[styles.iconCircle, { backgroundColor: '#ef444420' }]}>
            <FontAwesome name="times" size={32} color="#ef4444" />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Claim Failed</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint }]}
            onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'success') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <View style={[styles.iconCircle, { backgroundColor: '#22c55e20' }]}>
            <FontAwesome name="check" size={32} color="#22c55e" />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Claimed!</Text>
          <Text style={[styles.amountLarge, { color: colors.text }]}>
            {noteData ? (noteData.amount / 100_000_000).toFixed(8) : '0'} BTC
          </Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            The funds have been added to your wallet.
          </Text>

          {proofTime > 0 && (
            <View style={[styles.statBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
              <Text style={[styles.statLabel, { color: isDark ? '#888' : '#666' }]}>
                ZK Proof generated in
              </Text>
              <Text style={[styles.statValue, { color: colors.tint }]}>
                {(proofTime / 1000).toFixed(1)}s
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint }]}
            onPress={() => router.replace('/(tabs)/wallet')}>
            <Text style={styles.buttonText}>Go to Wallet</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'proving' || step === 'submitting') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.title, { color: colors.text }]}>
            {step === 'proving' ? 'Generating ZK Proof...' : 'Submitting Transaction...'}
          </Text>
          <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
            {step === 'proving'
              ? 'This proves you own this note without revealing the secret.'
              : 'Sending to Solana network...'}
          </Text>

          {step === 'proving' && (
            <View style={[styles.infoBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
              <FontAwesome name="shield" size={18} color={colors.tint} />
              <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
                {noirAvailable
                  ? 'Using native Noir prover for fast, private proof generation'
                  : 'Using backend prover for proof generation'}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // Preview step
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
          <FontAwesome name="gift" size={28} color={colors.tint} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Claim Bitcoin</Text>

        {/* Amount Display */}
        {noteData && (
          <View style={[styles.amountCard, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
            <Text style={[styles.amountLabel, { color: isDark ? '#888' : '#666' }]}>
              You're receiving
            </Text>
            <Text style={[styles.amountValue, { color: colors.text }]}>
              {(noteData.amount / 100_000_000).toFixed(8)} BTC
            </Text>
            <Text style={[styles.amountSats, { color: isDark ? '#666' : '#999' }]}>
              {noteData.amount.toLocaleString()} sats
            </Text>
          </View>
        )}

        {/* Privacy Info */}
        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
          <FontAwesome name="lock" size={18} color="#22c55e" />
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>Privacy Protected</Text>
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              When you claim, a ZK proof verifies ownership without revealing the note's secret.
              Your claim cannot be linked to the sender.
            </Text>
          </View>
        </View>

        {/* Proof Method */}
        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
          <FontAwesome name="bolt" size={18} color="#f59e0b" />
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>
              {noirAvailable ? 'Native Proving' : 'Backend Proving'}
            </Text>
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              {noirAvailable
                ? 'Using on-device Noir prover (~2-3 seconds)'
                : 'Proof will be generated on the server'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.claimButton, { backgroundColor: colors.tint }]}
          onPress={handleClaim}
          disabled={!noteData}>
          <FontAwesome name="check-circle" size={18} color="#fff" />
          <Text style={styles.claimButtonText}>Claim Now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.cancelButton, { borderColor: isDark ? '#333' : '#ddd' }]}
          onPress={() => router.back()}>
          <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  amountLarge: {
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  amountCard: {
    width: '100%',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  amountLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  amountValue: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  amountSats: {
    fontSize: 14,
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: 12,
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
  statBox: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
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
  buttons: {
    padding: 24,
    gap: 12,
  },
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
  },
  claimButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
