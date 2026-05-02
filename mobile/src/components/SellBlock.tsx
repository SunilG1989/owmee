/**
 * SellBlock — Sprint 8 / 2026-05-02 redesign
 *
 * Mint banner that sits below the category rail and invites the user to
 * list. Tapping the CTA delegates to the consumer's onPress (auth/KYC
 * gating still happens upstream).
 *
 * Copy is locked to the marketing-finalized version: no earnings claims,
 * no internal jargon. If we surface real seller stats later, prefer a
 * separate "social proof" surface rather than diluting this CTA.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { C, T, S, R } from '../utils/tokens';

interface Props {
  onPress: () => void;
}

export default function SellBlock({ onPress }: Props) {
  return (
    <View style={s.outer}>
      <View style={s.banner}>
        <View style={s.iconWrap}>
          <Text style={s.iconGlyph} allowFontScaling={false}>📦</Text>
          <View style={s.shieldBadge}>
            <Text style={s.shieldGlyph} allowFontScaling={false}>✓</Text>
          </View>
        </View>

        <View style={s.copy}>
          <Text style={s.title}>Sell safely from home</Text>
          <Text style={s.subtitle}>
            Get price help, verified buyers, and pickup support.
          </Text>
        </View>

        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.88}
          style={s.cta}
          accessibilityRole="button"
          accessibilityLabel="List now"
        >
          <Text style={s.ctaText}>List now</Text>
          <Text style={s.ctaArrow} allowFontScaling={false}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.sm + 2,
    paddingHorizontal: S.sm + 2,
    borderRadius: R.md,
    backgroundColor: C.mintSoft,
    borderWidth: 1,
    borderColor: C.mintBorder,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: R.sm,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: S.sm + 2,
  },
  iconGlyph: { fontSize: T.size.lg },
  shieldBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.petrol,
    borderWidth: 2,
    borderColor: C.mintSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldGlyph: {
    color: C.white,
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: T.size.md,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.text2,
    lineHeight: T.size.sm + 4,
    fontWeight: T.weight.medium,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.petrolDeep,
    paddingHorizontal: S.sm + 2,
    paddingVertical: S.xs + 4,
    borderRadius: R.sm,
    gap: 2,
  },
  ctaText: {
    color: C.white,
    fontSize: T.size.base,
    fontWeight: T.weight.heavy,
  },
  ctaArrow: {
    color: C.white,
    fontSize: T.size.md,
    fontWeight: T.weight.heavy,
  },
});
