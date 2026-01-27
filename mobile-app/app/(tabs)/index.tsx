/**
 * Wallet Home Screen
 *
 * Shows balance, recent notes, and quick actions.
 * Clean and simple like a normal wallet.
 */

import { StyleSheet, View, Text, TouchableOpacity, ScrollView, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { useWallet } from '@/contexts/WalletContext';
import { usePhantom } from '@phantom/react-native-wallet-sdk';

function formatBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8);
}

function formatShortBtc(sats: number): string {
  const btc = sats / 100_000_000;
  if (btc >= 1) return btc.toFixed(4);
  if (btc >= 0.01) return btc.toFixed(6);
  return btc.toFixed(8);
}

export default function WalletScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { showLoginOptions } = usePhantom();

  const {
    isConnected,
    address,
    keysDerived,
    deriveKeys,
    isDerivingKeys,
    totalBalance,
    availableBalance,
    notes,
    refreshNotes,
    addDemoNote,
    isLoading,
  } = useWallet();

  const bgColor = isDark ? '#0a0a0a' : '#fff';
  const cardBg = isDark ? '#151515' : '#f8f8f8';
  const textColor = isDark ? '#fff' : '#000';
  const mutedColor = isDark ? '#888' : '#666';

  // Not connected - show connect button
  if (!isConnected) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="lock" size={64} color="#9945FF" />
          <Text style={[styles.title, { color: textColor }]}>zVault</Text>
          <Text style={[styles.subtitle, { color: mutedColor }]}>
            Private Bitcoin Wallet
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => showLoginOptions()}
          >
            <FontAwesome name="bolt" size={18} color="#fff" />
            <Text style={styles.buttonText}>Connect Wallet</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Connected but keys not derived
  if (!keysDerived) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="key" size={64} color="#9945FF" />
          <Text style={[styles.title, { color: textColor }]}>Setup Keys</Text>
          <Text style={[styles.subtitle, { color: mutedColor, textAlign: 'center', paddingHorizontal: 32 }]}>
            Sign a message to derive your private viewing and spending keys
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={deriveKeys}
            disabled={isDerivingKeys}
          >
            {isDerivingKeys ? (
              <Text style={styles.buttonText}>Signing...</Text>
            ) : (
              <>
                <FontAwesome name="pencil" size={18} color="#fff" />
                <Text style={styles.buttonText}>Derive Keys</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Full wallet view
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: bgColor }]}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refreshNotes} />
      }
    >
      {/* Balance Card */}
      <View style={[styles.balanceCard, { backgroundColor: '#9945FF' }]}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balanceAmount}>{formatBtc(totalBalance)} BTC</Text>
        <Text style={styles.balanceUsd}>
          ≈ ${((totalBalance / 100_000_000) * 95000).toLocaleString()} USD
        </Text>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/receive')}
          >
            <View style={styles.quickActionIcon}>
              <FontAwesome name="arrow-down" size={16} color="#9945FF" />
            </View>
            <Text style={styles.quickActionText}>Receive</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/send')}
          >
            <View style={styles.quickActionIcon}>
              <FontAwesome name="arrow-up" size={16} color="#9945FF" />
            </View>
            <Text style={styles.quickActionText}>Send</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => addDemoNote(100000)} // 0.001 BTC demo
          >
            <View style={styles.quickActionIcon}>
              <FontAwesome name="plus" size={16} color="#9945FF" />
            </View>
            <Text style={styles.quickActionText}>Demo</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Notes Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>Your Notes</Text>

        {notes.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: cardBg }]}>
            <FontAwesome name="inbox" size={32} color={mutedColor} />
            <Text style={[styles.emptyText, { color: mutedColor }]}>
              No zkBTC notes yet
            </Text>
            <Text style={[styles.emptySubtext, { color: mutedColor }]}>
              Tap "Demo" to add a test note
            </Text>
          </View>
        ) : (
          <View style={styles.notesList}>
            {notes.map((note) => (
              <View key={note.id} style={[styles.noteItem, { backgroundColor: cardBg }]}>
                <View style={styles.noteLeft}>
                  <View style={[styles.noteIcon, { backgroundColor: note.status === 'available' ? '#14F19520' : '#FF990020' }]}>
                    <FontAwesome
                      name={note.status === 'available' ? 'check' : 'clock-o'}
                      size={14}
                      color={note.status === 'available' ? '#14F195' : '#FF9900'}
                    />
                  </View>
                  <View>
                    <Text style={[styles.noteAmount, { color: textColor }]}>
                      {formatShortBtc(note.amount)} BTC
                    </Text>
                    <Text style={[styles.noteStatus, { color: mutedColor }]}>
                      {note.status === 'available' ? 'Available' : 'Pending'}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.noteDate, { color: mutedColor }]}>
                  {new Date(note.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Privacy Badge */}
      <View style={[styles.privacyBadge, { backgroundColor: cardBg }]}>
        <FontAwesome name="eye-slash" size={14} color="#14F195" />
        <Text style={[styles.privacyText, { color: mutedColor }]}>
          Your balance is private - only visible to you
        </Text>
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
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9945FF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  balanceCard: {
    padding: 24,
    borderRadius: 20,
    marginBottom: 24,
  },
  balanceLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 4,
  },
  balanceAmount: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
    fontFamily: 'SpaceMono',
  },
  balanceUsd: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 4,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  quickAction: {
    alignItems: 'center',
    gap: 8,
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  emptyState: {
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
  },
  notesList: {
    gap: 8,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
  },
  noteLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noteIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteAmount: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  noteStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  noteDate: {
    fontSize: 12,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  privacyText: {
    fontSize: 12,
  },
});
