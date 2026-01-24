import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-wallet" />
      <Stack.Screen name="import-wallet" />
      <Stack.Screen name="backup" />
    </Stack>
  );
}
