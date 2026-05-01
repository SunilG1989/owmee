/**
 * Owmee SplashScreen — v6 "Petrol"
 *
 * The brand moment shown on cold start, in front of the auth
 * gate, and during long migrations. Kept deliberately quiet:
 *   - Bone canvas (warm, not aggressive white)
 *   - "owmee" wordmark in Fraunces — the only place we go all
 *     the way to display weight
 *   - Petrol underscore "swoosh" — the visual signature
 *   - Tagline in Inter Italic, low contrast
 *   - Optional ActivityIndicator when used as a loading screen
 *
 * If you swap the wordmark for an SVG/Lottie, drop it in place of
 * the <Text> here. Keep the bone background and petrol accent.
 *
 * Usage:
 *   <SplashScreen />                     // brand moment, no spinner
 *   <SplashScreen loading />             // spinner under the mark
 *   <SplashScreen loading caption="Restoring session…" />
 */
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { C, FONTS, S, T } from '../../utils/tokens';

interface Props {
  loading?: boolean;
  caption?: string;
}

export default function SplashScreen({ loading = false, caption }: Props) {
  // Subtle fade-in on the wordmark — feels less mechanical than a hard cut.
  const fade = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  return (
    <View style={styles.root}>
      <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
        <Text style={styles.wordmark}>owmee</Text>
        <View style={styles.swoosh} />
        <Text style={styles.tagline}>
          sell. <Text style={styles.taglineEm}>skip the strangers.</Text>
        </Text>
      </Animated.View>

      {(loading || caption) && (
        <View style={styles.loadingRow}>
          {loading && <ActivityIndicator size="small" color={C.petrol} />}
          {caption && <Text style={styles.caption}>{caption}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bone,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
  },
  wordmark: {
    fontFamily: FONTS.displaySemi,
    fontSize: 64,
    fontWeight: T.weight.semi,
    letterSpacing: -1.5,
    color: C.petrolText,
    marginBottom: S.md,
  },
  swoosh: {
    height: 4,
    width: 56,
    borderRadius: 2,
    backgroundColor: C.petrol,
    marginBottom: S.lg,
  },
  tagline: {
    fontFamily: FONTS.sans,
    fontSize: T.size.md,
    color: C.text2,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  taglineEm: {
    fontFamily: FONTS.displayItalic,
    color: C.petrolDeep,
  },
  loadingRow: {
    position: 'absolute',
    bottom: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  caption: {
    fontFamily: FONTS.sans,
    fontSize: T.size.base,
    color: C.text3,
  },
});
