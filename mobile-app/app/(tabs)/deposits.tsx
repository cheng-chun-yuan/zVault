import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  RefreshControl,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useWalletStore, Deposit } from '@/contexts/WalletContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

const STATUS_COLORS: Record<Deposit['status'], string> = {
  waiting: '#f59e0b',
  detected: '#3b82f6',
  confirming: '#8b5cf6',
  claimable: '#22c55e',
  claimed: '#6b7280',
};

const STATUS_ICONS: Record<Deposit['status'], string> = {
  waiting: 'clock-o',
  detected: 'search',
  confirming: 'spinner',
  claimable: 'check-circle',
  claimed: 'check',
};

function DepositItem({ deposit }: { deposit: Deposit }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();

  const statusColor = STATUS_COLORS[deposit.status];
  const statusIcon = STATUS_ICONS[deposit.status] as React.ComponentProps<typeof FontAwesome>['name'];

  return (
    <TouchableOpacity
      style={[styles.depositItem, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
      onPress={() => router.push(`/deposit/${deposit.id}`)}>
      <View style={styles.depositLeft}>
        <View style={[styles.iconContainer, { backgroundColor: statusColor + '20' }]}>
          <FontAwesome name={statusIcon} size={20} color={statusColor} />
        </View>
        <View>
          <Text style={[styles.depositAmount, { color: isDark ? '#fff' : '#000' }]}>
            {(deposit.amount / 100_000_000).toFixed(8)} BTC
          </Text>
          <Text style={[styles.depositDate, { color: isDark ? '#666' : '#999' }]}>
            {new Date(deposit.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </View>

      <View style={styles.depositRight}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {deposit.status}
          </Text>
        </View>
        {deposit.status === 'confirming' && (
          <Text style={[styles.confirmations, { color: isDark ? '#666' : '#999' }]}>
            {deposit.confirmations}/6 confirmations
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function DepositsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { deposits } = useWalletStore();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    // TODO: Check deposit statuses
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setRefreshing(false);
  }, []);

  const sortedDeposits = [...deposits].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f5f5f5' }]}>
      {/* New Deposit Button */}
      <Link href="/deposit/new" asChild>
        <TouchableOpacity style={[styles.newDepositButton, { backgroundColor: colors.tint }]}>
          <FontAwesome name="plus" size={16} color="#fff" />
          <Text style={styles.newDepositText}>New Deposit</Text>
        </TouchableOpacity>
      </Link>

      {/* Deposits List */}
      <FlatList
        data={sortedDeposits}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DepositItem deposit={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <FontAwesome name="inbox" size={48} color={isDark ? '#333' : '#ccc'} />
            <Text style={[styles.emptyTitle, { color: isDark ? '#666' : '#999' }]}>
              No deposits yet
            </Text>
            <Text style={[styles.emptyText, { color: isDark ? '#444' : '#bbb' }]}>
              Tap "New Deposit" to get a Bitcoin address and start depositing.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  newDepositButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  newDepositText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  depositItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
  },
  depositLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depositAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  depositDate: {
    fontSize: 12,
    marginTop: 2,
  },
  depositRight: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  confirmations: {
    fontSize: 10,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 48,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
