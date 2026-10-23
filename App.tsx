import React, { useEffect } from 'react';
import { Image, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/query/queryClient';

// Background tasks must be imported here (module scope) so Android can run them
// when it starts the app headlessly with the app closed.
import './src/tasks/backgroundNotificationTask';
import './src/tasks/backgroundGpsTask';
import { configureNotificationPresentation } from './src/services/systemNotifications';
import { AppNavigator } from './src/navigation/AppNavigator';
import { StatusBarBackdrop } from './src/components/StatusBarBackdrop';

configureNotificationPresentation();

export default function App() {
  useEffect(() => {
    // `Image.resolveAssetSource` isn't implemented on react-native-web, so
    // guard this native-only prefetch optimization to avoid crashing the
    // web build on load. Native (iOS/Android) still gets the prefetch.
    if (Platform.OS === 'web' || typeof Image.resolveAssetSource !== 'function') {
      return;
    }

    try {
      Image.prefetch(
        Image.resolveAssetSource(
          require('./assets/images/header-curve-bg1.png')
        ).uri
      );

      Image.prefetch(
        Image.resolveAssetSource(
          require('./assets/images/concrete-background.png')
        ).uri
      );
    } catch (err) {
      console.warn('[App] Image prefetch failed:', err);
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <AppNavigator />
          {/* Keeps the status-bar icons readable on every screen (content scrolls under it). */}
          <StatusBarBackdrop />
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}