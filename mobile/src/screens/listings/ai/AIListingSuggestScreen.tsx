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
  Alert,
  TextInput,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, T, S, R, Shadow, formatPrice } from '../../../utils/tokens';
import { AIListing } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import type { AIDraftPriceRefreshRequest, AIDraftResponse } from '../../../services/api';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';
import EditDetailsSheet from './shared/EditDetailsSheet';
import PriceSheet from './shared/PriceSheet';
import ComparablesSheet from './shared/ComparablesSheet';
import {
  APPLIANCE_ACCESSORY_OPTIONS,
  APPLIANCE_DEFECT_OPTIONS,
  APPLIANCE_PICKUP_OPTIONS,
  APPLIANCE_WORKING_OPTIONS,
  BOOK_COMPLETENESS_OPTIONS,
  BOOK_LANGUAGE_OPTIONS,
  BOOK_MARKING_OPTIONS,
  BOOK_PAGE_CONDITION_OPTIONS,
  BOOK_SET_STATUS_OPTIONS,
  BOOK_TYPE_OPTIONS,
  CATEGORY_PICKS,
  HYGIENE_OPTIONS,
  KIDS_AGE_OPTIONS,
  TOY_MISSING_PARTS_OPTIONS,
  TOY_POWER_STATUS_OPTIONS,
  TOY_SAFETY_STATUS_OPTIONS,
  canonicalCategorySlug,
  findCatalogOption,
  getBrandsForCategory,
  getCategoryKind,
  getCategoryLabel,
  getListingRequirementFamily,
  getModelSuggestions,
  getRamOptionsForCategory,
  getStorageOptionsForCategory,
  listingNeedsAppliancePickupStatus,
  listingNeedsBookSetStatus,
  listingNeedsPoweredToyStatus,
} from '../../../utils/listingCatalog';
import type { ListingRequirementFamily } from '../../../utils/listingCatalog';

const CONDITION_OPTIONS: { key: 'like_new' | 'good' | 'fair'; label: string; multiplier: number }[] = [
  { key: 'like_new', label: 'Like new', multiplier: 1.0 },
  { key: 'good', label: 'Good', multiplier: 0.85 },
  { key: 'fair', label: 'Fair', multiplier: 0.70 },
];

const MIN_PUBLISH_PHOTOS = 3;

// Categories that need an IMEI/serial sub-step before listing goes live
const IDENTIFIER_CATEGORIES = new Set(['smartphones', 'laptops', 'tablets']);

const PHOTO_BLOCKING_FLAGS = new Set([
  'nsfw',
  'personal_info',
  'multiple_items',
  'no_product',
  'blurry',
  'packaging_only',
  'screenshot_only',
  'stock_or_catalog_suspected',
]);

const SCREEN_CONDITION_OPTIONS = [
  { value: 'flawless', label: 'Flawless' },
  { value: 'minor_scratches', label: 'Minor scratches' },
  { value: 'cracked', label: 'Cracked' },
];

const BODY_CONDITION_OPTIONS = [
  { value: 'flawless', label: 'Flawless' },
  { value: 'minor_dents', label: 'Minor dents' },
  { value: 'major_damage', label: 'Major damage' },
];

const COMMON_DEFECTS = [
  'Screen scratch',
  'Body dent',
  'Crack',
  'Battery issue',
  'Speaker issue',
  'Camera issue',
  'Missing part',
  'Not fully working',
];

const KIDS_SAFETY_ITEMS = [
  { key: 'cleaned', label: 'Cleaned' },
  { key: 'no_small_parts', label: 'No unsafe small parts' },
  { key: 'no_loose_batteries', label: 'No loose batteries' },
  { key: 'no_sharp_edges', label: 'No sharp edges' },
  { key: 'age_label_correct', label: 'Age label checked' },
  { key: 'working_condition', label: 'Works as expected' },
];

const TERMS_URL = 'https://owmee.in/terms';

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
  category_specifics?: Record<string, any>;
};

type KidsSafetyState = Record<string, boolean | null>;

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
  | 'category_specifics'
  | 'screen_condition'
  | 'body_condition'
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

const OTHER_PLACEHOLDERS = new Set([
  '',
  'item',
  'used item',
  'product',
  'other',
  'others',
  'misc',
  'miscellaneous',
  'general',
  'accessory',
  'accessories',
  'electronics',
  'unknown',
  'not sure',
  'other / not sure',
]);

const isMeaningfulOtherDetail = (value?: string | null) => {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return cleaned.length >= 3 && !OTHER_PLACEHOLDERS.has(cleaned);
};

const normalizeConditionChoice = (value?: string | null, options: { value: string }[] = []) => {
  const cleaned = (value || '').trim().toLowerCase();
  return options.some((option) => option.value === cleaned) ? cleaned : '';
};

const normalizeDefects = (items?: string[] | null) => {
  const seen = new Set<string>();
  const out: string[] = [];
  (items || []).forEach((item) => {
    const cleaned = cleanText(item);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out.slice(0, 12);
};

const normalizeMrpSource = (value?: string | null) => {
  const source = (value || '').trim().toLowerCase();
  if (source === 'visible_mrp' || source === 'receipt_or_bill' || source === 'market_anchor' || source === 'seller_entered') return source;
  return null;
};

const buyerFacingMrpSource = (source?: string | null) =>
  source === 'visible_mrp' || source === 'receipt_or_bill' || source === 'seller_entered';

const conditionLabel = (value?: string | null) => {
  const all = [...SCREEN_CONDITION_OPTIONS, ...BODY_CONDITION_OPTIONS];
  return all.find((option) => option.value === value)?.label || '';
};

const specificValue = (specifics: Record<string, any>, key: string) => {
  const raw = specifics[key];
  if (raw === true || raw === false) return raw;
  if (typeof raw === 'number') return raw;
  return cleanText(raw == null ? '' : String(raw)) || '';
};

const hasSpecificValue = (specifics: Record<string, any>, key: string) => {
  const raw = specificValue(specifics, key);
  if (raw === true || raw === false || typeof raw === 'number') return true;
  return Boolean(raw);
};

const categorySpecificsForPayload = (
  family: ListingRequirementFamily,
  specifics: Record<string, any>,
  seed: { model?: string; age?: string; hygiene?: string },
) => {
  const allowed: Record<ListingRequirementFamily, string[]> = {
    device: [],
    other: [],
    toy: [
      'toy_type',
      'missing_parts_status',
      'safety_status',
      'battery_status',
      'working_status',
      'box_or_manual',
      'recall_checked',
      'notes',
    ],
    book: [
      'book_type',
      'language',
      'page_condition',
      'markings_status',
      'pages_complete',
      'set_status',
      'set_count',
      'author_or_publisher',
      'edition',
      'class_or_grade',
      'cover_condition',
      'notes',
    ],
    appliance: [
      'appliance_type',
      'working_status',
      'accessories_status',
      'defects_disclosed',
      'pickup_complexity',
      'installation_status',
      'bill_or_warranty',
      'hygiene_status',
      'capacity_or_size',
      'notes',
    ],
  };
  const payload: Record<string, any> = {};
  allowed[family].forEach((key) => {
    const value = specificValue(specifics, key);
    if (value !== '') payload[key] = value;
  });
  if (family === 'toy') {
    if (!payload.toy_type && seed.model) payload.toy_type = seed.model;
    if (seed.age) payload.age_suitability = seed.age;
    if (seed.hygiene) payload.hygiene_status = seed.hygiene;
  }
  if (family === 'book' && !payload.book_type && seed.model) payload.book_type = seed.model;
  if (family === 'appliance' && !payload.appliance_type && seed.model) payload.appliance_type = seed.model;
  return Object.keys(payload).length ? payload : null;
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
  const [confirmedOriginalPrice, setConfirmedOriginalPrice] = useState<number | null>(null);
  const [mrpSource, setMrpSource] = useState<string | null>(normalizeMrpSource(initialDraft.detected.mrp_source));
  const [mrpReviewed, setMrpReviewed] = useState(false);
  const [screenCondition, setScreenCondition] = useState(
    normalizeConditionChoice(initialDraft.detected.screen_condition, SCREEN_CONDITION_OPTIONS),
  );
  const [bodyCondition, setBodyCondition] = useState(
    normalizeConditionChoice(initialDraft.detected.body_condition, BODY_CONDITION_OPTIONS),
  );
  const [defects, setDefects] = useState<string[]>(normalizeDefects(initialDraft.detected.defects));
  const [newDefect, setNewDefect] = useState('');
  const [kidsSafetyChecklist, setKidsSafetyChecklist] = useState<KidsSafetyState>(() => ({}));
  const [categorySpecifics, setCategorySpecifics] = useState<Record<string, any>>({});
  const [removedPhotoIndices, setRemovedPhotoIndices] = useState<number[]>([]);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(
    typeof initialDraft.detected.hero_image_index === 'number' ? initialDraft.detected.hero_image_index : 0,
  );
  const [overrides, setOverrides] = useState<DetailOverrides>({});
  const [inlineField, setInlineField] = useState<InlineField>(null);
  const [editSheet, setEditSheet] = useState(false);
  const [priceSheet, setPriceSheet] = useState(false);
  const [compsSheet, setCompsSheet] = useState(false);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [priceRefreshError, setPriceRefreshError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ listingId: string; price: number; title: string } | null>(null);

  // Timer for the comparables → price sheet handoff. Tracked via ref so we
  // can cancel on unmount and avoid setState-on-unmounted-component warnings.
  const compsToPriceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPriceRefreshKey = useRef<string>('');
  const previousCategoryFamily = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (compsToPriceTimer.current) clearTimeout(compsToPriceTimer.current);
      if (priceRefreshTimer.current) clearTimeout(priceRefreshTimer.current);
    };
  }, []);

  const applyOverrides = useCallback((patch: Partial<DetailOverrides>) => {
    setOverrides((prev) => ({ ...prev, ...patch }));
  }, []);

  const setCategorySpecific = useCallback((key: string, value: any) => {
    setCategorySpecifics((prev) => ({ ...prev, [key]: value }));
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
  const titleForFamily = overrides.title ?? draft.detected.title_suggestion ?? '';
  const categoryFamily = useMemo(
    () => getListingRequirementFamily(categorySlug, model || draft.detected.detected_item_type, titleForFamily),
    [categorySlug, draft.detected.detected_item_type, model, titleForFamily],
  );
  useEffect(() => {
    if (previousCategoryFamily.current === null) {
      previousCategoryFamily.current = categoryFamily;
      return;
    }
    if (previousCategoryFamily.current !== categoryFamily) {
      previousCategoryFamily.current = categoryFamily;
      setCategorySpecifics({});
    }
  }, [categoryFamily]);
  const categoryFamilyLabel = categoryFamily === 'toy'
    ? 'Toy / kids item'
    : categoryFamily === 'book'
      ? 'Book / study material'
      : categoryFamily === 'appliance'
        ? 'Home appliance'
        : categoryFamily === 'device'
          ? 'Device'
          : 'Other item';
  const poweredToyStatusRequired = categoryFamily === 'toy'
    && listingNeedsPoweredToyStatus(model || draft.detected.detected_item_type, titleForFamily);
  const bookSetStatusRequired = categoryFamily === 'book'
    && listingNeedsBookSetStatus(model || draft.detected.detected_item_type, titleForFamily);
  const appliancePickupRequired = categoryFamily === 'appliance'
    && listingNeedsAppliancePickupStatus(model || draft.detected.detected_item_type, titleForFamily);
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
  const reviewPhotos = useMemo(() => {
    const source = draft.photo_urls && draft.photo_urls.length > 0 ? draft.photo_urls : [draft.photo_url];
    return source.filter((url): url is string => Boolean(url));
  }, [draft.photo_url, draft.photo_urls]);
  const activePhotoIndexes = useMemo(
    () => reviewPhotos.map((_, index) => index).filter((index) => !removedPhotoIndices.includes(index)),
    [removedPhotoIndices, reviewPhotos],
  );
  const hasEnoughPhotos = activePhotoIndexes.length >= MIN_PUBLISH_PHOTOS;
  const selectedPhotoUrl = reviewPhotos[selectedPhotoIndex] && !removedPhotoIndices.includes(selectedPhotoIndex)
    ? reviewPhotos[selectedPhotoIndex]
    : reviewPhotos[activePhotoIndexes[0] ?? 0] || draft.photo_url;
  const aiPhotoFlags = useMemo(() => {
    const raw = [...(draft.detected.flags || []), ...(draft.detected.blocking_reasons || [])]
      .map((flag) => String(flag || '').trim().toLowerCase())
      .filter(Boolean);
    if (imageQuality.has_private_info === true) raw.push('personal_info');
    if (imageQuality.is_stock_or_catalog_image_suspected === true) raw.push('stock_or_catalog_suspected');
    if (imageQuality.overall_photo_quality === 'unusable') raw.push('blurry');
    return Array.from(new Set(raw));
  }, [draft.detected.blocking_reasons, draft.detected.flags, imageQuality]);
  const photoBlockingFlags = useMemo(
    () => aiPhotoFlags.filter((flag) => PHOTO_BLOCKING_FLAGS.has(flag)),
    [aiPhotoFlags],
  );
  const photosBlocked = photoBlockingFlags.length > 0;
  const heroCleanup = (imageQuality.hero_image_cleanup || {}) as Record<string, any>;
  useEffect(() => {
    if (selectedPhotoIndex >= reviewPhotos.length) {
      setSelectedPhotoIndex(0);
      return;
    }
    if (removedPhotoIndices.includes(selectedPhotoIndex)) {
      const next = reviewPhotos.findIndex((_, index) => !removedPhotoIndices.includes(index));
      setSelectedPhotoIndex(next >= 0 ? next : 0);
    }
  }, [removedPhotoIndices, reviewPhotos, selectedPhotoIndex]);
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
  const categorySpecificIssues = useMemo(() => {
    const issues: string[] = [];
    if (categoryFamily === 'toy') {
      if (!findCatalogOption(ageSuitability, KIDS_AGE_OPTIONS)) issues.push('age suitability');
      if (!findCatalogOption(hygieneStatus, HYGIENE_OPTIONS)) issues.push('cleanliness');
      if (!hasSpecificValue(categorySpecifics, 'missing_parts_status')) issues.push('parts completeness');
      if (!hasSpecificValue(categorySpecifics, 'safety_status')) issues.push('safety status');
      if (poweredToyStatusRequired && !(
        hasSpecificValue(categorySpecifics, 'working_status')
        || hasSpecificValue(categorySpecifics, 'battery_status')
      )) {
        issues.push('battery/working status');
      }
    }
    if (categoryFamily === 'book') {
      if (!hasSpecificValue(categorySpecifics, 'book_type') && !model) issues.push('book type');
      if (!hasSpecificValue(categorySpecifics, 'language')) issues.push('language');
      if (!hasSpecificValue(categorySpecifics, 'page_condition')) issues.push('page condition');
      if (!hasSpecificValue(categorySpecifics, 'markings_status')) issues.push('markings');
      if (!hasSpecificValue(categorySpecifics, 'pages_complete')) issues.push('page completeness');
      if (bookSetStatusRequired && !hasSpecificValue(categorySpecifics, 'set_status')) issues.push('set completeness');
    }
    if (categoryFamily === 'appliance') {
      if (!hasSpecificValue(categorySpecifics, 'appliance_type') && !model) issues.push('appliance type');
      if (!hasSpecificValue(categorySpecifics, 'working_status')) issues.push('working status');
      if (!hasSpecificValue(categorySpecifics, 'accessories_status')) issues.push('accessories');
      if (!hasSpecificValue(categorySpecifics, 'defects_disclosed')) issues.push('defects');
      if (appliancePickupRequired && !hasSpecificValue(categorySpecifics, 'pickup_complexity')) issues.push('pickup effort');
    }
    return issues;
  }, [
    ageSuitability,
    appliancePickupRequired,
    bookSetStatusRequired,
    categoryFamily,
    categorySpecifics,
    hygieneStatus,
    model,
    poweredToyStatusRequired,
  ]);
  const detailReviewIssues = useMemo(() => {
    const issues: string[] = [];
    if (!categorySlug) {
      issues.push('category');
      return issues;
    }
    if (isOther) {
      const otherTitle = (overrides.title ?? draft.detected.title_suggestion ?? '').trim();
      if (otherTitle.length < 4 || /^used item$/i.test(otherTitle)) issues.push('title');
      if (!isMeaningfulOtherDetail(model)) issues.push('product type');
      categorySpecificIssues.forEach((issue) => issues.push(issue));
      return issues;
    }
    if (!isElectronic) {
      if ((categoryKind === 'appliance' || categoryKind === 'kids') && modelOptions.length > 0 && !findCatalogOption(model, modelOptions)) {
        issues.push('item type');
      }
      categorySpecificIssues.forEach((issue) => issues.push(issue));
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
    if (sellerFunctionalAttestation === null) issues.push('working condition');
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
    appliancePickupRequired,
    bookSetStatusRequired,
    categoryFamily,
    hygieneStatus,
    categorySpecificIssues,
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
      if (!isMeaningfulOtherDetail(model)) return 'model';
      if (categorySpecificIssues.length > 0) return 'category_specifics';
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
      if (categorySpecificIssues.length > 0) return 'category_specifics';
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
    if (sellerFunctionalAttestation === null) return 'seller_functional_attestation';
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
    categorySpecificIssues,
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
    setCategorySpecifics({});
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

  const suggestedPrice = useMemo(() => {
    const raw = draft.suggested_price;
    const rounded = raw == null ? NaN : Math.round(Number(raw));
    return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
  }, [draft.suggested_price]);

  // The seller owns the asking price. Owmee gives guidance, but changing
  // condition must not silently move the number under their feet.
  const effectivePrice = useMemo<number | null>(() => {
    if (customPrice != null) return customPrice;
    return suggestedPrice;
  }, [customPrice, suggestedPrice]);

  const aiOriginalPrice = useMemo(() => {
    const rawMrp = draft.detected.mrp_inr;
    const roundedMrp = rawMrp == null ? NaN : Math.round(Number(rawMrp));
    if (!Number.isFinite(roundedMrp) || roundedMrp <= 0) return null;
    return roundedMrp;
  }, [draft.detected.mrp_inr]);

  const originalPrice = useMemo(() => {
    if (!mrpReviewed || !buyerFacingMrpSource(mrpSource)) return null;
    if (effectivePrice == null || confirmedOriginalPrice == null || confirmedOriginalPrice <= effectivePrice) return null;
    return confirmedOriginalPrice;
  }, [confirmedOriginalPrice, effectivePrice, mrpReviewed, mrpSource]);

  const payloadOriginalPrice = useMemo(() => {
    if (!mrpReviewed || effectivePrice == null || confirmedOriginalPrice == null || confirmedOriginalPrice <= effectivePrice) {
      return null;
    }
    return confirmedOriginalPrice;
  }, [confirmedOriginalPrice, effectivePrice, mrpReviewed]);

  const needsMrpReview = Boolean(
    aiOriginalPrice
    && effectivePrice
    && aiOriginalPrice > effectivePrice
    && !mrpReviewed,
  );

  const discountPct = useMemo(() => {
    if (!originalPrice || effectivePrice == null) return null;
    const pct = Math.round((1 - effectivePrice / originalPrice) * 100);
    return pct > 0 ? pct : null;
  }, [effectivePrice, originalPrice]);

  const kidsSafetyIncomplete = categoryKind === 'kids' && categoryFamily === 'toy'
    && KIDS_SAFETY_ITEMS.some((item) => kidsSafetyChecklist[item.key] === null || kidsSafetyChecklist[item.key] === undefined);

  const conditionReviewIssues = useMemo(() => {
    const issues: string[] = [];
    if (isElectronic) {
      if (!screenCondition) issues.push('screen condition');
      if (!bodyCondition) issues.push('body condition');
      if (sellerFunctionalAttestation === false && defects.length === 0) {
        issues.push('what is not working');
      }
    }
    if (categoryKind === 'kids' && categoryFamily === 'toy' && kidsSafetyIncomplete) {
      issues.push('kids safety checklist');
    }
    return issues;
  }, [
    bodyCondition,
    categoryFamily,
    categoryKind,
    defects.length,
    isElectronic,
    kidsSafetyIncomplete,
    screenCondition,
    sellerFunctionalAttestation,
  ]);
  const needsConditionReview = conditionReviewIssues.length > 0;

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
    screen_condition: cleanText(screenCondition),
    body_condition: cleanText(bodyCondition),
    defects,
    battery_health: draft.detected.battery_health ?? null,
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
    category_family: categoryFamily,
    category_specifics: categorySpecificsForPayload(categoryFamily, categorySpecifics, {
      model,
      age: cleanText(ageSuitability) || undefined,
      hygiene: cleanText(hygieneStatus) || undefined,
    }),
    kids_safety_checklist: categoryKind === 'kids' && categoryFamily === 'toy'
      ? Object.fromEntries(
        KIDS_SAFETY_ITEMS
          .filter((item) => kidsSafetyChecklist[item.key] !== null && kidsSafetyChecklist[item.key] !== undefined)
          .map((item) => [item.key, Boolean(kidsSafetyChecklist[item.key])]),
      )
      : null,
    original_price: payloadOriginalPrice,
  }), [
    accessories,
    ageSuitability,
    brand,
    bodyCondition,
    categoryKind,
    categoryFamily,
    categorySpecifics,
    color,
    defects,
    draft.detected.battery_health,
    hasBill,
    hasBox,
    hasCharger,
    hasEarphones,
    hygieneStatus,
    model,
    payloadOriginalPrice,
    processor,
    purchaseYear,
    ram,
    screenSize,
    screenCondition,
    sellerFunctionalAttestation,
    storage,
    warrantyStatus,
    waterDamageHistory,
    kidsSafetyChecklist,
  ]);

  const sellerAdjustedPriceInputs = useMemo(() => {
    if (Object.keys(overrides).length > 0) return true;
    if (condition !== ((initialDraft.detected.condition_guess as any) || 'good')) return true;
    if (screenCondition !== normalizeConditionChoice(initialDraft.detected.screen_condition, SCREEN_CONDITION_OPTIONS)) return true;
    if (bodyCondition !== normalizeConditionChoice(initialDraft.detected.body_condition, BODY_CONDITION_OPTIONS)) return true;
    if (JSON.stringify(defects) !== JSON.stringify(normalizeDefects(initialDraft.detected.defects))) return true;
    return false;
  }, [
    bodyCondition,
    condition,
    defects,
    initialDraft.detected.body_condition,
    initialDraft.detected.condition_guess,
    initialDraft.detected.defects,
    initialDraft.detected.screen_condition,
    overrides,
    screenCondition,
  ]);

  const priceRefreshPayload = useMemo<AIDraftPriceRefreshRequest>(() => ({
    category_slug: categorySlug || null,
    brand: cleanText(brand),
    model: cleanText(model),
    storage: cleanText(storage),
    ram: cleanText(ram),
    processor: cleanText(processor),
    screen_size: cleanText(screenSize),
    detected_item_type: cleanText(model || draft.detected.detected_item_type),
    category_family: categoryFamily,
    category_specifics: categorySpecificsForPayload(categoryFamily, categorySpecifics, {
      model,
      age: cleanText(ageSuitability) || undefined,
      hygiene: cleanText(hygieneStatus) || undefined,
    }),
    condition,
    purchase_year: purchaseYear || null,
    screen_condition: cleanText(screenCondition),
    body_condition: cleanText(bodyCondition),
    defects,
    original_price: mrpReviewed ? confirmedOriginalPrice : null,
    mrp_source: mrpReviewed ? mrpSource : null,
    mrp_confidence: mrpReviewed ? draft.detected.mrp_confidence ?? null : null,
  }), [
    bodyCondition,
    brand,
    categoryFamily,
    categorySlug,
    categorySpecifics,
    condition,
    confirmedOriginalPrice,
    defects,
    draft.detected.detected_item_type,
    draft.detected.mrp_confidence,
    model,
    ageSuitability,
    hygieneStatus,
    mrpReviewed,
    mrpSource,
    processor,
    purchaseYear,
    ram,
    screenCondition,
    screenSize,
    storage,
  ]);

  const priceRefreshKey = useMemo(() => JSON.stringify(priceRefreshPayload), [priceRefreshPayload]);

  useEffect(() => {
    if (photosBlocked || heroCleanupNeedsRetake || needsDetailsReview) return;
    if (customPrice != null && !sellerAdjustedPriceInputs) return;
    if (suggestedPrice && aiOriginalPrice && !sellerAdjustedPriceInputs) return;
    if (lastPriceRefreshKey.current === priceRefreshKey) return;

    if (priceRefreshTimer.current) clearTimeout(priceRefreshTimer.current);
    priceRefreshTimer.current = setTimeout(async () => {
      lastPriceRefreshKey.current = priceRefreshKey;
      setPriceRefreshing(true);
      setPriceRefreshError(null);
      try {
        const { data } = await AIListing.refreshDraftPrice(draft.draft_id, priceRefreshPayload);
        setDraft((prev) => ({
          ...prev,
          ...data,
          detected: {
            ...prev.detected,
            ...data.detected,
          },
          photo_url: data.photo_url || prev.photo_url,
          photo_urls: data.photo_urls?.length ? data.photo_urls : prev.photo_urls,
          comparables: data.comparables || prev.comparables,
        }));
        if (!mrpReviewed) {
          const nextSource = normalizeMrpSource(data.detected.mrp_source);
          if (nextSource) setMrpSource(nextSource);
        }
      } catch (error) {
        setPriceRefreshError(parseApiError(error));
      } finally {
        setPriceRefreshing(false);
      }
    }, 650);
  }, [
    aiOriginalPrice,
    customPrice,
    draft.draft_id,
    heroCleanupNeedsRetake,
    mrpReviewed,
    needsDetailsReview,
    photosBlocked,
    priceRefreshKey,
    priceRefreshPayload,
    sellerAdjustedPriceInputs,
    suggestedPrice,
  ]);

  const retakeHeroPhoto = useCallback(() => {
    navigation.replace('AIListingCamera' as never, undefined as never);
  }, [navigation]);

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!hasEnoughPhotos) {
      Alert.alert(
        'Add more photos',
        `Listings need at least ${MIN_PUBLISH_PHOTOS} clear photos. Retake the item so buyers can see front, back, and condition details.`,
        [{ text: 'Retake', onPress: retakeHeroPhoto }],
      );
      return;
    }
    if (photosBlocked) {
      Alert.alert(
        'Retake photos',
        'These photos cannot be published safely. Remove private information, use original product photos, and list one item at a time.',
        [{ text: 'Retake', onPress: retakeHeroPhoto }],
      );
      return;
    }
    const priceToList = effectivePrice;
    if (!priceToList || priceToList <= 0) {
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
    if (needsMrpReview) {
      setPriceSheet(true);
      return;
    }
    if (needsConditionReview) {
      if (!screenCondition && isElectronic) {
        setInlineField('screen_condition');
        return;
      }
      if (!bodyCondition && isElectronic) {
        setInlineField('body_condition');
        return;
      }
      Alert.alert('Confirm condition', `Please complete: ${conditionReviewIssues.join(', ')}.`);
      return;
    }

    // If smartphone or laptop, route to identifier capture before creating
    if (IDENTIFIER_CATEGORIES.has(categorySlug)) {
      navigation.navigate('AIListingIdentifier', {
        draft,
        finalFields: {
          title: titleGuess,
          price: priceToList,
          condition,
          category_slug: categorySlug,
          ...finalDetails,
          mrp_source: mrpSource,
          mrp_confidence: draft.detected.mrp_confidence ?? null,
          seller_mrp_confirmed: mrpReviewed,
          hero_image_index: selectedPhotoIndex,
          removed_photo_indices: removedPhotoIndices,
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
        price: priceToList,
        condition,
        category_slug: categorySlug,
        ...finalDetails,
        mrp_source: mrpSource,
        mrp_confidence: draft.detected.mrp_confidence ?? null,
        seller_mrp_confirmed: mrpReviewed,
        hero_image_index: selectedPhotoIndex,
        removed_photo_indices: removedPhotoIndices,
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
    photosBlocked,
    categorySlug,
    needsDetailsReview,
    needsMrpReview,
    needsConditionReview,
    conditionReviewIssues,
    screenCondition,
    bodyCondition,
    isElectronic,
    titleGuess,
    navigation,
    submitting,
    hasEnoughPhotos,
    finalDetails,
    mrpSource,
    mrpReviewed,
    selectedPhotoIndex,
    removedPhotoIndices,
    openFirstRequiredField,
    heroCleanupNeedsRetake,
    retakeHeroPhoto,
  ]);

  const ctaLabel = !hasEnoughPhotos
    ? 'Add photos'
    : photosBlocked || heroCleanupNeedsRetake
    ? 'Retake photos'
    : needsDetailsReview
      ? 'Complete item details'
      : !effectivePrice
        ? priceRefreshing ? 'Finding price' : 'Set asking price'
        : needsMrpReview
          ? 'Review MRP'
          : needsConditionReview
            ? 'Confirm condition'
            : 'Publish listing';
  const ctaOnPress = !hasEnoughPhotos || photosBlocked || heroCleanupNeedsRetake
    ? retakeHeroPhoto
    : needsDetailsReview
      ? openFirstRequiredField
      : !effectivePrice || needsMrpReview
        ? () => setPriceSheet(true)
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

    if (inlineField === 'screen_condition') {
      return (
        <InlineChoicePanel
          title="Screen condition"
          helper="Use the worst visible screen issue, not the best-looking angle."
          options={SCREEN_CONDITION_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          selected={screenCondition}
          onSelect={(next) => {
            setScreenCondition(next);
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'body_condition') {
      return (
        <InlineChoicePanel
          title="Body condition"
          helper="Confirm dents, cracks, or frame damage before publishing."
          options={BODY_CONDITION_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          selected={bodyCondition}
          onSelect={(next) => {
            setBodyCondition(next);
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'category_specifics') {
      return null;
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
            We'll notify you the moment a buyer commits.
          </Text>

          <View style={st.successCard}>
            <Text style={st.successCardTitle} numberOfLines={2}>{success.title}</Text>
            <Text style={st.successCardPrice}>{formatPrice(success.price)}</Text>
          </View>

          <Text style={st.successSection}>What happens next</Text>
          <SuccessStep num={1} text="A buyer commits — usually within 72 hours" />
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
          <Image source={{ uri: selectedPhotoUrl }} style={st.itemImage} resizeMode="cover" />
          <View style={st.itemMeta}>
            <Text style={st.itemTitle} numberOfLines={2}>{titleGuess}</Text>
            {subtitleSpecifics ? (
              <Text style={st.itemSubtitle} numberOfLines={1}>{subtitleSpecifics}</Text>
            ) : null}
            <Text style={st.itemPrice}>{effectivePrice ? formatPrice(effectivePrice) : 'Set price'}</Text>
          </View>
          <TouchableOpacity onPress={() => setEditSheet(true)} style={st.itemEditBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={st.itemEditGlyph}>✎</Text>
          </TouchableOpacity>
        </View>
        <View style={st.photoReviewCard}>
          <View style={st.photoReviewHeader}>
            <View>
              <Text style={st.photoReviewTitle}>Photos</Text>
              <Text style={st.photoReviewSub}>Choose hero and remove accidental photos.</Text>
            </View>
            <TouchableOpacity onPress={retakeHeroPhoto} activeOpacity={0.82} style={st.photoRetakeBtn}>
              <Text style={st.photoRetakeText}>Retake</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.photoRail}>
            {reviewPhotos.map((url, index) => {
              const removed = removedPhotoIndices.includes(index);
              const active = selectedPhotoIndex === index && !removed;
              return (
                <View key={`${url}-${index}`} style={[st.photoThumbWrap, active && st.photoThumbActive, removed && st.photoThumbRemoved]}>
                  <TouchableOpacity
                    onPress={() => {
                      if (!removed) setSelectedPhotoIndex(index);
                    }}
                    activeOpacity={0.84}
                    accessibilityRole="button">
                    <Image source={{ uri: url }} style={st.photoThumb} resizeMode="cover" />
                    {active ? <Text style={st.photoHeroLabel}>Hero</Text> : null}
                    {removed ? <Text style={st.photoRemovedLabel}>Removed</Text> : null}
                  </TouchableOpacity>
                  {reviewPhotos.length > 1 ? (
                    <TouchableOpacity
                      onPress={() => {
                        if (!removed && activePhotoIndexes.length <= MIN_PUBLISH_PHOTOS) {
                          Alert.alert(
                            'Keep three photos',
                            `Listings need at least ${MIN_PUBLISH_PHOTOS} product photos. Retake if one of these is not usable.`,
                          );
                          return;
                        }
                        setRemovedPhotoIndices((prev) => (
                          prev.includes(index)
                            ? prev.filter((item) => item !== index)
                            : [...prev, index]
                        ));
                      }}
                      style={st.photoRemoveBtn}
                      activeOpacity={0.82}>
                      <Text style={st.photoRemoveText}>{removed ? 'Keep' : 'Remove'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
        {photosBlocked ? (
          <View style={[st.photoNotice, st.photoNoticeCritical]}>
            <Text style={[st.photoNoticeTitle, st.photoNoticeCriticalText]}>Photos blocked</Text>
            <Text style={st.photoNoticeText}>
              Retake before publishing: {photoBlockingFlags.join(', ')}.
            </Text>
          </View>
        ) : null}
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

        <View style={st.checklistCard}>
          <Text style={st.checklistTitle}>Publish checklist</Text>
          <ChecklistRow
            label="Photos"
            ready={!photosBlocked && !heroCleanupNeedsRetake && hasEnoughPhotos}
            hint={
              photosBlocked || heroCleanupNeedsRetake
                ? 'Retake required'
                : hasEnoughPhotos
                  ? `${activePhotoIndexes.length} ready`
                  : `${MIN_PUBLISH_PHOTOS - activePhotoIndexes.length} more needed`
            }
          />
          <ChecklistRow
            label="Item identity"
            ready={!needsDetailsReview}
            hint={needsDetailsReview ? detailReviewIssues.join(', ') : 'Confirmed'}
          />
          <ChecklistRow
            label="Price and MRP"
            ready={Boolean(effectivePrice) && !needsMrpReview}
            hint={!effectivePrice ? 'Set price' : needsMrpReview ? 'Review MRP source' : 'Ready'}
          />
          <ChecklistRow
            label="Condition"
            ready={!needsConditionReview}
            hint={needsConditionReview ? conditionReviewIssues.join(', ') : 'Confirmed'}
          />
        </View>

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
                    missing={sellerFunctionalAttestation === null}
                    onPress={() => setInlineField('seller_functional_attestation')}
                  />
                </>
              ) : null}
            </View>
            {categoryFamily === 'toy' || categoryFamily === 'book' || categoryFamily === 'appliance' ? (
              <CategorySpecificsPanel
                family={categoryFamily}
                model={model}
                categorySpecifics={categorySpecifics}
                categoryFamilyLabel={categoryFamilyLabel}
                poweredToyStatusRequired={poweredToyStatusRequired}
                bookSetStatusRequired={bookSetStatusRequired}
                appliancePickupRequired={appliancePickupRequired}
                highlighted={inlineField === 'category_specifics' || categorySpecificIssues.length > 0}
                onSelect={setCategorySpecific}
              />
            ) : null}
            {detailReviewIssues.length > 0 ? (
              <Text style={st.detailIssue}>
                Required before listing: {detailReviewIssues.join(', ')}.
              </Text>
            ) : null}
            {inlineField === 'screen_condition' || inlineField === 'body_condition' ? null : renderInlinePicker()}
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
                  : draft.price_source === 'mrp_anchor'
                    ? 'Owmee guidance uses MRP and visible condition.'
                    : draft.price_source === 'ai'
                      ? 'Owmee guidance uses Indian market estimates.'
                      : 'Choose the asking price buyers will see.'}
          </Text>

          <TouchableOpacity style={st.priceBtn} onPress={() => setPriceSheet(true)}>
            <View style={st.priceTitleRow}>
              <Text style={st.priceBtnTitle}>{originalPrice ? 'Discounted price' : 'Asking price and MRP'}</Text>
              {priceRefreshing ? <ActivityIndicator size="small" color={C.ctaPrimary} /> : null}
            </View>
            <Text style={st.priceBtnHint}>
              {customPrice != null
                ? `${formatPrice(customPrice)} · you set this price.`
                : effectivePrice
                  ? `${formatPrice(effectivePrice)} · starts from Owmee guidance.`
                  : priceRefreshing
                    ? 'Getting Owmee guidance from confirmed details.'
                    : 'No reliable guidance yet. Enter the amount you want.'}
            </Text>
            <Text style={st.priceBtnArrow}>›</Text>
          </TouchableOpacity>
          {priceRefreshError && !effectivePrice ? (
            <Text style={st.priceRefreshError}>{priceRefreshError}</Text>
          ) : null}
          {originalPrice && discountPct ? (
            <View style={st.mrpDealRow}>
              <Text style={st.mrpText}>MRP {formatPrice(originalPrice)}</Text>
              <Text style={st.discountBadge}>{discountPct}% off</Text>
            </View>
          ) : needsMrpReview && aiOriginalPrice ? (
            <View style={st.mrpReviewRow}>
              <Text style={st.mrpReviewText}>
                AI found MRP {formatPrice(aiOriginalPrice)}. Review source before any discount is shown.
              </Text>
            </View>
          ) : mrpReviewed && confirmedOriginalPrice && !buyerFacingMrpSource(mrpSource) ? (
            <View style={st.mrpReviewRow}>
              <Text style={st.mrpReviewText}>
                MRP saved for context. No buyer discount shown from market estimate.
              </Text>
            </View>
          ) : null}
          <Text style={st.priceNote}>
            Owmee suggests a range; you choose the final asking price.
          </Text>

          {draft.comparables.length > 0 && (
            <TouchableOpacity style={st.priceBtn} onPress={() => setCompsSheet(true)}>
              <Text style={st.priceBtnTitle}>See Owmee price guidance</Text>
              <Text style={st.priceBtnHint}>
                {suggestedPrice ? `${formatPrice(suggestedPrice)} · based on similar sales` : 'Recent sales available for context'}
              </Text>
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
          {isElectronic ? (
            <>
              <View style={st.conditionGrid}>
                <SpecPill
                  label="Screen"
                  value={conditionLabel(screenCondition)}
                  missing={!screenCondition}
                  onPress={() => setInlineField('screen_condition')}
                />
                <SpecPill
                  label="Body"
                  value={conditionLabel(bodyCondition)}
                  missing={!bodyCondition}
                  onPress={() => setInlineField('body_condition')}
                />
                {draft.detected.battery_health != null ? (
                  <SpecPill label="Battery" value={`${draft.detected.battery_health}%`} />
                ) : null}
              </View>
              <Text style={st.issueLabel}>Known issues</Text>
              <View style={st.issueChipRow}>
                {COMMON_DEFECTS.map((issue) => {
                  const active = defects.some((item) => item.toLowerCase() === issue.toLowerCase());
                  return (
                    <TouchableOpacity
                      key={issue}
                      onPress={() => {
                        setDefects((prev) => (
                          active
                            ? prev.filter((item) => item.toLowerCase() !== issue.toLowerCase())
                            : [...prev, issue]
                        ));
                      }}
                      activeOpacity={0.82}
                      style={[st.issueChip, active && st.issueChipActive]}>
                      <Text style={[st.issueChipText, active && st.issueChipTextActive]}>{issue}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={st.customIssueRow}>
                <TextInput
                  value={newDefect}
                  onChangeText={setNewDefect}
                  placeholder="Add another issue"
                  placeholderTextColor={C.text4}
                  style={st.customIssueInput}
                />
                <TouchableOpacity
                  onPress={() => {
                    const cleaned = cleanText(newDefect);
                    if (!cleaned) return;
                    setDefects((prev) => normalizeDefects([...prev, cleaned]));
                    setNewDefect('');
                  }}
                  activeOpacity={0.82}
                  style={st.addIssueBtn}>
                  <Text style={st.addIssueText}>Add</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
          {categoryKind === 'kids' && categoryFamily === 'toy' ? (
            <View style={st.kidsSafetyBox}>
              <Text style={st.issueLabel}>Kids safety declarations</Text>
              {KIDS_SAFETY_ITEMS.map((item) => {
                const value = kidsSafetyChecklist[item.key];
                return (
                  <View key={item.key} style={st.safetyRow}>
                    <Text style={st.safetyLabel}>{item.label}</Text>
                    <View style={st.safetyChoices}>
                      {[true, false].map((choice) => (
                        <TouchableOpacity
                          key={`${item.key}-${choice ? 'yes' : 'no'}`}
                          onPress={() => setKidsSafetyChecklist((prev) => ({ ...prev, [item.key]: choice }))}
                          activeOpacity={0.82}
                          style={[st.safetyChoice, value === choice && st.safetyChoiceActive]}>
                          <Text style={[st.safetyChoiceText, value === choice && st.safetyChoiceTextActive]}>
                            {choice ? 'Yes' : 'No'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
          {needsConditionReview ? (
            <Text style={st.detailIssue}>
              Required before listing: {conditionReviewIssues.join(', ')}.
            </Text>
          ) : null}
          {inlineField === 'screen_condition' || inlineField === 'body_condition' ? renderInlinePicker() : null}
        </View>

        {/* How Owmee protects your trust */}
        <View style={st.trustBlock}>
          <Text style={st.trustHeading}>How Owmee protects your sale</Text>
          <TrustRow text="Seller KYC badge appears only after verification is complete" />
          <TrustRow text="Owmee manages protected payment and delivery support" />
          <TrustRow text="Buyer payment stays inside Owmee checkout" />
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
          <Text style={st.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
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
            const nextCategorySlug = canonicalCategorySlug(next.category_slug);
            setOverrides({
              ...next,
              category_slug: nextCategorySlug,
            });
            if (nextCategorySlug !== categorySlug) setCategorySpecifics({});
            setEditSheet(false);
          }}
          onClose={() => setEditSheet(false)}
        />
      )}
      {priceSheet && (
        <PriceSheet
          suggested={suggestedPrice}
          initialMrp={confirmedOriginalPrice ?? aiOriginalPrice}
          initialMrpSource={mrpSource}
          mrpConfidence={draft.detected.mrp_confidence ?? null}
          mrpReasoning={draft.detected.mrp_reasoning ?? null}
          comparables={draft.comparables}
          initial={customPrice ?? effectivePrice}
          onSave={(p, mrp, source) => {
            setCustomPrice(p);
            setConfirmedOriginalPrice(mrp);
            setMrpSource(source);
            setMrpReviewed(Boolean(mrp && source));
            setPriceSheet(false);
          }}
          onUseSuggested={() => {
            setCustomPrice(null);
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

function ChecklistRow({ label, ready, hint }: { label: string; ready: boolean; hint: string }) {
  return (
    <View style={st.checklistRow}>
      <View style={[st.checklistDot, ready ? st.checklistDotReady : st.checklistDotTodo]}>
        <Text style={[st.checklistDotText, ready ? st.checklistDotTextReady : st.checklistDotTextTodo]}>
          {ready ? '✓' : '!'}
        </Text>
      </View>
      <View style={st.checklistCopy}>
        <Text style={st.checklistLabel}>{label}</Text>
        <Text style={st.checklistHint} numberOfLines={1}>{hint}</Text>
      </View>
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

function RequirementChoiceGroup({
  label,
  value,
  options,
  required,
  onSelect,
}: {
  label: string;
  value?: any;
  options: string[];
  required?: boolean;
  onSelect: (value: string) => void;
}) {
  const selected = value == null ? '' : String(value);
  const missing = required && !selected;
  return (
    <View style={st.requirementGroup}>
      <Text style={[st.requirementLabel, missing && st.requirementMissingText]}>
        {label}{required ? ' *' : ''}
      </Text>
      <View style={st.requirementChoices}>
        {options.map((option) => {
          const active = selected === option;
          return (
            <TouchableOpacity
              key={option}
              onPress={() => onSelect(option)}
              activeOpacity={0.82}
              style={[st.requirementChip, active && st.requirementChipActive, missing && st.requirementChipMissing]}>
              <Text style={[st.requirementChipText, active && st.requirementChipTextActive]} numberOfLines={2}>
                {option}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function CategorySpecificsPanel({
  family,
  model,
  categorySpecifics,
  categoryFamilyLabel,
  poweredToyStatusRequired,
  bookSetStatusRequired,
  appliancePickupRequired,
  highlighted,
  onSelect,
}: {
  family: ListingRequirementFamily;
  model: string;
  categorySpecifics: Record<string, any>;
  categoryFamilyLabel: string;
  poweredToyStatusRequired: boolean;
  bookSetStatusRequired: boolean;
  appliancePickupRequired: boolean;
  highlighted?: boolean;
  onSelect: (key: string, value: any) => void;
}) {
  if (family !== 'toy' && family !== 'book' && family !== 'appliance') return null;
  return (
    <View style={[st.requirementPanel, highlighted && st.requirementPanelWarn]}>
      <View style={st.requirementPanelHeader}>
        <View>
          <Text style={st.requirementTitle}>{categoryFamilyLabel}</Text>
          <Text style={st.requirementHelper}>Buyer-critical details for this item type.</Text>
        </View>
        {model ? <Text style={st.requirementModel} numberOfLines={1}>{model}</Text> : null}
      </View>

      {family === 'toy' ? (
        <>
          <RequirementChoiceGroup
            label="Parts"
            required
            value={categorySpecifics.missing_parts_status}
            options={TOY_MISSING_PARTS_OPTIONS}
            onSelect={(value) => onSelect('missing_parts_status', value)}
          />
          <RequirementChoiceGroup
            label="Safety"
            required
            value={categorySpecifics.safety_status}
            options={TOY_SAFETY_STATUS_OPTIONS}
            onSelect={(value) => onSelect('safety_status', value)}
          />
          <RequirementChoiceGroup
            label="Power / working"
            required={poweredToyStatusRequired}
            value={categorySpecifics.working_status || categorySpecifics.battery_status}
            options={TOY_POWER_STATUS_OPTIONS}
            onSelect={(value) => {
              onSelect('working_status', value);
              onSelect('battery_status', value);
            }}
          />
        </>
      ) : null}

      {family === 'book' ? (
        <>
          <RequirementChoiceGroup
            label="Type"
            required
            value={categorySpecifics.book_type || model}
            options={BOOK_TYPE_OPTIONS}
            onSelect={(value) => onSelect('book_type', value)}
          />
          <RequirementChoiceGroup
            label="Language"
            required
            value={categorySpecifics.language}
            options={BOOK_LANGUAGE_OPTIONS}
            onSelect={(value) => onSelect('language', value)}
          />
          <RequirementChoiceGroup
            label="Pages"
            required
            value={categorySpecifics.page_condition}
            options={BOOK_PAGE_CONDITION_OPTIONS}
            onSelect={(value) => onSelect('page_condition', value)}
          />
          <RequirementChoiceGroup
            label="Markings"
            required
            value={categorySpecifics.markings_status}
            options={BOOK_MARKING_OPTIONS}
            onSelect={(value) => onSelect('markings_status', value)}
          />
          <RequirementChoiceGroup
            label="Completeness"
            required
            value={categorySpecifics.pages_complete}
            options={BOOK_COMPLETENESS_OPTIONS}
            onSelect={(value) => onSelect('pages_complete', value)}
          />
          {bookSetStatusRequired ? (
            <RequirementChoiceGroup
              label="Set"
              required
              value={categorySpecifics.set_status}
              options={BOOK_SET_STATUS_OPTIONS}
              onSelect={(value) => onSelect('set_status', value)}
            />
          ) : null}
        </>
      ) : null}

      {family === 'appliance' ? (
        <>
          <RequirementChoiceGroup
            label="Working"
            required
            value={categorySpecifics.working_status}
            options={APPLIANCE_WORKING_OPTIONS}
            onSelect={(value) => onSelect('working_status', value)}
          />
          <RequirementChoiceGroup
            label="Accessories"
            required
            value={categorySpecifics.accessories_status}
            options={APPLIANCE_ACCESSORY_OPTIONS}
            onSelect={(value) => onSelect('accessories_status', value)}
          />
          <RequirementChoiceGroup
            label="Defects"
            required
            value={categorySpecifics.defects_disclosed}
            options={APPLIANCE_DEFECT_OPTIONS}
            onSelect={(value) => onSelect('defects_disclosed', value)}
          />
          {appliancePickupRequired ? (
            <RequirementChoiceGroup
              label="Pickup"
              required
              value={categorySpecifics.pickup_complexity}
              options={APPLIANCE_PICKUP_OPTIONS}
              onSelect={(value) => onSelect('pickup_complexity', value)}
            />
          ) : null}
        </>
      ) : null}
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
  photoReviewCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.sm,
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  photoReviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
  },
  photoReviewTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  photoReviewSub: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.text3,
  },
  photoRetakeBtn: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    backgroundColor: C.bone,
    borderWidth: 1,
    borderColor: C.border,
  },
  photoRetakeText: {
    color: C.ctaPrimary,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  photoRail: {
    gap: S.sm,
    paddingTop: S.md,
    paddingBottom: 2,
  },
  photoThumbWrap: {
    width: 88,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    backgroundColor: C.bone,
  },
  photoThumbActive: {
    borderColor: C.ctaPrimary,
    borderWidth: 2,
  },
  photoThumbRemoved: {
    opacity: 0.52,
  },
  photoThumb: {
    width: '100%',
    height: 72,
    backgroundColor: C.bone2,
  },
  photoHeroLabel: {
    position: 'absolute',
    left: 5,
    top: 5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: R.xs,
    backgroundColor: C.ctaPrimary,
    color: C.surface,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  photoRemovedLabel: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 26,
    textAlign: 'center',
    color: C.red,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    backgroundColor: 'rgba(255,253,248,0.86)',
  },
  photoRemoveBtn: {
    alignItems: 'center',
    paddingVertical: 5,
    backgroundColor: C.surface,
  },
  photoRemoveText: {
    color: C.text3,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
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
  checklistCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  checklistTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.sm,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingVertical: S.sm,
  },
  checklistDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistDotReady: { backgroundColor: C.ctaPrimary },
  checklistDotTodo: { backgroundColor: C.amberSoft, borderWidth: 1, borderColor: C.amberBorder },
  checklistDotText: { fontSize: T.size.xs, fontWeight: T.weight.bold },
  checklistDotTextReady: { color: C.surface },
  checklistDotTextTodo: { color: C.amberDeep },
  checklistCopy: { flex: 1, minWidth: 0 },
  checklistLabel: {
    color: C.text,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  checklistHint: {
    marginTop: 1,
    color: C.text3,
    fontSize: T.size.xs,
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
  requirementPanel: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  requirementPanelWarn: {
    borderColor: C.amberBorder,
    backgroundColor: C.amberSoft,
  },
  requirementPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
    marginBottom: S.sm,
  },
  requirementTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  requirementHelper: {
    marginTop: 2,
    fontSize: T.size.xs,
    color: C.text3,
  },
  requirementModel: {
    maxWidth: 128,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    color: C.text2,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
  },
  requirementGroup: {
    marginTop: S.sm,
  },
  requirementLabel: {
    color: C.text2,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    textTransform: 'uppercase',
  },
  requirementMissingText: {
    color: C.amberDeep,
  },
  requirementChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
    marginTop: S.xs,
  },
  requirementChip: {
    minHeight: 34,
    maxWidth: '48%',
    paddingHorizontal: S.sm,
    paddingVertical: 7,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border2,
    backgroundColor: C.surface,
    justifyContent: 'center',
  },
  requirementChipMissing: {
    borderColor: C.amberBorder,
  },
  requirementChipActive: {
    backgroundColor: C.ctaPrimary,
    borderColor: C.ctaPrimary,
  },
  requirementChipText: {
    color: C.text2,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    lineHeight: T.size.xs + 4,
  },
  requirementChipTextActive: {
    color: C.surface,
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
  priceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingRight: S.xl,
  },
  priceBtnTitle: {
    flexShrink: 1,
    fontSize: T.size.md,
    fontWeight: T.weight.semi,
    color: C.text,
  },
  priceBtnHint: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.text3,
  },
  priceRefreshError: {
    marginTop: -2,
    marginBottom: S.sm,
    fontSize: T.size.xs,
    color: C.amberDeep,
    lineHeight: T.size.xs + 4,
  },
  mrpDealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginTop: -2,
    marginBottom: S.sm,
  },
  mrpText: {
    fontSize: T.size.sm,
    color: C.text4,
    textDecorationLine: 'line-through',
  },
  mrpReviewRow: {
    marginTop: -2,
    marginBottom: S.sm,
    padding: S.sm,
    borderRadius: R.md,
    backgroundColor: C.amberSoft,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  mrpReviewText: {
    fontSize: T.size.sm,
    lineHeight: T.size.sm + 5,
    color: C.amberDeep,
    fontWeight: T.weight.semi,
  },
  discountBadge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: C.greenLight,
    color: C.green,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
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
  conditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginTop: S.md,
  },
  issueLabel: {
    marginTop: S.md,
    marginBottom: S.sm,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  issueChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
  },
  issueChip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  issueChipActive: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  issueChipText: {
    fontSize: T.size.sm,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  issueChipTextActive: {
    color: C.ctaPrimary,
  },
  customIssueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginTop: S.md,
  },
  customIssueInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    color: C.text,
    backgroundColor: C.bone,
    fontSize: T.size.base,
  },
  addIssueBtn: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.md,
    backgroundColor: C.ctaPrimary,
  },
  addIssueText: {
    color: C.surface,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  kidsSafetyBox: {
    marginTop: S.md,
    paddingTop: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
    paddingVertical: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  safetyLabel: {
    flex: 1,
    color: C.text2,
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
  },
  safetyChoices: {
    flexDirection: 'row',
    gap: S.xs,
  },
  safetyChoice: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingVertical: 6,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  safetyChoiceActive: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  safetyChoiceText: {
    color: C.text3,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  safetyChoiceTextActive: {
    color: C.ctaPrimary,
  },

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
