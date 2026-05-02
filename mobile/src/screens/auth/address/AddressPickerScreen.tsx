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
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Addresses, type UserAddress } from '../../../services/api';
import { BackButton, Button, EmptyState, ErrorState } from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

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
    useCallback(() => {
      load();
    }, [load]),
  );

  const onAddNew = () => {
    // Re-uses the 3-screen flow. After save the new address row will be
    // present on focus when we come back here.
    navigation.navigate('LocationDetect', {
      returnTo: 'AddressPicker',
    });
  };

  const onUse = (addr: UserAddress) => {
    // Phase 1 use case: caller is Concierge BookingStep3 (which doesn't
    // exist yet). For now we pop back; the calling screen reads the
    // chosen id from a navigation param state hook on its end. Concierge
    // Phase 1 will wire this with proper params.
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
          <ActivityIndicator color={C.honey} />
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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {renderHeader()}
      <FlatList
        data={addresses}
        keyExtractor={(a) => a.id}
        contentContainerStyle={s.listBody}
        renderItem={({ item }) => (
          <AddressCard address={item} onUse={() => onUse(item)} />
        )}
        ListFooterComponent={
          <TouchableOpacity
            style={s.addNew}
            onPress={onAddNew}
            activeOpacity={0.7}
          >
            <Text style={s.addNewText}>+ Add a new address</Text>
          </TouchableOpacity>
        }
      />
    </SafeAreaView>
  );
}

function AddressCard({
  address,
  onUse,
}: {
  address: UserAddress;
  onUse: () => void;
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

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardLabel}>
          {LABEL_GLYPH[address.label]} {labelText}
        </Text>
        {address.is_default ? (
          <Text style={s.cardDefault}>★ default</Text>
        ) : null}
      </View>
      {lines.map((line, i) => (
        <Text key={i} style={s.cardLine}>
          {line}
        </Text>
      ))}
      <Button
        label="Use this"
        onPress={onUse}
        variant="secondary"
        size="sm"
        style={s.useBtn}
      />
    </View>
  );
}

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
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.sm,
  },
  cardLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  cardDefault: {
    fontSize: 12,
    color: C.honeyDeep,
    fontWeight: '600',
  },
  cardLine: {
    fontSize: 14,
    color: C.text2,
    lineHeight: 20,
  },
  useBtn: {
    marginTop: S.md,
    alignSelf: 'flex-start',
  },
  addNew: {
    paddingVertical: S.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNewText: {
    fontSize: 16,
    color: C.honey,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
