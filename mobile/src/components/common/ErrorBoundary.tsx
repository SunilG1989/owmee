import React, { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, T, S } from '../../utils/tokens';
import { Button } from '../ui';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error) { console.error('ErrorBoundary:', e); }
  render() {
    if (this.state.hasError) return (
      <View style={s.c}>
        <Text style={s.e}>⚠️</Text>
        <Text style={s.t}>Something went wrong</Text>
        <Button
          label="Try again"
          variant="primary"
          onPress={() => this.setState({ hasError: false })}
        />
      </View>
    );
    return this.props.children;
  }
}

const s = StyleSheet.create({
  c: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: S.xxxl,
    backgroundColor: C.bone,
  },
  e: { fontSize: T.size.display + 18, marginBottom: S.lg },
  t: { fontSize: T.size.lg + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: S.xxl },
});
