/**
 * Standard back button used across every pushed screen.
 *
 * Shipping a single component (rather than per-screen TouchableOpacity
 * + Text) gives us:
 *   - one glyph (‹), one size, one tap target, one tint everywhere
 *   - a single accessibility label
 *   - safe-by-default behavior: hides itself when there's nothing to
 *     pop (canGoBack=false) so we don't render a dead control
 *
 * Usage:
 *   import { BackButton } from '../components/ui';
 *   <BackButton />                              // pops the stack
 *   <BackButton onPress={customHandler} />      // override (e.g. confirm-before-leave)
 *   <BackButton tint={C.white} />               // dark hero header (e.g. listing detail)
 *   <BackButton variant="floating" />           // overlay back on photo (semi-transparent pill)
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { C } from '../../utils/tokens';

export type BackButtonVariant = 'plain' | 'floating';

interface Props {
  onPress?: () => void;
  tint?: string;
  variant?: BackButtonVariant;
  /** Render even when there's nothing to pop — useful inside modals where canGoBack returns false. */
  alwaysVisible?: boolean;
  /** Optional left-margin override (default keeps glyph aligned to a 16px gutter). */
  marginLeft?: number;
}

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

export default function BackButton({
  onPress,
  tint,
  variant = 'plain',
  alwaysVisible = false,
  marginLeft,
}: Props) {
  const navigation = useNavigation<any>();
  const canGoBack = navigation?.canGoBack?.() ?? false;
  if (!canGoBack && !alwaysVisible) return null;

  const handle = () => {
    if (onPress) return onPress();
    if (canGoBack) navigation.goBack();
  };

  const isFloating = variant === 'floating';
  const glyphTint = tint ?? (isFloating ? C.white : C.text);

  return (
    <TouchableOpacity
      onPress={handle}
      hitSlop={HIT}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={[
        s.btn,
        isFloating && s.floating,
        marginLeft !== undefined && { marginLeft },
      ]}
    >
      <View style={s.inner}>
        <Text style={[s.glyph, { color: glyphTint }]}>‹</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
  },
  inner: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 32,
    fontWeight: '400',
    lineHeight: 32,
    marginTop: -3,
  },
});
