/**
 * Root Layout
 *
 * Simple wallet app with Phantom integration and tab navigation.
 */

// Import polyfills first
import '@/lib/polyfills';

import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { PhantomWalletProvider } from '@/contexts/PhantomContext';
import { WalletProvider } from '@/contexts/WalletContext';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // SpaceMono is now loaded natively via expo-font config plugin
  // Only need to load FontAwesome icons async
  const [loaded, error] = useFonts({
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
    <PhantomWalletProvider>
      <WalletProvider>
        <RootLayoutNav />
      </WalletProvider>
    </PhantomWalletProvider>
  );
}
