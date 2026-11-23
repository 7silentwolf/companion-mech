import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EStopButton } from '../components/RobotChrome';
import { RobotProvider } from '../lib/robot';
import { StoreProvider } from '../lib/store';

function Root() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="skill/[id]" options={{ title: 'Edit skill' }} />
      </Stack>
      {/* E-STOP floats above every screen, just over the tab bar. */}
      <EStopButton bottom={insets.bottom + 72} />
      <StatusBar style="dark" />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <RobotProvider>
          <Root />
        </RobotProvider>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
