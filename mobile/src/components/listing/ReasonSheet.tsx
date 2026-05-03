/**
 * ReasonSheet — bottom-sheet confirm for destructive seller actions.
 *
 * Use for any irreversible "remove / cancel / withdraw" flow where we
 * want to capture a structured reason (analytics + later product
 * decisions) and a free-text note. Pattern modelled after Mercari /
 * eBay listing-removal confirms.
 *
 * Renders an RN Modal slide-up sheet (no @gorhom/bottom-sheet
 * dependency, matches EditDetailsSheet.tsx convention).
 *
 * The caller passes:
 *   title       — sheet headline ("Remove this listing?")
 *   message     — body copy (1–2 sentences, plain English)
 *   reasons     — list of {key, label} chips. First tap selects.
 *   confirmLabel — primary button label
 *   onConfirm(reason, note) — fired when user submits
 *
 * Confirm button is disabled until a reason is picked. The free-text
 * note input only appears once a reason is selected (less visual
 * weight when the user hasn't decided yet).
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Chip } from '../ui';
import { C, O, R, S, Shadow, T } from '../../utils/tokens';

export interface ReasonOption<T extends string = string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  visible: boolean;
  title: string;
  message: string;
  reasons: ReasonOption<T>[];
  confirmLabel: string;
  confirmVariant?: 'primary' | 'destructive';
  loading?: boolean;
  onConfirm: (reason: T, note: string) => void;
  onClose: () => void;
}

export default function ReasonSheet<T extends string>({
  visible,
  title,
  message,
  reasons,
  confirmLabel,
  confirmVariant = 'destructive',
  loading = false,
  onConfirm,
  onClose,
}: Props<T>) {
  const [picked, setPicked] = useState<T | null>(null);
  const [note, setNote] = useState('');

  // Reset on close so reopen is fresh.
  const handleClose = () => {
    if (loading) return;
    setPicked(null);
    setNote('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}>
      <View style={s.backdrop}>
        <Pressable
          style={s.backdropTouch}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.sheet}>
          <View style={s.handle} />
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollBody}
            keyboardShouldPersistTaps="handled">
            <Text style={s.title}>{title}</Text>
            <Text style={s.message}>{message}</Text>

            <Text style={s.sectionLabel}>Reason</Text>
            <View style={s.chipRow}>
              {reasons.map((r) => (
                <Chip
                  key={r.key}
                  label={r.label}
                  selected={picked === r.key}
                  onPress={() => setPicked(r.key)}
                  variant="filter"
                  size="sm"
                  style={s.chipSpacing}
                />
              ))}
            </View>

            {picked ? (
              <>
                <Text style={s.sectionLabel}>Anything else? (optional)</Text>
                <TextInput
                  style={s.input}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Add a short note for our team"
                  placeholderTextColor={C.text4}
                  multiline
                  maxLength={500}
                />
              </>
            ) : null}
          </ScrollView>

          <View style={s.ctaRow}>
            <Button
              label="Keep it"
              variant="ghost"
              size="lg"
              onPress={handleClose}
              disabled={loading}
              style={s.ctaSecondary}
            />
            <Button
              label={confirmLabel}
              variant={confirmVariant}
              size="lg"
              onPress={() => picked && onConfirm(picked, note.trim())}
              disabled={!picked || loading}
              loading={loading}
              style={s.ctaPrimary}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: O.dark50, justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    paddingTop: S.sm,
    paddingBottom: S.lg,
    maxHeight: '80%',
    ...Shadow.glow,
  },
  handle: {
    width: 40, height: 4, borderRadius: R.pill,
    backgroundColor: C.border, alignSelf: 'center', marginBottom: S.sm,
  },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingHorizontal: S.lg, paddingBottom: S.md },
  title: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.text, marginBottom: S.xs },
  message: { fontSize: T.size.base, color: C.text2, lineHeight: 20, marginBottom: S.lg },
  sectionLabel: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
    marginTop: S.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs },
  chipSpacing: { marginRight: S.xs, marginBottom: S.xs },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.md,
    paddingHorizontal: S.md, paddingVertical: S.sm,
    fontSize: T.size.base, color: C.text, backgroundColor: C.bone,
    minHeight: 64, textAlignVertical: 'top',
  },
  ctaRow: {
    flexDirection: 'row', gap: S.sm,
    paddingHorizontal: S.lg, paddingTop: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border,
  },
  ctaSecondary: { flex: 1 },
  ctaPrimary: { flex: 1 },
});
