import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useWalletStore } from '@/contexts/WalletContext';
import { formatStealthAddress } from '@/lib/keys';

export default function ReceiveScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { stealthMetaAddress } = useWalletStore();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (stealthMetaAddress) {
      await Clipboard.setStringAsync(stealthMetaAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareAddress = async () => {
    if (stealthMetaAddress) {
      await Share.share({
        message: `Send me private Bitcoin via zVault:\n\n${stealthMetaAddress}`,
      });
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]} edges={['bottom']}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.tint + '20' }]}>
          <FontAwesome name="qrcode" size={28} color={colors.tint} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Your zKey Address</Text>
        <Text style={[styles.subtitle, { color: isDark ? '#888' : '#666' }]}>
          Share this address to receive private Bitcoin payments. Each sender will create a unique
          stealth address for you.
        </Text>

        {/* QR Code */}
        {stealthMetaAddress && (
          <View style={styles.qrContainer}>
            <View style={[styles.qrWrapper, { backgroundColor: '#fff' }]}>
              <QRCode value={stealthMetaAddress} size={200} />
            </View>
          </View>
        )}

        {/* Address Display */}
        <View
          style={[styles.addressContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
          <Text
            style={[styles.addressText, { color: colors.text }]}
            numberOfLines={3}
            ellipsizeMode="middle">
            {stealthMetaAddress || 'No address available'}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}
            onPress={copyAddress}>
            <FontAwesome name={copied ? 'check' : 'copy'} size={20} color={colors.tint} />
            <Text style={[styles.actionText, { color: colors.text }]}>
              {copied ? 'Copied!' : 'Copy'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.tint }]}
            onPress={shareAddress}>
            <FontAwesome name="share" size={20} color="#fff" />
            <Text style={[styles.actionText, { color: '#fff' }]}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Info */}
        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
          <FontAwesome name="info-circle" size={18} color={colors.tint} />
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>How Stealth Addresses Work</Text>
            <Text style={[styles.infoText, { color: isDark ? '#888' : '#666' }]}>
              When someone sends to your zKey, they create a unique one-time address that only you
              can spend from. This means no one can see how much you've received or link your
              transactions together.
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  qrContainer: {
    marginBottom: 20,
  },
  qrWrapper: {
    padding: 16,
    borderRadius: 16,
  },
  addressContainer: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  addressText: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
