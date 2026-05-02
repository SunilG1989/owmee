/**
 * SellBlock — Sprint 8 Phase 1
 *
 * Standalone "Got something to sell?" card that sits between the deals
 * strip and the explore feed. Tapping the CTA navigates to listing
 * creation (with auth/KYC gating handled by the consumer).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { C, Home } from '../utils/tokens';

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
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  block: {
    backgroundColor: Home.sellBgEnd,
    borderRadius: 14,
    padding: 16,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    // v4: was a sky-blue tint to match the old SellBlock palette; now a
    // soft warm border that matches the v4 forest-tinted background.
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
  iconEmoji: { fontSize: 22 },
  textBlock: { flex: 1 },
  headline: {
    fontSize: 14,
    fontWeight: '700',
    color: Home.sellTitle,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    color: Home.sellAccent,
  },
  cta: {
    backgroundColor: Home.sellCtaBg,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '600',
    color: Home.sellCtaText,
  },
});
