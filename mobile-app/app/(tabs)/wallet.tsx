import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Link } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';

import { useWalletStore, useFormattedBalance } from '@/contexts/WalletContext';
import { formatStealthAddress } from '@/lib/keys';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function WalletScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { stealthMetaAddress, notes } = useWalletStore();
  const { btc, sats } = useFormattedBalance();
  const [refreshing, setRefreshing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    // TODO: Scan for new notes
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setRefreshing(false);
  }, []);

  const copyAddress = async () => {
    if (stealthMetaAddress) {
      await Clipboard.setStringAsync(stealthMetaAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const confirmedNotes = notes.filter((n) => n.status === 'confirmed');

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#000' : '#f5f5f5' }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }>
      {/* Balance Card */}
      <View style={[styles.balanceCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <Text style={[styles.balanceLabel, { color: isDark ? '#888' : '#666' }]}>
          Private Balance
        </Text>
        <Text style={[styles.balanceAmount, { color: colors.text }]}>
          {btc} BTC
        </Text>
        <Text style={[styles.balanceSats, { color: isDark ? '#888' : '#666' }]}>
          {sats} sats
        </Text>
      </View>

      {/* zKey Address */}
      <View style={[styles.addressCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <View style={styles.addressHeader}>
          <Text style={[styles.addressLabel, { color: colors.text }]}>
            Your zKey Address
          </Text>
          <TouchableOpacity onPress={copyAddress}>
            <FontAwesome
              name={copied ? 'check' : 'copy'}
              size={18}
              color={copied ? '#4ade80' : colors.tint}
            />
          </TouchableOpacity>
        </View>
        <Text
          style={[styles.addressText, { color: isDark ? '#888' : '#666' }]}
          numberOfLines={1}
          ellipsizeMode="middle">
          {stealthMetaAddress ? formatStealthAddress(stealthMetaAddress, 16) : 'Not initialized'}
        </Text>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        <Link href="/deposit/new" asChild>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.tint }]}>
            <FontAwesome name="arrow-down" size={20} color="#fff" />
            <Text style={styles.actionText}>Deposit</Text>
          </TouchableOpacity>
        </Link>

        <Link href="/receive" asChild>
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: isDark ? '#333' : '#e5e5e5' },
            ]}>
            <FontAwesome name="qrcode" size={20} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Receive</Text>
          </TouchableOpacity>
        </Link>

        <Link href="/claim/scan" asChild>
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: isDark ? '#333' : '#e5e5e5' },
            ]}>
            <FontAwesome name="camera" size={20} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Claim</Text>
          </TouchableOpacity>
        </Link>
      </View>

      {/* Notes List */}
      <View style={[styles.section, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Your Notes ({confirmedNotes.length})
        </Text>
        {confirmedNotes.length === 0 ? (
          <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>
            No notes yet. Deposit BTC to get started.
          </Text>
        ) : (
          confirmedNotes.map((note) => (
            <View
              key={note.id}
              style={[styles.noteItem, { borderBottomColor: isDark ? '#333' : '#eee' }]}>
              <View>
                <Text style={[styles.noteAmount, { color: colors.text }]}>
                  {(note.amount / 100_000_000).toFixed(8)} BTC
                </Text>
                <Text style={[styles.noteDate, { color: isDark ? '#666' : '#999' }]}>
                  {new Date(note.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.noteStatus}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: note.status === 'confirmed' ? '#4ade80' : '#fbbf24' },
                  ]}
                />
                <Text style={[styles.statusText, { color: isDark ? '#888' : '#666' }]}>
                  {note.status}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  balanceCard: {
    margin: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  balanceSats: {
    fontSize: 14,
    marginTop: 4,
  },
  addressCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  addressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addressLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  addressText: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  emptyText: {
    textAlign: 'center',
    padding: 24,
  },
  noteItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  noteAmount: {
    fontSize: 16,
    fontWeight: '500',
  },
  noteDate: {
    fontSize: 12,
    marginTop: 2,
  },
  noteStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
});
