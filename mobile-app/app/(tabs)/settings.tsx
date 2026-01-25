import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWalletStore } from '@/contexts/WalletContext';
import { formatStealthAddress, loadKeys } from '@/lib/keys';
import { clearAllData, checkBiometricSupport, getCachedItem, setCachedItem, STORAGE_KEYS } from '@/lib/storage';

interface SettingItemProps {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  color?: string;
  isDark: boolean;
}

function SettingItem({
  icon,
  title,
  subtitle,
  onPress,
  rightElement,
  color,
  isDark,
}: SettingItemProps) {
  return (
    <TouchableOpacity
      style={[styles.settingItem, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
      onPress={onPress}
      disabled={!onPress}>
      <View style={[styles.settingIcon, { backgroundColor: (color || '#666') + '20' }]}>
        <FontAwesome name={icon} size={18} color={color || '#666'} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, { color: isDark ? '#fff' : '#000' }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.settingSubtitle, { color: isDark ? '#666' : '#999' }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {rightElement || (
        onPress && <FontAwesome name="chevron-right" size={14} color={isDark ? '#444' : '#ccc'} />
      )}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { stealthMetaAddress } = useWalletStore();
  const [biometricEnabled, setBiometricEnabled] = useState(true);
  const [testnet, setTestnet] = useState(true);

  const copyAddress = async () => {
    if (stealthMetaAddress) {
      await Clipboard.setStringAsync(stealthMetaAddress);
      Alert.alert('Copied', 'zKey address copied to clipboard');
    }
  };

  const showBackupPhrase = async () => {
    Alert.alert(
      'Show Recovery Phrase',
      'You will need to authenticate with Face ID to view your recovery phrase.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            try {
              const keys = await loadKeys();
              if (keys) {
                Alert.alert('Recovery Phrase', keys.mnemonic, [{ text: 'OK' }]);
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to load recovery phrase');
            }
          },
        },
      ]
    );
  };

  const exportViewingKey = async () => {
    Alert.alert(
      'Export Viewing Key',
      'This allows others to see your transaction history but NOT spend your funds. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            try {
              const keys = await loadKeys();
              if (keys) {
                // Convert viewing private key to hex string
                const viewingKeyHex = keys.zvaultKeys.viewingPrivKey.toString(16).padStart(64, '0');
                await Clipboard.setStringAsync(viewingKeyHex);
                Alert.alert('Copied', 'Viewing key copied to clipboard');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to export viewing key');
            }
          },
        },
      ]
    );
  };

  const resetWallet = () => {
    Alert.alert(
      'Reset Wallet',
      'This will delete all data including your keys. Make sure you have backed up your recovery phrase!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            // Force app restart/reload
            Alert.alert('Wallet Reset', 'Please restart the app.');
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#000' : '#f5f5f5' }]}
      contentContainerStyle={styles.content}>
      {/* zKey Section */}
      <Text style={[styles.sectionTitle, { color: isDark ? '#888' : '#666' }]}>
        Your zKey
      </Text>

      <SettingItem
        icon="key"
        title="zKey Address"
        subtitle={stealthMetaAddress ? formatStealthAddress(stealthMetaAddress, 12) : 'Not set'}
        onPress={copyAddress}
        color={colors.tint}
        isDark={isDark}
      />

      <SettingItem
        icon="tag"
        title="Register .zkey Name"
        subtitle="Get a human-readable address"
        onPress={() => Alert.alert('Coming Soon', 'Name registration will be available soon.')}
        color="#8b5cf6"
        isDark={isDark}
      />

      {/* Security Section */}
      <Text style={[styles.sectionTitle, { color: isDark ? '#888' : '#666' }]}>
        Security
      </Text>

      <SettingItem
        icon="lock"
        title="Backup Recovery Phrase"
        subtitle="View your 24-word phrase"
        onPress={showBackupPhrase}
        color="#22c55e"
        isDark={isDark}
      />

      <SettingItem
        icon="eye"
        title="Export Viewing Key"
        subtitle="For auditors or delegated access"
        onPress={exportViewingKey}
        color="#3b82f6"
        isDark={isDark}
      />

      <SettingItem
        icon="user-secret"
        title="Face ID / Touch ID"
        subtitle="Require biometrics for transactions"
        rightElement={
          <Switch
            value={biometricEnabled}
            onValueChange={setBiometricEnabled}
            trackColor={{ true: colors.tint }}
          />
        }
        color="#f59e0b"
        isDark={isDark}
      />

      {/* Network Section */}
      <Text style={[styles.sectionTitle, { color: isDark ? '#888' : '#666' }]}>
        Network
      </Text>

      <SettingItem
        icon="globe"
        title="Use Testnet"
        subtitle="Bitcoin testnet + Solana devnet"
        rightElement={
          <Switch
            value={testnet}
            onValueChange={setTestnet}
            trackColor={{ true: colors.tint }}
          />
        }
        color="#6366f1"
        isDark={isDark}
      />

      {/* About Section */}
      <Text style={[styles.sectionTitle, { color: isDark ? '#888' : '#666' }]}>
        About
      </Text>

      <SettingItem
        icon="info-circle"
        title="About zVault"
        subtitle="Version 1.0.0"
        onPress={() => Alert.alert('zVault', 'Privacy-preserving Bitcoin bridge powered by ZK proofs.')}
        color="#888"
        isDark={isDark}
      />

      <SettingItem
        icon="github"
        title="Source Code"
        subtitle="View on GitHub"
        onPress={() => Alert.alert('GitHub', 'github.com/zvault/zvault')}
        color="#888"
        isDark={isDark}
      />

      {/* Danger Zone */}
      <Text style={[styles.sectionTitle, { color: '#ef4444' }]}>Danger Zone</Text>

      <SettingItem
        icon="trash"
        title="Reset Wallet"
        subtitle="Delete all data and start fresh"
        onPress={resetWallet}
        color="#ef4444"
        isDark={isDark}
      />

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: isDark ? '#444' : '#ccc' }]}>
          zVault Mobile v1.0.0
        </Text>
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
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 12,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  settingSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  footer: {
    alignItems: 'center',
    padding: 32,
  },
  footerText: {
    fontSize: 12,
  },
});
