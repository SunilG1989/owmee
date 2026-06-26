/**
 * CreateListingScreen — Category-specific listing form
 * Inspired by Circle/OLX/Cashify India listing flows.
 * 
 * Flow: Photos → Category → Category-specific details → Condition → Price → Review
 * 
 * Each category shows relevant fields only:
 *   Smartphones:     brand, model, storage, color, IMEI, battery, screen/body condition
 *   Laptops/Tablets: brand, model, processor, RAM, storage, screen size, serial
 *   Appliances:      brand, model/type, purchase year
 *   Kids & Utility:  age suitability, hygiene status
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Linking,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { parseApiError } from '../../utils/errors';
import { C, T, S, R, Shadow, formatPrice, O } from '../../utils/tokens';
import { Button, IconButton } from '../../components/ui';
import { Listings } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useLocation } from '../../hooks/useLocation';
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
  COLOR_OPTIONS,
  HYGIENE_OPTIONS as LISTING_HYGIENE_OPTIONS,
  KIDS_AGE_OPTIONS,
  PROCESSOR_OPTIONS,
  RAM_OPTIONS,
  SCREEN_SIZE_OPTIONS,
  STORAGE_OPTIONS,
  TOY_MISSING_PARTS_OPTIONS,
  TOY_POWER_STATUS_OPTIONS,
  TOY_SAFETY_STATUS_OPTIONS,
  getBrandsForCategory,
  getCategoryKind,
  getListingRequirementFamily,
  getModelSuggestions,
  listingNeedsAppliancePickupStatus,
  listingNeedsBookSetStatus,
  listingNeedsPoweredToyStatus,
} from '../../utils/listingCatalog';
import type { ListingRequirementFamily } from '../../utils/listingCatalog';
import { afterInteractions } from '../../utils/schedule';

// ── Reference data ───────────────────────────────────────────────
const DEFECT_OPTIONS = [
  { key: 'dead_pixels', label: 'Dead pixels on screen' },
  { key: 'touch_issue', label: 'Touch unresponsive in spots' },
  { key: 'speaker_issue', label: 'Speaker not working properly' },
  { key: 'mic_issue', label: 'Microphone issue' },
  { key: 'camera_issue', label: 'Camera not working' },
  { key: 'charging_issue', label: 'Charging port issue' },
  { key: 'button_issue', label: 'Buttons not working' },
  { key: 'wifi_issue', label: 'WiFi/Bluetooth issue' },
  { key: 'fingerprint_issue', label: 'Fingerprint sensor issue' },
  { key: 'face_id_issue', label: 'Face ID not working' },
  { key: 'battery_drain', label: 'Battery drains fast' },
];

const CONDITION_OPTIONS = [
  { key: 'like_new', label: 'Like New', desc: 'Barely used, no visible wear', emoji: '✨' },
  { key: 'good', label: 'Good', desc: 'Minor use, fully functional', emoji: '👍' },
  { key: 'fair', label: 'Fair', desc: 'Visible wear, works properly', emoji: '👌' },
];

const SCREEN_CONDITIONS = [
  { key: 'flawless', label: 'Flawless', desc: 'No scratches at all' },
  { key: 'minor_scratches', label: 'Minor scratches', desc: 'Only visible at certain angles' },
  { key: 'cracked', label: 'Cracked/Damaged', desc: 'Visible cracks or deep scratches' },
];

const KIDS_SAFETY_ITEMS = [
  { key: 'cleaned', label: 'Cleaned' },
  { key: 'no_small_parts', label: 'No unsafe small parts' },
  { key: 'no_loose_batteries', label: 'No loose batteries' },
  { key: 'no_sharp_edges', label: 'No sharp edges' },
  { key: 'age_label_correct', label: 'Age label checked' },
  { key: 'working_condition', label: 'Works as expected' },
];

const BODY_CONDITIONS = [
  { key: 'flawless', label: 'Flawless', desc: 'No dents or scratches' },
  { key: 'minor_dents', label: 'Minor wear', desc: 'Small dents or scratches' },
  { key: 'major_damage', label: 'Major damage', desc: 'Significant dents or cracks' },
];

const PURCHASE_YEARS = Array.from({ length: 8 }, (_, i) => 2026 - i);

const KIDS_AGE_RANGES = KIDS_AGE_OPTIONS;
const HYGIENE_OPTIONS = LISTING_HYGIENE_OPTIONS;

type Category = { id: string; slug: string; name: string; imei_required?: boolean };

function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let total = 0;
  value
    .split('')
    .reverse()
    .forEach((ch, i) => {
      let n = Number(ch);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      total += n;
    });
  return total % 10 === 0;
}

const cleanText = (value?: string | null) => {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length ? cleaned : null;
};

const hasSpecificValue = (specifics: Record<string, any>, key: string) => {
  const raw = specifics[key];
  if (raw === true || raw === false || typeof raw === 'number') return true;
  return Boolean(cleanText(raw == null ? '' : String(raw)));
};

const categorySpecificsForPayload = (
  family: ListingRequirementFamily,
  specifics: Record<string, any>,
  seed: { model?: string | null; age?: string | null; hygiene?: string | null },
) => {
  const allowed: Record<ListingRequirementFamily, string[]> = {
    device: [],
    other: [],
    toy: ['toy_type', 'missing_parts_status', 'safety_status', 'battery_status', 'working_status'],
    book: ['book_type', 'language', 'page_condition', 'markings_status', 'pages_complete', 'set_status'],
    appliance: ['appliance_type', 'working_status', 'accessories_status', 'defects_disclosed', 'pickup_complexity'],
  };
  const payload: Record<string, any> = {};
  allowed[family].forEach((key) => {
    const value = cleanText(specifics[key] == null ? '' : String(specifics[key]));
    if (value) payload[key] = value;
  });
  if (family === 'toy' && seed.model && !payload.toy_type) payload.toy_type = seed.model;
  if (family === 'book' && seed.model && !payload.book_type) payload.book_type = seed.model;
  if (family === 'appliance' && seed.model && !payload.appliance_type) payload.appliance_type = seed.model;
  return Object.keys(payload).length ? payload : null;
};

// ── Component ────────────────────────────────────────────────────
export default function CreateListingScreen({ navigation }: any) {
  const { isAuthenticated, kycStatus } = useAuthStore();
  const { location } = useLocation();

  // Steps
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Categories from API
  const [categories, setCategories] = useState<Category[]>([]);
  const [cat, setCat] = useState<Category | null>(null);

  // Photos
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null, null, null, null]);

  // Common fields
  const [title, setTitle] = useState('');
  const [autoTitle, setAutoTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [condition, setCondition] = useState('');
  const [price, setPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [nego, setNego] = useState(true);
  // Reserve price (P1.5) — hidden floor below which auto-decline offers.
  // Buyers don't see it. Empty string = no floor (any offer routed to seller).
  const [reservePrice, setReservePrice] = useState('');

  // Product details (category-specific)
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [ram, setRam] = useState('');
  const [color, setColor] = useState('');
  const [processor, setProcessor] = useState('');
  const [screenSize, setScreenSize] = useState('');
  const [purchaseYear, setPurchaseYear] = useState<number | null>(null);
  const [imei, setImei] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [batteryHealth, setBatteryHealth] = useState('');
  const [screenCond, setScreenCond] = useState('');
  const [bodyCond, setBodyCond] = useState('');
  const [defects, setDefects] = useState<string[]>([]);
  const [accessories, setAccessories] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');
  const [ageSuitability, setAgeSuitability] = useState('');
  const [hygiene, setHygiene] = useState('');
  const [categorySpecifics, setCategorySpecifics] = useState<Record<string, any>>({});
  const [kidsSafetyChecklist, setKidsSafetyChecklist] = useState<Record<string, boolean | null>>({});

  // Structured accessory presence (P1.3) — replaces free-text "accessories"
  // with explicit yes/no for the items India buyers ask about most often.
  // Charger especially is a top return-cause when buyer assumed it shipped.
  const [hasBox, setHasBox] = useState(false);
  const [hasBill, setHasBill] = useState(false);
  const [hasCharger, setHasCharger] = useState(false);
  const [hasEarphones, setHasEarphones] = useState(false);

  // P1.4 — Cashify-floor disclosures missing from defects[]:
  // - waterDamageHistory: ever submerged / liquid contact (yes/no, declared once)
  // - functionalAttest: explicit "everything else works" sign-off, gates submit
  //   for electronics so the seller affirms the listing matches reality.
  const [waterDamageHistory, setWaterDamageHistory] = useState<boolean | null>(null);
  const [functionalAttest, setFunctionalAttest] = useState(false);

  // Fetch categories
  useEffect(() => {
    const cancelTask = afterInteractions(() => Listings.categories().then(res => {
      setCategories(res.data?.categories || []);
    }).catch(() => {}));
    return cancelTask;
  }, []);

  const valid = photos.filter(Boolean) as string[];
  const catType = getCategoryKind(cat?.slug);
  const categorySlug = cat?.slug;
  const categoryFamily = getListingRequirementFamily(categorySlug, model, title);
  const poweredToyStatusRequired = categoryFamily === 'toy' && listingNeedsPoweredToyStatus(model, title);
  const bookSetStatusRequired = categoryFamily === 'book' && listingNeedsBookSetStatus(model, title);
  const appliancePickupRequired = categoryFamily === 'appliance' && listingNeedsAppliancePickupStatus(model, title);

  useEffect(() => {
    setCategorySpecifics({});
    setKidsSafetyChecklist({});
  }, [cat?.id]);

  const setCategorySpecific = (key: string, value: any) => {
    setCategorySpecifics(prev => ({ ...prev, [key]: value }));
  };

  const categorySpecificIssues = () => {
    const issues: string[] = [];
    if (categoryFamily === 'toy') {
      if (!ageSuitability) issues.push('age suitability');
      if (!hygiene) issues.push('cleanliness');
      if (!hasSpecificValue(categorySpecifics, 'missing_parts_status')) issues.push('parts completeness');
      if (!hasSpecificValue(categorySpecifics, 'safety_status')) issues.push('safety status');
      if (poweredToyStatusRequired && !(
        hasSpecificValue(categorySpecifics, 'working_status')
        || hasSpecificValue(categorySpecifics, 'battery_status')
      )) issues.push('battery/working status');
      if (catType === 'kids') {
        const requiredSafety = ['no_small_parts', 'no_loose_batteries', 'no_sharp_edges'];
        if (!requiredSafety.every(key => kidsSafetyChecklist[key] !== null && kidsSafetyChecklist[key] !== undefined)) {
          issues.push('kids safety checklist');
        }
      }
    }
    if (categoryFamily === 'book') {
      if (!hasSpecificValue(categorySpecifics, 'book_type') && !model.trim()) issues.push('book type');
      if (!hasSpecificValue(categorySpecifics, 'language')) issues.push('language');
      if (!hasSpecificValue(categorySpecifics, 'page_condition')) issues.push('page condition');
      if (!hasSpecificValue(categorySpecifics, 'markings_status')) issues.push('markings');
      if (!hasSpecificValue(categorySpecifics, 'pages_complete')) issues.push('page completeness');
      if (bookSetStatusRequired && !hasSpecificValue(categorySpecifics, 'set_status')) issues.push('set completeness');
    }
    if (categoryFamily === 'appliance') {
      if (!hasSpecificValue(categorySpecifics, 'appliance_type') && !model.trim()) issues.push('appliance type');
      if (!hasSpecificValue(categorySpecifics, 'working_status')) issues.push('working status');
      if (!hasSpecificValue(categorySpecifics, 'accessories_status')) issues.push('accessories');
      if (!hasSpecificValue(categorySpecifics, 'defects_disclosed')) issues.push('defects');
      if (appliancePickupRequired && !hasSpecificValue(categorySpecifics, 'pickup_complexity')) issues.push('pickup effort');
    }
    return issues;
  };

  // Auto-generate title from brand + model until the seller edits it.
  useEffect(() => {
    const next = [brand, model].filter(Boolean).join(' ').trim();
    if (next && (!title || title === autoTitle)) {
      setTitle(next);
      setAutoTitle(next);
    }
  }, [brand, model, title, autoTitle]);

  // Auth gate
  if (!isAuthenticated) return (
    <SafeAreaView style={st.safe}>
      <View style={st.gate}>
        <Text style={st.gateEmoji}>🔐</Text>
        <Text style={st.gateH}>Sign in to sell</Text>
        <Button
          label="Sign in"
          variant="primary"
          onPress={() => navigation.getParent()?.navigate('AuthFlow')}
        />
      </View>
    </SafeAreaView>
  );

  // ── Runtime permission helpers (Android 6+) ─────────────────────
  // Structural fix: react-native-image-picker docs say "camera permission
  // is not required by the library" — but if CAMERA is declared in
  // AndroidManifest (which we do), then the intent to launch camera FAILS
  // silently unless runtime permission is granted first.
  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Owmee needs camera access',
          message: 'Take photos of the item you want to list.',
          buttonPositive: 'Allow',
          buttonNegative: 'Cancel',
        },
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) return true;
      if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        Alert.alert(
          'Camera blocked',
          'Open Settings → Apps → Owmee → Permissions and enable Camera.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
      return false;
    } catch (err) {
      console.warn('Camera permission error:', err);
      return false;
    }
  };

  const requestGalleryPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    // Android 13+ (API 33): READ_MEDIA_IMAGES
    // Android 12 and below: READ_EXTERNAL_STORAGE
    const androidVersion = Platform.Version as number;
    const permission = androidVersion >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    try {
      const granted = await PermissionsAndroid.request(permission, {
        title: 'Owmee needs photo access',
        message: 'Choose photos of the item you want to list.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      });
      if (granted === PermissionsAndroid.RESULTS.GRANTED) return true;
      if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        Alert.alert(
          'Photo access blocked',
          'Open Settings → Apps → Owmee → Permissions and enable Photos.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
      return false;
    } catch (err) {
      console.warn('Gallery permission error:', err);
      return false;
    }
  };

  const pick = (i: number) => {
    Alert.alert('Add photo', 'Choose source', [
      {
        text: 'Camera',
        onPress: async () => {
          const ok = await requestCameraPermission();
          if (!ok) return;
          launchCamera(
            {
              mediaType: 'photo',
              quality: 0.8,
              maxWidth: 1200,
              maxHeight: 1200,
              saveToPhotos: false,
              cameraType: 'back',
            },
            r => {
              if (r.didCancel) return;
              if (r.errorCode) {
                Alert.alert('Camera error', r.errorMessage || r.errorCode);
                return;
              }
              if (r.assets?.[0]?.uri) {
                const n = [...photos];
                n[i] = r.assets[0].uri!;
                setPhotos(n);
              }
            },
          );
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const ok = await requestGalleryPermission();
          if (!ok) return;
          launchImageLibrary(
            {
              mediaType: 'photo',
              quality: 0.8,
              maxWidth: 1200,
              maxHeight: 1200,
              selectionLimit: 1,
            },
            r => {
              if (r.didCancel) return;
              if (r.errorCode) {
                Alert.alert('Gallery error', r.errorMessage || r.errorCode);
                return;
              }
              if (r.assets?.[0]?.uri) {
                const n = [...photos];
                n[i] = r.assets[0].uri!;
                setPhotos(n);
              }
            },
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleDefect = (key: string) => {
    setDefects(prev => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]);
  };

  // Smartphone IMEI is required and must pass the same Luhn checksum used by
  // AIListingIdentifierScreen. Without this, manual fallback becomes a weaker
  // path than AI-assisted listing.
  const imeiRequired = catType === 'phone';
  const imeiValid = !imeiRequired || isValidImei(imei);

  const submit = async () => {
    if (imeiRequired && !imeiValid) {
      Alert.alert('Invalid IMEI', 'IMEI must be exactly 15 digits and pass checksum. Dial *#06# on the phone to read it.');
      return;
    }
    if (defects.length > 0 && condition === 'like_new') {
      Alert.alert(
        'Condition mismatch',
        '"Like new" can\'t be paired with reported defects. Pick "Good" or "Fair", or remove the defects.',
      );
      return;
    }
    const requirementIssues = categorySpecificIssues();
    if (requirementIssues.length > 0) {
      Alert.alert('Complete item details', `Please complete: ${requirementIssues.join(', ')}.`);
      return;
    }
    if ((catType === 'phone' || catType === 'laptop' || catType === 'tablet')) {
      if (waterDamageHistory === null) {
        Alert.alert('One more thing', 'Please answer the water-damage question — buyers and the refund team rely on this.');
        return;
      }
      if (!functionalAttest) {
        Alert.alert(
          'Confirm functional state',
          'Please tick "I confirm anything not flagged above works as expected" so we can stand behind the listing with our refund guarantee.',
        );
        return;
      }
    }
    if (nego && reservePrice && price && parseFloat(reservePrice) > parseFloat(price)) {
      Alert.alert(
        'Reserve too high',
        'Reserve price can\'t be higher than your asking price.',
      );
      return;
    }
    setBusy(true);
    try {
      const hasStructuredIncludes = catType === 'phone' || catType === 'laptop' || catType === 'tablet' || catType === 'appliance';
      const hasDeviceAttestation = catType === 'phone' || catType === 'laptop' || catType === 'tablet';
      const res = await Listings.create({
        category_id: cat!.id,
        title: title.trim(),
        description: desc.trim() || undefined,
        price: parseFloat(price),
        condition,
        city: location?.city || 'Unknown',
        state: location?.state || 'Karnataka',
        lat: location?.lat,
        lng: location?.lng,
        is_negotiable: nego,
        min_acceptable_price: nego && reservePrice ? parseFloat(reservePrice) : undefined,
        // Product details
        brand: brand || undefined,
        model: model || undefined,
        storage: storage || undefined,
        ram: ram || undefined,
        color: color || undefined,
        processor: processor || undefined,
        screen_size: screenSize || undefined,
        purchase_year: purchaseYear || undefined,
        screen_condition: screenCond || undefined,
        body_condition: bodyCond || undefined,
        defects: defects.length > 0 ? defects : undefined,
        original_price: originalPrice ? parseFloat(originalPrice) : undefined,
        serial_number: serialNumber || undefined,
        imei: imei || undefined,
        accessories: accessories || undefined,
        warranty_info: warrantyInfo || undefined,
        category_family: categoryFamily,
        category_specifics: categorySpecificsForPayload(categoryFamily, categorySpecifics, {
          model,
          age: ageSuitability,
          hygiene,
        }) || undefined,
        has_box: hasStructuredIncludes ? hasBox : undefined,
        has_bill: hasStructuredIncludes ? hasBill : undefined,
        has_charger: hasStructuredIncludes ? hasCharger : undefined,
        has_earphones: catType === 'phone' ? hasEarphones : undefined,
        water_damage_history: waterDamageHistory ?? undefined,
        seller_functional_attestation: hasDeviceAttestation ? functionalAttest : undefined,
        battery_health: batteryHealth ? parseInt(batteryHealth) : undefined,
        age_suitability: ageSuitability || undefined,
        hygiene_status: hygiene || undefined,
        is_kids_item: catType === 'kids',
        kids_safety_checklist: catType === 'kids' && categoryFamily === 'toy'
          ? Object.fromEntries(
            KIDS_SAFETY_ITEMS
              .filter(item => kidsSafetyChecklist[item.key] !== null && kidsSafetyChecklist[item.key] !== undefined)
              .map(item => [item.key, Boolean(kidsSafetyChecklist[item.key])]),
          )
          : undefined,
      });
      const lid = res.data.listing_id || res.data.id;

      // Upload images (3-step: request presigned URL -> PUT file -> confirm).
      // Publish only after every required photo has been confirmed.
      let uploadedCount = 0;
      for (let i = 0; i < valid.length; i++) {
        try {
          const reqRes = await Listings.requestImageUpload(lid);
          const { r2_key, upload_url } = reqRes.data;
          // React Native: use XHR to PUT the file directly from file:// URI
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', upload_url);
            xhr.setRequestHeader('Content-Type', 'image/jpeg');
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload ${xhr.status}`));
            xhr.onerror = () => reject(new Error('Upload network error'));
            xhr.send({ uri: valid[i], type: 'image/jpeg', name: `photo_${i}.jpg` } as any);
          });
          await Listings.confirmImageUpload(lid, r2_key, i === 0);
          uploadedCount += 1;
        } catch (imgErr: any) {
          // Fix #9: Surface actual error — not generic message
          const status = imgErr?.message?.match(/Upload (\d+)/)?.[1];
          const detail = status === '403' ? 'Presigned URL expired — try again'
            : status === '413' ? 'Photo too large — use a smaller image'
            : imgErr?.message === 'Upload network error' ? 'Network error — check WiFi'
            : `Upload failed (${status || 'unknown'})`;
          console.warn('Image upload failed for index', i, imgErr);
          throw new Error(`Photo ${i + 1}: ${detail}`);
        }
      }

      if (uploadedCount < 3) {
        throw new Error(`Only ${uploadedCount} photos uploaded. Add at least 3 photos before publishing.`);
      }

      await Listings.publish(lid);
      const kycTrustLine = kycStatus === 'verified'
        ? 'Your Verified seller badge helps buyers trust the listing.'
        : 'Complete KYC from Profile to add the Verified seller trust badge.';
      Alert.alert('Listing submitted', `Your item is submitted for review. Usually live within 2 hours.\n\n${kycTrustLine}`, [
        { text: 'View listing', onPress: () => navigation.navigate('ListingDetail', { listingId: lid }) },
      ]);
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Step labels ────────────────────────────────────────────────
  const steps = ['Photos', 'Category', 'Details', 'Condition', 'Price'];

  // ── Chip selector helper ───────────────────────────────────────
  const Chips = ({ options, selected, onSelect, wrap = true }: { options: string[]; selected: string; onSelect: (v: string) => void; wrap?: boolean }) => (
    <ScrollView horizontal={!wrap} showsHorizontalScrollIndicator={false} contentContainerStyle={wrap ? st.chipWrap : undefined}>
      {options.map(o => (
        <TouchableOpacity key={o} style={[st.chip, selected === o && st.chipActive]} onPress={() => onSelect(o)}>
          <Text style={[st.chipText, selected === o && st.chipTextActive]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // ── Can proceed to next step? ──────────────────────────────────
  const canProceed = () => {
    if (step === 0) return valid.length >= 3;
    if (step === 1) return !!cat;
    if (step === 2) {
      if (title.trim().length < 3) return false;
      if (catType === 'phone' || catType === 'laptop' || catType === 'tablet' || catType === 'appliance') {
        return brand.trim().length > 0 && model.trim().length > 0;
      }
      if (catType === 'kids') {
        if (!model.trim()) return false;
        if (categoryFamily === 'toy' && (!ageSuitability || !hygiene)) return false;
      }
      if (catType === 'other') return model.trim().length > 0;
      return true;
    }
    if (step === 3) return !!condition && categorySpecificIssues().length === 0;
    if (step === 4) return !!price && parseFloat(price) > 0;
    return true;
  };

  return (
    <SafeAreaView style={st.safe}>
      {/* Header with step dots */}
      <View style={st.top}>
        <IconButton
          icon="←"
          onPress={() => (step > 0 ? setStep(step - 1) : navigation.goBack())}
          a11y={step > 0 ? 'Previous step' : 'Back'}
          size="sm"
        />
        <View style={st.dots}>
          {steps.map((l, i) => (
            <View key={i} style={st.dw}>
              <View style={[st.d, i <= step && st.dActive]} />
              <Text style={[st.dl, i <= step && st.dlActive]}>{l}</Text>
            </View>
          ))}
        </View>
        <View style={st.topSpacer} />
      </View>

      {/* ═══ STEP 0: Photos ═══ */}
      {step === 0 && (
        <ScrollView style={st.body}>
          <Text style={st.h}>Add photos</Text>
          <Text style={st.sub}>Min 3 photos. Clear shots from all angles sell 3× faster.</Text>
          <View style={st.pg}>
            {photos.map((u, i) => (
              <TouchableOpacity key={i} style={st.ps} onPress={() => u ? (() => { const n = [...photos]; n[i] = null; setPhotos(n); })() : pick(i)}>
                {u ? (
                  <>
                    <Image source={{ uri: u }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                    <View style={st.px}><Text style={st.pxText}>✕</Text></View>
                  </>
                ) : (
                  <View style={st.pe}>
                    <Text style={st.peIcon}>+</Text>
                    <Text style={st.peLabel}>{['Front', 'Back', 'Detail', 'Accessories', 'Box', 'Extra'][i]}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={st.photosCount}>
            {valid.length}/6 · {valid.length < 3 ? `${3 - valid.length} more needed` : '✓ Ready'}
          </Text>
          <View style={st.bottomSpacer} />
        </ScrollView>
      )}

      {/* ═══ STEP 1: Category ═══ */}
      {step === 1 && (
        <ScrollView style={st.body}>
          <Text style={st.h}>What are you selling?</Text>
          <Text style={st.sub}>Choose a category</Text>
          {categories.map(c => (
            <TouchableOpacity key={c.id} style={[st.catCard, cat?.id === c.id && st.catCardActive]} onPress={() => setCat(c)}>
              <Text style={[st.catName, cat?.id === c.id && st.catNameActive]}>{c.name}</Text>
              {c.imei_required && <Text style={st.catTag}>IMEI required</Text>}
            </TouchableOpacity>
          ))}
          <View style={st.bottomSpacer} />
        </ScrollView>
      )}

      {/* ═══ STEP 2: Category-specific details ═══ */}
      {step === 2 && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.flex1}>
          <ScrollView style={st.body}>
            <Text style={st.h}>Product details</Text>

            {/* ── Smartphones ── */}
            {catType === 'phone' && (
              <>
                <SuggestedInput
                  label="Brand"
                  required
                  value={brand}
                  onChangeText={setBrand}
                  placeholder="Apple, Samsung, OnePlus..."
                  suggestions={getBrandsForCategory(categorySlug)}
                />
                <SuggestedInput
                  label="Model"
                  required
                  value={model}
                  onChangeText={setModel}
                  placeholder="iPhone 15 Pro, Galaxy S24..."
                  suggestions={getModelSuggestions(categorySlug, brand)}
                />
                <Text style={st.lbl}>Storage</Text>
                <Chips options={STORAGE_OPTIONS} selected={storage} onSelect={setStorage} />
                <Text style={st.lbl}>RAM</Text>
                <Chips options={RAM_OPTIONS} selected={ram} onSelect={setRam} />
                <Text style={st.lbl}>Color</Text>
                <Chips options={COLOR_OPTIONS} selected={color} onSelect={setColor} />
                <Text style={st.lbl}>IMEI *  (dial *#06#)</Text>
                <TextInput
                  style={st.inp}
                  placeholder="15-digit IMEI number"
                  placeholderTextColor={C.text4}
                  value={imei}
                  onChangeText={(v) => setImei(v.replace(/[^\d]/g, '').slice(0, 15))}
                  keyboardType="numeric"
                  maxLength={15}
                />
                {imei.length > 0 && imei.length < 15 ? (
                  <Text style={st.errText}>{15 - imei.length} more digit{15 - imei.length === 1 ? '' : 's'} needed</Text>
                ) : null}
                <Text style={st.lbl}>Battery Health (%)</Text>
                <TextInput
                  style={st.inp}
                  placeholder="e.g. 87"
                  placeholderTextColor={C.text4}
                  value={batteryHealth}
                  onChangeText={(v) => {
                    const digits = v.replace(/[^\d]/g, '').slice(0, 3);
                    if (digits === '') return setBatteryHealth('');
                    const n = parseInt(digits, 10);
                    if (n > 100) return setBatteryHealth('100');
                    setBatteryHealth(digits);
                  }}
                  keyboardType="numeric"
                  maxLength={3}
                />
                {batteryHealth !== '' && parseInt(batteryHealth, 10) === 0 ? (
                  <Text style={st.errText}>Battery health must be greater than 0</Text>
                ) : null}
              </>
            )}

            {/* ── Laptops/Tablets ── */}
            {(catType === 'laptop' || catType === 'tablet') && (
              <>
                <SuggestedInput
                  label="Brand"
                  required
                  value={brand}
                  onChangeText={setBrand}
                  placeholder={catType === 'tablet' ? 'Apple, Samsung, Lenovo...' : 'HP, Dell, Lenovo, Apple...'}
                  suggestions={getBrandsForCategory(categorySlug)}
                />
                <SuggestedInput
                  label="Model"
                  required
                  value={model}
                  onChangeText={setModel}
                  placeholder={catType === 'tablet' ? 'iPad Air M2, Galaxy Tab S9...' : 'MacBook Air M2, ThinkPad X1...'}
                  suggestions={getModelSuggestions(categorySlug, brand)}
                />
                <Text style={st.lbl}>RAM</Text>
                <Chips options={RAM_OPTIONS} selected={ram} onSelect={setRam} />
                <Text style={st.lbl}>Storage</Text>
                <Chips options={STORAGE_OPTIONS} selected={storage} onSelect={setStorage} />
                <Text style={st.lbl}>Processor / chip</Text>
                <Chips options={PROCESSOR_OPTIONS} selected={processor} onSelect={setProcessor} />
                <Text style={st.lbl}>Screen Size</Text>
                <Chips options={SCREEN_SIZE_OPTIONS} selected={screenSize} onSelect={setScreenSize} />
                <Text style={st.lbl}>Serial Number</Text>
                <TextInput style={st.inp} placeholder="Found in Settings → About" placeholderTextColor={C.text4} value={serialNumber} onChangeText={setSerialNumber} />
              </>
            )}

            {/* ── Small Appliances ── */}
            {catType === 'appliance' && (
              <>
                <SuggestedInput
                  label="Brand"
                  required
                  value={brand}
                  onChangeText={setBrand}
                  placeholder="LG, Samsung, Bosch..."
                  suggestions={getBrandsForCategory(categorySlug)}
                />
                <SuggestedInput
                  label="Model / product name"
                  required
                  value={model}
                  onChangeText={setModel}
                  placeholder="Air Purifier XF-200, 7kg front load..."
                  suggestions={getModelSuggestions(categorySlug, brand)}
                />
              </>
            )}

            {/* ── Kids ── */}
            {catType === 'kids' && (
              <>
                <SuggestedInput
                  label="Brand"
                  value={brand}
                  onChangeText={setBrand}
                  placeholder="LEGO, Fisher-Price, Babyhug..."
                  suggestions={getBrandsForCategory(categorySlug)}
                />
                <SuggestedInput
                  label="Item type / model"
                  value={model}
                  onChangeText={setModel}
                  placeholder="Stroller, STEM kit, LEGO set..."
                  suggestions={getModelSuggestions(categorySlug, brand)}
                />
                {categoryFamily === 'toy' && (
                  <>
                    <Text style={st.lbl}>Age Suitability</Text>
                    <Chips options={KIDS_AGE_RANGES} selected={ageSuitability} onSelect={setAgeSuitability} />
                    <Text style={st.lbl}>Hygiene Status</Text>
                    <Chips options={HYGIENE_OPTIONS} selected={hygiene} onSelect={setHygiene} />
                  </>
                )}
              </>
            )}

            {/* ── Other ── */}
            {catType === 'other' && (
              <>
                <SuggestedInput
                  label="Brand"
                  value={brand}
                  onChangeText={setBrand}
                  placeholder="Optional"
                  suggestions={getBrandsForCategory(categorySlug)}
                />
                <SuggestedInput
                  label="Item type / product name"
                  required
                  value={model}
                  onChangeText={setModel}
                  placeholder="Book set, headphones, toy, chair..."
                  suggestions={getModelSuggestions(categorySlug, brand)}
                />
              </>
            )}

            {/* Common: Title */}
            <Text style={st.lbl}>Listing Title *</Text>
            <TextInput style={st.inp} placeholder={catType === 'phone' ? 'Auto-filled from brand + model' : 'What are you selling?'} placeholderTextColor={C.text4} value={title} onChangeText={setTitle} maxLength={200} />
            <Text style={st.lbl}>Description</Text>
            <TextInput style={[st.inp, st.inpMulti]} placeholder="Anything a buyer should know — what's included, any issues" placeholderTextColor={C.text4} value={desc} onChangeText={setDesc} multiline textAlignVertical="top" />

            {/* Purchase year */}
            <Text style={st.lbl}>Purchase Year</Text>
            <Chips options={PURCHASE_YEARS.map(String)} selected={purchaseYear ? String(purchaseYear) : ''} onSelect={v => setPurchaseYear(parseInt(v))} />

            <View style={st.bottomSpacer} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ═══ STEP 3: Condition ═══ */}
      {step === 3 && (
        <ScrollView style={st.body}>
          <Text style={st.h}>Condition</Text>
          <Text style={st.sub}>Be honest — accurate descriptions sell faster and avoid disputes.</Text>

          {CONDITION_OPTIONS.map(c => (
            <TouchableOpacity key={c.key} style={[st.condCard, condition === c.key && st.condCardActive]} onPress={() => setCondition(c.key)}>
              <Text style={st.condEmoji}>{c.emoji}</Text>
              <View style={st.flex1}>
                <Text style={[st.condLabel, condition === c.key && st.condLabelActive]}>{c.label}</Text>
                <Text style={st.condDesc}>{c.desc}</Text>
              </View>
              <View style={[st.radio, condition === c.key && st.radioActive]}>
                {condition === c.key && <View style={st.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}

          {/* Screen + body condition for electronics */}
          {(catType === 'phone' || catType === 'laptop' || catType === 'tablet') && (
            <>
              <Text style={[st.lbl, st.lblSpaced]}>Screen Condition</Text>
              {SCREEN_CONDITIONS.map(c => (
                <TouchableOpacity key={c.key} style={[st.miniCard, screenCond === c.key && st.miniCardActive]} onPress={() => setScreenCond(c.key)}>
                  <Text style={st.miniLabel}>{c.label}</Text>
                  <Text style={st.miniDesc}>{c.desc}</Text>
                </TouchableOpacity>
              ))}

              <Text style={st.lbl}>Body Condition</Text>
              {BODY_CONDITIONS.map(c => (
                <TouchableOpacity key={c.key} style={[st.miniCard, bodyCond === c.key && st.miniCardActive]} onPress={() => setBodyCond(c.key)}>
                  <Text style={st.miniLabel}>{c.label}</Text>
                  <Text style={st.miniDesc}>{c.desc}</Text>
                </TouchableOpacity>
              ))}

              <Text style={st.lbl}>Any defects? (select all that apply)</Text>
              {DEFECT_OPTIONS.map(d => (
                <TouchableOpacity key={d.key} style={[st.defectRow, defects.includes(d.key) && st.defectActive]} onPress={() => toggleDefect(d.key)}>
                  <View style={[st.checkbox, defects.includes(d.key) && st.checkboxActive]}>
                    {defects.includes(d.key) && <Text style={st.checkboxTick}>✓</Text>}
                  </View>
                  <Text style={st.defectLabel}>{d.label}</Text>
                </TouchableOpacity>
              ))}

              {/* Water damage history — separate yes/no, since the question is
                 about the device's history, not its current state. Cashify
                 floor: every device's quote is contingent on this answer. */}
              <Text style={[st.lbl, st.lblSpaced]}>Has it ever had water damage?</Text>
              <View style={st.includesRow}>
                <TouchableOpacity
                  style={[st.includesPill, waterDamageHistory === false && st.includesPillOn]}
                  onPress={() => setWaterDamageHistory(false)}
                  activeOpacity={0.7}
                >
                  <Text style={[st.includesLbl, waterDamageHistory === false && st.includesLblOn]}>
                    No
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.includesPill, waterDamageHistory === true && st.includesPillOn]}
                  onPress={() => setWaterDamageHistory(true)}
                  activeOpacity={0.7}
                >
                  <Text style={[st.includesLbl, waterDamageHistory === true && st.includesLblOn]}>
                    Yes — water exposure
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Functional attestation — explicit sign-off that the
                 unselected components work. Becomes the legal basis for
                 a refund decision if buyer raises a "not as promised"
                 claim later. Required to publish electronics. */}
              <TouchableOpacity
                style={[st.attestRow, functionalAttest && st.attestRowOn]}
                onPress={() => setFunctionalAttest(!functionalAttest)}
                activeOpacity={0.7}
              >
                <View style={[st.checkbox, functionalAttest && st.checkboxActive]}>
                  {functionalAttest && <Text style={st.checkboxTick}>✓</Text>}
                </View>
                <Text style={st.attestText}>
                  I confirm that anything not flagged above works as expected.
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* What's in the box — structured Yes/No checkboxes per India ecom convention.
             Free-text "accessories" stayed available below for anything else. */}
          {(catType === 'phone' || catType === 'laptop' || catType === 'tablet' || catType === 'appliance') && (
            <>
              <Text style={[st.lbl, st.lblSpaced]}>What's in the box?</Text>
              <View style={st.includesRow}>
                <Includes label="Original box" on={hasBox} onToggle={() => setHasBox(!hasBox)} />
                <Includes label="Bill / invoice" on={hasBill} onToggle={() => setHasBill(!hasBill)} />
                <Includes label="Charger" on={hasCharger} onToggle={() => setHasCharger(!hasCharger)} />
                {catType === 'phone' && (
                  <Includes
                    label="Earphones"
                    on={hasEarphones}
                    onToggle={() => setHasEarphones(!hasEarphones)}
                  />
                )}
              </View>
            </>
          )}

          {(categoryFamily === 'toy' || categoryFamily === 'book' || categoryFamily === 'appliance') && (
            <View style={st.requirementPanel}>
              <Text style={st.requirementTitle}>
                {categoryFamily === 'toy' ? 'Toy / kids item details' : categoryFamily === 'book' ? 'Book details' : 'Appliance details'}
              </Text>
              <Text style={st.requirementSub}>These details prevent buyer disputes later.</Text>
              {categoryFamily === 'toy' && (
                <>
                  {catType !== 'kids' && (
                    <>
                      <Text style={st.lbl}>Age Suitability</Text>
                      <Chips options={KIDS_AGE_RANGES} selected={ageSuitability} onSelect={setAgeSuitability} />
                      <Text style={st.lbl}>Hygiene Status</Text>
                      <Chips options={HYGIENE_OPTIONS} selected={hygiene} onSelect={setHygiene} />
                    </>
                  )}
                  <RequirementChoiceGroup
                    label="Parts"
                    value={categorySpecifics.missing_parts_status}
                    options={TOY_MISSING_PARTS_OPTIONS}
                    onSelect={(value) => setCategorySpecific('missing_parts_status', value)}
                  />
                  <RequirementChoiceGroup
                    label="Safety"
                    value={categorySpecifics.safety_status}
                    options={TOY_SAFETY_STATUS_OPTIONS}
                    onSelect={(value) => setCategorySpecific('safety_status', value)}
                  />
                  <RequirementChoiceGroup
                    label="Power / working"
                    value={categorySpecifics.working_status || categorySpecifics.battery_status}
                    options={TOY_POWER_STATUS_OPTIONS}
                    onSelect={(value) => {
                      setCategorySpecific('working_status', value);
                      setCategorySpecific('battery_status', value);
                    }}
                  />
                  {catType === 'kids' && (
                    <View style={st.kidsSafetyBox}>
                      <Text style={st.requirementMiniTitle}>Kids safety checklist</Text>
                      {KIDS_SAFETY_ITEMS.map((item) => {
                        const value = kidsSafetyChecklist[item.key];
                        return (
                          <View key={item.key} style={st.safetyRow}>
                            <Text style={st.safetyLabel}>{item.label}</Text>
                            <View style={st.safetyChoices}>
                              {[true, false].map((choice) => (
                                <TouchableOpacity
                                  key={`${item.key}-${choice ? 'yes' : 'no'}`}
                                  onPress={() => setKidsSafetyChecklist(prev => ({ ...prev, [item.key]: choice }))}
                                  activeOpacity={0.78}
                                  style={[st.safetyChoice, value === choice && st.safetyChoiceOn]}
                                >
                                  <Text style={[st.safetyChoiceText, value === choice && st.safetyChoiceTextOn]}>
                                    {choice ? 'Yes' : 'No'}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              )}
              {categoryFamily === 'book' && (
                <>
                  <RequirementChoiceGroup
                    label="Type"
                    value={categorySpecifics.book_type || model}
                    options={BOOK_TYPE_OPTIONS}
                    onSelect={(value) => setCategorySpecific('book_type', value)}
                  />
                  <RequirementChoiceGroup
                    label="Language"
                    value={categorySpecifics.language}
                    options={BOOK_LANGUAGE_OPTIONS}
                    onSelect={(value) => setCategorySpecific('language', value)}
                  />
                  <RequirementChoiceGroup
                    label="Pages"
                    value={categorySpecifics.page_condition}
                    options={BOOK_PAGE_CONDITION_OPTIONS}
                    onSelect={(value) => setCategorySpecific('page_condition', value)}
                  />
                  <RequirementChoiceGroup
                    label="Markings"
                    value={categorySpecifics.markings_status}
                    options={BOOK_MARKING_OPTIONS}
                    onSelect={(value) => setCategorySpecific('markings_status', value)}
                  />
                  <RequirementChoiceGroup
                    label="Completeness"
                    value={categorySpecifics.pages_complete}
                    options={BOOK_COMPLETENESS_OPTIONS}
                    onSelect={(value) => setCategorySpecific('pages_complete', value)}
                  />
                  {bookSetStatusRequired && (
                    <RequirementChoiceGroup
                      label="Set"
                      value={categorySpecifics.set_status}
                      options={BOOK_SET_STATUS_OPTIONS}
                      onSelect={(value) => setCategorySpecific('set_status', value)}
                    />
                  )}
                </>
              )}
              {categoryFamily === 'appliance' && (
                <>
                  <RequirementChoiceGroup
                    label="Working"
                    value={categorySpecifics.working_status}
                    options={APPLIANCE_WORKING_OPTIONS}
                    onSelect={(value) => setCategorySpecific('working_status', value)}
                  />
                  <RequirementChoiceGroup
                    label="Accessories"
                    value={categorySpecifics.accessories_status}
                    options={APPLIANCE_ACCESSORY_OPTIONS}
                    onSelect={(value) => setCategorySpecific('accessories_status', value)}
                  />
                  <RequirementChoiceGroup
                    label="Defects"
                    value={categorySpecifics.defects_disclosed}
                    options={APPLIANCE_DEFECT_OPTIONS}
                    onSelect={(value) => setCategorySpecific('defects_disclosed', value)}
                  />
                  {appliancePickupRequired && (
                    <RequirementChoiceGroup
                      label="Pickup"
                      value={categorySpecifics.pickup_complexity}
                      options={APPLIANCE_PICKUP_OPTIONS}
                      onSelect={(value) => setCategorySpecific('pickup_complexity', value)}
                    />
                  )}
                </>
              )}
              {categorySpecificIssues().length > 0 && (
                <Text style={st.errText}>Required before listing: {categorySpecificIssues().join(', ')}.</Text>
              )}
            </View>
          )}

          {/* Accessories + Warranty */}
          <Text style={[st.lbl, st.lblSpaced]}>Anything else included?</Text>
          <TextInput style={st.inp} placeholder="e.g. case, screen guard, extra cable" placeholderTextColor={C.text4} value={accessories} onChangeText={setAccessories} />
          <Text style={st.lbl}>Warranty</Text>
          <TextInput style={st.inp} placeholder="e.g. 3 months remaining, No warranty" placeholderTextColor={C.text4} value={warrantyInfo} onChangeText={setWarrantyInfo} />

          {/* Defect ↔ condition consistency check (P1.6) — block "Like new" + serious
             defect. Shows at the bottom so the user sees it after picking everything. */}
          {defects.length > 0 && condition === 'like_new' && (
            <Text style={st.errText}>
              "Like new" can't be paired with reported defects. Pick "Good" or "Fair", or remove the defects.
            </Text>
          )}

          <View style={st.bottomSpacer} />
        </ScrollView>
      )}

      {/* ═══ STEP 4: Price + Review ═══ */}
      {step === 4 && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.flex1}>
          <ScrollView style={st.body}>
            <Text style={st.h}>Set your price</Text>

            <Text style={st.lbl}>Your asking price *</Text>
            <View style={st.priceRow}>
              <Text style={st.priceCurrencyBig}>₹</Text>
              <TextInput
                style={[st.inp, st.priceInputBig]}
                placeholder="0"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                value={price}
                onChangeText={setPrice}
              />
            </View>

            <Text style={st.lbl}>Original MRP (optional — shows "% off")</Text>
            <View style={st.priceRow}>
              <Text style={st.priceCurrencySmall}>₹</Text>
              <TextInput
                style={[st.inp, st.flex1]}
                placeholder="Price when new"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                value={originalPrice}
                onChangeText={setOriginalPrice}
              />
            </View>

            {originalPrice && price && parseFloat(originalPrice) > parseFloat(price) && (
              <Text style={st.discountHint}>
                {Math.round((1 - parseFloat(price) / parseFloat(originalPrice)) * 100)}% off original price
              </Text>
            )}

            <TouchableOpacity style={st.negoRow} onPress={() => setNego(!nego)}>
              <View style={[st.toggle, nego && st.toggleActive]}>
                <View style={[st.toggleThumb, nego && st.toggleThumbOn]} />
              </View>
              <Text style={st.negoLabel}>Open to negotiation</Text>
            </TouchableOpacity>

            {nego && (
              <>
                <Text style={st.lbl}>Reserve price (optional, hidden from buyers)</Text>
                <View style={st.priceRow}>
                  <Text style={st.priceCurrencySmall}>₹</Text>
                  <TextInput
                    style={[st.inp, st.flex1]}
                    placeholder="Auto-decline offers below this"
                    placeholderTextColor={C.text4}
                    keyboardType="numeric"
                    value={reservePrice}
                    onChangeText={setReservePrice}
                  />
                </View>
                <Text style={st.reserveHint}>
                  Offers below the reserve are politely declined automatically. You won't be pinged for spam.
                </Text>
                {reservePrice && price && parseFloat(reservePrice) > parseFloat(price) ? (
                  <Text style={st.errText}>Reserve can't be higher than your asking price.</Text>
                ) : null}
              </>
            )}

            {/* Review summary */}
            <View style={st.reviewCard}>
              <Text style={st.reviewTitle}>Review</Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.reviewThumbs}>
                {valid.map((u, i) => (
                  <Image key={i} source={{ uri: u }} style={st.reviewThumb} resizeMode="cover" />
                ))}
              </ScrollView>

              {[
                ['Category', cat?.name],
                ['Title', title],
                ['Brand', brand],
                ['Model', model],
                ...(catType === 'phone' ? [['Storage', storage], ['RAM', ram], ['Color', color], ['Battery', batteryHealth ? `${batteryHealth}%` : '']] : []),
                ...(catType === 'laptop' || catType === 'tablet' ? [['Processor', processor], ['RAM', ram], ['Storage', storage], ['Screen', screenSize]] : []),
                ...(categoryFamily === 'toy' ? [
                  ['Age', ageSuitability],
                  ['Cleanliness', hygiene],
                  ['Parts', categorySpecifics.missing_parts_status],
                  ['Safety', categorySpecifics.safety_status],
                ] : []),
                ...(categoryFamily === 'book' ? [
                  ['Book type', categorySpecifics.book_type || model],
                  ['Language', categorySpecifics.language],
                  ['Pages', categorySpecifics.page_condition],
                  ['Markings', categorySpecifics.markings_status],
                  ['Completeness', categorySpecifics.pages_complete],
                ] : []),
                ...(categoryFamily === 'appliance' ? [
                  ['Working', categorySpecifics.working_status],
                  ['Accessories', categorySpecifics.accessories_status],
                  ['Defects', categorySpecifics.defects_disclosed],
                ] : []),
                ['Condition', CONDITION_OPTIONS.find(c => c.key === condition)?.label],
                ['Location', location?.city || 'Not set'],
              ].filter(([, v]) => v).map(([k, v]) => (
                <View key={k as string} style={st.reviewRow}>
                  <Text style={st.reviewKey}>{k}</Text>
                  <Text style={st.reviewVal}>{v}</Text>
                </View>
              ))}

              <Text style={st.reviewPrice}>
                {formatPrice(price)}{nego ? ' · Negotiable' : ''}
              </Text>
            </View>

            <View style={st.bottomSpacer} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ═══ Bottom bar ═══ */}
      <View style={st.bar}>
        {step < 4 ? (
          <Button
            label="Continue"
            variant="primary"
            size="lg"
            disabled={!canProceed()}
            onPress={() => setStep(step + 1)}
            fullWidth
          />
        ) : (
          <Button
            label="Publish listing"
            variant="primary"
            size="lg"
            disabled={busy || !canProceed()}
            loading={busy}
            onPress={submit}
            fullWidth
            style={st.publishBtn}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Includes({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={[st.includesPill, on && st.includesPillOn]} onPress={onToggle} activeOpacity={0.7}>
      <View style={[st.includesBox, on && st.includesBoxOn]}>
        {on && <Text style={st.includesTick}>✓</Text>}
      </View>
      <Text style={[st.includesLbl, on && st.includesLblOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RequirementChoiceGroup({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value?: any;
  options: string[];
  onSelect: (value: string) => void;
}) {
  const selected = value == null ? '' : String(value);
  return (
    <View style={st.requirementGroup}>
      <Text style={st.requirementLabel}>{label}</Text>
      <View style={st.requirementChoices}>
        {options.map(option => {
          const active = selected === option;
          return (
            <TouchableOpacity
              key={option}
              onPress={() => onSelect(option)}
              activeOpacity={0.78}
              style={[st.requirementChip, active && st.requirementChipOn]}
            >
              <Text style={[st.requirementChipText, active && st.requirementChipTextOn]} numberOfLines={2}>
                {option}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SuggestedInput({
  label,
  required = false,
  value,
  onChangeText,
  placeholder,
  suggestions,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  suggestions: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const query = value.trim().toLowerCase();
  const uniqueSuggestions = Array.from(new Set(suggestions));
  const filtered = query
    ? uniqueSuggestions.filter((item) => item.toLowerCase().includes(query))
    : uniqueSuggestions;
  const visible = (expanded ? filtered : filtered.slice(0, 8));

  return (
    <View>
      <Text style={st.lbl}>
        {label}{required ? <Text style={st.req}> *</Text> : null}
      </Text>
      <TextInput
        style={st.inp}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="words"
      />
      {visible.length > 0 ? (
        <View style={st.suggestionWrap}>
          {visible.map((item) => {
            const active = value.trim().toLowerCase() === item.toLowerCase();
            return (
              <TouchableOpacity
                key={item}
                style={[st.suggestionChip, active && st.suggestionChipOn]}
                onPress={() => onChangeText(item)}
                activeOpacity={0.75}
              >
                <Text style={[st.suggestionText, active && st.suggestionTextOn]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
          {filtered.length > 8 ? (
            <TouchableOpacity
              style={st.suggestionMore}
              onPress={() => setExpanded(!expanded)}
              activeOpacity={0.75}
            >
              <Text style={st.suggestionMoreText}>
                {expanded ? 'Less' : `More ${filtered.length - 8}`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  flex1: { flex: 1 },
  bottomSpacer: { height: 100 },
  lblSpaced: { marginTop: S.xl },
  inpMulti: { height: 80 },

  // Step 0 — Photos
  photosCount: {
    fontSize: T.size.sm,
    color: C.text3,
    marginTop: S.md,
    textAlign: 'center',
  },
  pxText: { fontSize: T.size.xs, color: C.white },
  peIcon: { fontSize: T.size.xxl - 2, color: C.text4 },
  peLabel: { fontSize: T.size.xs, color: C.text4 },

  // Step 1 — Category
  catNameActive: { color: C.ctaPrimary },

  // Step 3 — Condition
  condEmoji: { fontSize: T.size.xxl },
  condLabelActive: { color: C.ctaPrimary },
  checkboxTick: { color: C.white, fontSize: T.size.sm },

  // Step 4 — Price + Review
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  priceCurrencyBig: { fontSize: T.size.xxl - 2, fontWeight: T.weight.bold, color: C.text },
  priceCurrencySmall: { fontSize: T.size.sm + 1, color: C.text3 },
  priceInputBig: { flex: 1, fontSize: T.size.xxl - 2, fontWeight: T.weight.bold },
  discountHint: { color: C.ctaPrimary, fontSize: T.size.base, marginTop: S.xs },
  negoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginTop: S.lg,
  },
  negoLabel: { fontSize: T.size.sm + 1, color: C.text },
  reviewCard: {
    marginTop: S.xxl,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    ...Shadow.card,
  },
  reviewTitle: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.md,
  },
  reviewThumbs: { marginBottom: S.md },
  reviewThumb: {
    width: 70,
    height: 70,
    borderRadius: R.xs + 2,
    marginRight: S.sm,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: S.xs,
  },
  reviewKey: { fontSize: T.size.sm, color: C.text4 },
  reviewVal: { fontSize: T.size.sm, color: C.text, fontWeight: T.weight.medium },
  top: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: S.lg, paddingVertical: S.sm,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  topSpacer: { width: 48 },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: S.md },
  dw: { alignItems: 'center', gap: 3 },
  d: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dActive: { backgroundColor: C.ctaPrimary },
  dl: { fontSize: T.size.xs - 1, color: C.text4 },                  // 9
  dlActive: { color: C.ctaPrimary },

  body: { flex: 1, paddingHorizontal: S.lg, paddingTop: S.lg },
  h: { fontSize: T.size.xl, fontWeight: T.weight.bold, color: C.text, marginBottom: S.xs },
  sub: { fontSize: T.size.base, color: C.text3, marginBottom: S.lg },
  lbl: {
    fontSize: T.size.sm, fontWeight: T.weight.semi,
    color: C.text2, marginTop: S.lg, marginBottom: S.xs + 2,
  },
  req: { color: C.ctaPrimary },
  inp: {
    borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.sm + 2,
    fontSize: T.size.sm + 1, color: C.text, backgroundColor: C.surface,
  },
  errText: {
    marginTop: 4,
    fontSize: T.size.sm,
    color: C.red,
  },
  reserveHint: {
    marginTop: 4,
    fontSize: T.size.sm,
    color: C.text3,
  },

  // Functional attestation row — gates publish for electronics (P1.4)
  attestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.md,
    paddingHorizontal: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    marginTop: S.lg,
    gap: S.md,
  },
  attestRowOn: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
    borderWidth: 1.5,
  },
  attestText: {
    flex: 1,
    fontSize: T.size.base,
    color: C.text,
    fontWeight: T.weight.semi,
    lineHeight: T.size.base + 4,
  },

  // What's-in-the-box checkboxes
  includesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginTop: 4,
  },
  includesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    gap: S.sm,
  },
  includesPillOn: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  includesBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: C.text4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  includesBoxOn: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimary,
  },
  includesTick: {
    color: C.surface,
    fontSize: T.size.sm - 1,
    fontWeight: T.weight.heavy,
    lineHeight: 14,
  },
  includesLbl: {
    fontSize: T.size.base,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  includesLblOn: {
    color: C.ctaPrimary,
  },

  // Chips (local helper — TODO migrate to components/ui/Chip)
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: {
    paddingHorizontal: S.md + 2, paddingVertical: S.sm,
    borderRadius: R.pill, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface,
  },
  chipActive: { backgroundColor: C.ctaPrimarySoft, borderColor: C.ctaPrimary },
  chipText: { fontSize: T.size.base, color: C.text2 },
  chipTextActive: { color: C.ctaPrimary, fontWeight: T.weight.semi },
  requirementPanel: {
    marginTop: S.lg,
    padding: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  requirementTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  requirementSub: {
    marginTop: 2,
    marginBottom: S.sm,
    fontSize: T.size.sm,
    color: C.text3,
  },
  requirementMiniTitle: {
    marginTop: S.md,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  requirementGroup: {
    marginTop: S.sm,
  },
  requirementLabel: {
    fontSize: T.size.xs,
    fontWeight: T.weight.bold,
    color: C.text3,
    textTransform: 'uppercase',
    marginBottom: S.xs,
  },
  requirementChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
  },
  requirementChip: {
    minHeight: 34,
    maxWidth: '48%',
    paddingHorizontal: S.sm,
    paddingVertical: 7,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    justifyContent: 'center',
  },
  requirementChipOn: {
    backgroundColor: C.ctaPrimarySoft,
    borderColor: C.ctaPrimary,
  },
  requirementChipText: {
    fontSize: T.size.xs,
    color: C.text2,
    fontWeight: T.weight.semi,
    lineHeight: T.size.xs + 4,
  },
  requirementChipTextOn: {
    color: C.ctaPrimary,
  },
  kidsSafetyBox: {
    marginTop: S.sm,
    paddingTop: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  safetyRow: {
    marginTop: S.sm,
    gap: S.xs,
  },
  safetyLabel: {
    fontSize: T.size.sm,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  safetyChoices: {
    flexDirection: 'row',
    gap: S.xs,
  },
  safetyChoice: {
    minWidth: 64,
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingVertical: 7,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  safetyChoiceOn: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  safetyChoiceText: {
    fontSize: T.size.xs,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  safetyChoiceTextOn: {
    color: C.ctaPrimary,
  },
  suggestionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginTop: S.sm,
  },
  suggestionChip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  suggestionChipOn: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  suggestionText: {
    fontSize: T.size.sm,
    color: C.text2,
    fontWeight: T.weight.medium,
  },
  suggestionTextOn: {
    color: C.ctaPrimary,
    fontWeight: T.weight.semi,
  },
  suggestionMore: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    backgroundColor: C.bone2,
  },
  suggestionMoreText: {
    fontSize: T.size.sm,
    color: C.text2,
    fontWeight: T.weight.semi,
  },

  // Category cards
  catCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: S.lg, marginBottom: S.sm,
    borderRadius: R.md, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface,
  },
  catCardActive: { borderColor: C.ctaPrimary, backgroundColor: C.ctaPrimarySoft },
  catName: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  catTag: {
    fontSize: T.size.xs, color: C.ctaPrimary, fontWeight: T.weight.semi,
    backgroundColor: C.ctaPrimarySoft,
    paddingHorizontal: S.sm, paddingVertical: 2,
    borderRadius: R.xs - 2,
  },

  // Condition cards
  condCard: {
    flexDirection: 'row', alignItems: 'center', gap: S.md,
    padding: S.lg, marginBottom: S.sm,
    borderRadius: R.md, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface,
  },
  condCardActive: { borderColor: C.ctaPrimary, backgroundColor: C.ctaPrimarySoft },
  condLabel: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text },
  condDesc: { fontSize: T.size.sm, color: C.text3, marginTop: 2 },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: C.ctaPrimary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.ctaPrimary },

  // Mini cards (screen/body condition)
  miniCard: {
    padding: S.md, marginBottom: S.xs + 2,
    borderRadius: R.sm, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface,
  },
  miniCardActive: { borderColor: C.ctaPrimary, backgroundColor: C.ctaPrimarySoft },
  miniLabel: { fontSize: T.size.base, fontWeight: T.weight.semi, color: C.text },
  miniDesc: { fontSize: T.size.sm, color: C.text3, marginTop: 2 },

  // Defects
  defectRow: {
    flexDirection: 'row', alignItems: 'center', gap: S.sm + 2,
    padding: S.sm + 2, marginBottom: S.xs,
    borderRadius: R.sm,
  },
  defectActive: { backgroundColor: C.ctaPrimarySoft },
  defectLabel: { fontSize: T.size.base, color: C.text },
  checkbox: {
    width: 20, height: 20, borderRadius: R.xs - 2,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: C.ctaPrimary, borderColor: C.ctaPrimary },

  // Photos
  pg: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  ps: {
    width: '31%' as any, aspectRatio: 1,
    borderRadius: R.sm, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
  },
  pe: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  px: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: O.dark50,
    alignItems: 'center', justifyContent: 'center',
  },

  // Toggle
  toggle: {
    width: 44, height: 24, borderRadius: 12,
    backgroundColor: C.border, justifyContent: 'center', padding: 2,
  },
  toggleActive: { backgroundColor: C.ctaPrimary },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.white },
  toggleThumbOn: { alignSelf: 'flex-end' },
  reviewPrice: {
    fontSize: T.size.xxl - 2,
    fontWeight: T.weight.bold,
    color: C.ctaPrimary,
    marginTop: S.sm,
  },

  // Bottom bar
  bar: {
    paddingHorizontal: S.lg, paddingVertical: S.md,
    backgroundColor: C.surface,
    borderTopWidth: 0.5, borderTopColor: C.border,
  },
  publishBtn: { backgroundColor: C.ctaPrimary },

  // Gate
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xxxl },
  gateEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },   // 48
  gateH: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text, marginBottom: S.lg },
});
