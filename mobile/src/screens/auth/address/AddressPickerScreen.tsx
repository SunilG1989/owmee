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
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Addresses, type UserAddress } from '../../../services/api';
import {
  Button, EmptyState, ErrorState, ScreenHeader,
} from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';
import { cacheAddressLocation } from '../../../utils/addressLocation';
import { afterInteractions } from '../../../utils/schedule';

const LABEL_GLYPH: Record<UserAddress['label'], string> = {
  home: '🏠',
  work: '💼',
  other: '📍',
};

export default function AddressPickerScreen({
  navigation,
  route,
}: RootScreen<'AddressPicker'>) {
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    useCallback(() => afterInteractions(load), [load]),
  );

  const onAddNew = () => {
    // Re-uses the 3-screen flow. After save the new address row will be
    // present on focus when we come back here. Checkout is special: a
    // newly-created address should become the active delivery address and
    // return directly to checkout instead of forcing an extra "Use this" tap.
    const returnTo = route.params?.returnTo;
    navigation.navigate('LocationDetect', {
      returnTo:
        returnTo === 'Checkout'
          ? 'Checkout'
          : returnTo === 'MainTabs'
            ? 'MainTabs'
            : 'AddressPicker',
    });
  };

  const onUse = async (addr: UserAddress) => {
    const returnTo = route.params?.returnTo;

    // Checkout keeps the expected quick picker behaviour: choose a saved
    // delivery address and return. Home/default-location changes go through
    // map confirmation so users can verify the pin before Owmee saves it.
    if (returnTo === 'Checkout') {
      try {
        const selected = addr.is_default
          ? addr
          : (await Addresses.update(addr.id, { is_default: true })).data;
        await cacheAddressLocation(selected).catch(() => {});
      } catch {
        setError('Could not set this address. Please try again.');
        return;
      }
      if (navigation.canGoBack()) navigation.goBack();
      return;
    }

    navigation.navigate('LocationMap', {
      initialLat: addr.lat,
      initialLng: addr.lng,
      source: addr.source === 'gps_detected' ? 'gps_detected' : 'manual',
      returnTo: returnTo === 'MainTabs' ? 'MainTabs' : 'AddressPicker',
      reviewAddress: addr,
    });
  };

  const renderHeader = () => (
    <ScreenHeader title="Choose an address" onBack={() => navigation.goBack()} tone="canvas" />
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
            confirmOnMap={route.params?.returnTo !== 'Checkout'}
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
  confirmOnMap,
}: {
  address: UserAddress;
  onUse: () => void;
  onEdit: () => void;
  confirmOnMap?: boolean;
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
          label={confirmOnMap ? 'Confirm on map' : 'Use this'}
          onPress={onUse}
          variant="secondary"
          size="sm"
          style={s.useBtn}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
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
