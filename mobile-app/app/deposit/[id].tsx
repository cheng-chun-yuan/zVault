import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWalletStore, Deposit } from '@/contexts/WalletContext';

const STATUS_COLORS: Record<Deposit['status'], string> = {
  waiting: '#f59e0b',
  detected: '#3b82f6',
  confirming: '#8b5cf6',
  claimable: '#22c55e',
  claimed: '#6b7280',
};

const STATUS_DESCRIPTIONS: Record<Deposit['status'], string> = {
  waiting: 'Waiting for Bitcoin transaction',
  detected: 'Transaction detected, waiting for confirmations',
  confirming: 'Confirming on Bitcoin network',
  claimable: 'Ready to claim your sbBTC',
  claimed: 'Successfully claimed',
};

export default function DepositDetailScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { deposits } = useWalletStore();
  const deposit = deposits.find((d) => d.id === id);

  const [copied, setCopied] = React.useState(false);

  if (!deposit) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.errorText, { color: colors.text }]}>Deposit not found</Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint }]}
            onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const copyAddress = async () => {
    await Clipboard.setStringAsync(deposit.taprootAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareAddress = async () => {
    await Share.share({
      message: `Send ${(deposit.amount / 100_000_000).toFixed(8)} BTC to:\n${deposit.taprootAddress}`,
    });
  };

  const statusColor = STATUS_COLORS[deposit.status];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#000' : '#f5f5f5' }]}
      contentContainerStyle={styles.scrollContent}>
      {/* Status Card */}
      <View style={[styles.statusCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {deposit.status.toUpperCase()}
          </Text>
        </View>

        <Text style={[styles.amount, { color: colors.text }]}>
          {(deposit.amount / 100_000_000).toFixed(8)} BTC
        </Text>
        <Text style={[styles.sats, { color: isDark ? '#666' : '#999' }]}>
          {deposit.amount.toLocaleString()} sats
        </Text>

        <Text style={[styles.statusDescription, { color: isDark ? '#888' : '#666' }]}>
          {STATUS_DESCRIPTIONS[deposit.status]}
        </Text>

        {deposit.status === 'confirming' && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: isDark ? '#333' : '#eee' }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: statusColor,
                    width: `${(deposit.confirmations / 6) * 100}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: isDark ? '#888' : '#666' }]}>
              {deposit.confirmations} / 6 confirmations
            </Text>
          </View>
        )}

        {deposit.status === 'claimable' && (
          <TouchableOpacity style={[styles.claimButton, { backgroundColor: '#22c55e' }]}>
            <FontAwesome name="check-circle" size={18} color="#fff" />
            <Text style={styles.claimButtonText}>Claim sbBTC</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* QR Code */}
      {deposit.status === 'waiting' && (
        <View style={[styles.qrCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Deposit Address</Text>
          <View style={styles.qrWrapper}>
            <QRCode
              value={`bitcoin:${deposit.taprootAddress}?amount=${deposit.amount / 100_000_000}`}
              size={180}
            />
          </View>

          <Text
            style={[styles.addressText, { color: isDark ? '#888' : '#666' }]}
            numberOfLines={2}>
            {deposit.taprootAddress}
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDark ? '#333' : '#f5f5f5' }]}
              onPress={copyAddress}>
              <FontAwesome name={copied ? 'check' : 'copy'} size={16} color={colors.tint} />
              <Text style={[styles.actionButtonText, { color: colors.text }]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDark ? '#333' : '#f5f5f5' }]}
              onPress={shareAddress}>
              <FontAwesome name="share" size={16} color={colors.tint} />
              <Text style={[styles.actionButtonText, { color: colors.text }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Details */}
      <View style={[styles.detailsCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Details</Text>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: isDark ? '#888' : '#666' }]}>Created</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>
            {new Date(deposit.createdAt).toLocaleString()}
          </Text>
        </View>

        {deposit.txHash && (
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: isDark ? '#888' : '#666' }]}>TX Hash</Text>
            <Text
              style={[styles.detailValue, { color: colors.tint }]}
              numberOfLines={1}
              ellipsizeMode="middle">
              {deposit.txHash}
            </Text>
          </View>
        )}

        {deposit.claimedAt && (
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: isDark ? '#888' : '#666' }]}>Claimed</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {new Date(deposit.claimedAt).toLocaleString()}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  sats: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: 12,
  },
  statusDescription: {
    fontSize: 14,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    marginTop: 16,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  claimButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  qrCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  qrWrapper: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  addressText: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  detailsCard: {
    padding: 20,
    borderRadius: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#33333320',
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    maxWidth: '60%',
  },
});
