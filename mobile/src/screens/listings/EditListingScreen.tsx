/**
 * EditListingScreen — Sprint 8 Phase 2
 *
 * Post-publish edit. Triggered from My Listings → tap a listing → Edit details.
 *
 * State-based locks:
 *   - pending_buyer / draft_ai: all fields editable
 *   - buyer_committed and beyond: locked, banner shown
 *
 * Uses PATCH /v1/listings/{id}/ai (the suffix avoids collision with
 * GET /v1/listings/{id}).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, T, S, R, Shadow, formatPrice } from '../../utils/tokens';
import { Listings, AIListing } from '../../services/api';
import { parseApiError } from '../../utils/errors';
import type { RootScreen } from '../../navigation/types';

const EDITABLE_STATES = new Set(['draft_ai', 'pending_buyer']);

export default function EditListingScreen({ route, navigation }: RootScreen<'EditListing'>) {
  const { listingId } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listingState, setListingState] = useState<string>('pending_buyer');
  const [legacyStatus, setLegacyStatus] = useState<string>('active');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [color, setColor] = useState('');
  const [accessories, setAccessories] = useState('');
  const [condition, setCondition] = useState<'like_new' | 'good' | 'fair'>('good');

  const isEditable = EDITABLE_STATES.has(listingState) ||
    (legacyStatus === 'active' && !listingState);  // legacy listings without listing_state

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await Listings.get(listingId);
      // The detail endpoint may shape data either as the listing object or
      // wrapped — handle both.
      const l = data?.listing || data;
      setTitle(l.title || '');
      setDescription(l.description || '');
      setPrice(String(l.price ? Math.round(l.price) : ''));
      setBrand(l.brand || '');
      setModel(l.model || '');
      setStorage(l.storage || '');
      setColor(l.color || '');
      setAccessories(l.accessories || '');
      setCondition((l.condition as any) || 'good');
      setLegacyStatus(l.status || 'active');
      setListingState(l.listing_state || '');
    } catch (e) {
      Alert.alert('Could not load listing', parseApiError(e));
      navigation.goBack();
    }
    setLoading(false);
  }, [listingId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (saving || !isEditable) return;
    setSaving(true);
    try {
      const fields: Record<string, any> = {};
      if (title) fields.title = title;
      if (description) fields.description = description;
      const num = parseInt(price, 10);
      if (!isNaN(num) && num > 0) fields.price = num;
      if (brand) fields.brand = brand;
      if (model) fields.model = model;
      if (storage) fields.storage = storage;
      if (color) fields.color = color;
      if (accessories) fields.accessories = accessories;
      if (condition) fields.condition = condition;

      const { data } = await AIListing.edit(listingId, fields);
      if (data?.locked_reason) {
        Alert.alert('Listing locked', data.locked_reason);
      } else {
        Alert.alert('Saved', `${data?.updated_fields?.length ?? 0} field(s) updated.`);
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Could not save', parseApiError(e));
    }
    setSaving(false);
  }, [saving, isEditable, title, description, price, brand, model, storage, color, accessories, condition, listingId, navigation]);

  const regenerate = useCallback(async () => {
    setSaving(true);
    try {
      const { data } = await AIListing.regenerateDescription(listingId);
      setDescription(data.description);
    } catch (e) {
      Alert.alert('Could not regenerate', parseApiError(e));
    }
    setSaving(false);
  }, [listingId]);

  if (loading) {
    return (
      <SafeAreaView style={st.root}>
        <View style={st.loadingWrap}>
          <ActivityIndicator size="large" color={C.honey} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.headerBtn}>
          <Text style={st.headerBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>Edit listing</Text>
        <View style={st.headerBtn} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
          {!isEditable && (
            <View style={st.lockedBanner}>
              <Text style={st.lockedTitle}>🔒 Listing locked</Text>
              <Text style={st.lockedBody}>
                A buyer has committed (state: {listingState}). Fields cannot be edited
                until the transaction completes or is cancelled.
              </Text>
            </View>
          )}

          <View style={st.field}>
            <Text style={st.label}>Title</Text>
            <TextInput
              style={st.input}
              value={title}
              editable={isEditable}
              onChangeText={setTitle}
              placeholder="iPhone 13 128GB Midnight"
              placeholderTextColor={C.text4}
            />
          </View>

          <View style={st.field}>
            <View style={st.labelRow}>
              <Text style={st.label}>Description</Text>
              {isEditable && (
                <TouchableOpacity onPress={regenerate} style={st.regenBtn} disabled={saving}>
                  <Text style={st.regenBtnText}>✨ Regenerate</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={[st.input, st.inputMulti]}
              value={description}
              editable={isEditable}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              placeholder="Describe condition, what's included, why selling..."
              placeholderTextColor={C.text4}
            />
          </View>

          <View style={st.field}>
            <Text style={st.label}>Price (₹)</Text>
            <TextInput
              style={st.input}
              value={price}
              editable={isEditable}
              onChangeText={(v) => setPrice(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="33000"
              placeholderTextColor={C.text4}
            />
            {price && !isNaN(parseInt(price, 10)) && (
              <Text style={st.hint}>{formatPrice(parseInt(price, 10))}</Text>
            )}
          </View>

          <View style={st.field}>
            <Text style={st.label}>Condition</Text>
            <View style={st.chipRow}>
              {(['like_new', 'good', 'fair'] as const).map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => isEditable && setCondition(c)}
                  style={[st.chip, condition === c && st.chipActive, !isEditable && { opacity: 0.5 }]}
                  disabled={!isEditable}>
                  <Text style={[st.chipText, condition === c && st.chipTextActive]}>
                    {c === 'like_new' ? 'Like new' : c === 'good' ? 'Good' : 'Fair'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={st.field}>
            <Text style={st.label}>Brand</Text>
            <TextInput
              style={st.input}
              value={brand}
              editable={isEditable}
              onChangeText={setBrand}
              placeholder="Apple"
              placeholderTextColor={C.text4}
            />
          </View>

          <View style={st.field}>
            <Text style={st.label}>Model</Text>
            <TextInput
              style={st.input}
              value={model}
              editable={isEditable}
              onChangeText={setModel}
              placeholder="iPhone 13"
              placeholderTextColor={C.text4}
            />
          </View>

          <View style={st.row2}>
            <View style={[st.field, { flex: 1 }]}>
              <Text style={st.label}>Storage</Text>
              <TextInput
                style={st.input}
                value={storage}
                editable={isEditable}
                onChangeText={setStorage}
                placeholder="128GB"
                placeholderTextColor={C.text4}
              />
            </View>
            <View style={{ width: S.md }} />
            <View style={[st.field, { flex: 1 }]}>
              <Text style={st.label}>Colour</Text>
              <TextInput
                style={st.input}
                value={color}
                editable={isEditable}
                onChangeText={setColor}
                placeholder="Midnight"
                placeholderTextColor={C.text4}
              />
            </View>
          </View>

          <View style={st.field}>
            <Text style={st.label}>Accessories included</Text>
            <TextInput
              style={st.input}
              value={accessories}
              editable={isEditable}
              onChangeText={setAccessories}
              placeholder="Box, charger, original cable"
              placeholderTextColor={C.text4}
            />
          </View>
        </ScrollView>

        {isEditable && (
          <View style={st.ctaBar}>
            <TouchableOpacity
              style={[st.saveBtn, saving && { opacity: 0.6 }]}
              onPress={save}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color={C.surface} />
              ) : (
                <Text style={st.saveBtnText}>Save changes</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  headerBtn: { minWidth: 32, height: 32, justifyContent: 'center' },
  headerBtnText: { fontSize: 22, color: C.text2 },
  headerTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },

  lockedBanner: {
    margin: S.lg,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.yellowLight,
    borderWidth: 1,
    borderColor: C.yellow,
  },
  lockedTitle: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.yellow, marginBottom: 4 },
  lockedBody: { fontSize: T.size.base, color: C.text2 },

  field: { paddingHorizontal: S.lg, paddingVertical: S.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
  },
  regenBtn: {
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.sm,
    backgroundColor: C.honeyLight,
  },
  regenBtnText: { color: C.honey, fontSize: T.size.sm, fontWeight: T.weight.semi },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: Platform.OS === 'ios' ? S.md : S.sm,
    fontSize: T.size.md,
    color: C.text,
    backgroundColor: C.surface,
  },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },
  hint: { marginTop: 4, color: C.text3, fontSize: T.size.sm },

  chipRow: { flexDirection: 'row', gap: S.sm },
  chip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  chipActive: { backgroundColor: C.honeyLight, borderColor: C.honey },
  chipText: { color: C.text2, fontSize: T.size.base, fontWeight: T.weight.medium },
  chipTextActive: { color: C.honeyText, fontWeight: T.weight.bold },

  row2: { flexDirection: 'row' },

  ctaBar: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.lg,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  saveBtn: {
    backgroundColor: C.honey,
    paddingVertical: S.lg,
    borderRadius: R.md,
    alignItems: 'center',
    ...Shadow.glow,
  },
  saveBtnText: { color: C.surface, fontSize: T.size.lg, fontWeight: T.weight.bold },
});
