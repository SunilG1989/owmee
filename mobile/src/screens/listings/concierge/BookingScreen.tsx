/**
 * BookingScreen — Concierge master spec section 4.3
 *
 * ONE screen. Replaces the previously-spec'd 3-step wizard.
 *
 * Required: address (defaulted from saved) + slot.
 * Optional: notes (free text + 6 quick-tag chips).
 *
 * Behavior shape per the master spec:
 *   - Default address pre-selected on mount.
 *   - "Change ▾" expands inline picker (no new screen).
 *   - 4 slot chips visible by default (next 2 days × 2 slots).
 *     "More times ▾" expands to 5 days × 4 slots, in-place.
 *   - Tag taps append/remove their display label to the textarea while
 *     also tracking the canonical DB value in notesTags state. The two
 *     are sent independently to the backend.
 *   - Submit disabled until both required fields chosen.
 *   - 0-addresses path: card shows "Set up your address first" with a
 *     button that pushes through LocationDetect → returns here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Addresses, FEVisits, type UserAddress } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import {
  CONCIERGE_STRINGS,
  CONCIERGE_TAGS,
} from '../../../utils/conciergeStrings';
import { parseApiError } from '../../../utils/errors';
import { C, MIN_TAP, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const STR = CONCIERGE_STRINGS.booking;

type Slot = {
  start: Date;
  end: Date;
  /** Date label like "Tomorrow" or "Wed". */
  dayLabel: string;
  /** Time label like "10am-12" / "2-4pm". */
  timeLabel: string;
};

const DEFAULT_DAYS = 2;
const EXTENDED_DAYS = 5;
const DEFAULT_SLOTS_PER_DAY = [10, 14] as const;       // 10am-12, 2-4pm
const EXTENDED_SLOTS_PER_DAY = [10, 12, 14, 16] as const; // 4 slots

/** Build slot list, hiding past slots. */
function buildSlots(extended: boolean): Slot[] {
  const now = new Date();
  const dayCount = extended ? EXTENDED_DAYS : DEFAULT_DAYS;
  const hours = extended ? EXTENDED_SLOTS_PER_DAY : DEFAULT_SLOTS_PER_DAY;
  const slots: Slot[] = [];

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);

    for (const startHour of hours) {
      const start = new Date(day);
      start.setHours(startHour, 0, 0, 0);
      // Hide past slots (and slots starting in less than 1 hour from now).
      if (start.getTime() <= now.getTime() + 60 * 60 * 1000) continue;

      const end = new Date(start);
      end.setHours(start.getHours() + 2);

      const dayLabel =
        dayOffset === 0
          ? 'Today'
          : dayOffset === 1
            ? 'Tomorrow'
            : day.toLocaleDateString('en-IN', { weekday: 'short' });

      const sH = start.getHours();
      const eH = end.getHours();
      const fmt = (h: number) => {
        if (h === 12) return '12';
        if (h > 12) return `${h - 12}`;
        return `${h}`;
      };
      const ampm = (h: number) => (h < 12 ? 'am' : 'pm');
      // "10am-12" / "2-4pm" — drop am/pm on the start when same period
      const samePeriod = (sH < 12) === (eH < 12);
      const timeLabel = samePeriod
        ? `${fmt(sH)}-${fmt(eH)}${ampm(eH)}`
        : `${fmt(sH)}${ampm(sH)}-${fmt(eH)}${ampm(eH)}`;

      slots.push({ start, end, dayLabel, timeLabel });
    }
  }
  return slots;
}

export default function BookingScreen({
  navigation,
}: RootScreen<'ConciergeBooking'>) {
  // ── State ────────────────────────────────────────────────────────────
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);

  const [slot, setSlot] = useState<Slot | null>(null);
  const [showMoreSlots, setShowMoreSlots] = useState(false);
  const slots = useMemo(() => buildSlots(showMoreSlots), [showMoreSlots]);

  const [notes, setNotes] = useState('');
  const [notesTags, setNotesTags] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);

  // ── Load addresses on focus (so returning from LocationDetect refreshes) ─
  const loadAddresses = React.useCallback(async () => {
    try {
      const res = await Addresses.list();
      setAddresses(res.data);
      // Auto-select default on first load if not already chosen.
      setAddressId((current) => {
        if (current && res.data.some((a) => a.id === current)) return current;
        const def = res.data.find((a) => a.is_default) ?? res.data[0];
        return def?.id ?? null;
      });
    } catch {
      setAddresses([]);
    } finally {
      setAddressesLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadAddresses();
    }, [loadAddresses]),
  );

  // ── Tag toggle ──────────────────────────────────────────────────────
  const toggleTag = (tag: { display: string; value: string }) => {
    const isOn = notesTags.includes(tag.value);
    if (isOn) {
      setNotesTags((prev) => prev.filter((v) => v !== tag.value));
      // Remove the display label from notes — match it as a comma-separated
      // word, leading/trailing commas/spaces tidied up.
      setNotes((prev) => {
        const escaped = tag.display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let next = prev.replace(
          new RegExp(`(^|,\\s*)${escaped}(?=\\s*,|\\s*$)`, 'i'),
          (_match, lead) => (lead.startsWith(',') ? '' : ''),
        );
        next = next.replace(/^,\s*/, '').replace(/\s*,\s*,/g, ', ').trim();
        next = next.replace(/,\s*$/, '');
        return next;
      });
    } else {
      setNotesTags((prev) => [...prev, tag.value]);
      setNotes((prev) => (prev.trim() ? `${prev.trim()}, ${tag.display}` : tag.display));
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────
  const canSubmit = !!addressId && !!slot && !submitting;

  const onSubmit = async () => {
    if (!addressId || !slot) return;
    setSubmitting(true);
    try {
      const res = await FEVisits.request({
        requested_slot_start: slot.start.toISOString(),
        requested_slot_end: slot.end.toISOString(),
        address_id: addressId,
        notes: notes.trim() || null,
        notes_tags: notesTags,
      });
      navigation.replace('ConciergeBookingConfirmed', { visit: res.data });
    } catch (e) {
      Alert.alert(
        'Could not book',
        parseApiError(e, STR.submitError),
      );
      setSubmitting(false);
    }
  };

  // ── Render: 0-addresses path ────────────────────────────────────────
  if (!addressesLoading && addresses && addresses.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>{STR.title}</Text>
        </View>
        <View style={s.center}>
          <Text style={s.setUpEmoji}>📍</Text>
          <Text style={s.setUpTitle}>{STR.whereSetUp}</Text>
          <Button
            label={STR.whereSetUpCta}
            onPress={() =>
              navigation.navigate('LocationDetect', {
                returnTo: 'ConciergeBooking',
              })
            }
            style={{ marginTop: S.lg }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (addressesLoading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>{STR.title}</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={C.honey} />
        </View>
      </SafeAreaView>
    );
  }

  const selectedAddress = addresses?.find((a) => a.id === addressId) ?? null;

  // ── Render: main ────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{STR.title}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Where ─────────────────────────────────────────────────── */}
          <Text style={s.sectionLabel}>📍 {STR.whereLabel}</Text>
          <View style={s.addressCard}>
            {selectedAddress ? (
              <AddressDisplay address={selectedAddress} />
            ) : (
              <Text style={s.addressEmpty}>No address selected</Text>
            )}
            <TouchableOpacity
              onPress={() => setShowAddressPicker((x) => !x)}
              style={s.changeBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Change address"
            >
              <Text style={s.changeBtnText}>
                {STR.whereChange} {showAddressPicker ? '▴' : '▾'}
              </Text>
            </TouchableOpacity>
          </View>

          {showAddressPicker && (addresses?.length ?? 0) > 0 ? (
            <View style={s.pickerBlock}>
              {addresses!.map((a) => {
                const isOn = a.id === addressId;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[s.pickerRow, isOn && s.pickerRowOn]}
                    onPress={() => {
                      setAddressId(a.id);
                      setShowAddressPicker(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.pickerLabel}>
                        {labelFor(a)} {a.is_default ? '★' : ''}
                      </Text>
                      <Text style={s.pickerLine} numberOfLines={2}>
                        {oneLineAddress(a)}
                      </Text>
                    </View>
                    {isOn ? <Text style={s.pickerTick}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={s.addNewRow}
                onPress={() =>
                  navigation.navigate('LocationDetect', {
                    returnTo: 'ConciergeBooking',
                  })
                }
                activeOpacity={0.7}
              >
                <Text style={s.addNewText}>+ Add new address</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── When ──────────────────────────────────────────────────── */}
          <Text style={[s.sectionLabel, { marginTop: S.xl }]}>
            🕐 {STR.whenLabel}
          </Text>
          {slots.length === 0 ? (
            <Text style={s.fullyBooked}>{STR.fullyBooked}</Text>
          ) : (
            <View style={s.slotGrid}>
              {slots.map((sl, i) => {
                const isOn =
                  !!slot && slot.start.getTime() === sl.start.getTime();
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.slotChip, isOn && s.slotChipOn]}
                    onPress={() => setSlot(isOn ? null : sl)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isOn }}
                    accessibilityLabel={`${sl.dayLabel} ${sl.timeLabel}`}
                  >
                    <Text style={[s.slotDay, isOn && s.slotDayOn]}>
                      {sl.dayLabel}
                    </Text>
                    <Text style={[s.slotTime, isOn && s.slotTimeOn]}>
                      {sl.timeLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TouchableOpacity
            onPress={() => setShowMoreSlots((x) => !x)}
            style={s.moreTimesBtn}
            activeOpacity={0.7}
          >
            <Text style={s.moreTimesText}>
              {showMoreSlots ? STR.fewerTimes : STR.moreTimes}{' '}
              {showMoreSlots ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>

          {/* ── Notes ─────────────────────────────────────────────────── */}
          <Text style={[s.sectionLabel, { marginTop: S.xl }]}>
            💬 {STR.notesLabel}
          </Text>
          <Text style={s.notesHint}>{STR.notesHint}</Text>

          <Text style={s.tagsTitle}>{STR.notesQuickTagsTitle}</Text>
          <View style={s.tagsRow}>
            {CONCIERGE_TAGS.map((tag) => {
              const isOn = notesTags.includes(tag.value);
              return (
                <TouchableOpacity
                  key={tag.value}
                  style={[s.tagChip, isOn && s.tagChipOn]}
                  onPress={() => toggleTag(tag)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isOn }}
                >
                  <Text style={[s.tagText, isOn && s.tagTextOn]}>
                    {tag.display}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={STR.notesPlaceholder}
            placeholderTextColor={C.text4}
            style={s.notesInput}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />

          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.bottomBar}>
        <Button
          label={STR.submitCta}
          onPress={onSubmit}
          disabled={!canSubmit}
          loading={submitting}
        />
      </View>
    </SafeAreaView>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function labelFor(a: UserAddress): string {
  if (a.label === 'other' && a.custom_label) return a.custom_label;
  const map: Record<string, string> = {
    home: '🏠 Home',
    work: '💼 Work',
    other: '📍 Other',
  };
  return map[a.label] ?? a.label;
}

function oneLineAddress(a: UserAddress): string {
  const parts = [
    a.flat_house_number,
    a.building_name,
    a.locality,
    a.city,
  ].filter(Boolean);
  return parts.join(', ');
}

function AddressDisplay({ address }: { address: UserAddress }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.addressLabel}>{labelFor(address)}</Text>
      {address.flat_house_number || address.building_name ? (
        <Text style={s.addressLine}>
          {[address.flat_house_number, address.building_name]
            .filter(Boolean)
            .join(', ')}
        </Text>
      ) : null}
      {address.locality ? (
        <Text style={s.addressLine}>{address.locality}</Text>
      ) : null}
      <Text style={s.addressLine}>
        {[address.city, address.pincode].filter(Boolean).join(' ')}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    flex: 1,
  },
  body: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xl,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },

  setUpEmoji: { fontSize: 56, marginBottom: S.md },
  setUpTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },

  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: S.sm,
  },

  // Address card
  addressCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
    gap: S.md,
  },
  addressEmpty: { fontSize: 14, color: C.text3, flex: 1 },
  addressLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  addressLine: {
    fontSize: 13,
    color: C.text2,
    lineHeight: 18,
  },
  changeBtn: {
    paddingHorizontal: S.sm,
    paddingVertical: 6,
  },
  changeBtnText: {
    fontSize: 13,
    color: C.honey,
    fontWeight: '600',
  },
  pickerBlock: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    marginTop: S.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerRowOn: { backgroundColor: C.honeyLight },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  pickerLine: {
    fontSize: 12,
    color: C.text3,
    marginTop: 2,
  },
  pickerTick: {
    fontSize: 18,
    color: C.honeyDeep,
    fontWeight: '700',
  },
  addNewRow: {
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  addNewText: {
    fontSize: 14,
    color: C.honey,
    fontWeight: '600',
  },

  // Slots
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
  },
  slotChip: {
    minWidth: '47%',
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  slotChipOn: {
    backgroundColor: C.honeyLight,
    borderColor: C.honey,
  },
  slotDay: {
    fontSize: 13,
    color: C.text2,
    fontWeight: '500',
  },
  slotDayOn: { color: C.honeyDeep, fontWeight: '700' },
  slotTime: {
    fontSize: 15,
    color: C.text,
    fontWeight: '600',
    marginTop: 2,
  },
  slotTimeOn: { color: C.honeyDeep },
  fullyBooked: {
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    paddingVertical: S.lg,
    fontStyle: 'italic',
  },
  moreTimesBtn: {
    paddingVertical: S.sm,
    alignItems: 'flex-end',
  },
  moreTimesText: {
    fontSize: 13,
    color: C.honey,
    fontWeight: '600',
  },

  // Notes / tags
  notesHint: {
    fontSize: 12,
    color: C.text3,
    fontStyle: 'italic',
    marginBottom: S.md,
  },
  tagsTitle: {
    fontSize: 13,
    color: C.text2,
    marginBottom: S.sm,
    fontWeight: '500',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginBottom: S.md,
  },
  tagChip: {
    paddingHorizontal: S.md,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
  },
  tagChipOn: {
    backgroundColor: C.honeyLight,
    borderColor: C.honey,
  },
  tagText: { fontSize: 13, color: C.text2 },
  tagTextOn: { color: C.honeyDeep, fontWeight: '600' },
  notesInput: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 100,
  },

  bottomBar: {
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    backgroundColor: C.cream,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
});
