/**
 * SellerApprovalScreen — Concierge master spec section 6.5
 *
 * The "show seller" gate. Specialist hands phone to seller. Seller reads
 * the summary (item title + condition + price). Tap approve → submit-
 * listing fires + navigate to VisitContinue. Tap edit → goBack to
 * FeCaptureScreen with all state intact.
 *
 * This isn't gimmicky. It's the single moment that reinforces "they're
 * working FOR me, not on me." Per the master spec: real PMs at category-
 * defining services obsess over moments like this.
 */
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FE } from '../../services/api';
import { Button } from '../../components/ui';
import { C, MIN_TAP, R, S, Shadow, formatPrice } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

export default function SellerApprovalScreen({
  navigation,
  route,
}: RootScreen<'SellerApproval'>) {
  const { visitId, summary, payload } = route.params;
  const [submitting, setSubmitting] = useState(false);

  const onApprove = async () => {
    setSubmitting(true);
    try {
      await FE.submitListing(visitId, payload);
      navigation.replace('VisitContinue', { visitId });
    } catch (e: any) {
      Alert.alert(
        'Submit failed',
        e?.response?.data?.detail?.message || 'Please try again.',
      );
      setSubmitting(false);
    }
  };

  const onEdit = () => {
    navigation.goBack();
  };

  const conditionLabel = (() => {
    const map: Record<string, string> = {
      flawless: 'Like new',
      excellent: 'Excellent',
      good: 'Good',
      fair: 'Fair',
      poor: 'Worn',
    };
    return map[summary.condition] ?? summary.condition;
  })();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.body}>
        <Text style={s.eyebrow}>SHOW THIS TO THE SELLER BEFORE SUBMITTING</Text>

        <View style={s.card}>
          <Text style={s.title} numberOfLines={3}>
            📱 {summary.title || '—'}
          </Text>
          <Text style={s.condition}>"{conditionLabel}" condition</Text>
          <Text style={s.price}>{formatPrice(summary.priceInr)}</Text>
        </View>

        <Text style={s.script}>
          "In the last two months, similar items sold on Owmee around
          this price. I'm pricing yours at {formatPrice(summary.priceInr)}.
          Sound good?"
        </Text>

        <View style={{ flex: 1 }} />

        <Button
          label="✓ Seller approved — list it"
          onPress={onApprove}
          loading={submitting}
          disabled={submitting}
          style={s.cta}
        />
        <TouchableOpacity
          onPress={onEdit}
          disabled={submitting}
          style={s.editBtn}
          activeOpacity={0.7}
        >
          <Text style={s.editText}>Edit before listing</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  body: {
    flex: 1,
    paddingHorizontal: S.xl,
    paddingTop: S.xl,
    paddingBottom: S.lg,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: C.petrolDeep,
    letterSpacing: 0.6,
    marginBottom: S.lg,
    textAlign: 'center',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    padding: S.xl,
    alignItems: 'center',
    ...Shadow.glow,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    lineHeight: 28,
  },
  condition: {
    fontSize: 14,
    color: C.text2,
    fontStyle: 'italic',
    marginTop: S.sm,
  },
  price: {
    fontSize: 38,
    fontWeight: '800',
    color: C.petrolDeep,
    marginTop: S.md,
  },
  script: {
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: S.xl,
    lineHeight: 21,
    paddingHorizontal: S.md,
  },
  cta: {
    width: '100%',
    marginBottom: S.sm,
  },
  editBtn: {
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editText: {
    fontSize: 14,
    color: C.text2,
    fontWeight: '500',
  },
});
