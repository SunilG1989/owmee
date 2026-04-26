/**
 * CreateListingScreen
 * 3-step listing flow: Photos → Details → Price & publish
 *
 * India UX (from review):
 * - Each photo slot labelled: Front / Back / Sides / Box / Screen
 * - "4+ photos sell faster" nudge
 * - "Condition affects buyer trust" helper text
 * - AI price suggestion in B-style dark card
 * - is_negotiable toggle — default open
 * - Minimum 3 photos enforced (backend also enforces this)
 * - Category-specific fields (battery_health for electronics, age_suitability for kids)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Alert, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import { Listings } from '../../services/api';
import type { Category } from '../../services/api';

type Step = 1 | 2 | 3;
const CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;
const CONDITION_LABELS: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair' };
const PHOTO_SLOTS = ['Front view', 'Back', 'Sides', 'Box / accessories', 'Screen'];

export default function CreateListingScreen() {
  const navigation = useNavigation();

  const [step, setStep] = useState<Step>(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);

  // Form state
  const [photos, setPhotos] = useState<Array<{ uri: string; r2_key?: string }>>([]);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState<typeof CONDITIONS[number]>('like_new');
  const [city, setCity] = useState('');
  const [locality, setLocality] = useState('');
  const [accessories, setAccessories] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');
  const [batteryHealth, setBatteryHealth] = useState('');
  const [isKidsItem, setIsKidsItem] = useState(false);
  const [ageSuitability, setAgeSuitability] = useState('');
  const [hygieneStatus, setHygieneStatus] = useState('');
  const [price, setPrice] = useState('');
  const [isNegotiable, setIsNegotiable] = useState(true);

  const selectedCategory = categories.find(c => c.id === categoryId);
  const isElectronics = selectedCategory?.slug?.includes('phone') || selectedCategory?.slug?.includes('laptop');

  useEffect(() => {
    Listings.categories().then(r => {
      setCategories(r.data.categories);
      if (r.data.categories.length > 0) setCategoryId(r.data.categories[1].id);
    }).catch(() => {});
  }, []);

  // Step 1: Create draft listing when moving to step 2
  const handleDraftCreate = useCallback(async () => {
    if (!title.trim() || !city.trim()) { setError('Title and city are required'); return; }
    if (!categoryId) { setError('Select a category'); return; }
    setLoading(true); setError(null);
    try {
      const res = await Listings.create({
        category_id: categoryId,
        title: title.trim(),
        description: description.trim() || undefined,
        price: parseFloat(price) || 0,
        condition,
        city: city.trim(),
        state: 'Karnataka', // TODO: state picker
        locality: locality.trim() || undefined,
        accessories: accessories.trim() || undefined,
        warranty_info: warrantyInfo.trim() || undefined,
        battery_health: batteryHealth ? parseInt(batteryHealth) : undefined,
        is_kids_item: isKidsItem,
        age_suitability: ageSuitability.trim() || undefined,
        hygiene_status: hygieneStatus.trim() || undefined,
        is_negotiable: isNegotiable,
      });
      setListingId(res.data.listing_id);
      setStep(2);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [title, description, city, locality, categoryId, condition, price, accessories, warrantyInfo, batteryHealth, isKidsItem, ageSuitability, hygieneStatus, isNegotiable]);

  // Step 2: Upload photos
  const handlePickPhoto = useCallback(async (slotIndex: number) => {
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
    if (!result.assets?.length || !listingId) return;
    const asset = result.assets[0];
    if (!asset.uri) return;
    setLoading(true);
    try {
      const uploadRes = await Listings.requestImageUpload(listingId, asset.type ?? 'image/jpeg');
      // Upload to R2
      await fetch(uploadRes.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': asset.type ?? 'image/jpeg' },
        body: { uri: asset.uri, type: asset.type, name: asset.fileName } as any,
      });
      await Listings.confirmImageUpload(listingId, uploadRes.data.r2_key, slotIndex === 0);
      setPhotos(prev => {
        const next = [...prev];
        next[slotIndex] = { uri: asset.uri!, r2_key: uploadRes.data.r2_key };
        return next;
      });
    } catch (e: any) { Alert.alert('Upload failed', e.message); }
    finally { setLoading(false); }
  }, [listingId]);

  // Step 3: Publish
  const handlePublish = useCallback(async () => {
    if (!listingId) return;
    const uploadedCount = photos.filter(p => p.r2_key).length;
    if (uploadedCount < 3) { setError('Add at least 3 photos to publish'); return; }
    if (!price || parseFloat(price) <= 0) { setError('Enter a valid price'); return; }
    setPublishing(true); setError(null);
    try {
      await Listings.publish(listingId);
      Alert.alert('Listing submitted!', 'Your listing will be reviewed and go live within 2 hours.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (e: any) { setError(e.message); }
    finally { setPublishing(false); }
  }, [listingId, photos, price, navigation]);

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => step === 1 ? navigation.goBack() : setStep(s => (s - 1) as Step)}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>List your item</Text>
        <Text style={s.stepLabel}>{step} / 3</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressBg}>
        <View style={[s.progressFill, { width: `${(step / 3) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {error && <Text style={s.error}>{error}</Text>}

        {/* ── STEP 1: Details ── */}
        {step === 1 && (
          <View style={s.stepContent}>
            {/* Category */}
            <Text style={s.label}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll}>
              {categories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[s.catChip, categoryId === cat.id && s.catChipActive]}
                  onPress={() => { setCategoryId(cat.id); setIsKidsItem(cat.slug.includes('kids')); }}
                >
                  <Text style={[s.catChipText, categoryId === cat.id && s.catChipTextActive]}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Title */}
            <Text style={s.label}>Item title</Text>
            <TextInput style={s.input} value={title} onChangeText={setTitle}
              placeholder={isElectronics ? 'e.g. iPhone 13 Pro Max 256GB Space Gray' : 'Describe your item'}
              placeholderTextColor={Colors.text4} />

            {/* Condition */}
            <View style={s.labelRow}>
              <Text style={s.label}>Condition</Text>
              <Text style={s.labelHint}>affects buyer trust</Text>
            </View>
            <View style={s.condRow}>
              {CONDITIONS.map(c => (
                <TouchableOpacity key={c} style={[s.condChip, condition === c && s.condChipActive]} onPress={() => setCondition(c)}>
                  <Text style={[s.condText, condition === c && s.condTextActive]}>{CONDITION_LABELS[c]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* City */}
            <Text style={s.label}>City</Text>
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="e.g. Bengaluru" placeholderTextColor={Colors.text4} />
            <TextInput style={[s.input, { marginTop: 6 }]} value={locality} onChangeText={setLocality} placeholder="Locality (optional) e.g. Koramangala" placeholderTextColor={Colors.text4} />

            {/* Electronics-specific */}
            {isElectronics && (
              <>
                <Text style={s.label}>Battery health %</Text>
                <TextInput style={s.input} value={batteryHealth} onChangeText={setBatteryHealth}
                  placeholder="e.g. 94" keyboardType="number-pad" placeholderTextColor={Colors.text4} />
              </>
            )}

            {/* Accessories / warranty */}
            <Text style={s.label}>What's included</Text>
            <TextInput style={s.input} value={accessories} onChangeText={setAccessories}
              placeholder="e.g. Box, charger, warranty card" placeholderTextColor={Colors.text4} />
            <TextInput style={[s.input, { marginTop: 6 }]} value={warrantyInfo} onChangeText={setWarrantyInfo}
              placeholder="Warranty status e.g. 4 months left" placeholderTextColor={Colors.text4} />

            {/* Kids-specific */}
            <View style={s.kidsToggleRow}>
              <Text style={s.label}>Kids item</Text>
              <Switch value={isKidsItem} onValueChange={setIsKidsItem} trackColor={{ true: Colors.kids }} />
            </View>
            {isKidsItem && (
              <>
                <TextInput style={s.input} value={ageSuitability} onChangeText={setAgeSuitability}
                  placeholder="Age suitability e.g. 3-6 years" placeholderTextColor={Colors.text4} />
                <TextInput style={[s.input, { marginTop: 6 }]} value={hygieneStatus} onChangeText={setHygieneStatus}
                  placeholder="Hygiene status e.g. Cleaned, Sanitised" placeholderTextColor={Colors.text4} />
              </>
            )}

            {/* Description */}
            <Text style={s.label}>Description (optional)</Text>
            <TextInput style={[s.input, s.textarea]} value={description} onChangeText={setDescription}
              placeholder="Any other details the buyer should know" placeholderTextColor={Colors.text4}
              multiline numberOfLines={3} />

            <TouchableOpacity style={[s.primaryBtn, loading && s.btnDisabled]} onPress={handleDraftCreate} disabled={loading}>
              {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Add photos →</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP 2: Photos ── */}
        {step === 2 && (
          <View style={s.stepContent}>
            <View style={s.labelRow}>
              <Text style={s.label}>Photos</Text>
              <Text style={s.labelHint}>4+ photos sell faster</Text>
            </View>
            <Text style={s.photoGuidance}>Use natural light · Clean background · Show any scratches</Text>

            <View style={s.photoGrid}>
              {PHOTO_SLOTS.map((slot, i) => (
                <TouchableOpacity
                  key={slot}
                  style={[s.photoSlot, i === 0 && s.photoSlotMain, photos[i]?.uri && s.photoSlotFilled]}
                  onPress={() => handlePickPhoto(i)}
                >
                  {photos[i]?.uri ? (
                    <Text style={s.photoCheck}>✓</Text>
                  ) : (
                    <>
                      <Text style={s.photoPlus}>{i === 0 ? '📸' : '+'}</Text>
                      <Text style={s.photoSlotLabel}>{slot}</Text>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {loading && (
              <View style={s.uploadingRow}>
                <ActivityIndicator size="small" color={Colors.teal} />
                <Text style={s.uploadingText}>Uploading...</Text>
              </View>
            )}

            <Text style={s.photoCount}>
              {photos.filter(p => p.r2_key).length} / {PHOTO_SLOTS.length} uploaded · minimum 3 required
            </Text>

            <TouchableOpacity
              style={[s.primaryBtn, photos.filter(p => p.r2_key).length < 3 && s.btnDisabled]}
              onPress={() => setStep(3)}
              disabled={photos.filter(p => p.r2_key).length < 3}
            >
              <Text style={s.primaryBtnText}>Set price →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP 3: Price ── */}
        {step === 3 && (
          <View style={s.stepContent}>
            {/* AI price suggestion */}
            <View style={s.aiCard}>
              <Text style={s.aiIcon}>✦</Text>
              <View style={s.aiInfo}>
                <Text style={s.aiRange}>₹42,000 – ₹55,000</Text>
                <Text style={s.aiSub}>Suggested range for this category in Bengaluru</Text>
              </View>
              <TouchableOpacity onPress={() => setPrice('48000')}>
                <Text style={s.aiUse}>Use →</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.label}>Your price (₹)</Text>
            <TextInput style={[s.input, s.priceInput]} value={price} onChangeText={setPrice}
              placeholder="0" keyboardType="number-pad" placeholderTextColor={Colors.text4} autoFocus />

            {/* Negotiable toggle */}
            <View style={s.negotiableRow}>
              <View style={s.negotiableInfo}>
                <Text style={s.negotiableLabel}>{isNegotiable ? 'Open to offers' : 'Fixed price'}</Text>
                <Text style={s.negotiableSub}>{isNegotiable ? 'Buyers can make offers' : 'No negotiation'}</Text>
              </View>
              <Switch value={isNegotiable} onValueChange={setIsNegotiable} trackColor={{ true: Colors.teal }} />
            </View>

            <TouchableOpacity style={[s.primaryBtn, publishing && s.btnDisabled]} onPress={handlePublish} disabled={publishing}>
              {publishing ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Publish listing →</Text>}
            </TouchableOpacity>

            <Text style={s.publishNote}>Your listing will be reviewed and go live within 2 hours.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back: { fontSize: 20, color: Colors.text3, marginRight: Spacing.md },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '500', color: Colors.text },
  stepLabel: { fontSize: 12, color: Colors.text4 },
  progressBg: { height: 3, backgroundColor: Colors.border2 },
  progressFill: { height: '100%', backgroundColor: Colors.teal, borderRadius: 2 },
  scroll: { paddingBottom: 60 },
  stepContent: { padding: Spacing.lg, gap: Spacing.md },
  error: { margin: Spacing.lg, padding: Spacing.md, backgroundColor: Colors.errorLight, borderRadius: Radius.md, fontSize: 13, color: Colors.error },
  label: { fontSize: 12, fontWeight: '500', color: Colors.text2, marginBottom: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelHint: { fontSize: 11, color: Colors.teal },
  input: { backgroundColor: Colors.surface, borderWidth: 0.5, borderColor: Colors.border, borderRadius: Radius.md, padding: 12, fontSize: 14, color: Colors.text },
  textarea: { height: 80, textAlignVertical: 'top' },
  catScroll: { marginBottom: 4 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 0.5, borderColor: Colors.border, marginRight: 8, backgroundColor: Colors.surface },
  catChipActive: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  catChipText: { fontSize: 13, color: Colors.text2 },
  catChipTextActive: { color: Colors.teal, fontWeight: '500' },
  condRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  condChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border, backgroundColor: Colors.surface },
  condChipActive: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  condText: { fontSize: 13, color: Colors.text2 },
  condTextActive: { color: Colors.teal, fontWeight: '500' },
  kidsToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  photoGuidance: { fontSize: 11, color: Colors.text3, marginTop: -8, marginBottom: 4 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoSlot: { width: 80, height: 80, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', backgroundColor: Colors.border2, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoSlotMain: { width: 120, height: 120, borderColor: Colors.teal, backgroundColor: Colors.tealLight },
  photoSlotFilled: { borderStyle: 'solid', backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  photoCheck: { fontSize: 28, color: Colors.teal },
  photoPlus: { fontSize: 20, color: Colors.text4 },
  photoSlotLabel: { fontSize: 9, color: Colors.text4, textAlign: 'center' },
  photoCount: { fontSize: 11, color: Colors.text3, textAlign: 'center' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  uploadingText: { fontSize: 12, color: Colors.text3 },
  aiCard: { backgroundColor: Colors.ink, borderRadius: Radius.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiIcon: { fontSize: 18, color: Colors.white },
  aiInfo: { flex: 1 },
  aiRange: { fontSize: 14, fontWeight: '500', color: Colors.white },
  aiSub: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  aiUse: { fontSize: 12, color: '#5DCAA5', fontWeight: '500', borderWidth: 0.5, borderColor: 'rgba(93,202,165,0.4)', borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  priceInput: { fontSize: 22, fontWeight: '500', paddingVertical: 16 },
  negotiableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border, padding: 14 },
  negotiableInfo: { flex: 1 },
  negotiableLabel: { fontSize: 13, fontWeight: '500', color: Colors.text },
  negotiableSub: { fontSize: 11, color: Colors.text3, marginTop: 2 },
  primaryBtn: { backgroundColor: Colors.teal, borderRadius: Radius.md, padding: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 15, fontWeight: '500', color: Colors.white },
  publishNote: { fontSize: 11, color: Colors.text4, textAlign: 'center' },
});
