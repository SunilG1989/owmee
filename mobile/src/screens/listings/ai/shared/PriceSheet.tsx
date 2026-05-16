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
import { Button } from '../../../../components/ui';
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
          <Text style={st.title}>Set asking price</Text>

          {/* Suggested context */}
          <View style={st.suggestBox}>
            <Text style={st.suggestLabel}>Owmee guidance</Text>
            <Text style={st.suggestPrice}>{formatPrice(suggested)}</Text>
          </View>

          {/* Custom input */}
          <Text style={st.label}>Your asking price (₹)</Text>
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
              <ScrollView style={st.compsScroll} keyboardShouldPersistTaps="handled">
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
          <Button
            label="Use suggested price"
            variant="ghost"
            size="sm"
            onPress={onUseSuggested}
            style={st.useSuggestedBtn}
          />

          <View style={st.ctaRow}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={onClose}
              style={st.cancelBtn}
            />
            <Button
              label="Save"
              variant="primary"
              disabled={!valid}
              onPress={() => onSave(num)}
              style={st.saveBtn}
            />
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
    backgroundColor: C.petrolLight,
    padding: S.md,
    borderRadius: R.md,
    alignItems: 'center',
    marginBottom: S.lg,
  },
  suggestLabel: { fontSize: T.size.sm, color: C.petrolText, marginBottom: 2 },
  suggestPrice: { fontSize: T.size.xxl, fontWeight: T.weight.bold, color: C.petrolText },

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
    backgroundColor: C.bone,
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

  compsScroll: { maxHeight: 220 },
  useSuggestedBtn: { marginTop: S.lg, alignSelf: 'center' },

  ctaRow: { flexDirection: 'row', gap: S.md, marginTop: S.lg },
  cancelBtn: { flex: 1 },
  saveBtn: { flex: 2 },
});
