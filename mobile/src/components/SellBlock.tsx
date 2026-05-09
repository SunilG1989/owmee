/**
 * SellBlock — compact Owmee Assist prompt.
 *
 * Keeps seller activation visible without pushing the product feed below
 * the first viewport.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { CalendarCheck } from 'lucide-react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';

interface Props {
  onPress: () => void;
}

export default function SellBlock({ onPress }: Props) {
  return (
    <View style={s.outer}>
      <View style={s.banner}>
        <View style={s.iconPlate}>
          <CalendarCheck size={16} strokeWidth={2.4} color={C.coralDeep} />
        </View>

        <View style={s.copy}>
          <Text style={s.title}>Owmee Assist</Text>
          <Text style={s.subtitle} numberOfLines={1}>
            Home visit. Photos, price and pickup.
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
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    paddingHorizontal: S.lg,
    paddingTop: S.xs,
  },
  banner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.xs,
    paddingHorizontal: S.sm,
    borderRadius: R.lg,
    backgroundColor: 'rgba(255,253,248,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.85)',
    overflow: 'hidden',
    ...Shadow.subtle,
  },
  iconPlate: {
    width: 28,
    height: 28,
    marginRight: S.xs + 2,
    borderRadius: 14,
    backgroundColor: C.coralLight,
    borderWidth: 1,
    borderColor: 'rgba(187, 104, 79, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.heavy,
    color: C.text,
    lineHeight: T.size.sm + 4,
  },
  subtitle: {
    marginTop: 1,
    fontSize: T.size.xs,
    color: C.text2,
    lineHeight: T.size.xs + 4,
    fontWeight: T.weight.medium,
  },
  cta: {
    marginLeft: S.sm,
    height: 30,
    minWidth: 80,
    paddingHorizontal: S.sm,
    borderRadius: R.pill,
    backgroundColor: '#F3D0BD',
    borderWidth: 1,
    borderColor: 'rgba(187, 104, 79, 0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.subtle,
  },
  ctaText: {
    color: '#2D1F1A',
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.heavy,
  },
});
