import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#FEFBF4" translucent={false} />
        <RootNavigator />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
