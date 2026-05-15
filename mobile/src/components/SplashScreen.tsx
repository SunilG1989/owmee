/**
 * SplashScreen — JS-side branded surface shown during app bootstrap.
 *
 * The native side (iOS LaunchScreen.storyboard / Android LaunchTheme)
 * already renders the sampled logo field instantly on cold start.
 * This component takes over once React mounts and stays visible until
 * `RootNavigator` finishes hydrating auth + location.
 *
 * Commerce-app rule: splash is identity, not marketing. Keep it quiet,
 * centered and fast; the home screen does the explaining.
 */
import React from 'react';
import {
  Image, StatusBar, StyleSheet, View,
} from 'react-native';
import { C, R } from '../utils/tokens';

const SPLASH_MARK = require('../../assets/owmee/brand/owmee-splash-icon-approved.png');
const SPLASH_BG = C.splashBg;
const SPLASH_MARK_SIZE = 132;

export default function SplashScreen() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={SPLASH_BG} translucent={false} />
      <View style={s.root} pointerEvents="none">
        <View style={s.brandStage}>
          <Image
            source={SPLASH_MARK}
            resizeMode="contain"
            style={s.icon}
          />
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandStage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: SPLASH_MARK_SIZE,
    height: SPLASH_MARK_SIZE,
  },
  icon: {
    width: SPLASH_MARK_SIZE,
    height: SPLASH_MARK_SIZE,
    borderRadius: R.xl + R.md - 2,
  },
});
