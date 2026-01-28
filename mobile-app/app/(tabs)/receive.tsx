/**
 * Receive Screen
 *
 * Shows stealth address and QR code for receiving zkBTC.
 */

import { StyleSheet, View, Text, Pressable, Share, Alert } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useColorScheme } from '@/components/useColorScheme';
import { useWallet } from '@/contexts/WalletContext';

export default function ReceiveScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { isConnected, keysDerived, stealthAddress, deriveKeys, isDerivingKeys } = useWallet();

  const bgColor = isDark ? '#0a0a0a' : '#fff';
  const cardBg = isDark ? '#151515' : '#f8f8f8';
  const textColor = isDark ? '#fff' : '#000';
  const mutedColor = isDark ? '#888' : '#666';

  const handleCopy = async () => {
    if (stealthAddress) {
      await Clipboard.setStringAsync(stealthAddress);
      Alert.alert('Copied', 'Stealth address copied to clipboard');
    }
  };

  const handleShare = async () => {
    if (stealthAddress) {
      await Share.share({
        message: `Send zkBTC to my stealth address:\n${stealthAddress}`,
      });
    }
  };

  // Not ready
  if (!isConnected) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="user-times" size={48} color={mutedColor} />
          <Text style={[styles.message, { color: mutedColor }]}>
            Connect wallet first
          </Text>
        </View>
      </View>
    );
  }

  if (!keysDerived) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.centerContent}>
          <FontAwesome name="key" size={48} color={mutedColor} />
          <Text style={[styles.message, { color: mutedColor }]}>
            Derive keys to get your stealth address
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={deriveKeys}
            disabled={isDerivingKeys}
          >
            <Text style={styles.buttonText}>
              {isDerivingKeys ? 'Signing...' : 'Derive Keys'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.content}>
        {/* QR Code */}
        <View style={[styles.qrContainer, { backgroundColor: '#fff' }]}>
          <QRCode
            value={stealthAddress || 'zkey:...'}
            size={200}
            color="#000"
            backgroundColor="#fff"
          />
        </View>

        {/* Address */}
        <View style={[styles.addressContainer, { backgroundColor: cardBg }]}>
          <Text style={[styles.addressLabel, { color: mutedColor }]}>
            Your Stealth Address
          </Text>
          <Text style={[styles.address, { color: textColor }]} numberOfLines={2}>
            {stealthAddress}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, { backgroundColor: cardBg }]}
            onPress={handleCopy}
          >
            <FontAwesome name="copy" size={20} color="#9945FF" />
            <Text style={[styles.actionText, { color: textColor }]}>Copy</Text>
          </Pressable>

          <Pressable
            style={[styles.actionButton, { backgroundColor: cardBg }]}
            onPress={handleShare}
          >
            <FontAwesome name="share-alt" size={20} color="#9945FF" />
            <Text style={[styles.actionText, { color: textColor }]}>Share</Text>
          </Pressable>
        </View>

        {/* Privacy Notice */}
        <View style={[styles.notice, { backgroundColor: '#14F19510' }]}>
          <FontAwesome name="shield" size={16} color="#14F195" />
          <Text style={[styles.noticeText, { color: mutedColor }]}>
            This stealth address is unique to you. Senders cannot link payments to your identity.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#9945FF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
  },
  qrContainer: {
    padding: 24,
    borderRadius: 20,
    borderCurve: 'continuous',
    marginTop: 24,
  },
  addressContainer: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderCurve: 'continuous',
    marginTop: 24,
  },
  addressLabel: {
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  address: {
    fontSize: 14,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  actionText: {
    fontSize: 16,
    fontWeight: '500',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderCurve: 'continuous',
    marginTop: 24,
    width: '100%',
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
