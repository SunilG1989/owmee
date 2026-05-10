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
import { ArrowRight } from 'lucide-react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';

const SECTION_GAP = 7;

interface Props {
  onPress: () => void;
}

export default function SellBlock({ onPress }: Props) {
  return (
    <View style={s.outer}>
      <View style={s.banner}>
        <View style={s.copy}>
          <Text style={s.title} numberOfLines={1}>Sell easier with Owmee</Text>
          <Text style={s.subtitle} numberOfLines={1}>
            Photos, pickup and listing help.
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
          <ArrowRight size={13} strokeWidth={2.4} color={C.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    paddingHorizontal: S.lg,
    paddingTop: SECTION_GAP,
  },
  banner: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.md,
    borderRadius: R.lg,
    backgroundColor: 'rgba(255, 253, 248, 0.30)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.32)',
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.heavy,
    color: C.text,
    lineHeight: T.size.sm + 3,
  },
  subtitle: {
    fontSize: T.size.xs,
    color: '#4B7280',
    lineHeight: T.size.xs + 2,
    fontWeight: T.weight.medium,
  },
  cta: {
    marginLeft: S.sm,
    height: 30,
    minWidth: 86,
    paddingHorizontal: S.sm + 1,
    borderRadius: R.pill,
    backgroundColor: 'rgba(53, 95, 99, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(53, 95, 99, 0.20)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    ...Shadow.subtle,
  },
  ctaText: {
    color: C.white,
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
  },
});
