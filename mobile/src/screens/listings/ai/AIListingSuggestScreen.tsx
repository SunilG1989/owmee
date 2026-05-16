/**
 * AIListingSuggestScreen — Sprint 8 Phase 2
 *
 * Screen 2 of 2. The "Everything Screen" that packs 16 trust signals:
 *
 *   1. Photo with edit affordance
 *   2. AI-detected specifics ("iPhone 13 · 128GB · Midnight Black")
 *   3. Edit details affordance
 *   4. BIG price
 *   5. "Based on N similar sold in <state>"
 *   6. "See similar sales →"
 *   7. "Set my own price" link
 *   8. Condition radio (re-prices live)
 *   9-13. HOW IT WORKS: pay → pickup → check → ship → money
 *   14-16. ✓ No buyer comes home / No bargaining / No scam calls
 *
 * Plus: Owmee Terms link.
 *
 * On "List for ₹X" → AIListing.createFromDraft() →
 *   - if smartphone + no IMEI yet, route to AIListingIdentifier
 *   - else, in-place success state
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, T, S, R, Shadow, formatPrice } from '../../../utils/tokens';
import { AIListing } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import type { AIDraftResponse } from '../../../services/api';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';
import EditDetailsSheet from './shared/EditDetailsSheet';
import PriceSheet from './shared/PriceSheet';
import ComparablesSheet from './shared/ComparablesSheet';

const CONDITION_OPTIONS: { key: 'like_new' | 'good' | 'fair'; label: string; multiplier: number }[] = [
  { key: 'like_new', label: 'Like new', multiplier: 1.0 },
  { key: 'good', label: 'Good', multiplier: 0.85 },
  { key: 'fair', label: 'Fair', multiplier: 0.70 },
];

// Categories that need an IMEI/serial sub-step before listing goes live
const IDENTIFIER_CATEGORIES = new Set(['smartphones', 'laptops', 'tablets']);

const cleanText = (value?: string | null) => {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length ? cleaned : null;
};

export default function AIListingSuggestScreen({
  route,
  navigation,
}: RootScreen<'AIListingSuggest'>) {
  const initialDraft: AIDraftResponse = route.params.draft;

  // Editable state, seeded from AI response
  const [draft, setDraft] = useState<AIDraftResponse>(initialDraft);
  const [condition, setCondition] = useState<'like_new' | 'good' | 'fair'>(
    (initialDraft.detected.condition_guess as any) || 'good',
  );
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<{
    brand?: string;
    model?: string;
    storage?: string;
    ram?: string;
    processor?: string;
    screen_size?: string;
    color?: string;
    purchase_year?: number | null;
    accessories?: string;
    warranty_status?: string;
    category_slug?: string;
  }>({});
  const [editSheet, setEditSheet] = useState(false);
  const [priceSheet, setPriceSheet] = useState(false);
  const [compsSheet, setCompsSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ listingId: string; price: number; title: string } | null>(null);

  // Timer for the comparables → price sheet handoff. Tracked via ref so we
  // can cancel on unmount and avoid setState-on-unmounted-component warnings.
  const compsToPriceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (compsToPriceTimer.current) clearTimeout(compsToPriceTimer.current);
    };
  }, []);

  // Effective fields (overrides win over AI)
  const brand = overrides.brand ?? draft.detected.brand ?? '';
  const model = overrides.model ?? draft.detected.model ?? '';
  const storage = overrides.storage ?? draft.detected.storage ?? '';
  const ram = overrides.ram ?? draft.detected.ram ?? '';
  const processor = overrides.processor ?? draft.detected.processor ?? '';
  const screenSize = overrides.screen_size ?? draft.detected.screen_size ?? '';
  const color = overrides.color ?? draft.detected.color ?? '';
  const purchaseYear = overrides.purchase_year ?? draft.detected.purchase_year ?? null;
  const accessories = overrides.accessories ?? draft.detected.accessories ?? '';
  const warrantyStatus = overrides.warranty_status ?? draft.detected.warranty_status ?? '';
  const categorySlug = overrides.category_slug ?? draft.detected.category_slug ?? '';

  // Live re-priced based on condition. Custom price short-circuits.
  const effectivePrice = useMemo(() => {
    if (customPrice != null) return customPrice;
    const base = draft.suggested_price ?? 0;
    const m = CONDITION_OPTIONS.find((o) => o.key === condition)?.multiplier ?? 1.0;
    // Initial AI suggestion already factors in detected condition; if user
    // changes condition we adjust *relative to* the like_new baseline.
    const baseLikeNew = base / (CONDITION_OPTIONS.find(
      (o) => o.key === (draft.detected.condition_guess as any) || 'good',
    )?.multiplier ?? 1.0);
    return Math.round(baseLikeNew * m / 10) * 10;
  }, [condition, customPrice, draft]);

  const titleGuess = useMemo(() => {
    const identityWasEdited = ['brand', 'model', 'storage', 'ram', 'color', 'category_slug']
      .some((key) => Object.prototype.hasOwnProperty.call(overrides, key));
    if (!identityWasEdited && draft.detected.title_suggestion) return draft.detected.title_suggestion;
    const parts = [brand, model, storage, color].filter(Boolean);
    return parts.join(' ').slice(0, 80) || 'Used item';
  }, [draft, overrides, brand, model, storage, color]);

  const subtitleSpecifics = useMemo(() => {
    const parts = [storage, ram, color].filter(Boolean);
    return parts.length ? parts.join(' · ') : '';
  }, [storage, ram, color]);

  const finalDetails = useMemo(() => ({
    brand: cleanText(brand),
    model: cleanText(model),
    storage: cleanText(storage),
    ram: cleanText(ram),
    processor: cleanText(processor),
    screen_size: cleanText(screenSize),
    color: cleanText(color),
    purchase_year: purchaseYear || null,
    accessories: cleanText(accessories),
    warranty_status: cleanText(warrantyStatus),
  }), [brand, model, storage, ram, processor, screenSize, color, purchaseYear, accessories, warrantyStatus]);

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!effectivePrice || effectivePrice <= 0) {
      Alert.alert('Set a price', 'Please set a price before listing.');
      return;
    }
    if (!categorySlug) {
      Alert.alert('Pick a category', 'Tap "Edit details" to confirm the category.');
      return;
    }

    // If smartphone or laptop, route to identifier capture before creating
    if (IDENTIFIER_CATEGORIES.has(categorySlug)) {
      navigation.navigate('AIListingIdentifier', {
        draft,
        finalFields: {
          title: titleGuess,
          price: effectivePrice,
          condition,
          category_slug: categorySlug,
          ...finalDetails,
          description: draft.detected.description_suggestion ?? '',
        },
      });
      return;
    }

    // Non-identifier categories — create directly
    setSubmitting(true);
    try {
      const { data } = await AIListing.createFromDraft({
        draft_id: draft.draft_id,
        title: titleGuess,
        price: effectivePrice,
        condition,
        category_slug: categorySlug,
        ...finalDetails,
        description: draft.detected.description_suggestion ?? '',
      });
      setSuccess({
        listingId: data.listing_id,
        price: data.price,
        title: data.title,
      });
    } catch (e) {
      Alert.alert('Could not list', parseApiError(e));
      setSubmitting(false);
    }
  }, [draft, effectivePrice, condition, categorySlug, titleGuess, navigation, submitting, finalDetails]);

  // ── Success state (in-place, replaces form) ─────────────────────────────
  if (success) {
    return (
      <SafeAreaView style={st.root}>
        <ScrollView contentContainerStyle={st.successScroll}>
          <View style={st.successCheckCircle}>
            <Text style={st.successCheck}>✓</Text>
          </View>
          <Text style={st.successTitle}>Your listing is ready</Text>
          <Text style={st.successHelper}>
            We'll notify you the moment a verified buyer commits.
          </Text>

          <View style={st.successCard}>
            <Text style={st.successCardTitle} numberOfLines={2}>{success.title}</Text>
            <Text style={st.successCardPrice}>{formatPrice(success.price)}</Text>
          </View>

          <Text style={st.successSection}>What happens next</Text>
          <SuccessStep num={1} text="A verified buyer commits — usually within 72 hours" />
          <SuccessStep num={2} text="Owmee manages payment and handover support" />
          <SuccessStep num={3} text="Keep the item ready and update details if anything changes" />
          <SuccessStep num={4} text="Payout is released after handover as per Owmee policy" />
        </ScrollView>

        <View style={st.successCtaBar}>
          <Button
            label="See my listing"
            variant="primary"
            size="lg"
            onPress={() => navigation.replace('ListingDetail' as never, { listingId: success.listingId } as never)}
            fullWidth
            style={st.primaryBtn}
          />
          <Button
            label="List another item"
            variant="secondary"
            onPress={() => navigation.replace('AIListingCamera' as never, undefined as never)}
            fullWidth
            style={st.secondaryBtn}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Main scroll ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.root}>
      {/* Header */}
      <View style={st.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={st.headerTitle}>Review listing</Text>
        <View style={st.headerSpacer} />
      </View>

      <ScrollView style={st.flex} contentContainerStyle={st.scrollPad}>
        {/* Compact item card — image left, title + price + edit affordance */}
        <View style={st.itemCard}>
          <Image source={{ uri: draft.photo_url }} style={st.itemImage} resizeMode="cover" />
          <View style={st.itemMeta}>
            <Text style={st.itemTitle} numberOfLines={2}>{titleGuess}</Text>
            {subtitleSpecifics ? (
              <Text style={st.itemSubtitle} numberOfLines={1}>{subtitleSpecifics}</Text>
            ) : null}
            <Text style={st.itemPrice}>{formatPrice(effectivePrice)}</Text>
          </View>
          <TouchableOpacity onPress={() => setEditSheet(true)} style={st.itemEditBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={st.itemEditGlyph}>✎</Text>
          </TouchableOpacity>
        </View>

        {/* Set your price */}
        <View style={st.section}>
          <Text style={st.sectionH1}>Set your price</Text>
          <Text style={st.sectionSub}>
            {draft.price_source === 'comparables' && draft.comparables.length > 0
              ? `Based on ${draft.comparables.length} similar items sold recently.`
              : draft.price_source === 'ai'
                ? 'Suggested using Indian market estimates.'
                : 'Confirm or set a base price for your listing.'}
          </Text>

          <TouchableOpacity style={st.priceBtn} onPress={() => setPriceSheet(true)}>
            <Text style={st.priceBtnTitle}>Set my price</Text>
            <Text style={st.priceBtnHint}>Enter the amount you want.</Text>
            <Text style={st.priceBtnArrow}>›</Text>
          </TouchableOpacity>

          {draft.comparables.length > 0 && (
            <TouchableOpacity style={st.priceBtn} onPress={() => setCompsSheet(true)}>
              <Text style={st.priceBtnTitle}>See our price suggestion</Text>
              <Text style={st.priceBtnHint}>{formatPrice(draft.suggested_price ?? effectivePrice)} · based on similar sales</Text>
              <Text style={st.priceBtnArrow}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Condition pills */}
        <View style={st.section}>
          <Text style={st.sectionH1}>Condition</Text>
          <Text style={st.sectionSub}>How is the item right now?</Text>
          <View style={st.condRow}>
            {CONDITION_OPTIONS.map((opt) => {
              const active = condition === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => {
                    setCondition(opt.key);
                    setCustomPrice(null);
                  }}
                  style={[st.condPill, active && st.condPillActive]}>
                  {active && <Text style={st.condPillTick}>✓</Text>}
                  <Text style={[st.condPillLabel, active && st.condPillLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* How Owmee protects your trust */}
        <View style={st.trustBlock}>
          <Text style={st.trustHeading}>How Owmee protects your sale</Text>
          <TrustRow text="KYC verification stays visible as your seller trust badge" />
          <TrustRow text="Owmee manages protected payment and handover support" />
          <TrustRow text="Verified buyers use safe payment — no seller chat needed" />
          <TrustRow text="You can edit details until a buyer commits" />
          <TrustRow text="Clear photos and honest condition help prevent returns" />
        </View>

        {/* TDS pre-disclosure (P0 launch fix) — surfacing IT Section 194-O
           early avoids the surprise at first ₹5L payout. Single info card,
           non-blocking. */}
        <View style={st.tdsCard}>
          <Text style={st.tdsHeading}>Heads-up about taxes</Text>
          <Text style={st.tdsBody}>
            Once your sales on Owmee cross{' '}
            <Text style={st.tdsBold}>₹5,00,000 in a financial year</Text>,
            1% TDS is deducted from each payout (Section 194-O). Add your PAN
            in profile to keep the rate at 1% — without it, deductions jump to 5%.
          </Text>
        </View>

        {/* Tiny legal */}
        <Text style={st.legal}>
          By listing, you agree to{' '}
          <Text style={st.legalLink} onPress={() => Alert.alert('Owmee Terms', 'Terms and Conditions go here.')}>
            Owmee Terms
          </Text>
          .
        </Text>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={st.ctaBar}>
        <Button
          label="Continue to list"
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={submitting}
          onPress={submit}
          fullWidth
          style={st.primaryBtn}
        />
      </View>

      {/* Bottom sheets */}
      {editSheet && (
        <EditDetailsSheet
          initial={{
            brand,
            model,
            storage,
            ram,
            processor,
            screen_size: screenSize,
            color,
            purchase_year: purchaseYear,
            accessories,
            warranty_status: warrantyStatus,
            category_slug: categorySlug,
          }}
          onSave={(next) => {
            setOverrides(next);
            setEditSheet(false);
          }}
          onClose={() => setEditSheet(false)}
        />
      )}
      {priceSheet && (
        <PriceSheet
          suggested={draft.suggested_price ?? effectivePrice}
          comparables={draft.comparables}
          initial={customPrice ?? effectivePrice}
          onSave={(p) => {
            setCustomPrice(p);
            setPriceSheet(false);
          }}
          onUseSuggested={() => {
            setCustomPrice(null);
            setPriceSheet(false);
          }}
          onClose={() => setPriceSheet(false)}
        />
      )}
      {compsSheet && (
        <ComparablesSheet
          comparables={draft.comparables}
          onSetMyPrice={() => {
            setCompsSheet(false);
            if (compsToPriceTimer.current) clearTimeout(compsToPriceTimer.current);
            compsToPriceTimer.current = setTimeout(() => setPriceSheet(true), 200);
          }}
          onClose={() => setCompsSheet(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ── Internal sub-components (small, kept inline for simplicity) ─────────────

function TrustRow({ text }: { text: string }) {
  return (
    <View style={st.trustRow}>
      <Text style={st.trustCheck}>✓</Text>
      <Text style={st.trustText}>{text}</Text>
    </View>
  );
}

function SuccessStep({ num, text }: { num: number; text: string }) {
  return (
    <View style={st.successStepRow}>
      <View style={st.successStepNum}>
        <Text style={st.successStepNumText}>{num}</Text>
      </View>
      <Text style={st.successStepText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerSpacer: { width: 36 },
  headerTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },
  flex: { flex: 1 },
  scrollPad: { paddingBottom: 96 },

  // Compact item card — image + meta + edit pencil
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.lg,
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  itemImage: {
    width: 64,
    height: 64,
    borderRadius: R.md,
    backgroundColor: C.bone2,
  },
  itemMeta: { flex: 1, marginLeft: S.md },
  itemTitle: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text },
  itemSubtitle: { marginTop: 2, fontSize: T.size.sm, color: C.text3 },
  itemPrice: {
    marginTop: 4,
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: C.petrol,
  },
  itemEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.bone2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemEditGlyph: { fontSize: T.size.md, color: C.petrol, fontWeight: T.weight.semi },

  // Section (Set your price / Condition)
  section: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  sectionH1: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: T.size.sm,
    color: C.text3,
    marginBottom: S.md,
  },

  // Price option button (outlined)
  priceBtn: {
    position: 'relative',
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
    marginBottom: S.sm,
  },
  priceBtnTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.semi,
    color: C.text,
  },
  priceBtnHint: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.text3,
  },
  priceBtnArrow: {
    position: 'absolute',
    right: S.md,
    top: '50%',
    marginTop: -10,
    fontSize: T.size.xl,
    color: C.text3,
    fontWeight: T.weight.semi,
  },

  // Condition pills
  condRow: {
    flexDirection: 'row',
    gap: S.sm,
  },
  condPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: S.md - 2,
    paddingHorizontal: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  condPillActive: {
    borderColor: C.petrol,
    backgroundColor: C.petrolLight,
    borderWidth: 1.5,
  },
  condPillTick: {
    color: C.petrol,
    fontSize: T.size.sm,
    fontWeight: T.weight.heavy,
    marginRight: 4,
  },
  condPillLabel: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
  },
  condPillLabelActive: { color: C.petrolText },

  // Trust — floating card, mint background, refund-guarantee aligned
  trustBlock: {
    backgroundColor: C.petrolLight,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
  },
  trustHeading: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.petrolText,
    marginBottom: S.md,
  },
  trustRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  trustCheck: {
    fontSize: T.size.md,
    color: C.petrol,
    fontWeight: T.weight.heavy,
    marginRight: S.md,
    marginTop: 2,
  },
  trustText: { fontSize: T.size.base, color: C.petrolText, fontWeight: T.weight.medium, flex: 1, lineHeight: T.size.base + 4 },

  // TDS info card — soft amber "heads-up" so it reads informational, not warning
  tdsCard: {
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    backgroundColor: C.bone2,
    borderRadius: R.lg,
    borderLeftWidth: 4,
    borderLeftColor: C.petrol,
  },
  tdsHeading: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: 4,
  },
  tdsBody: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    lineHeight: T.size.sm + 8,
  },
  tdsBold: {
    fontWeight: T.weight.bold,
    color: C.text,
  },

  legal: {
    marginTop: S.lg,
    paddingHorizontal: S.lg,
    fontSize: T.size.sm,
    color: C.text3,
    textAlign: 'center',
  },
  legalLink: { color: C.petrol, textDecorationLine: 'underline' },

  // CTA
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.lg,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  primaryBtn: { ...Shadow.glow },
  secondaryBtn: { marginTop: S.md },

  // Success state — green checkmark circle, item card, "what happens next" steps
  successScroll: {
    paddingHorizontal: S.xl,
    paddingTop: S.xxl,
    paddingBottom: 200,
    alignItems: 'stretch',
  },
  successCheckCircle: {
    alignSelf: 'center',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.petrolLight,
    borderWidth: 2,
    borderColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: S.lg,
    marginBottom: S.xl,
  },
  successCheck: {
    fontSize: T.size.display + 8,
    color: C.petrol,
    fontWeight: T.weight.heavy,
    lineHeight: T.size.display + 12,
  },
  successTitle: {
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.sm,
  },
  successHelper: {
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    marginBottom: S.xl,
  },
  successCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.lg,
    paddingVertical: S.lg,
    marginBottom: S.xl,
    ...Shadow.card,
  },
  successCardTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.semi,
    color: C.text,
    marginBottom: 4,
  },
  successCardPrice: {
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.petrol,
  },
  successSection: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.md,
  },
  successStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: S.md,
  },
  successStepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: S.md,
    marginTop: 2,
  },
  successStepNumText: {
    color: C.surface,
    fontWeight: T.weight.bold,
    fontSize: T.size.sm,
  },
  successStepText: {
    flex: 1,
    fontSize: T.size.md,
    color: C.text,
    lineHeight: T.size.md + 6,
  },
  successCtaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.lg,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
});
