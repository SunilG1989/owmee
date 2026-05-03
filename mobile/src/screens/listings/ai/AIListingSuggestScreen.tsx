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

import { C, T, S, R, Shadow, Home, formatPrice, condStyle } from '../../../utils/tokens';
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
    color?: string;
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
  const color = overrides.color ?? draft.detected.color ?? '';
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
    if (draft.detected.title_suggestion) return draft.detected.title_suggestion;
    const parts = [brand, model, storage, color].filter(Boolean);
    return parts.join(' ').slice(0, 80) || 'Used item';
  }, [draft, brand, model, storage, color]);

  const subtitleSpecifics = useMemo(() => {
    const parts = [storage, color].filter(Boolean);
    return parts.length ? parts.join(' · ') : '';
  }, [storage, color]);

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
          brand,
          model,
          storage,
          color,
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
        brand,
        model,
        storage,
        color,
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
  }, [draft, effectivePrice, condition, brand, model, storage, color, categorySlug, titleGuess, navigation, submitting]);

  // ── Success state (in-place, replaces form) ─────────────────────────────
  if (success) {
    return (
      <SafeAreaView style={st.root}>
        <ScrollView contentContainerStyle={st.successScroll}>
          <View style={st.successCheckCircle}>
            <Text style={st.successCheck}>✓</Text>
          </View>
          <Text style={st.successTitle}>Your listing is live!</Text>
          <Text style={st.successHelper}>
            We'll notify you the moment a verified buyer commits.
          </Text>

          <View style={st.successCard}>
            <Text style={st.successCardTitle} numberOfLines={2}>{success.title}</Text>
            <Text style={st.successCardPrice}>{formatPrice(success.price)}</Text>
          </View>

          <Text style={st.successSection}>What happens next</Text>
          <SuccessStep num={1} text="A verified buyer commits — usually within 72 hours" />
          <SuccessStep num={2} text="We pick up the item from your address" />
          <SuccessStep num={3} text="We inspect and ship to the buyer" />
          <SuccessStep num={4} text="Money lands in your bank 2 days after pickup" />
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
        {/* Photo */}
        <View style={st.photoBlock}>
          <Image source={{ uri: draft.photo_url }} style={st.photo} resizeMode="cover" />
          <Text style={st.photoHint}>Tap photo to edit</Text>
        </View>

        {/* Specifics + edit affordance */}
        <View style={st.specsBlock}>
          <Text style={st.specsTitle}>{titleGuess}</Text>
          {subtitleSpecifics ? <Text style={st.specsSub}>{subtitleSpecifics}</Text> : null}
          <TouchableOpacity onPress={() => setEditSheet(true)} style={st.editLink}>
            <Text style={st.editLinkText}>✎ Edit details</Text>
          </TouchableOpacity>
        </View>

        {/* BIG price */}
        <View style={st.priceBlock}>
          <Text style={st.priceBig}>{formatPrice(effectivePrice)}</Text>

          {draft.price_source === 'comparables' && draft.comparables.length > 0 ? (
            <Text style={st.priceProof}>
              Based on {draft.comparables.length} similar sold recently
            </Text>
          ) : draft.price_source === 'ai' ? (
            <Text style={st.priceProof}>Based on Indian market estimate</Text>
          ) : (
            <Text style={st.priceProofWeak}>Set your own price</Text>
          )}

          {draft.comparables.length > 0 && (
            <TouchableOpacity onPress={() => setCompsSheet(true)} style={st.linkBtn}>
              <Text style={st.linkBtnText}>See similar sales →</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => setPriceSheet(true)} style={st.linkBtnTertiary}>
            <Text style={st.linkBtnTertiaryText}>✎ Set my own price</Text>
          </TouchableOpacity>
        </View>

        {/* Condition */}
        <View style={st.conditionBlock}>
          <Text style={st.sectionTitle}>Condition</Text>
          {CONDITION_OPTIONS.map((opt) => {
            const active = condition === opt.key;
            const cs = condStyle(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => {
                  setCondition(opt.key);
                  setCustomPrice(null); // clear custom price when condition changes
                }}
                style={[st.condRow, active && st.condRowActive]}>
                <View style={[st.radio, active && st.radioActive]}>
                  {active && <View style={st.radioDot} />}
                </View>
                <Text style={[st.condLabel, { color: active ? cs.color : C.text }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* HOW IT WORKS */}
        <View style={st.howBlock}>
          <Text style={st.howTitle}>HOW IT WORKS</Text>
          <HowItWorksRow num={1} text="Buyer pays Owmee" />
          <HowItWorksRow num={2} text="We pick up from you" />
          <HowItWorksRow num={3} text="We check, then ship to buyer" />
          <HowItWorksRow num={4} text="Money in your bank in 2 days" />
        </View>

        {/* Trust checkmarks — How Owmee protects you */}
        <View style={st.trustBlock}>
          <Text style={st.trustHeading}>How Owmee protects your trust</Text>
          <TrustRow text="No buyer comes to your home" />
          <TrustRow text="We handle pricing, photos, and pickup" />
          <TrustRow text="Only verified buyers — no scam calls" />
          <TrustRow text="100% refund guarantee backs every sale" />
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
          label={`List for ${formatPrice(effectivePrice)} →`}
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
          initial={{ brand, model, storage, color, category_slug: categorySlug }}
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

function HowItWorksRow({ num, text }: { num: number; text: string }) {
  return (
    <View style={st.howRow}>
      <View style={st.howNum}>
        <Text style={st.howNumText}>{num}</Text>
      </View>
      <Text style={st.howRowText}>{text}</Text>
    </View>
  );
}

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

  // Photo
  photoBlock: { padding: S.lg, alignItems: 'center', backgroundColor: C.surface },
  photo: {
    width: 160,
    height: 160,
    borderRadius: R.lg,
    backgroundColor: C.bone2,
  },
  photoHint: { marginTop: S.sm, fontSize: T.size.sm, color: C.text3 },

  // Specs
  specsBlock: {
    backgroundColor: C.surface,
    paddingHorizontal: S.lg,
    paddingBottom: S.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  specsTitle: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.text },
  specsSub: { marginTop: 2, fontSize: T.size.md, color: C.text2 },
  editLink: { marginTop: S.sm, paddingVertical: 4 },
  editLinkText: { color: C.petrol, fontSize: T.size.base, fontWeight: T.weight.semi },

  // Price
  priceBlock: {
    paddingVertical: S.xxl,
    paddingHorizontal: S.lg,
    alignItems: 'center',
    backgroundColor: C.surface,
    marginTop: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  priceBig: {
    fontSize: T.size.display + 18,                                  // 48
    fontWeight: T.weight.bold,
    color: C.text,
    letterSpacing: -1,
  },
  priceProof: {
    marginTop: S.sm,
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
  },
  priceProofWeak: {
    marginTop: S.sm,
    fontSize: T.size.md,
    color: C.text3,
    textAlign: 'center',
  },
  linkBtn: { marginTop: S.md, paddingVertical: 4 },
  linkBtnText: { color: C.petrol, fontSize: T.size.md, fontWeight: T.weight.semi },
  linkBtnTertiary: { marginTop: 4, paddingVertical: 4 },
  linkBtnTertiaryText: { color: C.text3, fontSize: T.size.sm, textDecorationLine: 'underline' },

  // Condition
  conditionBlock: {
    backgroundColor: C.surface,
    paddingHorizontal: S.lg,
    paddingVertical: S.lg,
    marginTop: S.sm,
  },
  sectionTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.semi,
    color: C.text,
    marginBottom: S.sm,
  },
  condRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.md,
    paddingHorizontal: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: S.sm,
    backgroundColor: C.bone,
  },
  condRowActive: { borderColor: C.petrol, backgroundColor: C.petrolLight },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.text4,
    marginRight: S.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: C.petrol },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.petrol },
  condLabel: { fontSize: T.size.md, fontWeight: T.weight.semi },

  // How it works
  howBlock: {
    backgroundColor: C.ink,
    paddingHorizontal: S.xl,
    paddingVertical: S.xl,
    marginTop: S.sm,
  },
  howTitle: {
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: Home.dealsBgStart,
    letterSpacing: 1.5,
    marginBottom: S.md,
  },
  howRow: { flexDirection: 'row', alignItems: 'center', marginBottom: S.md },
  howNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: S.md,
  },
  howNumText: { color: C.surface, fontWeight: T.weight.bold, fontSize: T.size.base },
  howRowText: { color: C.surface, fontSize: T.size.md, fontWeight: T.weight.medium },

  // Trust
  trustBlock: {
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.lg,
    paddingVertical: S.lg,
    marginTop: S.sm,
  },
  trustHeading: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.petrolText,
    marginBottom: S.md,
  },
  trustRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  trustCheck: {
    fontSize: T.size.lg,
    color: C.petrol,
    fontWeight: T.weight.bold,
    marginRight: S.md,
  },
  trustText: { fontSize: T.size.md, color: C.petrolText, fontWeight: T.weight.medium, flex: 1 },

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
