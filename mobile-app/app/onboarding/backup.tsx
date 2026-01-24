import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function BackupScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();

  const words = mnemonic?.split(' ') || [];

  // Pick 3 random words to verify
  const [verificationIndices] = useState(() => {
    const indices: number[] = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * words.length);
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }
    return indices.sort((a, b) => a - b);
  });

  const [answers, setAnswers] = useState<{ [key: number]: string }>({});
  const [errors, setErrors] = useState<{ [key: number]: boolean }>({});

  const handleVerify = () => {
    const newErrors: { [key: number]: boolean } = {};
    let allCorrect = true;

    verificationIndices.forEach((idx) => {
      const answer = answers[idx]?.trim().toLowerCase();
      const correct = words[idx]?.toLowerCase();
      if (answer !== correct) {
        newErrors[idx] = true;
        allCorrect = false;
      }
    });

    setErrors(newErrors);

    if (allCorrect) {
      router.replace('/(tabs)/wallet');
    } else {
      Alert.alert('Incorrect', 'One or more words are incorrect. Please check your recovery phrase.');
    }
  };

  const handleSkip = () => {
    Alert.alert(
      'Skip Verification?',
      'Are you sure you want to skip? Make sure you have written down your recovery phrase safely.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', onPress: () => router.replace('/(tabs)/wallet') },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: '#22c55e20' }]}>
          <FontAwesome name="check-circle" size={32} color="#22c55e" />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Verify Your Backup</Text>
        <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
          Let's make sure you wrote down your recovery phrase correctly. Enter the following words:
        </Text>

        {/* Verification Inputs */}
        <View style={styles.verificationContainer}>
          {verificationIndices.map((idx) => (
            <View key={idx} style={styles.verificationRow}>
              <Text style={[styles.wordLabel, { color: isDark ? '#888' : '#666' }]}>
                Word #{idx + 1}
              </Text>
              <TextInput
                style={[
                  styles.wordInput,
                  {
                    backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5',
                    color: colors.text,
                    borderColor: errors[idx] ? '#ef4444' : 'transparent',
                  },
                ]}
                placeholder={`Enter word #${idx + 1}`}
                placeholderTextColor={isDark ? '#444' : '#bbb'}
                autoCapitalize="none"
                autoCorrect={false}
                value={answers[idx] || ''}
                onChangeText={(text) => {
                  setAnswers((prev) => ({ ...prev, [idx]: text }));
                  setErrors((prev) => ({ ...prev, [idx]: false }));
                }}
              />
              {errors[idx] && (
                <Text style={styles.errorText}>Incorrect word</Text>
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.tint }]}
          onPress={handleVerify}>
          <Text style={styles.primaryButtonText}>Verify & Continue</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={[styles.skipButtonText, { color: isDark ? '#666' : '#999' }]}>
            Skip Verification
          </Text>
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
  verificationContainer: {
    width: '100%',
    gap: 20,
  },
  verificationRow: {
    gap: 8,
  },
  wordLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  wordInput: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 2,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 4,
  },
  buttons: {
    padding: 24,
    gap: 12,
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
  skipButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 14,
  },
});
