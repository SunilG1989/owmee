/**
 * SplashScreen — JS-side branded overlay shown during app bootstrap.
 *
 * The native side (iOS LaunchScreen.storyboard / Android LaunchTheme)
 * already renders a cream window background instantly on cold start.
 * This component takes over once React mounts and stays visible until
 * `RootNavigator` finishes hydrating auth + location, then fades out.
 *
 * Commerce-app rule: splash is identity, not marketing. Keep it quiet,
 * centered and fast; the home screen does the explaining.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated, Image, StyleSheet, View,
} from 'react-native';
import { C, R } from '../utils/tokens';

const SPLASH_MARK = require('../../assets/owmee/brand/owmee-splash-icon-approved.png');

interface Props {
  /** When true, fades out and unmounts. Defaults to false (visible). */
  hide?: boolean;
  /** Called once the fade-out animation completes. */
  onFadeOut?: () => void;
}

export default function SplashScreen({ hide = false, onFadeOut }: Props) {
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!hide) return;
    Animated.timing(fade, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onFadeOut?.();
    });
  }, [hide, fade, onFadeOut]);

  return (
    <Animated.View style={[s.root, { opacity: fade }]} pointerEvents="none">
      <View style={s.brandStage}>
        <Image
          source={SPLASH_MARK}
          resizeMode="cover"
          style={s.icon}
        />
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bone,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandStage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 132,
    height: 132,
  },
  icon: {
    width: 132,
    height: 132,
    borderRadius: R.xl + R.md - 2,
  },
});
