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
import { C, T, S, R, Shadow, formatPrice } from '../../utils/tokens';
import { Listings } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useLocation } from '../../hooks/useLocation';

// ── Reference data ───────────────────────────────────────────────
const PHONE_BRANDS = ['Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Vivo', 'Oppo', 'Realme', 'Google', 'Nothing', 'Motorola', 'Other'];
const LAPTOP_BRANDS = ['Apple', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Samsung', 'Microsoft', 'Other'];
const APPLIANCE_BRANDS = ['Samsung', 'LG', 'Whirlpool', 'Bosch', 'Philips', 'Bajaj', 'Havells', 'Prestige', 'Dyson', 'Other'];

const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'];
const RAM_OPTIONS = ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '32GB'];
const COLORS = ['Black', 'White', 'Silver', 'Gold', 'Blue', 'Green', 'Red', 'Purple', 'Other'];
const SCREEN_SIZES = ['11"', '13"', '14"', '15.6"', '16"', '17"'];
const PROCESSORS = ['Apple M1', 'Apple M2', 'Apple M3', 'Intel i3', 'Intel i5', 'Intel i7', 'Intel i9', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Other'];

const DEFECT_OPTIONS = [
  { key: 'dead_pixels', label: 'Dead pixels on screen' },
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

const BODY_CONDITIONS = [
  { key: 'flawless', label: 'Flawless', desc: 'No dents or scratches' },
  { key: 'minor_dents', label: 'Minor wear', desc: 'Small dents or scratches' },
  { key: 'major_damage', label: 'Major damage', desc: 'Significant dents or cracks' },
];

const PURCHASE_YEARS = Array.from({ length: 8 }, (_, i) => 2026 - i);

const KIDS_AGE_RANGES = ['0-1 year', '1-3 years', '3-5 years', '5-8 years', '8-12 years', '12+ years'];
const HYGIENE_OPTIONS = ['Cleaned and sanitised', 'Gently used', 'Needs cleaning'];

type Category = { id: string; slug: string; name: string; imei_required?: boolean };

// ── Helper: get category type ────────────────────────────────────
function getCatType(slug: string): 'phone' | 'laptop' | 'appliance' | 'kids' | 'generic' {
  if (slug === 'smartphones') return 'phone';
  if (slug === 'laptops' || slug === 'tablets') return 'laptop';
  if (slug === 'small-appliances') return 'appliance';
  if (slug === 'kids-utility') return 'kids';
  return 'generic';
}

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
  const [desc, setDesc] = useState('');
  const [condition, setCondition] = useState('');
  const [price, setPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [nego, setNego] = useState(true);

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

  // Fetch categories
  useEffect(() => {
    Listings.categories().then(res => {
      setCategories(res.data?.categories || []);
    }).catch(() => {});
  }, []);

  // Auth gate
  if (!isAuthenticated) return (
    <SafeAreaView style={st.safe}>
      <View style={st.gate}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🔐</Text>
        <Text style={st.gateH}>Sign in to sell</Text>
        <TouchableOpacity style={st.gateBtn} onPress={() => navigation.getParent()?.navigate('AuthFlow')}>
          <Text style={{ fontSize: 14, color: '#fff', fontWeight: '600' }}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const valid = photos.filter(Boolean) as string[];
  const catType = cat ? getCatType(cat.slug) : 'generic';

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

  // Auto-generate title from brand + model
  useEffect(() => {
    if (brand && model && !title) {
      setTitle(`${brand} ${model}`);
    }
  }, [brand, model]);

  const submit = async () => {
    setBusy(true);
    try {
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
        battery_health: batteryHealth ? parseInt(batteryHealth) : undefined,
        age_suitability: ageSuitability || undefined,
        hygiene_status: hygiene || undefined,
        is_kids_item: catType === 'kids',
      });
      const lid = res.data.listing_id || res.data.id;

      // Upload images (3-step: request presigned URL → PUT file → confirm)
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
        } catch (imgErr: any) {
          // Fix #9: Surface actual error — not generic message
          const status = imgErr?.message?.match(/Upload (\d+)/)?.[1];
          const detail = status === '403' ? 'Presigned URL expired — try again'
            : status === '413' ? 'Photo too large — use a smaller image'
            : imgErr?.message === 'Upload network error' ? 'Network error — check WiFi'
            : `Upload failed (${status || 'unknown'})`;
          console.warn('Image upload failed for index', i, imgErr);
          Alert.alert('Photo upload failed', `Photo ${i + 1}: ${detail}`);
        }
      }

      await Listings.publish(lid);
      Alert.alert('Listed! 🎉', 'Your item is now live.', [
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
    if (step === 2) return title.length >= 3;
    if (step === 3) return !!condition;
    if (step === 4) return !!price && parseFloat(price) > 0;
    return true;
  };

  return (
    <SafeAreaView style={st.safe}>
      {/* Header with step dots */}
      <View style={st.top}>
        <TouchableOpacity onPress={() => step > 0 ? setStep(step - 1) : navigation.goBack()}>
          <Text style={{ fontSize: 20, color: C.text2 }}>←</Text>
        </TouchableOpacity>
        <View style={st.dots}>
          {steps.map((l, i) => (
            <View key={i} style={st.dw}>
              <View style={[st.d, i <= step && { backgroundColor: C.honey }]} />
              <Text style={[st.dl, i <= step && { color: C.honey }]}>{l}</Text>
            </View>
          ))}
        </View>
        <View style={{ width: 24 }} />
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
                    <View style={st.px}><Text style={{ fontSize: 10, color: '#fff' }}>✕</Text></View>
                  </>
                ) : (
                  <View style={st.pe}>
                    <Text style={{ fontSize: 22, color: C.text4 }}>+</Text>
                    <Text style={{ fontSize: 10, color: C.text4 }}>{['Front', 'Back', 'Detail', 'Accessories', 'Box', 'Extra'][i]}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontSize: T.size.sm, color: C.text3, marginTop: 12, textAlign: 'center' }}>
            {valid.length}/6 · {valid.length < 3 ? `${3 - valid.length} more needed` : '✓ Ready'}
          </Text>
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* ═══ STEP 1: Category ═══ */}
      {step === 1 && (
        <ScrollView style={st.body}>
          <Text style={st.h}>What are you selling?</Text>
          <Text style={st.sub}>Choose a category</Text>
          {categories.map(c => (
            <TouchableOpacity key={c.id} style={[st.catCard, cat?.id === c.id && st.catCardActive]} onPress={() => setCat(c)}>
              <Text style={[st.catName, cat?.id === c.id && { color: C.honeyDeep }]}>{c.name}</Text>
              {c.imei_required && <Text style={st.catTag}>IMEI required</Text>}
            </TouchableOpacity>
          ))}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* ═══ STEP 2: Category-specific details ═══ */}
      {step === 2 && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={st.body}>
            <Text style={st.h}>Product details</Text>

            {/* ── Smartphones ── */}
            {catType === 'phone' && (
              <>
                <Text style={st.lbl}>Brand *</Text>
                <Chips options={PHONE_BRANDS} selected={brand} onSelect={setBrand} />
                <Text style={st.lbl}>Model *</Text>
                <TextInput style={st.inp} placeholder="e.g. iPhone 15 Pro, Galaxy S24" placeholderTextColor={C.text4} value={model} onChangeText={setModel} />
                <Text style={st.lbl}>Storage</Text>
                <Chips options={STORAGE_OPTIONS} selected={storage} onSelect={setStorage} />
                <Text style={st.lbl}>Color</Text>
                <Chips options={COLORS} selected={color} onSelect={setColor} />
                <Text style={st.lbl}>IMEI *  (dial *#06#)</Text>
                <TextInput style={st.inp} placeholder="15-digit IMEI number" placeholderTextColor={C.text4} value={imei} onChangeText={setImei} keyboardType="numeric" maxLength={17} />
                <Text style={st.lbl}>Battery Health (%)</Text>
                <TextInput style={st.inp} placeholder="e.g. 87" placeholderTextColor={C.text4} value={batteryHealth} onChangeText={setBatteryHealth} keyboardType="numeric" maxLength={3} />
              </>
            )}

            {/* ── Laptops/Tablets ── */}
            {catType === 'laptop' && (
              <>
                <Text style={st.lbl}>Brand *</Text>
                <Chips options={LAPTOP_BRANDS} selected={brand} onSelect={setBrand} />
                <Text style={st.lbl}>Model *</Text>
                <TextInput style={st.inp} placeholder="e.g. MacBook Air M2, ThinkPad X1" placeholderTextColor={C.text4} value={model} onChangeText={setModel} />
                <Text style={st.lbl}>Processor</Text>
                <Chips options={PROCESSORS} selected={processor} onSelect={setProcessor} />
                <Text style={st.lbl}>RAM</Text>
                <Chips options={RAM_OPTIONS} selected={ram} onSelect={setRam} />
                <Text style={st.lbl}>Storage</Text>
                <Chips options={STORAGE_OPTIONS} selected={storage} onSelect={setStorage} />
                <Text style={st.lbl}>Screen Size</Text>
                <Chips options={SCREEN_SIZES} selected={screenSize} onSelect={setScreenSize} />
                <Text style={st.lbl}>Serial Number</Text>
                <TextInput style={st.inp} placeholder="Found in Settings → About" placeholderTextColor={C.text4} value={serialNumber} onChangeText={setSerialNumber} />
              </>
            )}

            {/* ── Small Appliances ── */}
            {catType === 'appliance' && (
              <>
                <Text style={st.lbl}>Brand</Text>
                <Chips options={APPLIANCE_BRANDS} selected={brand} onSelect={setBrand} />
                <Text style={st.lbl}>Model / Product name *</Text>
                <TextInput style={st.inp} placeholder="e.g. Air Purifier XF-200" placeholderTextColor={C.text4} value={model} onChangeText={setModel} />
              </>
            )}

            {/* ── Kids ── */}
            {catType === 'kids' && (
              <>
                <Text style={st.lbl}>Age Suitability</Text>
                <Chips options={KIDS_AGE_RANGES} selected={ageSuitability} onSelect={setAgeSuitability} />
                <Text style={st.lbl}>Hygiene Status</Text>
                <Chips options={HYGIENE_OPTIONS} selected={hygiene} onSelect={setHygiene} />
              </>
            )}

            {/* Common: Title */}
            <Text style={st.lbl}>Listing Title *</Text>
            <TextInput style={st.inp} placeholder={catType === 'phone' ? 'Auto-filled from brand + model' : 'What are you selling?'} placeholderTextColor={C.text4} value={title} onChangeText={setTitle} maxLength={200} />
            <Text style={st.lbl}>Description</Text>
            <TextInput style={[st.inp, { height: 80 }]} placeholder="Anything a buyer should know — what's included, any issues" placeholderTextColor={C.text4} value={desc} onChangeText={setDesc} multiline textAlignVertical="top" />

            {/* Purchase year */}
            <Text style={st.lbl}>Purchase Year</Text>
            <Chips options={PURCHASE_YEARS.map(String)} selected={purchaseYear ? String(purchaseYear) : ''} onSelect={v => setPurchaseYear(parseInt(v))} />

            <View style={{ height: 100 }} />
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
              <Text style={{ fontSize: 24 }}>{c.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.condLabel, condition === c.key && { color: C.honeyDeep }]}>{c.label}</Text>
                <Text style={st.condDesc}>{c.desc}</Text>
              </View>
              <View style={[st.radio, condition === c.key && st.radioActive]}>
                {condition === c.key && <View style={st.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}

          {/* Screen + body condition for electronics */}
          {(catType === 'phone' || catType === 'laptop') && (
            <>
              <Text style={[st.lbl, { marginTop: 20 }]}>Screen Condition</Text>
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
                    {defects.includes(d.key) && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                  </View>
                  <Text style={st.defectLabel}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {/* Accessories + Warranty */}
          <Text style={[st.lbl, { marginTop: 20 }]}>Accessories included</Text>
          <TextInput style={st.inp} placeholder="e.g. Charger, box, case, earphones" placeholderTextColor={C.text4} value={accessories} onChangeText={setAccessories} />
          <Text style={st.lbl}>Warranty</Text>
          <TextInput style={st.inp} placeholder="e.g. 3 months remaining, No warranty" placeholderTextColor={C.text4} value={warrantyInfo} onChangeText={setWarrantyInfo} />

          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* ═══ STEP 4: Price + Review ═══ */}
      {step === 4 && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={st.body}>
            <Text style={st.h}>Set your price</Text>

            <Text style={st.lbl}>Your asking price *</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: C.text }}>₹</Text>
              <TextInput style={[st.inp, { flex: 1, fontSize: 22, fontWeight: '700' }]} placeholder="0" placeholderTextColor={C.text4} keyboardType="numeric" value={price} onChangeText={setPrice} />
            </View>

            <Text style={st.lbl}>Original MRP (optional — shows "% off")</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 14, color: C.text3 }}>₹</Text>
              <TextInput style={[st.inp, { flex: 1 }]} placeholder="Price when new" placeholderTextColor={C.text4} keyboardType="numeric" value={originalPrice} onChangeText={setOriginalPrice} />
            </View>

            {originalPrice && price && parseFloat(originalPrice) > parseFloat(price) && (
              <Text style={{ color: C.forest, fontSize: 13, marginTop: 4 }}>
                {Math.round((1 - parseFloat(price) / parseFloat(originalPrice)) * 100)}% off original price
              </Text>
            )}

            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }} onPress={() => setNego(!nego)}>
              <View style={[st.toggle, nego && { backgroundColor: C.honey }]}>
                <View style={[st.toggleThumb, nego && { alignSelf: 'flex-end' }]} />
              </View>
              <Text style={{ fontSize: 14, color: C.text }}>Open to negotiation</Text>
            </TouchableOpacity>

            {/* Review summary */}
            <View style={{ marginTop: 24, backgroundColor: C.surface, borderRadius: R.lg, padding: 16, ...Shadow.card }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 12 }}>Review</Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {valid.map((u, i) => <Image key={i} source={{ uri: u }} style={{ width: 70, height: 70, borderRadius: 8, marginRight: 8 }} resizeMode="cover" />)}
              </ScrollView>

              {[
                ['Category', cat?.name],
                ['Title', title],
                ['Brand', brand],
                ['Model', model],
                ...(catType === 'phone' ? [['Storage', storage], ['Color', color], ['Battery', batteryHealth ? `${batteryHealth}%` : '']] : []),
                ...(catType === 'laptop' ? [['Processor', processor], ['RAM', ram], ['Screen', screenSize]] : []),
                ['Condition', CONDITION_OPTIONS.find(c => c.key === condition)?.label],
                ['Location', location?.city || 'Not set'],
              ].filter(([, v]) => v).map(([k, v]) => (
                <View key={k as string} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: C.text4 }}>{k}</Text>
                  <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>{v}</Text>
                </View>
              ))}

              <Text style={{ fontSize: 22, fontWeight: '700', color: C.honey, marginTop: 8 }}>
                {formatPrice(price)}{nego ? ' · Negotiable' : ''}
              </Text>
            </View>

            <View style={{ height: 100 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ═══ Bottom bar ═══ */}
      <View style={st.bar}>
        {step < 4 ? (
          <TouchableOpacity
            style={[st.btn, !canProceed() && { opacity: 0.4 }]}
            disabled={!canProceed()}
            onPress={() => setStep(step + 1)}
          >
            <Text style={st.btnT}>Continue</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[st.btn, { backgroundColor: C.ink }, (busy || !canProceed()) && { opacity: 0.4 }]}
            disabled={busy || !canProceed()}
            onPress={submit}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnT}>Publish listing</Text>}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  dw: { alignItems: 'center', gap: 3 },
  d: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dl: { fontSize: 9, color: C.text4 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  h: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 },
  sub: { fontSize: 13, color: C.text3, marginBottom: 16 },
  lbl: { fontSize: 12, fontWeight: '600', color: C.text2, marginTop: 16, marginBottom: 6 },
  inp: { borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text, backgroundColor: C.surface },
  // Chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  chipActive: { backgroundColor: C.honeyLight, borderColor: C.honey },
  chipText: { fontSize: 13, color: C.text2 },
  chipTextActive: { color: C.honeyDeep, fontWeight: '600' },
  // Category cards
  catCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginBottom: 8, borderRadius: R.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  catCardActive: { borderColor: C.honey, backgroundColor: C.honeyLight },
  catName: { fontSize: 16, fontWeight: '600', color: C.text },
  catTag: { fontSize: 10, color: C.amber, fontWeight: '600', backgroundColor: C.amberLight || '#FFF8E7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  // Condition cards
  condCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginBottom: 8, borderRadius: R.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  condCardActive: { borderColor: C.honey, backgroundColor: C.honeyLight },
  condLabel: { fontSize: 15, fontWeight: '600', color: C.text },
  condDesc: { fontSize: 12, color: C.text3, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: C.honey },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.honey },
  // Mini cards (screen/body condition)
  miniCard: { padding: 12, marginBottom: 6, borderRadius: R.sm, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  miniCardActive: { borderColor: C.honey, backgroundColor: C.honeyLight },
  miniLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  miniDesc: { fontSize: 11, color: C.text3, marginTop: 2 },
  // Defects
  defectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginBottom: 4, borderRadius: R.sm },
  defectActive: { backgroundColor: '#FFF3E0' },
  defectLabel: { fontSize: 13, color: C.text },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: C.honey, borderColor: C.honey },
  // Photos
  pg: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ps: { width: '31%' as any, aspectRatio: 1, borderRadius: R.sm, overflow: 'hidden', borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' },
  pe: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  px: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  // Toggle
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: C.border, justifyContent: 'center', padding: 2 },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  // Bottom bar
  bar: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderTopWidth: 0.5, borderTopColor: C.border },
  btn: { backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 14, alignItems: 'center' },
  btnT: { fontSize: 15, color: '#fff', fontWeight: '600' },
  // Gate
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  gateH: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 16 },
  gateBtn: { backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: 24, paddingVertical: 12 },
});
