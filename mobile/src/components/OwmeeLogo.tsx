import React from 'react';
import {
  Image, StyleSheet, Text, View,
} from 'react-native';
import { C, T } from '../utils/tokens';

type Props = {
  markSize?: number;
  textSize?: number;
};

const OWMEE_MARK = require('../../assets/owmee/brand/owmee-app-icon-final.png');

const BRAND = {
  clayText: C.coralDeep,
  clayShadow: 'rgba(87, 45, 35, 0.18)',
  tealShadow: 'rgba(11, 67, 62, 0.18)',
};

export default function OwmeeLogo({ markSize = 48, textSize = 30 }: Props) {
  return (
    <View style={s.logo} accessibilityLabel="Owmee" accessible>
      <View
        style={[
          s.markShadow,
          {
            width: markSize,
            height: markSize,
            borderRadius: markSize * 0.24,
          },
        ]}
      >
        <Image
          source={OWMEE_MARK}
          resizeMode="cover"
          style={[
            s.mark,
            {
              width: markSize,
              height: markSize,
              borderRadius: markSize * 0.24,
            },
          ]}
        />
      </View>
      <Text
        style={[
          s.word,
          {
            fontSize: textSize,
            lineHeight: textSize + 2,
          },
        ]}
        numberOfLines={1}
      >
        mee
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  markShadow: {
    backgroundColor: C.surface,
    shadowColor: BRAND.tealShadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  mark: {
    overflow: 'hidden',
  },
  word: {
    marginLeft: 7,
    color: BRAND.clayText,
    fontWeight: T.weight.heavy,
    letterSpacing: 0,
    textShadowColor: BRAND.clayShadow,
    textShadowOffset: { width: 0, height: 1.3 },
    textShadowRadius: 1.2,
  },
});
