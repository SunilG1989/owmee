/**
 * SplashScreen — JS-side branded overlay shown during app bootstrap.
 *
 * The native side (iOS LaunchScreen.storyboard / Android LaunchTheme)
 * already renders a cream window background instantly on cold start.
 * This component takes over once React mounts and stays visible until
 * `RootNavigator` finishes hydrating auth + location, then fades out.
 *
 * Same handoff pattern as Amazon, Meesho, Flipkart: native cold-start
 * background → JS branded splash → first content screen, with no
 * white-flash between the two.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { C } from '../utils/tokens';

interface Props {
  /** When true, fades out and unmounts. Defaults to false (visible). */
  hide?: boolean;
  /** Called once the fade-out animation completes. */
  onFadeOut?: () => void;
}

export default function SplashScreen({ hide = false, onFadeOut }: Props) {
  const fade = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(lift, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [lift]);

  useEffect(() => {
    if (!hide) return;
    Animated.timing(fade, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onFadeOut?.();
    });
  }, [hide, fade, onFadeOut]);

  return (
    <Animated.View style={[s.root, { opacity: fade }]} pointerEvents="none">
      <Animated.View
        style={{
          opacity: lift,
          transform: [
            {
              translateY: lift.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        }}
      >
        <Text style={s.wordmark}>owmee</Text>
        <Text style={s.tagline}>trusted resale, hyperlocal</Text>
      </Animated.View>
      <View style={s.footer}>
        <Text style={s.footerText}>Bengaluru pilot</Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 48,
    fontWeight: '700',
    color: C.honey,
    textAlign: 'center',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 15,
    color: C.text2,
    textAlign: 'center',
    marginTop: 6,
  },
  footer: {
    position: 'absolute',
    bottom: 36,
    alignSelf: 'center',
  },
  footerText: {
    fontSize: 12,
    color: C.text2,
    opacity: 0.6,
    letterSpacing: 0.5,
  },
});
