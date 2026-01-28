/**
 * Settings Screen
 *
 * Account settings and wallet info.
 */

import { StyleSheet, View, Text, Pressable, ScrollView, Alert, Linking } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { useWallet } from '@/contexts/WalletContext';
import { usePhantom } from '@phantom/react-native-wallet-sdk';

interface SettingItemProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  value?: string;
  danger?: boolean;
  textColor: string;
  mutedColor: string;
  cardBg: string;
}

function SettingItem({
  icon,
  title,
  subtitle,
  onPress,
  value,
  danger,
  textColor,
  mutedColor,
  cardBg,
}: SettingItemProps) {
  return (
    <Pressable
      style={[styles.settingItem, { backgroundColor: cardBg }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingLeft}>
        <View style={[styles.iconContainer, danger && { backgroundColor: '#FF445520' }]}>
          <FontAwesome
            name={icon as any}
            size={18}
            color={danger ? '#FF4455' : '#9945FF'}
          />
        </View>
        <View>
          <Text style={[styles.settingTitle, { color: danger ? '#FF4455' : textColor }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.settingSubtitle, { color: mutedColor }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {value ? (
        <Text style={[styles.settingValue, { color: mutedColor }]}>{value}</Text>
      ) : null}
      {onPress && !value ? (
        <FontAwesome name="chevron-right" size={14} color={mutedColor} />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { logout } = usePhantom();

  const { isConnected, address, keysDerived, stealthAddress, notes, totalBalance } = useWallet();

  const bgColor = isDark ? '#0a0a0a' : '#fff';
  const cardBg = isDark ? '#151515' : '#f8f8f8';
  const textColor = isDark ? '#fff' : '#000';
  const mutedColor = isDark ? '#888' : '#666';

  const formatAddress = (addr: string | null) => {
    if (!addr) return 'Not connected';
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Wallet',
      'Are you sure you want to disconnect?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => logout(),
        },
      ]
    );
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'This will delete all local notes and keys. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            // TODO: Implement clear data
            Alert.alert('Cleared', 'All local data has been cleared');
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: bgColor }]} contentInsetAdjustmentBehavior="automatic">
      {/* Account Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: mutedColor }]}>ACCOUNT</Text>
        <View style={styles.sectionContent}>
          <SettingItem
            icon="user"
            title="Wallet Address"
            subtitle={formatAddress(address)}
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
          <SettingItem
            icon="key"
            title="Keys Status"
            value={keysDerived ? 'Derived' : 'Not Derived'}
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
          <SettingItem
            icon="eye"
            title="Stealth Address"
            subtitle={formatAddress(stealthAddress)}
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
        </View>
      </View>

      {/* Stats Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: mutedColor }]}>WALLET INFO</Text>
        <View style={styles.sectionContent}>
          <SettingItem
            icon="bitcoin"
            title="Total Notes"
            value={notes.length.toString()}
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
          <SettingItem
            icon="database"
            title="Total Balance"
            value={`${(totalBalance / 100_000_000).toFixed(8)} BTC`}
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
        </View>
      </View>

      {/* App Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: mutedColor }]}>APP</Text>
        <View style={styles.sectionContent}>
          <SettingItem
            icon="github"
            title="Source Code"
            subtitle="View on GitHub"
            onPress={() => Linking.openURL('https://github.com/anthropics/zVault')}
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
          <SettingItem
            icon="info-circle"
            title="Version"
            value="1.0.0"
            textColor={textColor}
            mutedColor={mutedColor}
            cardBg={cardBg}
          />
        </View>
      </View>

      {/* Danger Zone */}
      {isConnected ? (
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: mutedColor }]}>DANGER ZONE</Text>
          <View style={styles.sectionContent}>
            <SettingItem
              icon="trash"
              title="Clear Local Data"
              subtitle="Delete all notes and keys"
              onPress={handleClearData}
              danger
              textColor={textColor}
              mutedColor={mutedColor}
              cardBg={cardBg}
            />
            <SettingItem
              icon="sign-out"
              title="Disconnect Wallet"
              onPress={handleDisconnect}
              danger
              textColor={textColor}
              mutedColor={mutedColor}
              cardBg={cardBg}
            />
          </View>
        </View>
      ) : null}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: mutedColor }]}>
          zVault - Privacy-preserving Bitcoin Bridge
        </Text>
        <View style={styles.footerBadge}>
          <FontAwesome name="shield" size={12} color="#14F195" />
          <Text style={[styles.footerBadgeText, { color: '#14F195' }]}>
            All data stored locally
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
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionContent: {
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    gap: 1,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: '#9945FF15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  settingSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  settingValue: {
    fontSize: 14,
    fontFamily: 'SpaceMono',
  },
  footer: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  footerText: {
    fontSize: 13,
  },
  footerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
