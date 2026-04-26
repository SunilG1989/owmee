/**
 * FE Capture — Sprint 4 / Pass 3
 *
 * Pass 3 changes:
 *   - Category picker loads from /v1/listings/categories and pre-selects by
 *     the visit's category_hint. Drops the "Category selection pending" alert.
 *   - Real photo capture with expo-image-picker / react-native-image-picker
 *     (whichever is installed) → presigned S3 upload → confirm → r2_key
 *     stored locally and passed to submit-listing in image_urls.
 *   - Kids safety checklist renders when the selected category slug matches
 *     kids-utility. Checklist is passed as kids_safety_checklist on submit.
 *
 * Falls back cleanly if image-picker is not installed: a manual placeholder
 * capture path (Pass 2 behaviour) is kept so QA doesn't require the native
 * build to have the picker wired up.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';

import { FE, Listings, FEVisits } from '../../services/api';
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

type OutcomeChoice = 'listed' | 'rejected_item' | 'seller_missing_verification' | 'pickup_not_ready';

const CONDITIONS = ['flawless', 'excellent', 'good', 'fair', 'poor'] as const;
type Condition = typeof CONDITIONS[number];

const PHOTO_PROMPTS = [
  'Front, flat and centered',
  'Back, flat and centered',
  'Side profile (edges & ports)',
  'Screen on (show display)',
  'Close-up of any damage',
];

interface Category {
  id: string;
  name: string;
  slug: string;
  imei_required: boolean;
}

// Canonical kids safety checklist keys — keep in sync with docs/QA_CHECKLIST.md
const KIDS_SAFETY_KEYS: { key: string; label: string }[] = [
  { key: 'cleaned', label: 'Cleaned / sanitised before handover' },
  { key: 'no_small_parts', label: 'No small parts that can be swallowed' },
  { key: 'no_loose_batteries', label: 'No loose or accessible batteries' },
  { key: 'no_sharp_edges', label: 'No sharp edges or broken pieces' },
  { key: 'original_packaging', label: 'Original packaging available' },
  { key: 'working_condition', label: 'Item is in working condition' },
  { key: 'no_recalled_model', label: 'Not a recalled model' },
  { key: 'age_label_correct', label: 'Age suitability label matches listing' },
];

// Pass 3 (post-fix): react-native-image-picker is a hard dependency now.
// Static import above ensures Metro bundles the native bridge correctly.
function tryLoadImagePicker(): any {
  return { launchCamera, launchImageLibrary };
}

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const r = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera access',
        message: 'Owmee FE needs the camera to capture listing photos.',
        buttonPositive: 'OK',
        buttonNegative: 'Cancel',
      },
    );
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function uploadBytesViaPresigned(
  uploadUrl: string,
  localUri: string,
  contentType: string,
): Promise<void> {
  // React Native fetch(file_uri).blob() is unreliable for file:// URIs;
  // use XMLHttpRequest with RN's file-body format. Here we use fetch with
  // a direct body read: on RN, passing { uri, type, name } to FormData
  // works, but presigned PUT needs the raw bytes — so we use XHR.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.timeout = 60000;
    // On RN, passing the uri directly in send() works for most file:// URIs.
    // For maximum compatibility, use FormData path as a fallback below.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — RN's send accepts { uri } for file bodies
    xhr.send({ uri: localUri, type: contentType, name: 'photo.jpg' });
  });
}

interface CapturedPhoto {
  uri: string;        // local file uri for preview
  r2Key: string;      // server-side key after confirm
  publicUrl?: string; // server-computed public URL
}

export default function FeCaptureScreen({ route, navigation }: RootScreen<'FeCapture'>) {
  const { visitId } = route.params;

  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [ram, setRam] = useState('');
  const [color, setColor] = useState('');
  const [purchaseYear, setPurchaseYear] = useState('');
  const [screenCondition, setScreenCondition] = useState<Condition>('excellent');
  const [bodyCondition, setBodyCondition] = useState<Condition>('excellent');
  const [priceRupees, setPriceRupees] = useState('');
  const [accessories, setAccessories] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');
  const [batteryHealth, setBatteryHealth] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');

  // Category state
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCategorySlug, setSelectedCategorySlug] = useState<string | null>(null);
  const [cityOfVisit, setCityOfVisit] = useState<string>('');
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Kids checklist
  const [kidsChecklist, setKidsChecklist] = useState<Record<string, boolean>>({});

  // Photos — captured = uploaded + confirmed
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const isKidsCategory = selectedCategorySlug === 'kids-utility';

  // Load categories + visit detail (for city and category_hint matching) on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catsRes, mineRes] = await Promise.all([
          Listings.categories(),
          FEVisits.mine(),
        ]);
        if (cancelled) return;
        const cats: Category[] = catsRes.data?.categories || [];
        setCategories(cats);

        const myVisits: any[] = mineRes.data || [];
        const thisVisit = myVisits.find((v) => v.id === visitId);

        if (thisVisit) {
          if (thisVisit.address?.city) {
            setCityOfVisit(thisVisit.address.city);
          }
          // If the admin already locked a category on assign, use it.
          if (thisVisit.category_id) {
            const cat = cats.find((c) => c.id === thisVisit.category_id);
            if (cat) {
              setSelectedCategoryId(cat.id);
              setSelectedCategorySlug(cat.slug);
            }
          } else if (thisVisit.category_hint) {
            // Fuzzy-match category_hint against names and slugs
            const hint = String(thisVisit.category_hint).toLowerCase();
            const cat =
              cats.find((c) => c.slug.toLowerCase() === hint) ||
              cats.find((c) => c.name.toLowerCase() === hint) ||
              cats.find((c) => c.slug.toLowerCase().includes(hint)) ||
              cats.find((c) => c.name.toLowerCase().includes(hint));
            if (cat) {
              setSelectedCategoryId(cat.id);
              setSelectedCategorySlug(cat.slug);
            }
          }
        }
      } catch (e) {
        // Non-fatal; FE can still pick category manually.
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visitId]);

  const selectCategory = (cat: Category) => {
    setSelectedCategoryId(cat.id);
    setSelectedCategorySlug(cat.slug);
  };

  const capturePhoto = async (slotIndex: number) => {
    const imagePicker = tryLoadImagePicker();
    if (!imagePicker) {
      // Fallback: create a placeholder so QA can proceed even without
      // the native module. The backend will still accept the r2_key if a
      // real upload happens; placeholder URIs are only useful for UI.
      Alert.alert(
        'Camera module not installed',
        'Install react-native-image-picker or expo-image-picker. Using placeholder photo for now.',
      );
      const placeholder: CapturedPhoto = {
        uri: `placeholder://${visitId}/${slotIndex}`,
        r2Key: `fe-visits/${visitId}/placeholder-${slotIndex}`,
      };
      setPhotos((prev) => {
        const next = [...prev];
        next[slotIndex] = placeholder;
        return next;
      });
      return;
    }

    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert(
        'Camera permission required',
        'Grant camera permission in settings to capture listing photos.',
      );
      return;
    }

    setUploadingSlot(slotIndex);
    try {
      let localUri: string | null = null;

      // react-native-image-picker has launchCamera(options, callback) and launchCameraAsync
      if (typeof imagePicker.launchCamera === 'function') {
        const result = await new Promise<any>((resolve) => {
          imagePicker.launchCamera(
            {
              mediaType: 'photo',
              quality: 0.7,
              saveToPhotos: false,
              includeBase64: false,
            },
            (r: any) => resolve(r),
          );
        });
        if (result?.didCancel) { setUploadingSlot(null); return; }
        localUri = result?.assets?.[0]?.uri || null;
      } else if (typeof imagePicker.launchCameraAsync === 'function') {
        const result = await imagePicker.launchCameraAsync({
          mediaTypes: imagePicker.MediaTypeOptions?.Images ?? 'Images',
          quality: 0.7,
        });
        if (result?.canceled) { setUploadingSlot(null); return; }
        localUri = result?.assets?.[0]?.uri || result?.uri || null;
      }

      if (!localUri) {
        setUploadingSlot(null);
        Alert.alert('No photo captured', 'Please try again.');
        return;
      }

      // 1. Request presigned URL
      const presign = await FE.requestVisitImage(visitId, 'image/jpeg', slotIndex);
      const { upload_url, r2_key } = presign.data || {};
      if (!upload_url || !r2_key) {
        throw new Error('Bad presign response');
      }

      // 2. PUT bytes to S3
      await uploadBytesViaPresigned(upload_url, localUri, 'image/jpeg');

      // 3. Confirm
      const confirmed = await FE.confirmVisitImage(visitId, r2_key, slotIndex);
      const publicUrl = confirmed.data?.public_url;

      const captured: CapturedPhoto = {
        uri: localUri,
        r2Key: r2_key,
        publicUrl,
      };
      setPhotos((prev) => {
        const next = [...prev];
        next[slotIndex] = captured;
        return next;
      });
    } catch (e: any) {
      Alert.alert(
        'Photo upload failed',
        e?.response?.data?.detail?.message || e?.message || 'Please try again.',
      );
    } finally {
      setUploadingSlot(null);
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      next[idx] = undefined as any;
      return next.filter(Boolean);
    });
  };

  const photosCount = useMemo(() => photos.filter(Boolean).length, [photos]);

  const canSubmit = useMemo(() => {
    if (!title.trim() || !brand.trim() || !model.trim()) return false;
    if (!selectedCategoryId) return false;
    const p = parseFloat(priceRupees);
    if (!isFinite(p) || p <= 0) return false;
    if (photosCount < 3) return false;
    return true;
  }, [title, brand, model, priceRupees, photosCount, selectedCategoryId]);

  const submitListing = async () => {
    if (!canSubmit) {
      Alert.alert(
        'Incomplete',
        'Category, title, brand, model, price, and at least 3 photos are required.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = {
        title: title.trim(),
        category_id: selectedCategoryId,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        storage: storage.trim() || undefined,
        ram: ram.trim() || undefined,
        color: color.trim() || undefined,
        purchase_year: purchaseYear ? parseInt(purchaseYear, 10) : undefined,
        screen_condition: screenCondition,
        body_condition: bodyCondition,
        price: parseFloat(priceRupees),
        accessories: accessories.trim() || undefined,
        warranty_info: warrantyInfo.trim() || undefined,
        battery_health: batteryHealth ? parseInt(batteryHealth, 10) : undefined,
        serial_number: serialNumber.trim() || undefined,
        condition: screenCondition,   // listing.condition mirrors screen for now
        image_urls: photos.filter(Boolean).map((p) => p.r2Key),
        city: cityOfVisit || 'Bengaluru',
        description: notes.trim() || undefined,
        is_kids_item: isKidsCategory,
      };
      if (isKidsCategory) {
        payload.kids_safety_checklist = kidsChecklist;
      }

      await FE.submitListing(visitId, payload);
      Alert.alert(
        'Listing submitted',
        'The listing is queued for ops review. You’ll see it appear in the seller’s account shortly.',
        [{ text: 'Done', onPress: () => navigation.navigate('FeHome') }],
      );
    } catch (e: any) {
      Alert.alert(
        'Submit failed',
        e?.response?.data?.detail?.message || 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitNonListedOutcome = async (outcome: OutcomeChoice, label: string) => {
    Alert.alert(
      'Confirm outcome',
      `Mark this visit as "${label}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await FE.submitOutcome(visitId, outcome, notes || undefined);
              navigation.navigate('FeHome');
            } catch (e: any) {
              Alert.alert('Failed', e?.response?.data?.detail?.message || 'Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  if (loadingMeta) {
    return (
      <SafeAreaView style={st.root} edges={['top']}>
        <View style={st.center}>
          <ActivityIndicator color={C.honey} />
          <Text style={{ color: C.text3, marginTop: 8 }}>Loading visit…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.back}>‹</Text>
        </TouchableOpacity>
        <Text style={st.h1}>Capture listing</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 180 }}>
          {/* Category */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Category</Text>
            {selectedCategoryId ? (
              <Text style={st.sectionHint}>
                Locked at assignment · {categories.find(c => c.id === selectedCategoryId)?.name || '—'}
              </Text>
            ) : (
              <Text style={st.sectionHint}>Choose the category that best matches the item.</Text>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: S.sm }}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => selectCategory(cat)}
                  style={[st.chip, selectedCategoryId === cat.id && st.chipActive]}
                >
                  <Text style={[st.chipText, selectedCategoryId === cat.id && st.chipTextActive]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Photos */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Photos ({photosCount}/5)</Text>
            <Text style={st.sectionHint}>Take one photo per prompt. Minimum 3.</Text>
            {PHOTO_PROMPTS.map((prompt, i) => (
              <View key={i} style={st.photoRow}>
                <Text style={st.photoLabel}>{i + 1}. {prompt}</Text>
                {photos[i] ? (
                  <TouchableOpacity onPress={() => removePhoto(i)} style={st.photoTakenBtn}>
                    <Text style={st.photoTakenText}>✓ Captured · tap to retake</Text>
                  </TouchableOpacity>
                ) : uploadingSlot === i ? (
                  <View style={[st.photoAddBtn, { opacity: 0.6 }]}>
                    <ActivityIndicator color={C.honey} />
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => capturePhoto(i)} style={st.photoAddBtn}>
                    <Text style={st.photoAddText}>+ Capture</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          {/* Basic info */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Basic info</Text>
            <LabeledInput label="Listing title" value={title} onChangeText={setTitle} placeholder="e.g. iPhone 13 (128GB) — Midnight" />
            <LabeledInput label="Brand" value={brand} onChangeText={setBrand} placeholder="Apple, Samsung, Dell…" />
            <LabeledInput label="Model" value={model} onChangeText={setModel} placeholder="iPhone 13, Galaxy S22…" />
            <LabeledInput label="Storage" value={storage} onChangeText={setStorage} placeholder="128GB" />
            <LabeledInput label="RAM" value={ram} onChangeText={setRam} placeholder="8GB" />
            <LabeledInput label="Color" value={color} onChangeText={setColor} placeholder="Midnight" />
            <LabeledInput label="Purchase year" value={purchaseYear} onChangeText={setPurchaseYear} placeholder="2023" keyboardType="number-pad" />
          </View>

          {/* Condition */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Condition</Text>
            <ChoiceRow label="Screen" value={screenCondition} options={CONDITIONS} onChange={setScreenCondition} />
            <ChoiceRow label="Body" value={bodyCondition} options={CONDITIONS} onChange={setBodyCondition} />
            <LabeledInput label="Battery health %" value={batteryHealth} onChangeText={setBatteryHealth} placeholder="85" keyboardType="number-pad" />
          </View>

          {/* Extras */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Accessories & price</Text>
            <LabeledInput label="Accessories" value={accessories} onChangeText={setAccessories} placeholder="Box, charger, warranty card" />
            <LabeledInput label="Warranty" value={warrantyInfo} onChangeText={setWarrantyInfo} placeholder="4 months left" />
            <LabeledInput label="Serial / IMEI" value={serialNumber} onChangeText={setSerialNumber} placeholder="Optional" />
            <LabeledInput label="Asking price (₹)" value={priceRupees} onChangeText={setPriceRupees} placeholder="35000" keyboardType="number-pad" />
          </View>

          {/* Kids safety checklist */}
          {isKidsCategory && (
            <View style={st.section}>
              <Text style={st.sectionTitle}>Kids safety checklist</Text>
              <Text style={st.sectionHint}>Check every item you have personally verified.</Text>
              {KIDS_SAFETY_KEYS.map(({ key, label }) => {
                const checked = !!kidsChecklist[key];
                return (
                  <TouchableOpacity
                    key={key}
                    style={st.checklistRow}
                    onPress={() => setKidsChecklist({ ...kidsChecklist, [key]: !checked })}
                  >
                    <View style={[st.checkbox, checked && st.checkboxChecked]}>
                      {checked ? <Text style={st.checkMark}>✓</Text> : null}
                    </View>
                    <Text style={st.checklistLabel}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Notes */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>FE notes</Text>
            <TextInput
              style={[st.input, { minHeight: 80, textAlignVertical: 'top' }]}
              multiline
              placeholder="Anything ops should know about this visit…"
              placeholderTextColor={C.text3}
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          {/* Alternate outcomes */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Cannot list?</Text>
            <OutcomeBtn
              label="Item not in listable condition"
              onPress={() => submitNonListedOutcome('rejected_item', 'item rejected')}
            />
            <OutcomeBtn
              label="Seller hasn't completed KYC"
              onPress={() => submitNonListedOutcome('seller_missing_verification', 'seller not verified')}
            />
            <OutcomeBtn
              label="Seller / item not available at pickup"
              onPress={() => submitNonListedOutcome('pickup_not_ready', 'pickup not ready')}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={st.footer}>
        <TouchableOpacity
          style={[st.primaryBtn, (!canSubmit || submitting) && { opacity: 0.5 }]}
          onPress={submitListing}
          disabled={!canSubmit || submitting}
        >
          <Text style={st.primaryBtnText}>
            {submitting ? 'Submitting…' : 'Submit listing'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function LabeledInput(props: { label: string; value: string; onChangeText: (s: string) => void; placeholder?: string; keyboardType?: any }) {
  return (
    <View style={{ marginBottom: S.md }}>
      <Text style={st.inputLabel}>{props.label}</Text>
      <TextInput
        style={st.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={C.text3}
        keyboardType={props.keyboardType}
      />
    </View>
  );
}

function ChoiceRow<TT extends string>({
  label, value, options, onChange,
}: {
  label: string; value: TT; options: readonly TT[]; onChange: (v: TT) => void;
}) {
  return (
    <View style={{ marginBottom: S.md }}>
      <Text style={st.inputLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[st.chip, value === opt && st.chipActive]}
          >
            <Text style={[st.chipText, value === opt && st.chipTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function OutcomeBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={st.outcomeBtn} onPress={onPress}>
      <Text style={st.outcomeBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg, backgroundColor: C.cream },
  back: { fontSize: 28, color: C.text, paddingHorizontal: S.xs },
  h1: { fontSize: T.h3, fontWeight: '600', color: C.text },
  section: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.md, ...Shadow.glow },
  sectionTitle: { fontSize: T.h3, fontWeight: '600', color: C.text, marginBottom: S.xs },
  sectionHint: { fontSize: T.small, color: C.text3, marginBottom: S.md },
  photoRow: { marginBottom: S.sm },
  photoLabel: { fontSize: T.body, color: C.text2, marginBottom: 4 },
  photoAddBtn: { padding: S.md, backgroundColor: C.honeyLight, borderRadius: R.md, borderWidth: 1, borderColor: C.honey, borderStyle: 'dashed', alignItems: 'center' },
  photoAddText: { color: C.honeyText, fontWeight: '600', textAlign: 'center' },
  photoTakenBtn: { padding: S.md, backgroundColor: '#E6F5EC', borderRadius: R.md },
  photoTakenText: { color: '#1F6B3A', fontWeight: '600', textAlign: 'center' },
  inputLabel: { fontSize: T.small, color: C.text3, fontWeight: '600', marginBottom: 4 },
  input: { backgroundColor: C.cream, borderRadius: R.md, padding: S.md, fontSize: T.body, color: C.text, borderWidth: 1, borderColor: C.border },
  chip: { paddingHorizontal: S.md, paddingVertical: 6, borderRadius: R.pill, backgroundColor: C.cream, borderWidth: 1, borderColor: C.border, marginRight: S.sm, marginBottom: S.sm },
  chipActive: { backgroundColor: C.honey, borderColor: C.honey },
  chipText: { color: C.text2, fontSize: T.small, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  outcomeBtn: { padding: S.md, backgroundColor: C.sand, borderRadius: R.md, marginTop: S.sm },
  outcomeBtnText: { color: C.text2, fontWeight: '500' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.cream, borderTopWidth: 1, borderTopColor: C.border },
  primaryBtn: { backgroundColor: C.honey, paddingVertical: S.md, borderRadius: R.md, alignItems: 'center', ...Shadow.glow },
  primaryBtnText: { color: '#fff', fontSize: T.body, fontWeight: '700' },
  checklistRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    marginRight: S.md,
    backgroundColor: C.cream,
  },
  checkboxChecked: { backgroundColor: C.honey, borderColor: C.honey },
  checkMark: { color: '#fff', fontWeight: '700', fontSize: 14 },
  checklistLabel: { flex: 1, color: C.text2, fontSize: T.small },
});
