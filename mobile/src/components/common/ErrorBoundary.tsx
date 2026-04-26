import React, { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, R } from '../../utils/tokens';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error) { console.error('ErrorBoundary:', e); }
  render() {
    if (this.state.hasError) return (
      <View style={s.c}>
        <Text style={s.e}>⚠️</Text>
        <Text style={s.t}>Something went wrong</Text>
        <TouchableOpacity style={s.b} onPress={() => this.setState({ hasError: false })}>
          <Text style={s.bt}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
    return this.props.children;
  }
}
const s = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: C.cream },
  e: { fontSize: 48, marginBottom: 16 },
  t: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 24 },
  b: { backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: 24, paddingVertical: 12 },
  bt: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
