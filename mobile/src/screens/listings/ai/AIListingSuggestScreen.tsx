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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, T, S, R, Shadow, formatPrice, O } from '../../../utils/tokens';
import { AIListing } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import type { AIDraftPriceRefreshRequest, AIDraftResponse } from '../../../services/api';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';
import PriceSheet from './shared/PriceSheet';
import ComparablesSheet from './shared/ComparablesSheet';
import {
  APPLIANCE_ACCESSORY_OPTIONS,
  APPLIANCE_INSTALLATION_OPTIONS,
  APPLIANCE_PICKUP_OPTIONS,
  BOOK_LANGUAGE_OPTIONS,
  BOOK_SET_STATUS_OPTIONS,
  CATEGORY_PICKS,
  COLOR_OPTIONS,
  HYGIENE_OPTIONS,
  KIDS_AGE_OPTIONS,
  PROCESSOR_OPTIONS,
  SCREEN_SIZE_OPTIONS,
  TOY_POWER_STATUS_OPTIONS,
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
  listingNeedsEducationalBookDetails,
  listingNeedsPoweredToyStatus,
} from '../../../utils/listingCatalog';
import type { ListingRequirementFamily } from '../../../utils/listingCatalog';
import {
  APPLIANCE_STATUS_OPTIONS,
  BOOK_CONDITION_OPTIONS,
  TOY_DISCLOSURE_OPTIONS,
  appendDisclosureToDescription,
  applianceStatusSpecifics,
  applianceStatusValue,
  bookConditionSpecifics,
  bookConditionValue,
  buildSmartReviewChecks,
  disclosureDetailPrompt,
  disclosureNeedsDetail,
  toyDisclosureSpecifics,
  toyDisclosureValue,
} from '../../../utils/listingUx';
import type { SmartReviewCheck } from '../../../utils/listingUx';

const CONDITION_OPTIONS: { key: 'like_new' | 'good' | 'fair'; label: string; desc: string; multiplier: number }[] = [
  { key: 'like_new', label: 'Like new', desc: 'Barely used, no visible wear', multiplier: 1.0 },
  { key: 'good', label: 'Good', desc: 'Used, works as expected', multiplier: 0.85 },
  { key: 'fair', label: 'Fair', desc: 'Visible wear or needs attention', multiplier: 0.70 },
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
  | 'color'
  | 'storage'
  | 'ram'
  | 'processor'
  | 'screen_size'
  | 'condition'
  | 'additional_details'
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

type ReviewRowStatus = 'Ready' | 'Review' | 'Add';

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
      'material',
      'set_count',
      'part_count',
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
      'class_board_edition',
      'edition',
      'class_or_grade',
      'board',
      'subject',
      'isbn',
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
      'power_requirement',
      'bill_or_warranty',
      'hygiene_status',
      'capacity_or_size',
      'material',
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
  const [kidsSafetyChecklist, setKidsSafetyChecklist] = useState<KidsSafetyState>(() => ({}));
  const [categorySpecifics, setCategorySpecifics] = useState<Record<string, any>>(
    () => initialDraft.detected.category_specifics || {},
  );
  const [issueDisclosure, setIssueDisclosure] = useState('');
  const [sellerAdditionalDetails, setSellerAdditionalDetails] = useState('');
  const [touchedCategorySpecifics, setTouchedCategorySpecifics] = useState<Record<string, true>>({});
  const [confirmedSmartChecks, setConfirmedSmartChecks] = useState<Record<string, string>>({});
  const [removedPhotoIndices, setRemovedPhotoIndices] = useState<number[]>([]);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(
    typeof initialDraft.detected.hero_image_index === 'number' ? initialDraft.detected.hero_image_index : 0,
  );
  const [overrides, setOverrides] = useState<DetailOverrides>({});
  const [inlineField, setInlineField] = useState<InlineField>(null);
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

  const markCategorySpecificTouched = useCallback((keys: string[]) => {
    setTouchedCategorySpecifics((prev) => {
      const next = { ...prev };
      keys.forEach((key) => {
        next[key] = true;
      });
      return next;
    });
  }, []);

  const setCategorySpecific = useCallback((key: string, value: any) => {
    setCategorySpecifics((prev) => ({ ...prev, [key]: value }));
    markCategorySpecificTouched([key]);
  }, [markCategorySpecificTouched]);

  const setToyDisclosure = useCallback((value: string) => {
    const nextSpecifics = toyDisclosureSpecifics(value);
    setCategorySpecifics((prev) => ({
      ...prev,
      ...nextSpecifics,
    }));
    if (!disclosureNeedsDetail('toy', nextSpecifics)) setIssueDisclosure('');
    markCategorySpecificTouched(['missing_parts_status', 'safety_status']);
    const hasSafetyIssue = value === 'Safety issue disclosed';
    setKidsSafetyChecklist({
      cleaned: true,
      no_small_parts: !hasSafetyIssue,
      no_loose_batteries: !hasSafetyIssue,
      no_sharp_edges: !hasSafetyIssue,
      age_label_correct: true,
      working_condition: true,
    });
  }, [markCategorySpecificTouched]);

  const setBookCondition = useCallback((value: string) => {
    const nextSpecifics = bookConditionSpecifics(value, categorySpecifics);
    setCategorySpecifics((prev) => ({
      ...prev,
      ...bookConditionSpecifics(value, prev),
    }));
    if (!disclosureNeedsDetail('book', nextSpecifics)) setIssueDisclosure('');
    markCategorySpecificTouched(['page_condition', 'markings_status', 'pages_complete']);
  }, [categorySpecifics, markCategorySpecificTouched]);

  const setApplianceStatus = useCallback((value: string) => {
    const nextSpecifics = applianceStatusSpecifics(value, categorySpecifics);
    setCategorySpecifics((prev) => ({
      ...prev,
      ...applianceStatusSpecifics(value, prev),
    }));
    if (!disclosureNeedsDetail('appliance', nextSpecifics)) setIssueDisclosure('');
    markCategorySpecificTouched(['working_status', 'defects_disclosed']);
  }, [categorySpecifics, markCategorySpecificTouched]);

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
      setKidsSafetyChecklist({});
      setIssueDisclosure('');
      setTouchedCategorySpecifics({});
      setConfirmedSmartChecks({});
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
  const educationalBookDetailsRequired = categoryFamily === 'book'
    && listingNeedsEducationalBookDetails(model || draft.detected.detected_item_type, titleForFamily);
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
  const ageSuitability = overrides.age_suitability ?? String(specificValue(categorySpecifics, 'age_suitability') || '');
  const hygieneStatus = overrides.hygiene_status ?? String(specificValue(categorySpecifics, 'hygiene_status') || '');
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
      if (!(
        hasSpecificValue(categorySpecifics, 'missing_parts_status')
        && hasSpecificValue(categorySpecifics, 'safety_status')
      )) issues.push('parts & safety');
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
      if (!(
        hasSpecificValue(categorySpecifics, 'page_condition')
        && hasSpecificValue(categorySpecifics, 'markings_status')
        && hasSpecificValue(categorySpecifics, 'pages_complete')
      )) issues.push('page condition');
      if (bookSetStatusRequired && !hasSpecificValue(categorySpecifics, 'set_status')) issues.push('set completeness');
      if (educationalBookDetailsRequired && !(
        hasSpecificValue(categorySpecifics, 'class_board_edition')
        || hasSpecificValue(categorySpecifics, 'class_or_grade')
        || hasSpecificValue(categorySpecifics, 'edition')
      )) issues.push('class / board / edition');
    }
    if (categoryFamily === 'appliance') {
      if (!hasSpecificValue(categorySpecifics, 'appliance_type') && !model) issues.push('appliance type');
      if (!(
        hasSpecificValue(categorySpecifics, 'working_status')
        && hasSpecificValue(categorySpecifics, 'defects_disclosed')
      )) issues.push('working condition');
      if (!hasSpecificValue(categorySpecifics, 'accessories_status')) issues.push('accessories');
      if (appliancePickupRequired && !hasSpecificValue(categorySpecifics, 'pickup_complexity')) issues.push('pickup effort');
      if (appliancePickupRequired && !hasSpecificValue(categorySpecifics, 'installation_status')) issues.push('power / installation');
    }
    if (disclosureNeedsDetail(categoryFamily, categorySpecifics) && !issueDisclosure.trim()) {
      issues.push('issue details');
    }
    return issues;
  }, [
    ageSuitability,
    appliancePickupRequired,
    bookSetStatusRequired,
    educationalBookDetailsRequired,
    categoryFamily,
    categorySpecifics,
    hygieneStatus,
    issueDisclosure,
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
    if (firstRequiredField) {
      setInlineField(firstRequiredField);
      return;
    }
    setInlineField('title');
  }, [firstRequiredField]);

  const selectCategoryInline = useCallback((nextSlug: string) => {
    const next = canonicalCategorySlug(nextSlug);
    if (!next) return;
    if (next === categorySlug) {
      setInlineField(null);
      return;
    }
    const applyCategorySelection = () => {
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
      setKidsSafetyChecklist({});
      setIssueDisclosure('');
      setTouchedCategorySpecifics({});
      setConfirmedSmartChecks({});
      setInlineField(null);
    };
    if (Object.keys(categorySpecifics).length > 0 || issueDisclosure.trim()) {
      Alert.alert(
        'Change category?',
        'Changing category will replace buyer-trust answers for the current item type.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change', style: 'destructive', onPress: applyCategorySelection },
        ],
      );
      return;
    }
    applyCategorySelection();
  }, [
    categorySlug,
    categorySpecifics,
    draft.detected.brand,
    draft.detected.ram,
    draft.detected.storage,
    issueDisclosure,
  ]);

  const selectBrandInline = useCallback((next: string) => {
    setOverrides((prev) => ({ ...prev, brand: next, model: '' }));
    setInlineField(getModelSuggestions(categorySlug, next).length > 0 ? 'model' : null);
  }, [categorySlug]);

  const applyModelOverride = useCallback((next: string) => {
    const cleaned = cleanText(next) || '';
    applyOverrides({ model: cleaned });
    if (categoryFamily === 'toy') {
      setCategorySpecifics((prev) => ({ ...prev, toy_type: cleaned }));
      markCategorySpecificTouched(['toy_type']);
    } else if (categoryFamily === 'book') {
      setCategorySpecifics((prev) => ({ ...prev, book_type: cleaned }));
      markCategorySpecificTouched(['book_type']);
    } else if (categoryFamily === 'appliance') {
      setCategorySpecifics((prev) => ({ ...prev, appliance_type: cleaned }));
      markCategorySpecificTouched(['appliance_type']);
    }
  }, [applyOverrides, categoryFamily, markCategorySpecificTouched]);

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

  const conditionReviewIssues = useMemo(() => {
    const issues: string[] = [];
    if (isElectronic) {
      if (!screenCondition) issues.push('screen condition');
      if (!bodyCondition) issues.push('body condition');
      if (sellerFunctionalAttestation === false && defects.length === 0) {
        issues.push('what is not working');
      }
    }
    return issues;
  }, [
    bodyCondition,
    defects.length,
    isElectronic,
    screenCondition,
    sellerFunctionalAttestation,
  ]);
  const needsConditionReview = conditionReviewIssues.length > 0;

  const titleGuess = useMemo(() => {
    if (overrides.title?.trim()) return overrides.title.trim();
    const identityWasEdited = ['brand', 'model', 'storage', 'ram', 'color', 'category_slug']
      .some((key) => Object.prototype.hasOwnProperty.call(overrides, key));
    if (!identityWasEdited && draft.detected.title_suggestion) return draft.detected.title_suggestion;
    const itemType = cleanText(
      model
        || draft.detected.detected_item_type
        || specificValue(categorySpecifics, 'appliance_type')
        || specificValue(categorySpecifics, 'toy_type')
        || specificValue(categorySpecifics, 'book_type')
        || specificValue(categorySpecifics, 'subject')
        || '',
    );
    const categoryFallback = categorySlug && categorySlug !== 'others' ? getCategoryLabel(categorySlug) : '';
    const parts = [brand, itemType || categoryFallback, storage, color].filter(Boolean);
    return (cleanText(parts.join(' ')) || '').slice(0, 80);
  }, [draft, overrides, brand, model, storage, color, categorySpecifics, categorySlug]);

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

  const listingDescription = useMemo(
    () => {
      const base = appendDisclosureToDescription(draft.detected.description_suggestion ?? '', issueDisclosure);
      const extra = sellerAdditionalDetails.replace(/\s+/g, ' ').trim();
      return extra ? `${base}\n\nSeller note: ${extra}` : base;
    },
    [draft.detected.description_suggestion, issueDisclosure, sellerAdditionalDetails],
  );

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
    if (photosBlocked || heroCleanupNeedsRetake || !categorySlug) return;
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
    categorySlug,
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
          description: listingDescription,
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
        description: listingDescription,
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
    listingDescription,
    mrpSource,
    mrpReviewed,
    selectedPhotoIndex,
    removedPhotoIndices,
    openFirstRequiredField,
    heroCleanupNeedsRetake,
    retakeHeroPhoto,
  ]);

  const conditionText = CONDITION_OPTIONS.find((opt) => opt.key === condition)?.label || '';
  const catalogItemTypeRequired = !isElectronic
    && !isOther
    && (categoryKind === 'appliance' || categoryKind === 'kids')
    && modelOptions.length > 0;
  const reviewItemTypeLabel = useMemo(() => {
    if (catalogItemTypeRequired) return findCatalogOption(model, modelOptions) || '';
    const familyType = categoryFamily === 'toy'
      ? specificValue(categorySpecifics, 'toy_type')
      : categoryFamily === 'book'
        ? specificValue(categorySpecifics, 'book_type')
        : categoryFamily === 'appliance'
          ? specificValue(categorySpecifics, 'appliance_type')
          : '';
    return cleanText(model || familyType || draft.detected.detected_item_type || '');
  }, [
    catalogItemTypeRequired,
    categoryFamily,
    categorySpecifics,
    draft.detected.detected_item_type,
    model,
    modelOptions,
  ]);
  const smartReviewChecks = useMemo(
    () => buildSmartReviewChecks({
      photoCount: activePhotoIndexes.length,
      minPhotos: MIN_PUBLISH_PHOTOS,
      photosBlocked: photosBlocked || heroCleanupNeedsRetake,
      categoryLabel: categorySlug ? getCategoryLabel(categorySlug) : '',
      categorySlug,
      title: titleGuess,
      priceLabel: effectivePrice ? formatPrice(effectivePrice) : '',
      conditionLabel: conditionText,
      localityLabel: 'Seller profile locality',
      deliveryMethodLabel: 'Pickup + Owmee delivery',
      categoryFamily,
      categorySpecifics,
      itemTypeLabel: reviewItemTypeLabel,
      ageSuitability,
      hygieneStatus,
      poweredToyStatusRequired,
      bookSetStatusRequired,
      educationalBookDetailsRequired,
      appliancePickupRequired,
      issueDisclosureRequired: disclosureNeedsDetail(categoryFamily, categorySpecifics),
      issueDisclosure,
      confidenceByField: draft.detected.field_confidence || {},
    }),
    [
      activePhotoIndexes.length,
      ageSuitability,
      appliancePickupRequired,
      bookSetStatusRequired,
      categoryFamily,
      categorySlug,
      categorySpecifics,
      conditionText,
      draft.detected.field_confidence,
      effectivePrice,
      educationalBookDetailsRequired,
      heroCleanupNeedsRetake,
      hygieneStatus,
      issueDisclosure,
      photosBlocked,
      poweredToyStatusRequired,
      reviewItemTypeLabel,
      titleGuess,
    ],
  );
  const smartCheckWasSellerTouched = useCallback((check: SmartReviewCheck) => {
    const hasOverride = (key: keyof DetailOverrides) => Object.prototype.hasOwnProperty.call(overrides, key);
    if (check.id === 'toy_item_type') return hasOverride('model') || touchedCategorySpecifics.toy_type;
    if (check.id === 'age_suitability') return hasOverride('age_suitability') || touchedCategorySpecifics.age_suitability;
    if (check.id === 'toy_cleanliness') return hasOverride('hygiene_status') || touchedCategorySpecifics.hygiene_status;
    if (check.id === 'toy_parts_safety') {
      return Boolean(touchedCategorySpecifics.missing_parts_status || touchedCategorySpecifics.safety_status || issueDisclosure.trim());
    }
    if (check.id === 'toy_power_status') return Boolean(touchedCategorySpecifics.working_status || touchedCategorySpecifics.battery_status);
    if (check.id === 'book_identity') return hasOverride('model') || touchedCategorySpecifics.book_type;
    if (check.id === 'book_language') return Boolean(touchedCategorySpecifics.language);
    if (check.id === 'book_pages') {
      return Boolean(
        touchedCategorySpecifics.page_condition
        || touchedCategorySpecifics.markings_status
        || touchedCategorySpecifics.pages_complete
        || issueDisclosure.trim(),
      );
    }
    if (check.id === 'book_education_details') {
      return Boolean(
        touchedCategorySpecifics.class_board_edition
        || touchedCategorySpecifics.class_or_grade
        || touchedCategorySpecifics.edition,
      );
    }
    if (check.id === 'book_set_status') return Boolean(touchedCategorySpecifics.set_status);
    if (check.id === 'appliance_type') return hasOverride('model') || touchedCategorySpecifics.appliance_type;
    if (check.id === 'appliance_working') {
      return Boolean(touchedCategorySpecifics.working_status || touchedCategorySpecifics.defects_disclosed || issueDisclosure.trim());
    }
    if (check.id === 'appliance_accessories') return Boolean(touchedCategorySpecifics.accessories_status);
    if (check.id === 'appliance_pickup') return Boolean(touchedCategorySpecifics.pickup_complexity);
    if (check.id === 'appliance_installation') return Boolean(touchedCategorySpecifics.installation_status);
    return false;
  }, [issueDisclosure, overrides, touchedCategorySpecifics]);

  const smartCheckNeedsVisibleConfirmation = useCallback((check: SmartReviewCheck) => {
    if (check.status === 'missing') return false;
    if (check.confirmationRequired) return true;
    if (check.status === 'not_sure') return !smartCheckWasSellerTouched(check);
    const sellerConfirmableIds = new Set([
      'age_suitability',
      'toy_cleanliness',
      'toy_item_type',
      'toy_parts_safety',
      'toy_power_status',
      'book_identity',
      'book_language',
      'book_pages',
      'book_education_details',
      'book_set_status',
      'appliance_type',
      'appliance_working',
      'appliance_accessories',
      'appliance_pickup',
      'appliance_installation',
    ]);
    return sellerConfirmableIds.has(check.id) && !smartCheckWasSellerTouched(check);
  }, [smartCheckWasSellerTouched]);

  const remainingRequiredChecks = useMemo(
    () => smartReviewChecks.filter((item) => {
      if (item.requiredLevel !== 'P0' || item.status === 'not_applicable') return false;
      if (item.status === 'missing') return true;
      if (confirmedSmartChecks[item.id] === item.summary) return false;
      return smartCheckNeedsVisibleConfirmation(item);
    }),
    [confirmedSmartChecks, smartCheckNeedsVisibleConfirmation, smartReviewChecks],
  );

  const mrpReviewCheck = useMemo<SmartReviewCheck | null>(() => {
    if (!needsMrpReview) return null;
    return {
      id: 'mrp_review',
      label: 'MRP source',
      summary: aiOriginalPrice ? `${formatPrice(aiOriginalPrice)} found by AI` : 'Review before discount',
      action: 'price',
      requiredLevel: 'P0',
      status: 'missing',
      source: 'seller',
      buyerVisible: false,
    };
  }, [aiOriginalPrice, needsMrpReview]);

  const deviceConditionCheck = useMemo<SmartReviewCheck | null>(() => {
    if (!needsConditionReview) return null;
    const action = isElectronic && !screenCondition
      ? 'screen_condition'
      : isElectronic && !bodyCondition
        ? 'body_condition'
        : 'condition';
    return {
      id: 'device_condition_details',
      label: 'Condition details',
      summary: conditionReviewIssues.join(', '),
      action,
      requiredLevel: 'P0',
      status: 'missing',
      source: 'seller',
      buyerVisible: true,
    };
  }, [bodyCondition, conditionReviewIssues, isElectronic, needsConditionReview, screenCondition]);

  const pendingReviewChecks = useMemo(() => {
    const checks = [...remainingRequiredChecks];
    if (mrpReviewCheck && !checks.some((check) => check.id === mrpReviewCheck.id)) {
      const priceIndex = checks.findIndex((check) => check.action === 'price');
      checks.splice(priceIndex >= 0 ? priceIndex + 1 : 0, 0, mrpReviewCheck);
    }
    if (deviceConditionCheck && !checks.some((check) => check.id === deviceConditionCheck.id)) {
      const photosIndex = checks.findIndex((check) => check.action === 'photos');
      checks.splice(photosIndex >= 0 ? photosIndex + 1 : 0, 0, deviceConditionCheck);
    }
    return checks;
  }, [deviceConditionCheck, mrpReviewCheck, remainingRequiredChecks]);

  const allP0ReviewChecks = useMemo(() => {
    const checks = smartReviewChecks.filter((check) => (
      check.requiredLevel === 'P0' && check.status !== 'not_applicable'
      && check.id !== 'photos'
    ));
    if (mrpReviewCheck && !checks.some((check) => check.id === mrpReviewCheck.id)) {
      const priceIndex = checks.findIndex((check) => check.id === 'price');
      checks.splice(priceIndex >= 0 ? priceIndex + 1 : 0, 0, mrpReviewCheck);
    }
    if (deviceConditionCheck && !checks.some((check) => check.id === deviceConditionCheck.id)) {
      const conditionIndex = checks.findIndex((check) => check.id === 'condition');
      checks.splice(conditionIndex >= 0 ? conditionIndex + 1 : 0, 0, deviceConditionCheck);
    }
    return checks;
  }, [deviceConditionCheck, mrpReviewCheck, smartReviewChecks]);

  const p1ReviewChecks = useMemo(
    () => smartReviewChecks.filter((check) => (
      check.requiredLevel === 'P1' && check.status !== 'not_applicable'
    )),
    [smartReviewChecks],
  );

  const readinessScore = useMemo(() => {
    const totalRequired = smartReviewChecks.filter((check) => (
      check.requiredLevel === 'P0' && check.status !== 'not_applicable'
    )).length + (deviceConditionCheck ? 1 : 0) + (mrpReviewCheck ? 1 : 0);
    if (totalRequired <= 0) return 100;
    const blocked = Math.min(pendingReviewChecks.length, totalRequired);
    return Math.max(0, Math.min(100, Math.round(((totalRequired - blocked) / totalRequired) * 100)));
  }, [deviceConditionCheck, mrpReviewCheck, pendingReviewChecks.length, smartReviewChecks]);

  const openSmartReviewCheck = useCallback((target?: SmartReviewCheck) => {
    const next = target || pendingReviewChecks[0];
    if (!next) {
      submit();
      return;
    }
    const openEditor = () => {
      if (next.action === 'photos') {
        retakeHeroPhoto();
        return;
      }
      if (next.action === 'title') {
        setInlineField('title');
        return;
      }
      if (next.action === 'price') {
        setPriceSheet(true);
        return;
      }
      if (next.action === 'condition') {
        if (isElectronic && !screenCondition) {
          setInlineField('screen_condition');
          return;
        }
        if (isElectronic && !bodyCondition) {
          setInlineField('body_condition');
          return;
        }
        setInlineField('condition');
        return;
      }
      const inlineActions = new Set([
        'category',
        'title',
        'model',
        'brand',
        'age_suitability',
        'hygiene_status',
        'category_specifics',
        'screen_condition',
        'body_condition',
      ]);
      if (inlineActions.has(next.action)) {
        setInlineField(next.action as InlineField);
        return;
      }
      setInlineField('title');
    };
    if (
      next.status !== 'missing'
      && confirmedSmartChecks[next.id] !== next.summary
      && smartCheckNeedsVisibleConfirmation(next)
    ) {
      setConfirmedSmartChecks((prev) => ({ ...prev, [next.id]: next.summary }));
    }
    openEditor();
  }, [
    bodyCondition,
    confirmedSmartChecks,
    isElectronic,
    pendingReviewChecks,
    retakeHeroPhoto,
    screenCondition,
    smartCheckNeedsVisibleConfirmation,
    submit,
  ]);

  const reviewStatusForCheck = useCallback((check: SmartReviewCheck): ReviewRowStatus => {
    if (check.status === 'missing') return 'Add';
    if (
      confirmedSmartChecks[check.id] !== check.summary
      && smartCheckNeedsVisibleConfirmation(check)
    ) {
      return 'Review';
    }
    return 'Ready';
  }, [confirmedSmartChecks, smartCheckNeedsVisibleConfirmation]);

  const reviewPressForCheck = useCallback((check: SmartReviewCheck) => {
    if (check.action === 'location' || check.action === 'delivery') return undefined;
    return () => openSmartReviewCheck(check);
  }, [openSmartReviewCheck]);

  const hasOpenRequiredChecks = pendingReviewChecks.length > 0 || needsDetailsReview || needsMrpReview || needsConditionReview;
  const ctaLabel = hasOpenRequiredChecks
    ? priceRefreshing && !effectivePrice
      ? 'Finding price'
      : photosBlocked || heroCleanupNeedsRetake
        ? 'Retake photos'
        : 'Finish required details'
    : 'Publish listing';
  const ctaOnPress = hasOpenRequiredChecks
    ? () => {
      if (photosBlocked || heroCleanupNeedsRetake || !hasEnoughPhotos) {
        openSmartReviewCheck(pendingReviewChecks.find((item) => item.action === 'photos'));
        return;
      }
      if (!effectivePrice || needsMrpReview) {
        setPriceSheet(true);
        return;
      }
      if (needsConditionReview) {
        submit();
        return;
      }
      if (pendingReviewChecks.length > 0) {
        openSmartReviewCheck();
        return;
      }
      openFirstRequiredField();
    }
    : submit;

  const itemStatusLine = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      photosBlocked || heroCleanupNeedsRetake
        ? 'Retake photos'
        : activePhotoIndexes.length >= MIN_PUBLISH_PHOTOS
          ? `${activePhotoIndexes.length} photos`
          : `${Math.max(MIN_PUBLISH_PHOTOS - activePhotoIndexes.length, 0)} photos needed`,
    );
    const conditionOpen = needsConditionReview
      || categorySpecificIssues.some((issue) => (
        issue.includes('condition')
        || issue.includes('safety')
        || issue.includes('page')
        || issue.includes('working')
      ));
    parts.push(conditionOpen ? 'Condition needed' : 'Condition ready');
    parts.push(pendingReviewChecks.length > 0 ? `${pendingReviewChecks.length} pending` : 'Buyer preview ready');
    return parts.join(' · ');
  }, [
    activePhotoIndexes.length,
    categorySpecificIssues,
    heroCleanupNeedsRetake,
    needsConditionReview,
    pendingReviewChecks.length,
    photosBlocked,
  ]);

  const priceDisplayText = effectivePrice
    ? formatPrice(effectivePrice)
    : priceRefreshing
      ? 'Finding price'
      : 'Set price';

  const priceHelperText = effectivePrice
    ? customPrice != null
      ? 'Seller price'
      : 'Owmee guidance'
    : priceRefreshing
      ? 'Calculating guidance'
      : 'Required';

  const buyerPreviewFacts = useMemo(() => {
    const facts: Array<{ label: string; value: string }> = [];
    const add = (label: string, value?: string | number | boolean | null) => {
      const cleaned = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
      if (cleaned) facts.push({ label, value: cleaned });
    };
    add('Condition', conditionText);
    add('Category', categorySlug ? getCategoryLabel(categorySlug) : '');
    if (categoryFamily === 'toy') {
      add('Age', ageSuitability);
      add('Safety', toyDisclosureValue(categorySpecifics));
      add('Cleanliness', hygieneStatus);
    } else if (categoryFamily === 'book') {
      add('Language', categorySpecifics.language);
      add('Pages', bookConditionValue(categorySpecifics));
      add('Class / board', categorySpecifics.class_board_edition || categorySpecifics.class_or_grade || categorySpecifics.edition);
    } else if (categoryFamily === 'appliance') {
      add('Working', applianceStatusValue(categorySpecifics));
      add('Accessories', categorySpecifics.accessories_status);
      add('Pickup', categorySpecifics.pickup_complexity);
    } else {
      add('Brand', brand);
      add('Model', model);
      add('Colour', color);
    }
    add('Fulfilment', 'Pickup + Owmee delivery');
    return facts.slice(0, 6);
  }, [
    ageSuitability,
    brand,
    categoryFamily,
    categorySlug,
    categorySpecifics,
    color,
    conditionText,
    hygieneStatus,
    model,
  ]);

  const renderInlinePicker = () => {
    if (!inlineField) return null;

    if (inlineField === 'additional_details') {
      return (
        <InlineTextPanel
          title="Additional details"
          helper="Optional note shown in the buyer-facing description. Do not repeat price, title, or required condition answers."
          value={sellerAdditionalDetails}
          placeholder="Example: Gently used at home, includes extra blocks, original manual available."
          allowEmpty
          multiline
          maxLength={500}
          onSave={(next) => {
            setSellerAdditionalDetails(next);
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

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

    if (inlineField === 'title') {
      return (
        <InlineTextPanel
          title="Listing title"
          helper="Use a short buyer-facing title. Include product type, brand, or model only when you are sure."
          value={titleGuess}
          placeholder="e.g. Wooden stacking toy"
          onSave={(next) => {
            applyOverrides({ title: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'brand') {
      if (brandOptions.length === 0) {
        return (
          <InlineTextPanel
            title="Brand / maker"
            helper="Add the brand only if it is visible or you know it."
            value={brand}
            placeholder="Brand, or leave blank"
            onSave={(next) => {
              applyOverrides({ brand: next });
              setInlineField(null);
            }}
            onClose={() => setInlineField(null)}
          />
        );
      }
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
      if (modelOptions.length === 0) {
        return (
          <InlineTextPanel
            title={isOther ? 'Product type' : 'Item type'}
            helper="Be specific enough for buyers to understand the item at a glance."
            value={model}
            placeholder="e.g. mixer grinder, story book, office chair"
            onSave={(next) => {
              applyModelOverride(next);
              setInlineField(null);
            }}
            onClose={() => setInlineField(null)}
          />
        );
      }
      return (
        <InlineChoicePanel
          title="Choose model"
          helper="Choose the closest model. Use Other / not sure if the exact one is not listed."
          options={modelOptions.map((option) => ({ label: option, value: option }))}
          selected={model}
          onSelect={(next) => {
            applyModelOverride(next);
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
          emptyText={brand ? 'Model catalogue is not loaded for this brand yet.' : 'Choose brand first.'}
        />
      );
    }

    if (inlineField === 'color') {
      const colorChoices = color && !findCatalogOption(color, COLOR_OPTIONS)
        ? [color, ...COLOR_OPTIONS]
        : COLOR_OPTIONS;
      return (
        <InlineChoicePanel
          title="Choose colour"
          helper="Pick the colour buyers will notice first. Use the closest match if exact shade is unclear."
          options={colorChoices.map((option) => ({ label: option, value: option }))}
          selected={color}
          onSelect={(next) => {
            applyOverrides({ color: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
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

    if (inlineField === 'processor') {
      const processorChoices = processor && !findCatalogOption(processor, PROCESSOR_OPTIONS)
        ? [processor, ...PROCESSOR_OPTIONS]
        : PROCESSOR_OPTIONS;
      return (
        <InlineChoicePanel
          title="Choose processor"
          helper="Processor helps buyers compare laptops and tablets. Keep it blank if you are not sure."
          options={processorChoices.map((option) => ({ label: option, value: option }))}
          selected={processor}
          onSelect={(next) => {
            applyOverrides({ processor: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'screen_size') {
      const screenSizeChoices = screenSize && !findCatalogOption(screenSize, SCREEN_SIZE_OPTIONS)
        ? [screenSize, ...SCREEN_SIZE_OPTIONS]
        : SCREEN_SIZE_OPTIONS;
      return (
        <InlineChoicePanel
          title="Choose screen size"
          helper="Use the closest display size if the exact value is not visible."
          options={screenSizeChoices.map((option) => ({ label: option, value: option }))}
          selected={screenSize}
          onSelect={(next) => {
            applyOverrides({ screen_size: next });
            setInlineField(null);
          }}
          onClose={() => setInlineField(null)}
        />
      );
    }

    if (inlineField === 'condition') {
      return (
        <InlineChoicePanel
          title="Overall condition"
          helper="Choose the closest buyer-visible condition."
          options={CONDITION_OPTIONS.map((option) => ({ label: option.label, value: option.key }))}
          selected={condition}
          onSelect={(next) => {
            setCondition(next as 'like_new' | 'good' | 'fair');
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
      return (
        <CategorySpecificsEditSheet
          family={categoryFamily}
          model={model}
          categorySpecifics={categorySpecifics}
          categoryFamilyLabel={categoryFamilyLabel}
          poweredToyStatusRequired={poweredToyStatusRequired}
          bookSetStatusRequired={bookSetStatusRequired}
          educationalBookDetailsRequired={educationalBookDetailsRequired}
          appliancePickupRequired={appliancePickupRequired}
          highlighted={categorySpecificIssues.length > 0}
          issueDisclosure={issueDisclosure}
          onClose={() => setInlineField(null)}
          onSave={(nextSpecifics, nextIssueDisclosure) => {
            setCategorySpecifics(nextSpecifics);
            markCategorySpecificTouched(Object.keys(nextSpecifics));
            setIssueDisclosure(nextIssueDisclosure);
            if (categoryFamily === 'toy') {
              const hasSafetyIssue = toyDisclosureValue(nextSpecifics) === 'Safety issue disclosed';
              setKidsSafetyChecklist({
                cleaned: true,
                no_small_parts: !hasSafetyIssue,
                no_loose_batteries: !hasSafetyIssue,
                no_sharp_edges: !hasSafetyIssue,
                age_label_correct: true,
                working_condition: true,
              });
            }
            setInlineField(null);
          }}
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
        <BackButton onPress={() => navigation.goBack()} style={st.headerBackButton} />
        <View style={st.headerTextWrap}>
          <Text style={st.headerTitle}>Review listing</Text>
          <Text style={st.headerHelper}>Complete pending details, then preview as buyer</Text>
        </View>
        <View style={st.headerSpacer} />
      </View>

      <ScrollView style={st.flex} contentContainerStyle={st.scrollPad}>
        {/* Compact listing snapshot — the four facts sellers check first */}
        <View style={st.itemCard}>
          <Image source={{ uri: selectedPhotoUrl }} style={st.itemImage} resizeMode="cover" />
          <View style={st.itemMeta}>
            <Text style={st.itemTitle} numberOfLines={2}>{titleGuess}</Text>
            {subtitleSpecifics ? (
              <Text style={st.itemSubtitle} numberOfLines={1}>{subtitleSpecifics}</Text>
            ) : null}
            <Text style={st.itemStatusLine} numberOfLines={1}>{itemStatusLine}</Text>
            {priceRefreshError && !effectivePrice ? (
              <Text style={st.itemPriceError}>Price guidance unavailable. Set your asking price.</Text>
            ) : null}
          </View>
          <View style={st.itemActionRail}>
            <Text style={st.itemPrice}>{priceDisplayText}</Text>
            <Text style={st.itemPriceHelper}>{priceHelperText}</Text>
            <ReadinessBadge score={readinessScore} />
            <ActionPill label="Edit" onPress={() => setInlineField('title')} />
          </View>
        </View>
        <View style={st.photoReviewCard}>
          <View style={st.photoReviewHeader}>
            <View>
              <Text style={st.photoReviewTitle}>Photos</Text>
              <Text style={st.photoReviewSub}>Choose hero and remove accidental photos.</Text>
            </View>
            <ActionPill label="Retake" onPress={retakeHeroPhoto} />
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

        <View style={st.detailCard}>
          <View style={st.detailHeader}>
            <View>
              <Text style={st.detailTitle}>Required details</Text>
              <Text style={st.detailSub}>
                {pendingReviewChecks.length > 0
                  ? `${pendingReviewChecks.length} required detail${pendingReviewChecks.length === 1 ? '' : 's'} need review.`
                  : 'Required details are ready.'}
              </Text>
            </View>
            {pendingReviewChecks.length > 0 ? (
              <TouchableOpacity onPress={() => openSmartReviewCheck()} activeOpacity={0.82} style={st.queueNextBtn}>
                <Text style={st.queueNextText}>{pendingReviewChecks.length} left</Text>
              </TouchableOpacity>
            ) : (
              <Text style={st.queueDoneText}>Ready</Text>
            )}
          </View>

          <View style={st.summaryRows}>
            {allP0ReviewChecks.map((check) => (
              <ReviewSummaryRow
                key={check.id}
                label={check.label}
                summary={check.summary}
                status={reviewStatusForCheck(check)}
                onPress={reviewPressForCheck(check)}
              />
            ))}
          </View>

          {detailReviewIssues.length > 0 && pendingReviewChecks.length === 0 ? (
            <Text style={st.detailIssue}>
              Required before listing: {detailReviewIssues.join(', ')}.
            </Text>
          ) : null}
        </View>

        <View style={st.detailCard}>
          <View style={st.detailHeader}>
            <View style={st.detailTitleWrap}>
              <Text style={st.detailTitle}>Additional details</Text>
              <Text style={st.detailSub}>Optional note buyers see in the listing description.</Text>
            </View>
            <ActionPill
              label={sellerAdditionalDetails.trim() ? 'Edit' : 'Add'}
              onPress={() => setInlineField('additional_details')}
            />
          </View>
          {sellerAdditionalDetails.trim() ? (
            <Text style={st.additionalNoteText} numberOfLines={4}>{sellerAdditionalDetails.trim()}</Text>
          ) : (
            <TouchableOpacity
              onPress={() => setInlineField('additional_details')}
              activeOpacity={0.82}
              style={st.additionalNoteEmpty}>
              <Text style={st.additionalNoteEmptyText}>
                Add anything useful that is not already covered, such as usage context, included extras, or care notes.
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {draft.comparables.length > 0 ? (
          <View style={st.priceGuidanceCard}>
            <View style={st.detailTitleWrap}>
              <Text style={st.priceBtnTitle}>Price guidance</Text>
              <Text style={st.priceBtnHint}>
                {suggestedPrice ? `${formatPrice(suggestedPrice)} from similar sales` : 'Recent sales available'}
              </Text>
            </View>
            <ActionPill label="View" onPress={() => setCompsSheet(true)} />
          </View>
        ) : null}

        <View style={st.buyerPreviewCard}>
          <View style={st.detailHeader}>
            <View>
              <Text style={st.detailTitle}>Buyer preview</Text>
              <Text style={st.detailSub}>This is the core listing buyers will see before they pay.</Text>
            </View>
            {pendingReviewChecks.length > 0 ? (
              <Text style={st.previewWarnBadge}>Pending</Text>
            ) : (
              <Text style={st.previewReadyBadge}>Ready</Text>
            )}
          </View>
          <View style={st.previewBody}>
            <Image source={{ uri: selectedPhotoUrl }} style={st.previewImage} resizeMode="cover" />
            <View style={st.previewCopy}>
              <Text style={st.previewTitle} numberOfLines={2}>{titleGuess || 'Listing title'}</Text>
              <Text style={st.previewPrice}>{effectivePrice ? formatPrice(effectivePrice) : 'Price not set'}</Text>
              {discountPct ? <Text style={st.previewDiscount}>{discountPct}% off MRP after review</Text> : null}
              {sellerAdditionalDetails.trim() ? (
                <Text style={st.previewNote} numberOfLines={2}>{sellerAdditionalDetails.trim()}</Text>
              ) : null}
            </View>
          </View>
          {buyerPreviewFacts.length > 0 ? (
            <View style={st.previewFacts}>
              {buyerPreviewFacts.map((fact) => (
                <View key={`${fact.label}-${fact.value}`} style={st.previewFactRow}>
                  <Text style={st.previewFactLabel}>{fact.label}</Text>
                  <Text style={st.previewFactValue} numberOfLines={2}>{fact.value}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Seller-facing sale basics. Keep concise; the checkout flow carries detailed policy copy. */}
        <View style={st.trustBlock}>
          <Text style={st.trustHeading}>Listing checklist</Text>
          <TrustRow text="KYC badge shows after verification" />
          <TrustRow text="Payment and delivery stay on Owmee" />
          <TrustRow text="Edit anytime before a buyer commits" />
          <TrustRow text="Clear photos reduce returns" />
        </View>

        {/* TDS pre-disclosure. Single info card, non-blocking. */}
        <View style={st.tdsCard}>
          <Text style={st.tdsHeading}>Tax note</Text>
          <Text style={st.tdsBody}>
            After <Text style={st.tdsBold}>₹5,00,000</Text> sales in a financial year,
            1% TDS applies under Section 194-O. Add PAN to keep it at 1%;
            without PAN it can be 5%.
          </Text>
        </View>

        {/* Tiny legal */}
        <Text style={st.legal}>
          By publishing, you accept{' '}
          <Text style={st.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
            Owmee seller terms
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
      {renderInlinePicker()}
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

function RequiredCheckRow({
  check,
  needsConfirmation,
  onPress,
}: {
  check: SmartReviewCheck;
  needsConfirmation?: boolean;
  onPress: () => void;
}) {
  const warning = check.status === 'missing' || check.status === 'not_sure' || needsConfirmation;
  return (
    <TouchableOpacity style={st.requiredRow} onPress={onPress} activeOpacity={0.82}>
      <View style={[st.requiredDot, warning && st.requiredDotWarn]}>
        <Text style={[st.requiredDotText, warning && st.requiredDotWarnText]}>
          {check.status === 'not_sure' ? '?' : '!'}
        </Text>
      </View>
      <View style={st.requiredCopy}>
        <Text style={st.requiredLabel}>{check.label}</Text>
        <Text style={st.requiredSummary} numberOfLines={1}>{check.summary}</Text>
      </View>
      <Text style={st.requiredAction}>{needsConfirmation ? 'Review' : 'Fix'}</Text>
    </TouchableOpacity>
  );
}

function ReadinessBadge({ score }: { score: number }) {
  return (
    <View style={st.readinessMini}>
      <Text style={st.readinessMiniText}>{score}% ready</Text>
    </View>
  );
}

function ActionPill({
  label,
  onPress,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={[st.actionPill, tone === 'danger' && st.actionPillDanger]}
      accessibilityRole="button">
      <Text style={[st.actionPillText, tone === 'danger' && st.actionPillTextDanger]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ReviewSummaryRow({
  label,
  summary,
  status,
  onPress,
}: {
  label: string;
  summary: string;
  status: ReviewRowStatus;
  onPress?: () => void;
}) {
  const actionLabel = status === 'Ready' ? 'Edit' : status;
  const content = (
    <>
      <View style={st.reviewSummaryCopy}>
        <Text style={st.reviewSummaryLabel}>{label}</Text>
        <Text style={st.reviewSummaryText} numberOfLines={1}>{summary || 'Needs answer'}</Text>
      </View>
      {onPress ? (
        <ActionPill label={actionLabel} onPress={onPress} tone={status === 'Add' ? 'danger' : 'default'} />
      ) : (
        <View style={st.reviewSummaryStatus}>
          <Text style={st.reviewSummaryStatusText}>{status}</Text>
        </View>
      )}
    </>
  );
  if (!onPress) return <View style={[st.reviewSummaryRow, st.reviewSummaryRowStatic]}>{content}</View>;
  return <View style={st.reviewSummaryRow}>{content}</View>;
}

type InlineChoice = {
  label: string;
  value: string;
};

function FieldEditSheet({
  title,
  helper,
  children,
  footer,
  onClose,
}: {
  title: string;
  helper: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={st.fieldBackdrop}>
        <TouchableOpacity style={st.fieldBackdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={st.fieldSheet}>
          <View style={st.fieldHandle} />
          <View style={st.fieldHeader}>
            <View style={st.fieldTitleWrap}>
              <Text style={st.fieldTitle}>{title}</Text>
              <Text style={st.fieldHelper}>{helper}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={st.fieldClose} activeOpacity={0.82}>
              <Text style={st.fieldCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={st.fieldScroll}
            contentContainerStyle={st.fieldContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={st.fieldFooter}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

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
  const [draftValue, setDraftValue] = useState(selected || '');
  const canSave = draftValue.length > 0;
  return (
    <FieldEditSheet
      title={title}
      helper={helper}
      onClose={onClose}
      footer={(
        <View style={st.fieldCtaRow}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={st.fieldCtaBtn} />
          <Button
            label="Save"
            variant="primary"
            disabled={!canSave}
            onPress={() => onSelect(draftValue)}
            style={st.fieldCtaBtn}
          />
        </View>
      )}>
      {options.length > 0 ? (
        <View style={st.inlineChoiceRow}>
          {options.map((option) => {
            const active = draftValue === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => setDraftValue(option.value)}
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
    </FieldEditSheet>
  );
}

function InlineTextPanel({
  title,
  helper,
  value,
  placeholder,
  allowEmpty,
  multiline,
  maxLength = 80,
  onSave,
  onClose,
}: {
  title: string;
  helper: string;
  value?: string;
  placeholder: string;
  allowEmpty?: boolean;
  multiline?: boolean;
  maxLength?: number;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value || '');
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const canSave = allowEmpty || cleaned.length > 0;
  return (
    <FieldEditSheet
      title={title}
      helper={helper}
      onClose={onClose}
      footer={(
        <View style={st.fieldCtaRow}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={st.fieldCtaBtn} />
          <Button
            label="Save"
            variant="primary"
            disabled={!canSave}
            onPress={() => onSave(cleaned)}
            style={st.fieldCtaBtn}
          />
        </View>
      )}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        style={[st.inlineTextInput, multiline && st.inlineTextArea]}
        autoCapitalize="words"
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </FieldEditSheet>
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

function RequirementTextField({
  label,
  value,
  placeholder,
  required,
  onChangeText,
}: {
  label: string;
  value?: any;
  placeholder: string;
  required?: boolean;
  onChangeText: (value: string) => void;
}) {
  const selected = value == null ? '' : String(value);
  const missing = required && !selected.trim();
  return (
    <View style={st.requirementGroup}>
      <Text style={[st.requirementLabel, missing && st.requirementMissingText]}>
        {label}{required ? ' *' : ''}
      </Text>
      <TextInput
        value={selected}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        style={[st.requirementTextInput, missing && st.requirementTextInputMissing]}
      />
    </View>
  );
}

function CategorySpecificsEditSheet({
  family,
  model,
  categorySpecifics,
  categoryFamilyLabel,
  poweredToyStatusRequired,
  bookSetStatusRequired,
  educationalBookDetailsRequired,
  appliancePickupRequired,
  highlighted,
  issueDisclosure,
  onSave,
  onClose,
}: {
  family: ListingRequirementFamily;
  model: string;
  categorySpecifics: Record<string, any>;
  categoryFamilyLabel: string;
  poweredToyStatusRequired: boolean;
  bookSetStatusRequired: boolean;
  educationalBookDetailsRequired: boolean;
  appliancePickupRequired: boolean;
  highlighted?: boolean;
  issueDisclosure: string;
  onSave: (nextSpecifics: Record<string, any>, nextIssueDisclosure: string) => void;
  onClose: () => void;
}) {
  const [draftSpecifics, setDraftSpecifics] = useState<Record<string, any>>(() => ({ ...categorySpecifics }));
  const [draftIssueDisclosure, setDraftIssueDisclosure] = useState(issueDisclosure);
  const setDraftSpecific = useCallback((key: string, value: any) => {
    setDraftSpecifics((prev) => ({ ...prev, [key]: value }));
  }, []);
  const setDraftToyDisclosure = useCallback((value: string) => {
    const nextSpecifics = toyDisclosureSpecifics(value);
    setDraftSpecifics((prev) => ({
      ...prev,
      ...nextSpecifics,
    }));
    if (!disclosureNeedsDetail('toy', nextSpecifics)) setDraftIssueDisclosure('');
  }, []);
  const setDraftBookCondition = useCallback((value: string) => {
    const nextSpecifics = bookConditionSpecifics(value, draftSpecifics);
    setDraftSpecifics((prev) => ({
      ...prev,
      ...bookConditionSpecifics(value, prev),
    }));
    if (!disclosureNeedsDetail('book', nextSpecifics)) setDraftIssueDisclosure('');
  }, [draftSpecifics]);
  const setDraftApplianceStatus = useCallback((value: string) => {
    const nextSpecifics = applianceStatusSpecifics(value, draftSpecifics);
    setDraftSpecifics((prev) => ({
      ...prev,
      ...applianceStatusSpecifics(value, prev),
    }));
    if (!disclosureNeedsDetail('appliance', nextSpecifics)) setDraftIssueDisclosure('');
  }, [draftSpecifics]);

  return (
    <FieldEditSheet
      title={`${categoryFamilyLabel} details`}
      helper="Answer the item-specific details buyers check before paying."
      onClose={onClose}
      footer={(
        <View style={st.fieldCtaRow}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={st.fieldCtaBtn} />
          <Button
            label="Save"
            variant="primary"
            onPress={() => {
              const nextIssueDisclosure = disclosureNeedsDetail(family, draftSpecifics)
                ? draftIssueDisclosure.replace(/\s+/g, ' ').trim()
                : '';
              onSave(draftSpecifics, nextIssueDisclosure);
            }}
            style={st.fieldCtaBtn}
          />
        </View>
      )}>
      <CategorySpecificsPanel
        family={family}
        model={model}
        categorySpecifics={draftSpecifics}
        categoryFamilyLabel={categoryFamilyLabel}
        poweredToyStatusRequired={poweredToyStatusRequired}
        bookSetStatusRequired={bookSetStatusRequired}
        educationalBookDetailsRequired={educationalBookDetailsRequired}
        appliancePickupRequired={appliancePickupRequired}
        highlighted={highlighted}
        sheetMode
        issueDisclosureRequired={disclosureNeedsDetail(family, draftSpecifics)}
        issueDisclosure={draftIssueDisclosure}
        onIssueDisclosureChange={setDraftIssueDisclosure}
        onSelect={setDraftSpecific}
        onToyDisclosure={setDraftToyDisclosure}
        onBookCondition={setDraftBookCondition}
        onApplianceStatus={setDraftApplianceStatus}
      />
    </FieldEditSheet>
  );
}

function CategorySpecificsPanel({
  family,
  model,
  categorySpecifics,
  categoryFamilyLabel,
  poweredToyStatusRequired,
  bookSetStatusRequired,
  educationalBookDetailsRequired,
  appliancePickupRequired,
  highlighted,
  sheetMode,
  issueDisclosureRequired,
  issueDisclosure,
  onIssueDisclosureChange,
  onSelect,
  onToyDisclosure,
  onBookCondition,
  onApplianceStatus,
}: {
  family: ListingRequirementFamily;
  model: string;
  categorySpecifics: Record<string, any>;
  categoryFamilyLabel: string;
  poweredToyStatusRequired: boolean;
  bookSetStatusRequired: boolean;
  educationalBookDetailsRequired: boolean;
  appliancePickupRequired: boolean;
  highlighted?: boolean;
  sheetMode?: boolean;
  issueDisclosureRequired?: boolean;
  issueDisclosure?: string;
  onIssueDisclosureChange?: (value: string) => void;
  onSelect: (key: string, value: any) => void;
  onToyDisclosure: (value: string) => void;
  onBookCondition: (value: string) => void;
  onApplianceStatus: (value: string) => void;
}) {
  if (family !== 'toy' && family !== 'book' && family !== 'appliance') return null;
  return (
    <View style={[sheetMode ? st.requirementPanelSheet : st.requirementPanel, highlighted && st.requirementPanelWarn]}>
      <View style={st.requirementPanelHeader}>
        <View>
          <Text style={st.requirementTitle}>{categoryFamilyLabel}</Text>
          <Text style={st.requirementHelper}>Quick answers buyers need before paying.</Text>
        </View>
        {model ? <Text style={st.requirementModel} numberOfLines={1}>{model}</Text> : null}
      </View>

      {family === 'toy' ? (
        <>
          <RequirementChoiceGroup
            label="Condition & safety"
            required
            value={toyDisclosureValue(categorySpecifics)}
            options={TOY_DISCLOSURE_OPTIONS}
            onSelect={onToyDisclosure}
          />
          <RequirementChoiceGroup
            label="Battery / working"
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
            label="Language"
            required
            value={categorySpecifics.language}
            options={BOOK_LANGUAGE_OPTIONS}
            onSelect={(value) => onSelect('language', value)}
          />
          <RequirementChoiceGroup
            label="Pages"
            required
            value={bookConditionValue(categorySpecifics)}
            options={BOOK_CONDITION_OPTIONS}
            onSelect={onBookCondition}
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
          {educationalBookDetailsRequired ? (
            <RequirementTextField
              label="Class / board"
              required
              value={categorySpecifics.class_board_edition || categorySpecifics.class_or_grade || categorySpecifics.edition}
              placeholder="e.g. Class 4 CBSE, 2025 edition"
              onChangeText={(value) => onSelect('class_board_edition', value)}
            />
          ) : null}
        </>
      ) : null}

      {family === 'appliance' ? (
        <>
          <RequirementChoiceGroup
            label="Condition"
            required
            value={applianceStatusValue(categorySpecifics)}
            options={APPLIANCE_STATUS_OPTIONS}
            onSelect={onApplianceStatus}
          />
          <RequirementChoiceGroup
            label="Accessories"
            required
            value={categorySpecifics.accessories_status}
            options={APPLIANCE_ACCESSORY_OPTIONS}
            onSelect={(value) => onSelect('accessories_status', value)}
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
          {appliancePickupRequired ? (
            <RequirementChoiceGroup
              label="Install"
              required
              value={categorySpecifics.installation_status}
              options={APPLIANCE_INSTALLATION_OPTIONS}
              onSelect={(value) => onSelect('installation_status', value)}
            />
          ) : null}
        </>
      ) : null}

      {issueDisclosureRequired && onIssueDisclosureChange ? (
        <View style={st.disclosureBox}>
          <Text style={st.disclosureLabel}>{disclosureDetailPrompt(family, categorySpecifics)}</Text>
          <TextInput
            value={issueDisclosure || ''}
            onChangeText={onIssueDisclosureChange}
            placeholder="Short and specific, so buyers see it before paying"
            placeholderTextColor={C.text4}
            style={st.disclosureInput}
            multiline
            textAlignVertical="top"
            maxLength={300}
          />
          {!(issueDisclosure || '').trim() ? (
            <Text style={st.detailIssue}>Required before listing: issue details.</Text>
          ) : null}
        </View>
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
  headerSpacer: { width: 44 },
  headerBackButton: {
    width: 44,
    height: 44,
  },
  headerTextWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },
  headerHelper: { marginTop: 1, fontSize: T.size.xs, color: C.text4, fontWeight: T.weight.medium },
  flex: { flex: 1 },
  scrollPad: { paddingBottom: 168 },

  // Compact item card — image + meta + edit pencil
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  itemImage: {
    width: 72,
    height: 72,
    borderRadius: R.md,
    backgroundColor: C.bone2,
  },
  itemMeta: { flex: 1, minWidth: 0, marginLeft: S.md },
  itemTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
    lineHeight: T.size.md + 5,
  },
  itemSubtitle: { marginTop: 2, fontSize: T.size.sm, color: C.text3 },
  itemStatusLine: {
    marginTop: S.sm,
    color: C.text3,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
  },
  itemActionRail: {
    width: 88,
    alignItems: 'flex-end',
    gap: 5,
    flexShrink: 0,
  },
  itemPrice: {
    flexShrink: 0,
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.petrol,
  },
  itemPriceHelper: {
    marginTop: -2,
    color: C.text4,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
  },
  readinessMini: {
    minHeight: 24,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.greenLight,
    borderWidth: 1,
    borderColor: '#BFE8CF',
  },
  readinessMiniText: {
    color: C.green,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  itemPriceError: {
    marginTop: S.xs,
    color: C.amberDeep,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
  },
  actionPill: {
    width: 72,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.sm,
    paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.blueBorder,
  },
  actionPillDanger: {
    backgroundColor: C.redLight,
    borderColor: '#F1C7C1',
  },
  actionPillText: {
    color: C.ctaPrimary,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  actionPillTextDanger: {
    color: C.red,
  },
  photoReviewCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.sm,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
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
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  photoReviewSub: {
    marginTop: 2,
    fontSize: T.size.xs,
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
    gap: S.xs,
    paddingTop: S.sm,
    paddingBottom: 2,
  },
  photoThumbWrap: {
    width: 68,
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
    height: 58,
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
    top: 20,
    textAlign: 'center',
    color: C.red,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    backgroundColor: 'rgba(255,253,248,0.86)',
  },
  photoRemoveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26,
    paddingVertical: 3,
    backgroundColor: C.bone,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  photoRemoveText: {
    color: C.text3,
    fontSize: T.size.xs - 1,
    fontWeight: T.weight.semi,
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
  readinessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  readinessIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.ctaPrimarySoft,
    borderWidth: 1,
    borderColor: C.ctaPrimaryBorder,
  },
  readinessIconText: {
    color: C.ctaPrimary,
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
  },
  readinessCopy: { flex: 1, minWidth: 0 },
  readinessTitle: {
    color: C.text,
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
  },
  readinessSub: {
    marginTop: 2,
    color: C.text3,
    fontSize: T.size.sm,
    lineHeight: T.size.sm + 5,
  },
  requiredQueueCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  requiredQueueCardPending: {
    backgroundColor: C.amberSoft,
    borderColor: C.amberBorder,
  },
  requiredQueueHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
    marginBottom: S.sm,
  },
  requiredQueueTitle: {
    color: C.text,
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
  },
  requiredQueueSub: {
    marginTop: 2,
    color: C.text3,
    fontSize: T.size.xs,
  },
  queueNextBtn: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    backgroundColor: C.ctaPrimary,
  },
  queueNextText: {
    color: C.surface,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  queueDoneText: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    overflow: 'hidden',
    backgroundColor: C.greenLight,
    color: C.green,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  requiredRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingVertical: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  requiredDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.ctaPrimarySoft,
  },
  requiredDotWarn: {
    backgroundColor: C.amberSoft,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  requiredDotText: {
    color: C.ctaPrimary,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  requiredDotWarnText: { color: C.amberDeep },
  requiredCopy: { flex: 1, minWidth: 0 },
  requiredLabel: {
    color: C.text,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  requiredSummary: {
    marginTop: 1,
    color: C.text3,
    fontSize: T.size.xs,
  },
  requiredAction: {
    color: C.ctaPrimary,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  queueEmpty: {
    marginTop: S.sm,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.greenLight,
  },
  queueEmptyText: {
    color: C.green,
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    lineHeight: T.size.sm + 5,
  },
  summaryRows: {
    marginTop: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  reviewSummaryRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
    paddingVertical: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  reviewSummaryRowStatic: {
    opacity: 0.86,
  },
  reviewSummaryCopy: { flex: 1, minWidth: 0 },
  reviewSummaryLabel: {
    color: C.text,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  reviewSummaryText: {
    marginTop: 2,
    color: C.text3,
    fontSize: T.size.xs,
  },
  reviewSummaryStatus: {
    minWidth: 58,
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: C.greenLight,
  },
  reviewSummaryStatusWarn: { backgroundColor: C.amberSoft },
  reviewSummaryStatusDanger: { backgroundColor: C.redLight },
  reviewSummaryStatusText: {
    color: C.green,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  reviewSummaryStatusTextWarn: { color: C.amberDeep },
  reviewSummaryStatusTextDanger: { color: C.red },
  reviewSummaryArrow: {
    color: C.text4,
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    marginLeft: -S.xs,
  },
  additionalNoteText: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.bone,
    color: C.text,
    fontSize: T.size.sm,
    lineHeight: T.size.sm + 6,
  },
  additionalNoteEmpty: {
    marginTop: S.md,
    minHeight: 72,
    justifyContent: 'center',
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.border2,
    backgroundColor: C.bone,
  },
  additionalNoteEmptyText: {
    color: C.text3,
    fontSize: T.size.sm,
    lineHeight: T.size.sm + 6,
  },
  conditionBreakdownCard: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  conditionBreakdownHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
    marginBottom: S.sm,
  },
  conditionBreakdownTitle: {
    color: C.text,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  conditionBreakdownSub: {
    marginTop: 1,
    color: C.text3,
    fontSize: T.size.xs,
  },
  conditionEditBtn: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.blueBorder,
    backgroundColor: C.surface,
  },
  conditionEditText: {
    color: C.ctaPrimary,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  detailSectionLabel: {
    marginTop: S.md,
    marginBottom: S.xs,
    color: C.text3,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    textTransform: 'uppercase',
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
  finalReviewCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  finalReviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
    marginBottom: S.xs,
  },
  finalReviewTitle: {
    color: C.text,
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
  },
  finalReviewBadge: {
    overflow: 'hidden',
    borderRadius: R.pill,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    backgroundColor: C.ctaPrimarySoft,
    color: C.ctaPrimary,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
  },
  detailTitleWrap: {
    flex: 1,
    minWidth: 0,
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
  buyerPreviewCard: {
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  previewReadyBadge: {
    overflow: 'hidden',
    borderRadius: R.pill,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    backgroundColor: C.greenLight,
    color: C.green,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  previewWarnBadge: {
    overflow: 'hidden',
    borderRadius: R.pill,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    backgroundColor: C.amberSoft,
    color: C.amberDeep,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  previewBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: S.md,
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.bone,
  },
  previewImage: {
    width: 72,
    height: 72,
    borderRadius: R.md,
    backgroundColor: C.bone2,
  },
  previewCopy: { flex: 1, minWidth: 0 },
  previewTitle: {
    color: C.text,
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    lineHeight: T.size.base + 5,
  },
  previewPrice: {
    marginTop: 4,
    color: C.petrol,
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
  },
  previewDiscount: {
    marginTop: 2,
    color: C.green,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
  },
  previewNote: {
    marginTop: S.xs,
    color: C.text3,
    fontSize: T.size.xs,
    lineHeight: T.size.xs + 5,
  },
  previewFacts: {
    marginTop: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  previewFactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: S.md,
    paddingVertical: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  previewFactLabel: {
    width: 104,
    color: C.text4,
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    textTransform: 'uppercase',
  },
  previewFactValue: {
    flex: 1,
    color: C.text,
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    textAlign: 'right',
    lineHeight: T.size.sm + 5,
  },
  fieldBackdrop: {
    flex: 1,
    backgroundColor: O.dark50,
    justifyContent: 'flex-end',
  },
  fieldBackdropTouch: { ...StyleSheet.absoluteFillObject },
  fieldSheet: {
    maxHeight: '82%',
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    paddingBottom: S.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 16,
  },
  fieldHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border2,
    marginBottom: S.md,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
  },
  fieldTitleWrap: { flex: 1 },
  fieldTitle: {
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  fieldHelper: {
    marginTop: 3,
    fontSize: T.size.sm,
    color: C.text3,
    lineHeight: T.size.sm + 5,
  },
  fieldClose: {
    paddingHorizontal: S.sm,
    paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: C.bone,
    borderWidth: 1,
    borderColor: C.border,
  },
  fieldCloseText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    color: C.ctaPrimary,
  },
  fieldScroll: {
    marginTop: S.md,
  },
  fieldContent: {
    paddingBottom: S.md,
  },
  fieldFooter: {
    paddingTop: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  fieldCtaRow: {
    flexDirection: 'row',
    gap: S.sm,
  },
  fieldCtaBtn: {
    flex: 1,
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
  inlineTextInput: {
    minHeight: 46,
    marginTop: S.md,
    borderWidth: 1,
    borderColor: C.blueBorder,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    backgroundColor: C.surface,
    color: C.text,
    fontSize: T.size.base,
  },
  inlineTextArea: {
    minHeight: 128,
    lineHeight: T.size.base + 6,
  },
  inlineSaveBtn: {
    marginTop: S.sm,
    alignSelf: 'flex-end',
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    backgroundColor: C.ctaPrimary,
  },
  inlineSaveText: {
    color: C.surface,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  requirementPanel: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  requirementPanelSheet: {
    paddingTop: S.xs,
    paddingBottom: S.sm,
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
  requirementTextInput: {
    minHeight: 44,
    marginTop: S.xs,
    borderWidth: 1,
    borderColor: C.border2,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    backgroundColor: C.surface,
    color: C.text,
    fontSize: T.size.base,
  },
  requirementTextInputMissing: {
    borderColor: C.amberBorder,
    backgroundColor: C.surface,
  },
  detailIssue: {
    marginTop: S.md,
    fontSize: T.size.sm,
    color: C.amberDeep,
    fontWeight: T.weight.semi,
  },
  disclosureBox: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.amberBorder,
    backgroundColor: C.amberSoft,
  },
  disclosureLabel: {
    color: C.amberDeep,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    marginBottom: S.sm,
  },
  disclosureInput: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: C.amberBorder,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    backgroundColor: C.surface,
    color: C.text,
    fontSize: T.size.base,
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

  // Shared cards and edit controls
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
  priceGuidanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
    backgroundColor: C.surface,
    marginHorizontal: S.lg,
    marginTop: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
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
  conditionHelp: {
    marginTop: S.sm,
    fontSize: T.size.sm,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
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
