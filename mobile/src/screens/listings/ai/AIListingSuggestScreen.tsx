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
 *   9-13. HOW IT WORKS: pay → verify → deliver → money
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
import {
  CATEGORY_PICKS,
  HYGIENE_OPTIONS,
  KIDS_AGE_OPTIONS,
  canonicalCategorySlug,
  findCatalogOption,
  getBrandsForCategory,
  getCategoryKind,
  getCategoryLabel,
  getModelSuggestions,
  getRamOptionsForCategory,
  getStorageOptionsForCategory,
} from '../../../utils/listingCatalog';

const CONDITION_OPTIONS: { key: 'like_new' | 'good' | 'fair'; label: string; multiplier: number }[] = [
  { key: 'like_new', label: 'Like new', multiplier: 1.0 },
  { key: 'good', label: 'Good', multiplier: 0.85 },
  { key: 'fair', label: 'Fair', multiplier: 0.70 },
];

// Categories that need an IMEI/serial sub-step before listing goes live
const IDENTIFIER_CATEGORIES = new Set(['smartphones', 'laptops', 'tablets']);

type DetailOverrides = {
  title?: string;
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
  age_suitability?: string;
  hygiene_status?: string;
  has_box?: boolean | null;
  has_bill?: boolean | null;
  has_charger?: boolean | null;
  has_earphones?: boolean | null;
  water_damage_history?: boolean | null;
  seller_functional_attestation?: boolean | null;
  category_slug?: string;
};

type InlineField =
  | 'category'
  | 'title'
  | 'brand'
  | 'model'
  | 'storage'
  | 'ram'
  | 'age_suitability'
  | 'hygiene_status'
  | 'has_box'
  | 'has_bill'
  | 'has_charger'
  | 'has_earphones'
  | 'water_damage_history'
  | 'seller_functional_attestation'
  | null;

type BooleanDetailField =
  | 'has_box'
  | 'has_bill'
  | 'has_charger'
  | 'has_earphones'
  | 'water_damage_history'
  | 'seller_functional_attestation';

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
  const draft = initialDraft;
  const [condition, setCondition] = useState<'like_new' | 'good' | 'fair'>(
    (initialDraft.detected.condition_guess as any) || 'good',
  );
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<DetailOverrides>({});
  const [inlineField, setInlineField] = useState<InlineField>(null);
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

  const applyOverrides = useCallback((patch: Partial<DetailOverrides>) => {
    setOverrides((prev) => ({ ...prev, ...patch }));
  }, []);

  // Effective fields (overrides win over AI)
  const categorySlug = canonicalCategorySlug(overrides.category_slug ?? draft.detected.category_slug ?? '');
  const categoryKind = getCategoryKind(categorySlug);
  const isElectronic = categoryKind === 'phone' || categoryKind === 'laptop' || categoryKind === 'tablet';
  const isOther = categoryKind === 'other';
  const brandOptions = useMemo(() => getBrandsForCategory(categorySlug), [categorySlug]);
  const rawBrand = overrides.brand ?? draft.detected.brand ?? '';
  const brand = findCatalogOption(rawBrand, brandOptions) || rawBrand;
  const modelOptions = useMemo(() => getModelSuggestions(categorySlug, brand), [categorySlug, brand]);
  const rawModel = overrides.model ?? draft.detected.model ?? draft.detected.detected_item_type ?? '';
  const model = findCatalogOption(rawModel, modelOptions) || rawModel;
  const storageOptions = useMemo(() => getStorageOptionsForCategory(categorySlug), [categorySlug]);
  const ramOptions = useMemo(() => getRamOptionsForCategory(categorySlug), [categorySlug]);
  const evidence = draft.detected.field_evidence || {};
  const hasStorageOverride = Object.prototype.hasOwnProperty.call(overrides, 'storage');
  const hasRamOverride = Object.prototype.hasOwnProperty.call(overrides, 'ram');
  const rawStorage = hasStorageOverride
    ? overrides.storage ?? ''
    : evidence.storage && evidence.storage !== 'direct_visible'
      ? ''
      : draft.detected.storage ?? '';
  const rawRam = hasRamOverride
    ? overrides.ram ?? ''
    : evidence.ram && evidence.ram !== 'direct_visible'
      ? ''
      : draft.detected.ram ?? '';
  const storage = findCatalogOption(rawStorage, storageOptions) || rawStorage;
  const ram = findCatalogOption(rawRam, ramOptions) || rawRam;
  const processor = overrides.processor ?? draft.detected.processor ?? '';
  const screenSize = overrides.screen_size ?? draft.detected.screen_size ?? '';
  const color = overrides.color ?? draft.detected.color ?? '';
  const purchaseYear = overrides.purchase_year ?? draft.detected.purchase_year ?? null;
  const accessories = overrides.accessories ?? draft.detected.accessories ?? '';
  const warrantyStatus = overrides.warranty_status ?? draft.detected.warranty_status ?? '';
  const ageSuitability = overrides.age_suitability ?? '';
  const hygieneStatus = overrides.hygiene_status ?? '';
  const imageQuality = draft.detected.image_set_quality || {};
  const heroCleanup = (imageQuality.hero_image_cleanup || {}) as Record<string, any>;
  const heroCleanupStatus = typeof heroCleanup.status === 'string' ? heroCleanup.status : null;
  const heroCleanupNeedsRetake = heroCleanup.requires_retake === true || heroCleanupStatus === 'needs_retake';
  const heroCleanupDeferred = heroCleanupStatus === 'queued_after_listing';
  const heroCleanupUnavailable = Boolean(
    heroCleanupStatus && heroCleanupStatus !== 'ready' && !heroCleanupNeedsRetake && !heroCleanupDeferred,
  );
  const hasBox = Object.prototype.hasOwnProperty.call(overrides, 'has_box')
    ? overrides.has_box ?? null
    : imageQuality.has_box_or_packaging === true
      ? true
      : null;
  const hasBill = Object.prototype.hasOwnProperty.call(overrides, 'has_bill') ? overrides.has_bill ?? null : null;
  const hasCharger = Object.prototype.hasOwnProperty.call(overrides, 'has_charger') ? overrides.has_charger ?? null : null;
  const hasEarphones = Object.prototype.hasOwnProperty.call(overrides, 'has_earphones') ? overrides.has_earphones ?? null : null;
  const waterDamageHistory = Object.prototype.hasOwnProperty.call(overrides, 'water_damage_history')
    ? overrides.water_damage_history ?? null
    : null;
  const sellerFunctionalAttestation = Object.prototype.hasOwnProperty.call(overrides, 'seller_functional_attestation')
    ? overrides.seller_functional_attestation ?? null
    : null;
  const detailReviewIssues = useMemo(() => {
    const issues: string[] = [];
    if (!categorySlug) {
      issues.push('category');
      return issues;
    }
    if (isOther) {
      const otherTitle = (overrides.title ?? draft.detected.title_suggestion ?? '').trim();
      if (otherTitle.length < 4 || /^used item$/i.test(otherTitle)) issues.push('title');
      return issues;
    }
    if (!isElectronic) {
      if ((categoryKind === 'appliance' || categoryKind === 'kids') && modelOptions.length > 0 && !findCatalogOption(model, modelOptions)) {
        issues.push('item type');
      }
      if (categoryKind === 'kids') {
        if (!findCatalogOption(ageSuitability, KIDS_AGE_OPTIONS)) issues.push('age suitability');
        if (!findCatalogOption(hygieneStatus, HYGIENE_OPTIONS)) issues.push('cleanliness');
      }
      return issues;
    }
    if (!findCatalogOption(brand, brandOptions)) issues.push('brand');
    if (modelOptions.length > 0 && !findCatalogOption(model, modelOptions)) issues.push('model');
    if (!findCatalogOption(storage, storageOptions)) issues.push('storage');
    if (categoryKind === 'laptop' && !findCatalogOption(ram, ramOptions)) issues.push('RAM');
    if (hasBox === null) issues.push('box');
    if (hasBill === null) issues.push('bill');
    if (hasCharger === null) issues.push('charger');
    if (categoryKind === 'phone' && hasEarphones === null) issues.push('earphones');
    if (waterDamageHistory === null) issues.push('water damage');
    if (sellerFunctionalAttestation !== true) issues.push('working condition');
    return issues;
  }, [
    brand,
    brandOptions,
    categoryKind,
    categorySlug,
    hasBill,
    hasBox,
    hasCharger,
    hasEarphones,
    isElectronic,
    isOther,
    ageSuitability,
    hygieneStatus,
    model,
    modelOptions,
    draft.detected.title_suggestion,
    overrides.title,
    ram,
    ramOptions,
    sellerFunctionalAttestation,
    storage,
    storageOptions,
    waterDamageHistory,
  ]);
  const needsDetailsReview = !categorySlug || detailReviewIssues.length > 0;

  const firstRequiredField = useMemo<InlineField>(() => {
    if (!categorySlug) return 'category';
    if (isOther) {
      const otherTitle = (overrides.title ?? draft.detected.title_suggestion ?? '').trim();
      if (otherTitle.length < 4 || /^used item$/i.test(otherTitle)) return 'title';
      return null;
    }
    if (!isElectronic) {
      if ((categoryKind === 'appliance' || categoryKind === 'kids') && modelOptions.length > 0 && !findCatalogOption(model, modelOptions)) {
        return 'model';
      }
      if (categoryKind === 'kids') {
        if (!findCatalogOption(ageSuitability, KIDS_AGE_OPTIONS)) return 'age_suitability';
        if (!findCatalogOption(hygieneStatus, HYGIENE_OPTIONS)) return 'hygiene_status';
      }
      return null;
    }
    if (!findCatalogOption(brand, brandOptions)) return 'brand';
    if (modelOptions.length > 0 && !findCatalogOption(model, modelOptions)) return 'model';
    if (!findCatalogOption(storage, storageOptions)) return 'storage';
    if (categoryKind === 'laptop' && !findCatalogOption(ram, ramOptions)) return 'ram';
    if (hasBox === null) return 'has_box';
    if (hasBill === null) return 'has_bill';
    if (hasCharger === null) return 'has_charger';
    if (categoryKind === 'phone' && hasEarphones === null) return 'has_earphones';
    if (waterDamageHistory === null) return 'water_damage_history';
    if (sellerFunctionalAttestation !== true) return 'seller_functional_attestation';
    return null;
  }, [
    brand,
    brandOptions,
    categoryKind,
    categorySlug,
    draft.detected.title_suggestion,
    hasBill,
    hasBox,
    hasCharger,
    hasEarphones,
    isElectronic,
    isOther,
    ageSuitability,
    hygieneStatus,
    model,
    modelOptions,
    overrides.title,
    ram,
    ramOptions,
    sellerFunctionalAttestation,
    storage,
    storageOptions,
    waterDamageHistory,
  ]);

  const openFirstRequiredField = useCallback(() => {
    if (firstRequiredField === 'title') {
      setInlineField(null);
      setEditSheet(true);
      return;
    }
    if (firstRequiredField) {
      setInlineField(firstRequiredField);
      return;
    }
    setEditSheet(true);
  }, [firstRequiredField]);

  const selectCategoryInline = useCallback((nextSlug: string) => {
    const next = canonicalCategorySlug(nextSlug);
    if (!next) return;
    const nextKind = getCategoryKind(next);
    const nextBrandOptions = getBrandsForCategory(next);
    const nextStorageOptions = getStorageOptionsForCategory(next);
    const nextRamOptions = getRamOptionsForCategory(next);
    setOverrides((prev) => {
      const sourceBrand = prev.brand ?? draft.detected.brand ?? '';
      const sourceStorage = prev.storage ?? draft.detected.storage ?? '';
      const sourceRam = prev.ram ?? draft.detected.ram ?? '';
      return {
        ...prev,
        category_slug: next,
        brand: findCatalogOption(sourceBrand, nextBrandOptions) || '',
        model: '',
        storage: findCatalogOption(sourceStorage, nextStorageOptions) || '',
        ram: findCatalogOption(sourceRam, nextRamOptions) || '',
        has_earphones: nextKind === 'phone' ? prev.has_earphones ?? null : null,
      };
    });
    setInlineField(null);
  }, [draft.detected.brand, draft.detected.ram, draft.detected.storage]);

  const selectBrandInline = useCallback((next: string) => {
    setOverrides((prev) => ({ ...prev, brand: next, model: '' }));
    setInlineField(getModelSuggestions(categorySlug, next).length > 0 ? 'model' : null);
  }, [categorySlug]);

  const selectBooleanInline = useCallback((field: BooleanDetailField, next: boolean) => {
    applyOverrides({ [field]: next });
    setInlineField(null);
  }, [applyOverrides]);

  // The seller owns the asking price. Owmee gives guidance, but changing
  // condition must not silently move the number under their feet.
  const effectivePrice = useMemo(() => {
    if (customPrice != null) return customPrice;
    return draft.suggested_price ?? 0;
  }, [customPrice, draft.suggested_price]);

  const titleGuess = useMemo(() => {
    if (overrides.title?.trim()) return overrides.title.trim();
    const identityWasEdited = ['brand', 'model', 'storage', 'ram', 'color', 'category_slug']
      .some((key) => Object.prototype.hasOwnProperty.call(overrides, key));
    if (!identityWasEdited && draft.detected.title_suggestion) return draft.detected.title_suggestion;
    const parts = [brand, model, storage, color].filter(Boolean);
    return parts.join(' ').slice(0, 80) || 'Used item';
  }, [draft, overrides, brand, model, storage, color]);

  const subtitleSpecifics = useMemo(() => {
    const parts = (() => {
      if (categoryKind === 'kids') return [ageSuitability, hygieneStatus, color].filter(Boolean);
      if (categoryKind === 'appliance') return [model, brand, color].filter(Boolean);
      if (categoryKind === 'other') return [model, brand, color].filter(Boolean);
      return [storage, ram, color].filter(Boolean);
    })();
    return parts.length ? parts.join(' · ') : '';
  }, [ageSuitability, brand, categoryKind, color, hygieneStatus, model, storage, ram]);

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
    age_suitability: cleanText(ageSuitability),
    hygiene_status: cleanText(hygieneStatus),
    has_box: hasBox,
    has_bill: hasBill,
    has_charger: hasCharger,
    has_earphones: categoryKind === 'phone' ? hasEarphones : null,
    water_damage_history: waterDamageHistory,
    seller_functional_attestation: sellerFunctionalAttestation,
  }), [
    accessories,
    ageSuitability,
    brand,
    categoryKind,
    color,
    hasBill,
    hasBox,
    hasCharger,
    hasEarphones,
    hygieneStatus,
    model,
    processor,
    purchaseYear,
    ram,
    screenSize,
    sellerFunctionalAttestation,
    storage,
    warrantyStatus,
    waterDamageHistory,
  ]);

  const retakeHeroPhoto = useCallback(() => {
    navigation.replace('AIListingCamera' as never, undefined as never);
  }, [navigation]);

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!effectivePrice || effectivePrice <= 0) {
      Alert.alert('Set a price', 'Please set a price before listing.');
      return;
    }
    if (!categorySlug) {
      setInlineField('category');
      Alert.alert('Pick a category', 'Confirm the product category before listing.');
      return;
    }
    if (needsDetailsReview) {
      openFirstRequiredField();
      return;
    }
    if (heroCleanupNeedsRetake) {
      Alert.alert(
        'Retake hero photo',
        'Owmee could not safely clean this hero photo without a hand/body part or product color change. Retake with only the product visible.',
        [{ text: 'Retake', onPress: retakeHeroPhoto }],
      );
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
  }, [
    draft,
    effectivePrice,
    condition,
    categorySlug,
    needsDetailsReview,
    titleGuess,
    navigation,
    submitting,
    finalDetails,
    openFirstRequiredField,
    heroCleanupNeedsRetake,
    retakeHeroPhoto,
  ]);

  const ctaLabel = heroCleanupNeedsRetake
    ? 'Retake hero photo'
    : needsDetailsReview
      ? 'Complete required details'
      : 'Continue to list';
  const ctaOnPress = heroCleanupNeedsRetake
    ? retakeHeroPhoto
    : needsDetailsReview
      ? openFirstRequiredField
      : submit;

  const renderInlinePicker = () => {
    if (!inlineField) return null;

    if (inlineField === 'category') {
      return (
        <InlineChoicePanel
          title="Choose category"
          helper="Pick the closest category so the right buyer specs appear."
          options={CATEGORY_PICKS.map((pick) => ({ label: pick.label, value: pick.slug }))}
          selected={categorySlug}
          onSelect={selectCategoryInline}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'brand') {
      return (
        <InlineChoicePanel
          title="Choose brand"
          helper="Select the brand buyers will search for."
          options={brandOptions.map((option) => ({ label: option, value: option }))}
          selected={brand}
          onSelect={selectBrandInline}
          onClose={() => setInlineField(null)}
          emptyText="Pick a category first."
        />
      );
    }

    if (inlineField === 'model') {
      return (
        <InlineChoicePanel
          title="Choose model"
          helper="Choose the closest model. Use Other / not sure if the exact one is not listed."
          options={modelOptions.map((option) => ({ label: option, value: option }))}
          selected={model}
          onSelect={(next) => {
            applyOverrides({ model: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
          emptyText={brand ? 'Model catalogue is not loaded for this brand yet.' : 'Choose brand first.'}
        />
      );
    }

    if (inlineField === 'storage') {
      return (
        <InlineChoicePanel
          title="Choose storage"
          helper="Storage should match the device setting or invoice, not only AI guess."
          options={storageOptions.map((option) => ({ label: option, value: option }))}
          selected={storage}
          onSelect={(next) => {
            applyOverrides({ storage: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'ram') {
      return (
        <InlineChoicePanel
          title="Choose RAM"
          helper="For laptops, RAM is a key price and trust detail."
          options={ramOptions.map((option) => ({ label: option, value: option }))}
          selected={ram}
          onSelect={(next) => {
            applyOverrides({ ram: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'age_suitability') {
      return (
        <InlineChoicePanel
          title="Choose age"
          helper="Age suitability is the first thing parents check for kids items."
          options={KIDS_AGE_OPTIONS.map((option) => ({ label: option, value: option }))}
          selected={ageSuitability}
          onSelect={(next) => {
            applyOverrides({ age_suitability: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'hygiene_status') {
      return (
        <InlineChoicePanel
          title="Choose cleanliness"
          helper="Be clear about whether the item is cleaned, sealed, or needs cleaning."
          options={HYGIENE_OPTIONS.map((option) => ({ label: option, value: option }))}
          selected={hygieneStatus}
          onSelect={(next) => {
            applyOverrides({ hygiene_status: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    const booleanConfig: Partial<Record<Exclude<InlineField, null>, { title: string; helper: string; value: boolean | null }>> = {
      has_box: {
        title: 'Original box',
        helper: 'Tell buyers if original packaging is included.',
        value: hasBox,
      },
      has_bill: {
        title: 'Bill / invoice',
        helper: 'Invoice availability improves buyer confidence.',
        value: hasBill,
      },
      has_charger: {
        title: 'Charger included',
        helper: 'Confirm if the original or compatible charger is included.',
        value: hasCharger,
      },
      has_earphones: {
        title: 'Earphones included',
        helper: 'Choose No if the phone did not come with earphones or they are missing.',
        value: hasEarphones,
      },
      water_damage_history: {
        title: 'Water damage history',
        helper: 'Choose Yes only if the item has ever had water damage.',
        value: waterDamageHistory,
      },
      seller_functional_attestation: {
        title: 'Working condition',
        helper: 'Choose Yes only if everything works as expected right now.',
        value: sellerFunctionalAttestation,
      },
    };
    const config = booleanConfig[inlineField];
    if (!config) return null;

    return (
      <InlineChoicePanel
        title={config.title}
        helper={config.helper}
        options={[
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ]}
        selected={config.value === null ? '' : config.value ? 'yes' : 'no'}
        onSelect={(next) => selectBooleanInline(inlineField as BooleanDetailField, next === 'yes')}
        onClose={() => setInlineField(null)}
      />
    );
  };

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
          <SuccessStep num={2} text="Owmee manages protected payment and delivery support" />
          <SuccessStep num={3} text="Keep the item ready and update details if anything changes" />
          <SuccessStep num={4} text="Payout is released after delivery as per Owmee policy" />
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
        {heroCleanupNeedsRetake ? (
          <View style={[st.photoNotice, st.photoNoticeCritical]}>
            <Text style={[st.photoNoticeTitle, st.photoNoticeCriticalText]}>Retake hero photo</Text>
            <Text style={st.photoNoticeText}>
              Owmee could not safely clean this photo. Use a product-only photo so color and condition stay true.
            </Text>
          </View>
        ) : heroCleanupUnavailable ? (
          <View style={[st.photoNotice, st.photoNoticeMuted]}>
            <Text style={st.photoNoticeTitle}>Background cleanup did not finish</Text>
            <Text style={st.photoNoticeText}>
              You can continue, but a photo without hands will look more professional.
            </Text>
          </View>
        ) : null}

        <View style={st.detailCard}>
            <View style={st.detailHeader}>
              <View>
                <Text style={st.detailTitle}>Product details</Text>
                <Text style={st.detailSub}>
                  {needsDetailsReview
                    ? 'Tap highlighted fields to complete them.'
                    : 'Exact specs confirmed.'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={needsDetailsReview ? openFirstRequiredField : () => setEditSheet(true)}
                activeOpacity={0.82}
                style={[st.detailBadge, needsDetailsReview ? st.detailBadgeWarn : st.detailBadgeOk]}
              >
                <Text style={[st.detailBadgeText, needsDetailsReview ? st.detailBadgeWarnText : st.detailBadgeOkText]}>
                  {needsDetailsReview ? 'Review' : 'Ready'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={st.specRow}>
              <SpecPill
                label="Category"
                value={categorySlug ? getCategoryLabel(categorySlug) : ''}
                missing={!categorySlug}
                onPress={() => setInlineField('category')}
              />
              {isOther ? (
                <SpecPill
                  label="Item"
                  value={titleGuess}
                  missing={titleGuess.trim().length < 4}
                  onPress={() => setEditSheet(true)}
                />
              ) : null}
              <SpecPill
                label="Brand"
                value={brand}
                missing={isElectronic && !findCatalogOption(brand, brandOptions)}
                onPress={() => setInlineField('brand')}
              />
              <SpecPill
                label={isElectronic ? 'Model' : 'Item type'}
                value={model}
                missing={
                  modelOptions.length > 0
                  && (isElectronic || categoryKind === 'appliance' || categoryKind === 'kids')
                  && !findCatalogOption(model, modelOptions)
                }
                onPress={() => setInlineField('model')}
              />
              {categoryKind === 'kids' ? (
                <>
                  <SpecPill
                    label="Age"
                    value={ageSuitability}
                    missing={!findCatalogOption(ageSuitability, KIDS_AGE_OPTIONS)}
                    onPress={() => setInlineField('age_suitability')}
                  />
                  <SpecPill
                    label="Cleanliness"
                    value={hygieneStatus}
                    missing={!findCatalogOption(hygieneStatus, HYGIENE_OPTIONS)}
                    onPress={() => setInlineField('hygiene_status')}
                  />
                </>
              ) : null}
              {isElectronic ? (
                <SpecPill
                  label="Storage"
                  value={storage}
                  missing={!findCatalogOption(storage, storageOptions)}
                  onPress={() => setInlineField('storage')}
                />
              ) : null}
              {categoryKind === 'laptop' ? (
                <SpecPill
                  label="RAM"
                  value={ram}
                  missing={!findCatalogOption(ram, ramOptions)}
                  onPress={() => setInlineField('ram')}
                />
              ) : null}
              {!isElectronic && categoryKind !== 'kids' ? (
                <SpecPill
                  label="Colour"
                  value={color}
                  onPress={() => setEditSheet(true)}
                />
              ) : null}
              {isElectronic ? (
                <>
                  <SpecPill label="Box" value={boolLabel(hasBox)} missing={hasBox === null} onPress={() => setInlineField('has_box')} />
                  <SpecPill label="Bill" value={boolLabel(hasBill)} missing={hasBill === null} onPress={() => setInlineField('has_bill')} />
                  <SpecPill label="Charger" value={boolLabel(hasCharger)} missing={hasCharger === null} onPress={() => setInlineField('has_charger')} />
                  {categoryKind === 'phone' ? (
                    <SpecPill label="Earphones" value={boolLabel(hasEarphones)} missing={hasEarphones === null} onPress={() => setInlineField('has_earphones')} />
                  ) : null}
                  <SpecPill
                    label="Water damage"
                    value={boolLabel(waterDamageHistory)}
                    missing={waterDamageHistory === null}
                    onPress={() => setInlineField('water_damage_history')}
                  />
                  <SpecPill
                    label="Works"
                    value={boolLabel(sellerFunctionalAttestation)}
                    missing={sellerFunctionalAttestation !== true}
                    onPress={() => setInlineField('seller_functional_attestation')}
                  />
                </>
              ) : null}
            </View>
            {detailReviewIssues.length > 0 ? (
              <Text style={st.detailIssue}>
                Required before listing: {detailReviewIssues.join(', ')}.
              </Text>
            ) : null}
            {renderInlinePicker()}
            <TouchableOpacity
              style={st.detailAction}
              onPress={needsDetailsReview ? openFirstRequiredField : () => setEditSheet(true)}
              activeOpacity={0.82}
            >
              <Text style={st.detailActionText}>{needsDetailsReview ? 'Complete highlighted fields' : 'More details'}</Text>
            </TouchableOpacity>
        </View>

        {/* Set your price */}
        <View style={st.section}>
          <Text style={st.sectionH1}>Set your price</Text>
          <Text style={st.sectionSub}>
            {draft.price_source === 'comparables' && draft.comparables.length > 0
              ? `Owmee guidance is based on ${draft.comparables.length} similar items sold recently.`
              : draft.price_source === 'vision'
                ? 'Owmee guidance uses your photos and item condition.'
                : draft.price_source === 'category_anchor'
                  ? 'Owmee guidance uses the item type and condition.'
                  : draft.price_source === 'ai'
                    ? 'Owmee guidance uses Indian market estimates.'
                    : 'Choose the asking price buyers will see.'}
          </Text>

          <TouchableOpacity style={st.priceBtn} onPress={() => setPriceSheet(true)}>
            <Text style={st.priceBtnTitle}>Your asking price</Text>
            <Text style={st.priceBtnHint}>
              {customPrice != null ? 'You set this price.' : 'Starts from Owmee guidance. Change anytime.'}
            </Text>
            <Text style={st.priceBtnArrow}>›</Text>
          </TouchableOpacity>
          <Text style={st.priceNote}>
            Owmee suggests a range; you choose the final asking price.
          </Text>

          {draft.comparables.length > 0 && (
            <TouchableOpacity style={st.priceBtn} onPress={() => setCompsSheet(true)}>
              <Text style={st.priceBtnTitle}>See Owmee price guidance</Text>
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
                  onPress={() => setCondition(opt.key)}
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
          <TrustRow text="Owmee manages protected payment and delivery support" />
          <TrustRow text="Verified buyers use safe payment through Owmee" />
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
          label={ctaLabel}
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={submitting}
          onPress={ctaOnPress}
          fullWidth
          style={st.primaryBtn}
        />
      </View>

      {/* Bottom sheets */}
      {editSheet && (
        <EditDetailsSheet
          initial={{
            title: titleGuess,
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
            age_suitability: ageSuitability,
            hygiene_status: hygieneStatus,
            has_box: hasBox,
            has_bill: hasBill,
            has_charger: hasCharger,
            has_earphones: categoryKind === 'phone' ? hasEarphones : null,
            water_damage_history: waterDamageHistory,
            seller_functional_attestation: sellerFunctionalAttestation,
            category_slug: categorySlug,
          }}
          onSave={(next) => {
            setOverrides({
              ...next,
              category_slug: canonicalCategorySlug(next.category_slug),
            });
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

function boolLabel(value: boolean | null | undefined) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

function SpecPill({
  label,
  value,
  missing,
  onPress,
}: {
  label: string;
  value: string;
  missing?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text style={[st.specPillLabel, missing && st.specPillMissingText]}>{label}</Text>
      <Text style={[st.specPillValue, missing && st.specPillMissingText]} numberOfLines={1}>
        {value || 'Select'}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View style={[st.specPill, missing && st.specPillMissing]}>
        {content}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[st.specPill, st.specPillTap, missing && st.specPillMissing]}
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
}

type InlineChoice = {
  label: string;
  value: string;
};

function InlineChoicePanel({
  title,
  helper,
  options,
  selected,
  onSelect,
  onClose,
  emptyText,
}: {
  title: string;
  helper: string;
  options: InlineChoice[];
  selected?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  emptyText?: string;
}) {
  return (
    <View style={st.inlinePanel}>
      <View style={st.inlineHeader}>
        <View style={st.inlineTitleWrap}>
          <Text style={st.inlineTitle}>{title}</Text>
          <Text style={st.inlineHelper}>{helper}</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={st.inlineClose} activeOpacity={0.82}>
          <Text style={st.inlineCloseText}>Close</Text>
        </TouchableOpacity>
      </View>
      {options.length > 0 ? (
        <View style={st.inlineChoiceRow}>
          {options.map((option) => {
            const active = selected === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => onSelect(option.value)}
                activeOpacity={0.82}
                style={[st.inlineChoice, active && st.inlineChoiceActive]}>
                <Text style={[st.inlineChoiceText, active && st.inlineChoiceTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={st.inlineEmpty}>{emptyText || 'No options available yet.'}</Text>
      )}
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
  itemEditGlyph: { fontSize: T.size.md, color: C.ctaPrimary, fontWeight: T.weight.semi },
  photoNotice: {
    marginHorizontal: S.lg,
    marginTop: S.sm,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    borderRadius: R.md,
    borderWidth: 1,
  },
  photoNoticeCritical: {
    backgroundColor: C.redLight,
    borderColor: '#F1C7C1',
  },
  photoNoticeMuted: {
    backgroundColor: C.amberSoft,
    borderColor: C.amberBorder,
  },
  photoNoticeTitle: {
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: C.ctaPrimary,
  },
  photoNoticeCriticalText: {
    color: C.red,
  },
  photoNoticeText: {
    marginTop: 3,
    fontSize: T.size.sm,
    lineHeight: T.size.sm + 5,
    color: C.text2,
  },

  detailCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
  },
  detailTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  detailSub: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.text3,
  },
  detailBadge: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    borderWidth: 1,
  },
  detailBadgeWarn: {
    backgroundColor: C.amberSoft,
    borderColor: C.amberBorder,
  },
  detailBadgeOk: {
    backgroundColor: C.ctaPrimarySoft,
    borderColor: C.ctaPrimaryBorder,
  },
  detailBadgeText: {
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  detailBadgeWarnText: { color: C.amberDeep },
  detailBadgeOkText: { color: C.ctaPrimary },
  specRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginTop: S.md,
  },
  specPill: {
    minWidth: 92,
    maxWidth: '48%',
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border2,
    backgroundColor: C.bone,
  },
  specPillTap: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  specPillMissing: {
    borderColor: C.amberBorder,
    backgroundColor: C.amberSoft,
  },
  specPillLabel: {
    fontSize: T.size.xs,
    color: C.text4,
    fontWeight: T.weight.semi,
    textTransform: 'uppercase',
  },
  specPillValue: {
    marginTop: 2,
    color: C.text,
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
  },
  specPillMissingText: { color: C.amberDeep },
  inlinePanel: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  inlineHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
  },
  inlineTitleWrap: { flex: 1 },
  inlineTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.ctaPrimary,
  },
  inlineHelper: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.text2,
    lineHeight: T.size.sm + 5,
  },
  inlineClose: {
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.blueBorder,
  },
  inlineCloseText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    color: C.ctaPrimary,
  },
  inlineChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginTop: S.md,
  },
  inlineChoice: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.blueBorder,
    backgroundColor: C.surface,
  },
  inlineChoiceActive: {
    backgroundColor: C.ctaPrimary,
    borderColor: C.ctaPrimary,
  },
  inlineChoiceText: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.ctaPrimary,
  },
  inlineChoiceTextActive: {
    color: C.surface,
  },
  inlineEmpty: {
    marginTop: S.md,
    fontSize: T.size.sm,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
  detailIssue: {
    marginTop: S.md,
    fontSize: T.size.sm,
    color: C.amberDeep,
    fontWeight: T.weight.semi,
  },
  detailAction: {
    marginTop: S.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: S.md,
    borderRadius: R.md,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: C.blueBorder,
  },
  detailActionText: {
    color: C.petrolDeep,
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
  },

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
  priceNote: {
    marginTop: -2,
    marginBottom: S.sm,
    fontSize: T.size.xs,
    color: C.text4,
    lineHeight: T.size.xs + 4,
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
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
    borderWidth: 1.5,
  },
  condPillTick: {
    color: C.ctaPrimary,
    fontSize: T.size.sm,
    fontWeight: T.weight.heavy,
    marginRight: 4,
  },
  condPillLabel: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
  },
  condPillLabelActive: { color: C.ctaPrimary },

  // Trust — floating card, mint background, refund-guarantee aligned
  trustBlock: {
    backgroundColor: C.ctaPrimarySoft,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
  },
  trustHeading: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.ctaPrimary,
    marginBottom: S.md,
  },
  trustRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  trustCheck: {
    fontSize: T.size.md,
    color: C.ctaPrimary,
    fontWeight: T.weight.heavy,
    marginRight: S.md,
    marginTop: 2,
  },
  trustText: { fontSize: T.size.base, color: C.ctaPrimary, fontWeight: T.weight.medium, flex: 1, lineHeight: T.size.base + 4 },

  // TDS info card — soft amber "heads-up" so it reads informational, not warning
  tdsCard: {
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    backgroundColor: C.bone2,
    borderRadius: R.lg,
    borderLeftWidth: 4,
    borderLeftColor: C.ctaPrimary,
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
  legalLink: { color: C.ctaPrimary, textDecorationLine: 'underline' },

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
    backgroundColor: C.ctaPrimarySoft,
    borderWidth: 2,
    borderColor: C.ctaPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: S.lg,
    marginBottom: S.xl,
  },
  successCheck: {
    fontSize: T.size.display + 8,
    color: C.ctaPrimary,
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
    color: C.ctaPrimary,
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
    backgroundColor: C.ctaPrimary,
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
