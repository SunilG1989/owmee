/**
 * SellBlock — Sprint 8 Phase 1
 *
 * Standalone "Got something to sell?" card that sits between the deals
 * strip and the explore feed. Tapping the CTA navigates to listing
 * creation (with auth/KYC gating handled by the consumer).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { C, T, S, R, Home } from '../utils/tokens';

interface Props {
  onPress: () => void;
  /** Override the default subtitle; show real earnings stat if you have one */
  subtitle?: string;
}

export default function SellBlock({ onPress, subtitle }: Props) {
  return (
    <View style={s.outer}>
      <View style={s.block}>
        <View style={s.iconCircle}>
          <Text style={s.iconEmoji}>💰</Text>
        </View>
        <View style={s.textBlock}>
          <Text style={s.headline}>Got something to sell?</Text>
          <Text style={s.subtitle}>
            {subtitle || 'Sellers earned ₹22k avg last month'}
          </Text>
        </View>
        <TouchableOpacity
          style={s.cta}
          onPress={onPress}
          activeOpacity={0.85}
        >
          <Text style={s.ctaText}>List in 2 min</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    paddingHorizontal: S.md,
    paddingTop: S.md,
    paddingBottom: S.sm,
  },
  block: {
    backgroundColor: Home.sellBgEnd,
    borderRadius: R.md,
    padding: S.lg,
    paddingRight: S.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md + 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Home.sellAccent,
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  iconEmoji: { fontSize: T.size.xxl - 2 },
  textBlock: { flex: 1 },
  headline: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.bold,
    color: Home.sellTitle,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: T.size.sm,
    color: Home.sellAccent,
  },
  cta: {
    backgroundColor: Home.sellCtaBg,
    paddingHorizontal: S.md + 2,
    paddingVertical: S.sm + 1,
    borderRadius: R.xs + 2,
  },
  ctaText: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: Home.sellCtaText,
  },
});
