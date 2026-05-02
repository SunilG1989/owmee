/**
 * ExpertPricingPanel — Concierge master spec section 6.3
 *
 * The single most important UI in the whole feature, per the spec. It's
 * what makes the specialist look like a pro instead of a delivery worker.
 *
 * Inputs (specialist enters these in FeCaptureScreen): brand, model,
 * condition, category. We fire /v1/listings/price-suggestion as those
 * shake out and render:
 *   - median sale price (big, headline)
 *   - sold range
 *   - match count + days-to-sell
 *   - "Faster sell" + "Premium" quick-adjust chips
 *
 * If match_count < 5 even on the loosest filter, the panel is replaced
 * with "No similar items in last 60 days. Use your judgment."
 *
 * Display copy avoids data jargon (no "median", "p25", "p75"). Spec
 * section 11 specifically forbids those terms in seller-facing language;
 * specialist-facing here speaks plainly so when they show this screen
 * to the seller it lands clean.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { FE } from '../../services/api';
import { C, R, S, T, Shadow, formatPrice } from '../../utils/tokens';

interface Props {
  categoryId: string | null;
  brand: string | null;
  model: string | null;
  condition: string | null;
  itemDisplayName?: string;
  onPickPrice: (price: number) => void;
}

interface Suggestion {
  match_count: number;
  match_quality: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  avg_days_to_sell: number | null;
  faster_sell_price: number | null;
  premium_price: number | null;
}

export default function ExpertPricingPanel({
  categoryId,
  brand,
  model,
  condition,
  itemDisplayName,
  onPickPrice,
}: Props) {
  const [data, setData] = useState<Suggestion | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!categoryId || !brand) return;
    let cancelled = false;
    setLoading(true);
    FE.priceSuggestion({
      category_id: categoryId,
      brand,
      model: model ?? undefined,
      condition: condition ?? undefined,
    })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [categoryId, brand, model, condition]);

  if (!categoryId || !brand) {
    return null;
  }

  if (loading) {
    return (
      <View style={s.card}>
        <ActivityIndicator color={C.petrol} />
      </View>
    );
  }

  // Master spec 6.3: if there's no comparable data, don't fake it.
  if (!data || data.match_count < 5 || data.median == null) {
    return (
      <View style={s.card}>
        <Text style={s.noMatchTitle}>No similar items in last 60 days</Text>
        <Text style={s.noMatchBody}>
          Use your judgment. Show the seller a comparable price you've
          seen in similar transactions.
        </Text>
      </View>
    );
  }

  const days = data.avg_days_to_sell != null ? Math.round(data.avg_days_to_sell) : null;
  const titleSubject = itemDisplayName || 'this item';

  return (
    <View style={s.card}>
      <Text style={s.label}>Suggested price for {titleSubject}</Text>
      <Text style={s.median}>{formatPrice(data.median)}</Text>
      <Text style={s.medianHint}>most common selling price (last 60 days)</Text>

      <View style={s.divider} />

      <Text style={s.line}>
        Sold range: {data.p25 != null ? formatPrice(data.p25) : '—'} – {data.p75 != null ? formatPrice(data.p75) : '—'}
      </Text>
      <Text style={s.line}>
        Based on {data.match_count} similar item{data.match_count === 1 ? '' : 's'}
      </Text>
      {days !== null ? (
        <Text style={s.line}>
          Sells in ~{days} day{days === 1 ? '' : 's'} at this price
        </Text>
      ) : null}

      <View style={s.chipRow}>
        {data.faster_sell_price != null ? (
          <TouchableOpacity
            style={s.chip}
            onPress={() => onPickPrice(data.faster_sell_price as number)}
            activeOpacity={0.85}
          >
            <Text style={s.chipLabel}>Faster sell</Text>
            <Text style={s.chipValue}>{formatPrice(data.faster_sell_price)}</Text>
          </TouchableOpacity>
        ) : null}
        {data.premium_price != null ? (
          <TouchableOpacity
            style={s.chip}
            onPress={() => onPickPrice(data.premium_price as number)}
            activeOpacity={0.85}
          >
            <Text style={s.chipLabel}>Premium</Text>
            <Text style={s.chipValue}>{formatPrice(data.premium_price)}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={s.footnote}>
        These are real Owmee sale prices — show the seller for transparency.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginVertical: S.md,
    borderWidth: 1,
    borderColor: C.petrolLight,
    ...Shadow.glow,
  },
  label: {
    fontSize: T.size.base,
    color: C.text2,
    fontWeight: T.weight.semi,
    marginBottom: S.xs,
  },
  median: {
    fontSize: T.size.display + 6,
    fontWeight: T.weight.heavy,
    color: C.petrolDeep,
    marginTop: S.xs,
  },
  medianHint: {
    fontSize: T.size.sm,
    color: C.text3,
    marginTop: 2,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: S.md,
  },
  line: {
    fontSize: T.size.base,
    color: C.text,
    marginBottom: S.xs,
  },
  chipRow: {
    flexDirection: 'row',
    gap: S.sm,
    marginTop: S.md,
  },
  chip: {
    flex: 1,
    backgroundColor: C.petrolLight,
    borderRadius: R.md,
    padding: S.sm,
    alignItems: 'center',
  },
  chipLabel: {
    fontSize: T.size.sm,
    color: C.petrolDeep,
    fontWeight: T.weight.semi,
  },
  chipValue: {
    fontSize: T.size.lg - 1,
    color: C.petrolDeep,
    fontWeight: T.weight.heavy,
    marginTop: 2,
  },
  footnote: {
    fontSize: T.size.sm,
    color: C.text3,
    fontStyle: 'italic',
    marginTop: S.md,
    textAlign: 'center',
  },
  noMatchTitle: {
    fontSize: T.size.sm + 1,
    color: C.text,
    fontWeight: T.weight.semi,
  },
  noMatchBody: {
    fontSize: T.size.base,
    color: C.text2,
    marginTop: S.xs,
    lineHeight: 18,
  },
});
