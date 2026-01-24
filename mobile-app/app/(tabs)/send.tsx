import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useFormattedBalance } from '@/contexts/WalletContext';

interface SendOptionProps {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  title: string;
  description: string;
  href: string;
  color: string;
  isDark: boolean;
}

function SendOption({ icon, title, description, href, color, isDark }: SendOptionProps) {
  return (
    <Link href={href as any} asChild>
      <TouchableOpacity
        style={[styles.optionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <View style={[styles.optionIcon, { backgroundColor: color + '20' }]}>
          <FontAwesome name={icon} size={24} color={color} />
        </View>
        <View style={styles.optionContent}>
          <Text style={[styles.optionTitle, { color: isDark ? '#fff' : '#000' }]}>
            {title}
          </Text>
          <Text style={[styles.optionDescription, { color: isDark ? '#666' : '#999' }]}>
            {description}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={16} color={isDark ? '#444' : '#ccc'} />
      </TouchableOpacity>
    </Link>
  );
}

export default function SendScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const { btc } = useFormattedBalance();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#000' : '#f5f5f5' }]}
      contentContainerStyle={styles.content}>
      {/* Balance Header */}
      <View style={[styles.balanceHeader, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <Text style={[styles.balanceLabel, { color: isDark ? '#888' : '#666' }]}>
          Available Balance
        </Text>
        <Text style={[styles.balanceAmount, { color: colors.text }]}>
          {btc} BTC
        </Text>
      </View>

      {/* Send Options */}
      <Text style={[styles.sectionTitle, { color: isDark ? '#888' : '#666' }]}>
        Choose how to send
      </Text>

      <SendOption
        icon="user-secret"
        title="Send to zKey (Private)"
        description="Send privately to another zVault user using their stealth address"
        href="/send/stealth"
        color="#8b5cf6"
        isDark={isDark}
      />

      <SendOption
        icon="link"
        title="Send by Note"
        description="Generate a shareable claim link that anyone can redeem"
        href="/send/note"
        color="#3b82f6"
        isDark={isDark}
      />

      <SendOption
        icon="bitcoin"
        title="Withdraw to BTC"
        description="Convert sbBTC back to regular Bitcoin (public transaction)"
        href="/send/withdraw"
        color="#f59e0b"
        isDark={isDark}
      />

      {/* Info Box */}
      <View style={[styles.infoBox, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <FontAwesome name="info-circle" size={20} color={colors.tint} />
        <View style={styles.infoContent}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>
            Privacy Levels
          </Text>
          <Text style={[styles.infoText, { color: isDark ? '#666' : '#999' }]}>
            <Text style={{ fontWeight: '600' }}>zKey sends</Text> are fully private - only you and
            the recipient know about the transaction.
            {'\n\n'}
            <Text style={{ fontWeight: '600' }}>Note sends</Text> are private until claimed - the
            claim link holder can see the amount.
            {'\n\n'}
            <Text style={{ fontWeight: '600' }}>BTC withdrawals</Text> are public on the Bitcoin
            blockchain.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  balanceHeader: {
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    marginTop: 8,
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
});
