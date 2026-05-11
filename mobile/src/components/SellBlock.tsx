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

const SECTION_GAP = S.sm;

interface Props {
  onPress: () => void;
}

export default function SellBlock({ onPress }: Props) {
  return (
    <View style={s.outer}>
      <View style={s.banner}>
        <View style={s.copy}>
          <Text style={s.title} numberOfLines={1}>Selling something? We'll help</Text>
          <Text style={s.subtitle} numberOfLines={1}>
            Photos, pricing and pickup support.
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
    borderRadius: R.md,
    backgroundColor: 'rgba(241, 248, 246, 0.58)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.16)',
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: T.size.base,
    fontWeight: T.weight.heavy,
    color: C.text,
    lineHeight: T.size.sm + 3,
  },
  subtitle: {
    fontSize: T.size.xs + 1,
    color: C.text2,
    lineHeight: T.size.xs + 2,
    fontWeight: T.weight.medium,
  },
  cta: {
    marginLeft: S.sm,
    height: 30,
    minWidth: 86,
    paddingHorizontal: S.sm + 1,
    borderRadius: R.pill,
    backgroundColor: C.petrolDeep,
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
