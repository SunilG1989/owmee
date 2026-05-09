/**
 * AddressPickerScreen — Address PRD section 4.3.
 *
 * The "Choose an address" surface for returning users. Two paths out:
 *   1. Tap "Use this" on an existing card → returns address_id to the
 *      caller via navigate-replace into LocationDetect's returnTo.
 *   2. Tap "+ Add a new address" → enters the 3-screen flow; when it
 *      finishes the new address auto-becomes default for the very-first
 *      case, and the picker (if still mounted) re-fetches on focus.
 *
 * For Phase 1 of the address PRD, this screen is reachable from
 * Concierge Phase 1's BookingStep3WhereWhen ("Use a different address"
 * tap). Phase 2 of the address PRD will also wire it into Profile,
 * Checkout, and self-service Sell.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Addresses, type UserAddress } from '../../../services/api';
import { BackButton, Button, EmptyState, ErrorState } from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';
import { LOCATION_KEY } from '../../../utils/storageKeys';

const LABEL_GLYPH: Record<UserAddress['label'], string> = {
  home: '🏠',
  work: '💼',
  other: '📍',
};

function cacheLocation(addr: UserAddress) {
  const labelText =
    addr.label === 'other' && addr.custom_label
      ? addr.custom_label
      : addr.label.charAt(0).toUpperCase() + addr.label.slice(1);
  const fullAddress = [
    addr.flat_house_number,
    addr.building_name,
    addr.address_line_1,
    addr.locality,
    addr.city,
    addr.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  return AsyncStorage.setItem(
    LOCATION_KEY,
    JSON.stringify({
      lat: addr.lat,
      lng: addr.lng,
      city: addr.city,
      locality: addr.locality ?? undefined,
      state: addr.state,
      pincode: addr.pincode ?? undefined,
      fullAddress,
      addressId: addr.id,
      label: labelText,
    }),
  );
}

export default function AddressPickerScreen({
  navigation,
  route,
}: RootScreen<'AddressPicker'>) {
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await Addresses.list();
      setAddresses(res.data);
    } catch (e: any) {
      setError(
        e?.response?.data?.detail?.message ||
          'Could not load your saved addresses.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onAddNew = () => {
    // Re-uses the 3-screen flow. After save the new address row will be
    // present on focus when we come back here.
    navigation.navigate('LocationDetect', {
      returnTo: route.params?.returnTo === 'MainTabs' ? 'MainTabs' : 'AddressPicker',
    });
  };

  const onUse = async (addr: UserAddress) => {
    const returnTo = route.params?.returnTo;
    // P0 (2026-05-03): when the caller is Checkout (or anywhere else that
    // reads @ow_address as the source of truth for the active delivery
    // address), snapshot the chosen address into AsyncStorage so the
    // returning screen reflects the selection on next focus.
    if (returnTo === 'Checkout') {
      try {
        await AsyncStorage.setItem(
          '@ow_address',
          JSON.stringify({
            id: addr.id,
            full_name: addr.full_name,
            phone_number: addr.phone_number,
            house: addr.flat_house_number,
            building: addr.building_name,
            street: addr.address_line_1,
            locality: addr.locality,
            city: addr.city,
            state: addr.state,
            pincode: addr.pincode,
          }),
        );
      } catch {
        // non-blocking — checkout will fall back to its existing logic
      }
    } else {
      try {
        setSelectingId(addr.id);
        const selected = addr.is_default
          ? addr
          : (await Addresses.update(addr.id, { is_default: true })).data;
        await cacheLocation(selected);
      } catch (e: any) {
        Alert.alert(
          'Could not change location',
          e?.response?.data?.detail?.message || 'Please try again.',
        );
        setSelectingId(null);
        return;
      }
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const renderHeader = () => (
    <View style={s.headerRow}>
      <BackButton onPress={() => navigation.goBack()} />
      <Text style={s.headerTitle}>Choose an address</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        {renderHeader()}
        <View style={s.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        {renderHeader()}
        <ErrorState
          title="Couldn't load addresses"
          body={error}
          onRetry={load}
        />
      </SafeAreaView>
    );
  }

  if (addresses.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        {renderHeader()}
        <EmptyState
          glyph="📍"
          title="No saved addresses yet"
          body="Add your first address to start using Owmee."
          ctaLabel="+ Add a new address"
          onCtaPress={onAddNew}
        />
      </SafeAreaView>
    );
  }

  const onEdit = (addr: UserAddress) => {
    navigation.navigate('AddressDetails', {
      lat: addr.lat,
      lng: addr.lng,
      source: addr.source === 'gps_detected' ? 'gps_detected' : 'manual',
      reverse: null,
      returnTo: 'AddressPicker',
      edit: addr,
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {renderHeader()}
      <FlatList
        data={addresses}
        keyExtractor={(a) => a.id}
        contentContainerStyle={s.listBody}
        renderItem={({ item }) => (
          <AddressCard
            address={item}
            onUse={() => onUse(item)}
            onEdit={() => onEdit(item)}
            selecting={selectingId === item.id}
          />
        )}
        ListFooterComponent={
          <Button
            label="+ Add a new address"
            variant="ghost"
            onPress={onAddNew}
            style={s.addNew}
          />
        }
      />
    </SafeAreaView>
  );
}

function AddressCard({
  address,
  onUse,
  onEdit,
  selecting,
}: {
  address: UserAddress;
  onUse: () => void;
  onEdit: () => void;
  selecting?: boolean;
}) {
  const labelText =
    address.label === 'other' && address.custom_label
      ? address.custom_label
      : address.label.charAt(0).toUpperCase() + address.label.slice(1);

  const lines = [
    [address.flat_house_number, address.building_name].filter(Boolean).join(', '),
    [address.address_line_1, address.locality].filter(Boolean).join(', '),
    [address.city, address.pincode].filter(Boolean).join(' '),
  ].filter(Boolean);

  // Highlight rows that fail the P0 trust-floor (missing recipient name or
  // phone) — these will be rejected at checkout. Tapping Edit opens the
  // detail screen pre-filled so the user can fix in-app.
  const incomplete = !address.full_name || !address.phone_number;

  return (
    <View style={[s.card, incomplete && s.cardIncomplete]}>
      <View style={s.cardHead}>
        <Text style={s.cardLabel}>
          {LABEL_GLYPH[address.label]} {labelText}
        </Text>
        {address.is_default ? (
          <Text style={s.cardDefault}>★ default</Text>
        ) : null}
      </View>
      {address.full_name ? (
        <Text style={s.cardLine}>{address.full_name}{address.phone_number ? ` · +91 ${address.phone_number}` : ''}</Text>
      ) : null}
      {lines.map((line, i) => (
        <Text key={i} style={s.cardLine}>
          {line}
        </Text>
      ))}
      {incomplete ? (
        <Text style={s.cardWarn}>
          Recipient name or phone missing — required at checkout. Tap Edit.
        </Text>
      ) : null}
      <View style={s.cardActions}>
        <Button
          label="Edit"
          onPress={onEdit}
          variant="ghost"
          size="sm"
          style={s.useBtn}
        />
        <Button
          label="Use this"
          onPress={onUse}
          variant="secondary"
          size="sm"
          loading={selecting}
          style={s.useBtn}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listBody: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xl,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardIncomplete: {
    borderWidth: 1.5,
    borderColor: C.red,
  },
  cardWarn: {
    marginTop: S.sm,
    fontSize: T.size.sm,
    color: C.red,
    fontWeight: T.weight.semi,
  },
  cardActions: {
    flexDirection: 'row',
    gap: S.sm,
    marginTop: S.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.sm,
  },
  cardLabel: {
    fontSize: T.size.lg - 1,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  cardDefault: {
    fontSize: T.size.sm,
    color: C.petrolDeep,
    fontWeight: T.weight.semi,
  },
  cardLine: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    lineHeight: 20,
  },
  useBtn: {
    marginTop: S.md,
    alignSelf: 'flex-start',
  },
  addNew: {
    marginTop: S.md,
    alignSelf: 'center',
  },
});
