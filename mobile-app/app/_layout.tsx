import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { WalletProvider, useWalletStore } from '@/contexts/WalletContext';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const { isInitialized, isLoading } = useWalletStore();

  useEffect(() => {
    if (isLoading) return;

    const inOnboarding = segments[0] === 'onboarding';

    if (!isInitialized && !inOnboarding) {
      // Redirect to onboarding if wallet not initialized
      router.replace('/onboarding');
    } else if (isInitialized && inOnboarding) {
      // Redirect to main app if already initialized
      router.replace('/(tabs)/wallet');
    }
  }, [isInitialized, isLoading, segments]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen
          name="deposit/new"
          options={{
            title: 'New Deposit',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="deposit/[id]"
          options={{
            title: 'Deposit Details',
          }}
        />
        <Stack.Screen
          name="send/stealth"
          options={{
            title: 'Send Privately',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="send/note"
          options={{
            title: 'Send by Note',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="send/withdraw"
          options={{
            title: 'Withdraw to BTC',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="claim/scan"
          options={{
            title: 'Scan QR',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="claim/[noteId]"
          options={{
            title: 'Claim',
          }}
        />
        <Stack.Screen
          name="receive/index"
          options={{
            title: 'Receive',
            presentation: 'modal',
          }}
        />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <WalletProvider>
      <RootLayoutNav />
    </WalletProvider>
  );
}
