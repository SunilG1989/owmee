/**
 * EditDetailsSheet — bottom sheet to override AI's category/brand/model/etc.
 *
 * Sprint 8 Phase 2 — uses RN's Modal slide animation as a faux bottom sheet
 * to avoid pulling in @gorhom/bottom-sheet (which would require reanimated v3).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { C, T, S, R } from '../../../../utils/tokens';

const CATEGORY_PICKS = [
  { slug: 'smartphones', label: 'Smartphone' },
  { slug: 'laptops', label: 'Laptop' },
  { slug: 'tablets', label: 'Tablet' },
  { slug: 'small-appliances', label: 'Appliance' },
  { slug: 'kids-utility', label: 'Kids / Utility' },
];

const STORAGE_PICKS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'];

interface Props {
  initial: {
    brand?: string;
    model?: string;
    storage?: string;
    color?: string;
    category_slug?: string;
  };
  onSave: (next: {
    brand?: string;
    model?: string;
    storage?: string;
    color?: string;
    category_slug?: string;
  }) => void;
  onClose: () => void;
}

export default function EditDetailsSheet({ initial, onSave, onClose }: Props) {
  const [category_slug, setCategorySlug] = useState(initial.category_slug || '');
  const [brand, setBrand] = useState(initial.brand || '');
  const [model, setModel] = useState(initial.model || '');
  const [storage, setStorage] = useState(initial.storage || '');
  const [color, setColor] = useState(initial.color || '');

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <TouchableOpacity style={st.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={st.sheet}>
          <View style={st.handle} />
          <Text style={st.title}>Edit details</Text>

          <ScrollView style={{ maxHeight: 460 }}>
            <Text style={st.label}>Category</Text>
            <View style={st.chipRow}>
              {CATEGORY_PICKS.map((c) => (
                <TouchableOpacity
                  key={c.slug}
                  onPress={() => setCategorySlug(c.slug)}
                  style={[st.chip, category_slug === c.slug && st.chipActive]}>
                  <Text style={[st.chipText, category_slug === c.slug && st.chipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={st.label}>Brand</Text>
            <TextInput
              style={st.input}
              value={brand}
              onChangeText={setBrand}
              placeholder="e.g. Apple"
              placeholderTextColor={C.text4}
            />

            <Text style={st.label}>Model</Text>
            <TextInput
              style={st.input}
              value={model}
              onChangeText={setModel}
              placeholder="e.g. iPhone 13"
              placeholderTextColor={C.text4}
            />

            {(category_slug === 'smartphones' || category_slug === 'laptops' || category_slug === 'tablets') && (
              <>
                <Text style={st.label}>Storage</Text>
                <View style={st.chipRow}>
                  {STORAGE_PICKS.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setStorage(s)}
                      style={[st.chip, storage === s && st.chipActive]}>
                      <Text style={[st.chipText, storage === s && st.chipTextActive]}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={st.label}>Colour</Text>
            <TextInput
              style={st.input}
              value={color}
              onChangeText={setColor}
              placeholder="e.g. Midnight Black"
              placeholderTextColor={C.text4}
            />
          </ScrollView>

          <View style={st.ctaRow}>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose}>
              <Text style={st.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={st.saveBtn}
              onPress={() => onSave({ brand, model, storage, color, category_slug })}>
              <Text style={st.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    padding: S.lg,
    paddingBottom: S.xxl,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: S.md,
  },
  title: {
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.lg,
  },
  label: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
    marginTop: S.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.cream,
  },
  chipActive: { backgroundColor: C.honeyLight, borderColor: C.honey },
  chipText: { color: C.text2, fontSize: T.size.base, fontWeight: T.weight.medium },
  chipTextActive: { color: C.honeyText, fontWeight: T.weight.bold },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: Platform.OS === 'ios' ? S.md : S.sm,
    fontSize: T.size.md,
    color: C.text,
    backgroundColor: C.cream,
  },
  ctaRow: { flexDirection: 'row', gap: S.md, marginTop: S.lg },
  cancelBtn: {
    flex: 1,
    paddingVertical: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  cancelBtnText: { color: C.text2, fontSize: T.size.md, fontWeight: T.weight.semi },
  saveBtn: {
    flex: 2,
    paddingVertical: S.md,
    borderRadius: R.md,
    backgroundColor: C.honey,
    alignItems: 'center',
  },
  saveBtnText: { color: C.surface, fontSize: T.size.md, fontWeight: T.weight.bold },
});
