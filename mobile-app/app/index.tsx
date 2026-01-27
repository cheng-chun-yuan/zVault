/**
 * Home Screen
 *
 * Simple wallet connection screen with Phantom integration.
 */

import { StyleSheet, TouchableOpacity, View, Text, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { usePhantom } from '@phantom/react-native-wallet-sdk';
import { FontAwesome } from '@expo/vector-icons';

export default function HomeScreen() {
  const router = useRouter();
  const { phantom, isLoggedIn, addresses, showLoginOptions, logout } = usePhantom();

  const solanaAddress = addresses?.find((a) => a.chain === 'solana')?.address;

  const handleConnect = async () => {
    try {
      await showLoginOptions();
    } catch (error) {
      Alert.alert('Error', 'Failed to connect wallet');
      console.error(error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await logout();
    } catch (error) {
      console.error(error);
    }
  };

  const formatAddress = (address: string) => {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <FontAwesome name="lock" size={64} color="#9945FF" />
        <Text style={styles.title}>zVault</Text>
        <Text style={styles.subtitle}>Privacy-preserving Bitcoin Bridge</Text>
      </View>

      {isLoggedIn && solanaAddress ? (
        <View style={styles.walletContainer}>
          <View style={styles.addressBox}>
            <FontAwesome name="check-circle" size={20} color="#14F195" />
            <Text style={styles.addressText}>{formatAddress(solanaAddress)}</Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/sign')}
          >
            <FontAwesome name="pencil" size={18} color="#fff" style={styles.buttonIcon} />
            <Text style={styles.buttonText}>Sign Message</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleDisconnect}>
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.connectContainer}>
          <TouchableOpacity style={styles.phantomButton} onPress={handleConnect}>
            <FontAwesome name="bolt" size={20} color="#fff" style={styles.buttonIcon} />
            <Text style={styles.buttonText}>Connect with Phantom</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
    marginTop: 8,
  },
  walletContainer: {
    gap: 16,
  },
  addressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  addressText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  connectContainer: {
    gap: 16,
  },
  phantomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9945FF',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14F195',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
  },
  buttonIcon: {
    marginRight: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonText: {
    fontSize: 16,
    opacity: 0.6,
  },
});
