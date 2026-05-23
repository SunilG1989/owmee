/**
 * PriceSheet — seller-owned asking price plus reviewed MRP source.
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
  suggested?: number | null;
  initialMrp?: number | null;
  initialMrpSource?: string | null;
  mrpConfidence?: number | null;
  mrpReasoning?: string | null;
  comparables: AIComparable[];
  initial?: number | null;
  onSave: (price: number, originalPrice: number | null, mrpSource: string | null) => void;
  onUseSuggested: () => void;
  onClose: () => void;
}

const MRP_SOURCE_OPTIONS = [
  { key: 'visible_mrp', label: 'Seen on box' },
  { key: 'receipt_or_bill', label: 'From bill' },
  { key: 'seller_entered', label: 'Seller entered' },
  { key: 'market_anchor', label: 'Market estimate' },
];

const buyerFacingMrpSource = (source?: string | null) =>
  source === 'visible_mrp' || source === 'receipt_or_bill' || source === 'seller_entered';

export default function PriceSheet({
  suggested,
  initialMrp,
  initialMrpSource,
  mrpConfidence,
  mrpReasoning,
  comparables,
  initial,
  onSave,
  onUseSuggested,
  onClose,
}: Props) {
  const [text, setText] = useState(initial ? String(Math.round(initial)) : '');
  const [mrpText, setMrpText] = useState(initialMrp ? String(Math.round(initialMrp)) : '');
  const [mrpSource, setMrpSource] = useState<string | null>(initialMrpSource || null);

  const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
  const valid = !isNaN(num) && num > 0;
  const mrpNum = parseInt(mrpText.replace(/[^0-9]/g, ''), 10);
  const mrpEntered = mrpText.trim().length > 0;
  const hasValidMrp = valid && !isNaN(mrpNum) && mrpNum > num;
  const discountPct = hasValidMrp && buyerFacingMrpSource(mrpSource)
    ? Math.round((1 - num / mrpNum) * 100)
    : null;
  const canSave = valid && (!mrpEntered || (hasValidMrp && !!mrpSource));

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <TouchableOpacity style={st.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={st.sheet}>
          <View style={st.handle} />
          <Text style={st.title}>Set price and MRP</Text>

          <ScrollView style={st.bodyScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={st.suggestBox}>
            <Text style={st.suggestLabel}>Owmee guidance</Text>
            <Text style={st.suggestPrice}>{suggested ? formatPrice(suggested) : 'Set manually'}</Text>
            {initialMrp ? (
              <View style={st.mrpLine}>
                <Text style={st.mrpStrike}>MRP suggestion {formatPrice(initialMrp)}</Text>
                <Text style={st.mrpDiscount}>
                  {initialMrpSource === 'market_anchor' ? 'estimate' : 'review'}
                </Text>
              </View>
            ) : null}
            {mrpReasoning ? <Text style={st.mrpReasoning}>{mrpReasoning}</Text> : null}
          </View>

          <Text style={st.label}>Your asking price (₹)</Text>
          <TextInput
            style={st.input}
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={C.text4}
          />

          <Text style={st.label}>Original MRP (optional)</Text>
          <TextInput
            style={st.input}
            value={mrpText}
            onChangeText={setMrpText}
            keyboardType="number-pad"
            placeholder="Add only if you can stand behind it"
            placeholderTextColor={C.text4}
          />
          <Text style={st.mrpHelper}>
            Buyer discount is shown only when MRP is from box, bill/receipt, or a seller-confirmed original MRP.
          </Text>

          {mrpEntered ? (
            <View style={st.sourceRow}>
              {MRP_SOURCE_OPTIONS.map((source) => {
                const active = mrpSource === source.key;
                return (
                  <TouchableOpacity
                    key={source.key}
                    onPress={() => setMrpSource(source.key)}
                    activeOpacity={0.82}
                    style={[st.sourceChip, active && st.sourceChipActive]}>
                    <Text style={[st.sourceText, active && st.sourceTextActive]}>
                      {source.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {mrpEntered && !hasValidMrp && valid ? (
            <Text style={st.mrpError}>MRP must be higher than the asking price.</Text>
          ) : null}
          {hasValidMrp && !mrpSource ? (
            <Text style={st.mrpError}>Choose where the MRP came from.</Text>
          ) : null}
          {hasValidMrp && mrpSource === 'market_anchor' ? (
            <Text style={st.mrpMuted}>Market estimates are saved for support context, but not shown as a buyer discount.</Text>
          ) : null}
          {discountPct && discountPct > 0 ? (
            <View style={st.discountPreview}>
              <Text style={st.discountPreviewText}>Buyer tag: {discountPct}% off</Text>
              {mrpConfidence != null ? (
                <Text style={st.discountPreviewSub}>AI confidence {Math.round(mrpConfidence * 100)}%</Text>
              ) : null}
            </View>
          ) : null}

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

          {suggested ? (
            <Button
              label="Use suggested price"
              variant="ghost"
              size="sm"
              onPress={() => {
                setText(String(Math.round(suggested)));
                onUseSuggested();
              }}
              style={st.useSuggestedBtn}
            />
          ) : null}
          </ScrollView>

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
              disabled={!canSave}
              onPress={() => onSave(num, hasValidMrp ? mrpNum : null, hasValidMrp ? mrpSource : null)}
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
    maxHeight: '92%',
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
  bodyScroll: { maxHeight: '82%' },
  suggestBox: {
    backgroundColor: C.petrolLight,
    padding: S.md,
    borderRadius: R.md,
    alignItems: 'center',
    marginBottom: S.lg,
  },
  suggestLabel: { fontSize: T.size.sm, color: C.petrolText, marginBottom: 2 },
  suggestPrice: { fontSize: T.size.xxl, fontWeight: T.weight.bold, color: C.petrolText },
  mrpLine: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: S.sm },
  mrpStrike: { fontSize: T.size.sm, color: C.text3 },
  mrpDiscount: { fontSize: T.size.sm, color: C.green, fontWeight: T.weight.bold },
  mrpReasoning: {
    marginTop: S.xs,
    fontSize: T.size.xs,
    lineHeight: T.size.xs + 4,
    color: C.petrolText,
    textAlign: 'center',
  },
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
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: C.text,
    backgroundColor: C.bone,
    marginBottom: S.md,
  },
  mrpHelper: {
    marginTop: -S.xs,
    marginBottom: S.sm,
    fontSize: T.size.xs,
    lineHeight: T.size.xs + 4,
    color: C.text4,
  },
  sourceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginBottom: S.sm,
  },
  sourceChip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  sourceChipActive: {
    borderColor: C.ctaPrimary,
    backgroundColor: C.ctaPrimarySoft,
  },
  sourceText: { fontSize: T.size.sm, fontWeight: T.weight.semi, color: C.text2 },
  sourceTextActive: { color: C.ctaPrimary },
  mrpError: {
    marginBottom: S.sm,
    fontSize: T.size.sm,
    color: C.red,
    fontWeight: T.weight.semi,
  },
  mrpMuted: {
    marginBottom: S.sm,
    fontSize: T.size.sm,
    color: C.text3,
    lineHeight: T.size.sm + 5,
  },
  discountPreview: {
    marginBottom: S.md,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.greenLight,
  },
  discountPreviewText: { fontSize: T.size.sm, color: C.green, fontWeight: T.weight.bold },
  discountPreviewSub: { marginTop: 2, fontSize: T.size.xs, color: C.text3 },
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
  compsScroll: { maxHeight: 180 },
  useSuggestedBtn: { marginTop: S.lg, alignSelf: 'center' },
  ctaRow: { flexDirection: 'row', gap: S.md, marginTop: S.lg },
  cancelBtn: { flex: 1 },
  saveBtn: { flex: 2 },
});
