/**
 * SellBlock — compact Owmee Assist prompt.
 *
 * Keeps seller activation visible without pushing the product feed below
 * the first viewport.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ImageSourcePropType,
} from 'react-native';
import { CalendarCheck } from 'lucide-react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';

const SELL_IMAGE: ImageSourcePropType = require('../../assets/owmee/home/assist-photo-v2.png');

interface Props {
  onPress: () => void;
}

export default function SellBlock({ onPress }: Props) {
  return (
    <View style={s.outer}>
      <View style={s.banner}>
        <View style={s.artPlate}>
          <Image source={SELL_IMAGE} style={s.art} resizeMode="cover" />
        </View>

        <View style={s.copy}>
          <Text style={s.title}>Sell from home</Text>
          <Text style={s.subtitle} numberOfLines={2}>
            We take photos, verify and arrange pickup.
          </Text>
        </View>

        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.88}
          style={s.cta}
          accessibilityRole="button"
          accessibilityLabel="Book Owmee Assist visit"
        >
          <Text style={s.ctaText} numberOfLines={1}>Book visit</Text>
          <CalendarCheck size={14} strokeWidth={2.4} color="#251916" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    paddingHorizontal: S.lg,
    paddingTop: S.sm + 2,
  },
  banner: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.sm,
    paddingHorizontal: S.sm + 3,
    borderRadius: R.xl + 1,
    backgroundColor: 'rgba(255,253,248,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.85)',
    overflow: 'hidden',
    ...Shadow.subtle,
  },
  artPlate: {
    width: 50,
    height: 50,
    marginRight: S.sm + 2,
    borderRadius: R.md + 1,
    backgroundColor: '#F2E3D4',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    width: 46,
    height: 46,
    borderRadius: R.sm,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: T.size.base + 1,
    fontWeight: T.weight.heavy,
    color: C.text,
    lineHeight: T.size.base + 4,
  },
  subtitle: {
    marginTop: 2,
    fontSize: T.size.xs + 1,
    color: C.text2,
    lineHeight: T.size.xs + 4,
    fontWeight: T.weight.medium,
  },
  cta: {
    marginLeft: S.sm,
    height: 38,
    minWidth: 94,
    paddingHorizontal: S.sm + 4,
    borderRadius: R.md,
    backgroundColor: '#E6B79F',
    borderWidth: 1,
    borderColor: 'rgba(187, 104, 79, 0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.xs,
    ...Shadow.subtle,
  },
  ctaText: {
    color: '#2D1F1A',
    fontSize: T.size.base,
    fontWeight: T.weight.heavy,
  },
});
