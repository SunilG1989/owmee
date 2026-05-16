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
import React, { useState } from 'react';
import {
  Image, Platform, StatusBar, StyleSheet, View,
} from 'react-native';
import { C, R } from '../utils/tokens';

const SPLASH_MARK = require('../../assets/owmee/brand/owmee-splash-icon-approved.png');
const SPLASH_BG = C.splashBg;
const SPLASH_MARK_SIZE = 132;

export default function SplashScreen() {
  const [imageReady, setImageReady] = useState(false);
  const keepNativeSplashVisible = Platform.OS === 'android' && !imageReady;

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={SPLASH_BG} translucent={false} />
      <View
        style={[s.root, keepNativeSplashVisible && s.rootNativeHandoff]}
        pointerEvents="none"
      >
        <View style={s.brandStage}>
          <Image
            source={SPLASH_MARK}
            resizeMode="contain"
            fadeDuration={0}
            onLoad={() => setImageReady(true)}
            style={s.icon}
          />
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rootNativeHandoff: {
    backgroundColor: 'transparent',
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
