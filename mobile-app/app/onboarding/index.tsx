import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function WelcomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={[styles.logoCircle, { backgroundColor: colors.tint + '20' }]}>
            <FontAwesome name="shield" size={48} color={colors.tint} />
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>zVault</Text>
        <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
          Private Bitcoin on Solana
        </Text>

        {/* Features */}
        <View style={styles.features}>
          <FeatureItem
            icon="lock"
            title="Private Transfers"
            description="Send and receive Bitcoin without revealing your balance"
            isDark={isDark}
            color={colors.tint}
          />
          <FeatureItem
            icon="bolt"
            title="Fast & Cheap"
            description="Powered by Solana for instant, low-cost transactions"
            isDark={isDark}
            color="#f59e0b"
          />
          <FeatureItem
            icon="user-secret"
            title="Stealth Addresses"
            description="Every transaction uses a unique address for privacy"
            isDark={isDark}
            color="#8b5cf6"
          />
        </View>
      </View>

      {/* Buttons */}
      <View style={styles.buttons}>
        <Link href="/onboarding/create-wallet" asChild>
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.tint }]}>
            <Text style={styles.primaryButtonText}>Create New Wallet</Text>
          </TouchableOpacity>
        </Link>

        <Link href="/onboarding/import-wallet" asChild>
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: isDark ? '#333' : '#ddd' }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
              Import Existing Wallet
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({
  icon,
  title,
  description,
  isDark,
  color,
}: {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  title: string;
  description: string;
  isDark: boolean;
  color: string;
}) {
  return (
    <View style={styles.featureItem}>
      <View style={[styles.featureIcon, { backgroundColor: color + '20' }]}>
        <FontAwesome name={icon} size={20} color={color} />
      </View>
      <View style={styles.featureContent}>
        <Text style={[styles.featureTitle, { color: isDark ? '#fff' : '#000' }]}>{title}</Text>
        <Text style={[styles.featureDescription, { color: isDark ? '#666' : '#999' }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 48,
  },
  features: {
    gap: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 14,
    lineHeight: 20,
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
