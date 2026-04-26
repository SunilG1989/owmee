/**
 * PriceSheet — bottom sheet to set a custom price.
 * Shows comparables for context, with a "Use suggested" link to revert.
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

import { C, T, S, R, formatPrice } from '../../../../utils/tokens';
import type { AIComparable } from '../../../../services/api';

interface Props {
  suggested: number;
  comparables: AIComparable[];
  initial: number;
  onSave: (price: number) => void;
  onUseSuggested: () => void;
  onClose: () => void;
}

export default function PriceSheet({
  suggested,
  comparables,
  initial,
  onSave,
  onUseSuggested,
  onClose,
}: Props) {
  const [text, setText] = useState(String(Math.round(initial)));

  const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
  const valid = !isNaN(num) && num > 0;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <TouchableOpacity style={st.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={st.sheet}>
          <View style={st.handle} />
          <Text style={st.title}>Set your price</Text>

          {/* Suggested context */}
          <View style={st.suggestBox}>
            <Text style={st.suggestLabel}>Owmee suggests</Text>
            <Text style={st.suggestPrice}>{formatPrice(suggested)}</Text>
          </View>

          {/* Custom input */}
          <Text style={st.label}>Your price (₹)</Text>
          <TextInput
            style={st.input}
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={C.text4}
          />

          {/* Comparables */}
          {comparables.length > 0 && (
            <>
              <Text style={st.compsLabel}>Recent similar sales</Text>
              <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
                {comparables.map((c, i) => (
                  <View key={i} style={st.compRow}>
                    <Text style={st.compTitle} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <View style={st.compMeta}>
                      <Text style={st.compPrice}>{formatPrice(c.price)}</Text>
                      <Text style={st.compAge}>
                        {c.days_ago < 1 ? 'today' : `${Math.round(c.days_ago)}d ago`}
                        {c.city ? ` · ${c.city}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          {/* Actions */}
          <TouchableOpacity onPress={onUseSuggested} style={st.useSuggestedBtn}>
            <Text style={st.useSuggestedText}>Use suggested price</Text>
          </TouchableOpacity>

          <View style={st.ctaRow}>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose}>
              <Text style={st.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.saveBtn, !valid && st.saveBtnDisabled]}
              disabled={!valid}
              onPress={() => onSave(num)}>
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
  title: { fontSize: T.size.xl, fontWeight: T.weight.bold, color: C.text, marginBottom: S.lg },

  suggestBox: {
    backgroundColor: C.honeyLight,
    padding: S.md,
    borderRadius: R.md,
    alignItems: 'center',
    marginBottom: S.lg,
  },
  suggestLabel: { fontSize: T.size.sm, color: C.honeyText, marginBottom: 2 },
  suggestPrice: { fontSize: T.size.xxl, fontWeight: T.weight.bold, color: C.honeyText },

  label: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
    marginBottom: S.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: Platform.OS === 'ios' ? S.md : S.sm,
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    backgroundColor: C.cream,
    marginBottom: S.lg,
  },

  compsLabel: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
  },
  compRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  compTitle: { flex: 1, fontSize: T.size.base, color: C.text, marginRight: S.sm },
  compMeta: { alignItems: 'flex-end' },
  compPrice: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.text },
  compAge: { fontSize: T.size.xs, color: C.text3 },

  useSuggestedBtn: { marginTop: S.lg, paddingVertical: S.sm, alignItems: 'center' },
  useSuggestedText: { color: C.honey, fontSize: T.size.md, fontWeight: T.weight.semi },

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
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: C.surface, fontSize: T.size.md, fontWeight: T.weight.bold },
});
