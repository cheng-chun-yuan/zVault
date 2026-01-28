/**
 * Wallet Home Screen
 *
 * Shows balance, recent notes, and quick actions.
 * Clean and simple like a normal wallet.
 */

import { useCallback, memo } from 'react';
import { StyleSheet, View, Text, Pressable, RefreshControl } from 'react-native';
import { FlashList, ListRenderItemInfo } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { useWallet, WalletNote } from '@/contexts/WalletContext';
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

// Memoized note item component for better FlashList performance
const NoteItem = memo(function NoteItem({
  id,
  amount,
  status,
  createdAt,
  cardBg,
  textColor,
  mutedColor,
}: {
  id: string;
  amount: number;
  status: 'available' | 'pending' | 'spent';
  createdAt: number;
  cardBg: string;
  textColor: string;
  mutedColor: string;
}) {
  const isAvailable = status === 'available';

  return (
    <View style={[styles.noteItem, { backgroundColor: cardBg }]}>
      <View style={styles.noteLeft}>
        <View style={[styles.noteIcon, { backgroundColor: isAvailable ? '#14F19520' : '#FF990020' }]}>
          <FontAwesome
            name={isAvailable ? 'check' : 'clock-o'}
            size={14}
            color={isAvailable ? '#14F195' : '#FF9900'}
          />
        </View>
        <View>
          <Text style={[styles.noteAmount, { color: textColor }]}>
            {formatShortBtc(amount)} BTC
          </Text>
          <Text style={[styles.noteStatus, { color: mutedColor }]}>
            {isAvailable ? 'Available' : 'Pending'}
          </Text>
        </View>
      </View>
      <Text style={[styles.noteDate, { color: mutedColor }]}>
        {new Date(createdAt).toLocaleDateString()}
      </Text>
    </View>
  );
});

export default function WalletScreen() {
  const { push } = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { showLoginOptions } = usePhantom();

  const {
    isConnected,
    keysDerived,
    deriveKeys,
    isDerivingKeys,
    totalBalance,
    notes,
    refreshNotes,
    addDemoNote,
    isLoading,
  } = useWallet();

  const bgColor = isDark ? '#0a0a0a' : '#fff';
  const cardBg = isDark ? '#151515' : '#f8f8f8';
  const textColor = isDark ? '#fff' : '#000';
  const mutedColor = isDark ? '#888' : '#666';

  // Callbacks destructured early for React Compiler
  const handleReceive = useCallback(() => push('/receive'), [push]);
  const handleSend = useCallback(() => push('/send'), [push]);
  const handleDemo = useCallback(() => addDemoNote(100000), [addDemoNote]);

  // Render item for FlashList - pass primitives for memoization
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WalletNote>) => (
      <NoteItem
        id={item.id}
        amount={item.amount}
        status={item.status}
        createdAt={item.createdAt}
        cardBg={cardBg}
        textColor={textColor}
        mutedColor={mutedColor}
      />
    ),
    [cardBg, textColor, mutedColor]
  );

  const keyExtractor = useCallback((item: WalletNote) => item.id, []);

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
          <Pressable
            style={styles.primaryButton}
            onPress={showLoginOptions}
          >
            <FontAwesome name="bolt" size={18} color="#fff" />
            <Text style={styles.buttonText}>Connect Wallet</Text>
          </Pressable>
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
          <Pressable
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
          </Pressable>
        </View>
      </View>
    );
  }

  // Header component for FlashList
  const ListHeader = (
    <>
      {/* Balance Card */}
      <View style={[styles.balanceCard, { backgroundColor: '#9945FF' }]}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balanceAmount}>{formatBtc(totalBalance)} BTC</Text>
        <Text style={styles.balanceUsd}>
          ≈ ${((totalBalance / 100_000_000) * 95000).toLocaleString()} USD
        </Text>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Pressable style={styles.quickAction} onPress={handleReceive}>
            <View style={styles.quickActionIcon}>
              <FontAwesome name="arrow-down" size={16} color="#9945FF" />
            </View>
            <Text style={styles.quickActionText}>Receive</Text>
          </Pressable>

          <Pressable style={styles.quickAction} onPress={handleSend}>
            <View style={styles.quickActionIcon}>
              <FontAwesome name="arrow-up" size={16} color="#9945FF" />
            </View>
            <Text style={styles.quickActionText}>Send</Text>
          </Pressable>

          <Pressable style={styles.quickAction} onPress={handleDemo}>
            <View style={styles.quickActionIcon}>
              <FontAwesome name="plus" size={16} color="#9945FF" />
            </View>
            <Text style={styles.quickActionText}>Demo</Text>
          </Pressable>
        </View>
      </View>

      {/* Section Title */}
      <Text style={[styles.sectionTitle, { color: textColor }]}>Your Notes</Text>
    </>
  );

  // Footer component for FlashList
  const ListFooter = (
    <View style={[styles.privacyBadge, { backgroundColor: cardBg }]}>
      <FontAwesome name="eye-slash" size={14} color="#14F195" />
      <Text style={[styles.privacyText, { color: mutedColor }]}>
        Your balance is private - only visible to you
      </Text>
    </View>
  );

  // Empty state component
  const ListEmpty = (
    <View style={[styles.emptyState, { backgroundColor: cardBg }]}>
      <FontAwesome name="inbox" size={32} color={mutedColor} />
      <Text style={[styles.emptyText, { color: mutedColor }]}>
        No zkBTC notes yet
      </Text>
      <Text style={[styles.emptySubtext, { color: mutedColor }]}>
        Tap "Demo" to add a test note
      </Text>
    </View>
  );

  // Full wallet view with FlashList
  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <FlashList
        data={notes}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refreshNotes} />
        }
        contentInsetAdjustmentBehavior="automatic"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
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
    borderCurve: 'continuous',
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
    borderCurve: 'continuous',
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  emptyState: {
    padding: 32,
    borderRadius: 16,
    borderCurve: 'continuous',
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
  separator: {
    height: 8,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderCurve: 'continuous',
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
    borderCurve: 'continuous',
    gap: 8,
    marginTop: 16,
  },
  privacyText: {
    fontSize: 12,
  },
});
