/**
 * CheckoutScreen — "Buy Now" flow (Circle-inspired)
 * Item summary → delivery address → payment → platform fee breakdown → Owmee Guarantee → Pay
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, T, S, R, Shadow, formatPrice } from '../../utils/tokens';
import { Listings, Orders, type Listing } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { parseApiError } from '../../utils/errors';
import type { RootScreen } from '../../navigation/types';

const PLATFORM_FEE_PERCENT = 0.02; // 2%
const GST_RATE = 0.18; // 18% on platform fee

export default function CheckoutScreen({ navigation, route }: any) {
  const { listingId } = route.params;
  const { kycStatus, userId } = useAuthStore();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [address, setAddress] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const [listRes, addrStr] = await Promise.all([
          Listings.get(listingId),
          AsyncStorage.getItem('@ow_location'),
        ]);
        setListing(listRes.data);
        if (addrStr) {
          const loc = JSON.parse(addrStr);
          // Also try to get full address from registration
          const profileStr = await AsyncStorage.getItem('@ow_address');
          if (profileStr) setAddress(JSON.parse(profileStr));
          else setAddress({ city: loc.city, pincode: loc.pincode || '' });
        }
      } catch (e) {
        Alert.alert('Error', 'Could not load listing');
        navigation.goBack();
      } finally { setLoading(false); }
    })();
  }, [listingId]);

  if (loading || !listing) {
    return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  const itemPrice = listing.price;
  const platformFee = Math.round(itemPrice * PLATFORM_FEE_PERCENT);
  const gstOnFee = Math.round(platformFee * GST_RATE);
  const total = itemPrice + platformFee + gstOnFee;

  const handlePay = async () => {
    setPaying(true);
    try {
      // Create offer at listing price (Buy Now = offer at asking price, auto-accepted)
      const res = await Orders.buyNow(listingId);
      const txnId = res.data?.transaction_id;
      
      // Navigate to order confirmation
      navigation.replace('OrderConfirmation', {
        transactionId: txnId || 'pending',
        listing: { title: listing.title, price: listing.price, image: listing.images?.[0] },
        total,
      });
    } catch (e: any) {
      Alert.alert('Payment failed', parseApiError(e, 'Could not complete purchase. Please try again.'));
    } finally { setPaying(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Checkout</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        {/* Item summary */}
        <View style={s.itemCard}>
          <View style={s.itemImagePlaceholder}>
            <Text style={{ fontSize: 32 }}>{listing.category_slug === 'phones' ? '📱' : listing.category_slug === 'laptops' ? '💻' : '📦'}</Text>
          </View>
          <View style={s.itemInfo}>
            <Text style={s.itemTitle} numberOfLines={2}>{listing.title}</Text>
            <Text style={s.itemPrice}>{formatPrice(itemPrice)}</Text>
            {listing.condition && <Text style={s.itemCondition}>{listing.condition}</Text>}
            {listing.seller_verified && (
              <View style={s.sellerBadge}><Text style={s.sellerBadgeText}>✓ Verified seller</Text></View>
            )}
          </View>
        </View>

        {/* Delivery address */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>📍 Deliver to</Text>
          <TouchableOpacity style={s.addressCard} onPress={() => Alert.alert('Coming soon', 'Address selection will be available shortly.')}>
            {address ? (
              <>
                <Text style={s.addressText}>
                  {[address.house, address.street, address.locality].filter(Boolean).join(', ') || address.city}
                </Text>
                <Text style={s.addressCity}>{address.city} {address.pincode}</Text>
              </>
            ) : (
              <Text style={s.addressText}>Add delivery address</Text>
            )}
            <Text style={{ fontSize: 13, color: C.honey, fontWeight: '600' }}>Change ▾</Text>
          </TouchableOpacity>
        </View>

        {/* Payment method */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>💳 Payment</Text>
          <View style={s.paymentCard}>
            <View style={s.upiIcon}><Text style={{ fontSize: 16, fontWeight: '700', color: C.forest }}>UPI</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.paymentLabel}>UPI Payment</Text>
              <Text style={s.paymentSub}>GPay, PhonePe, Paytm or any UPI app</Text>
            </View>
            <View style={s.radioOn}><View style={s.radioDot} /></View>
          </View>
        </View>

        {/* Price breakdown */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Price details</Text>
          <View style={s.priceCard}>
            <View style={s.priceRow}><Text style={s.priceLabel}>Item price</Text><Text style={s.priceValue}>{formatPrice(itemPrice)}</Text></View>
            <View style={s.priceRow}><Text style={s.priceLabel}>Platform fee (2%)</Text><Text style={s.priceValue}>{formatPrice(platformFee)}</Text></View>
            <View style={s.priceRow}><Text style={s.priceLabel}>GST (18% on fee)</Text><Text style={s.priceValue}>{formatPrice(gstOnFee)}</Text></View>
            <View style={s.priceDivider} />
            <View style={s.priceRow}><Text style={s.totalLabel}>Total</Text><Text style={s.totalValue}>{formatPrice(total)}</Text></View>
          </View>
        </View>

        {/* Owmee Guarantee */}
        <View style={s.guarantee}>
          <Text style={{ fontSize: 20 }}>🛡️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.guaranteeTitle}>Owmee Guarantee</Text>
            <Text style={s.guaranteeSub}>Your money is held safely by our payment partner until you confirm receipt. Full refund if item doesn't match the listing.</Text>
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Pay button — fixed at bottom */}
      <View style={s.bottomBar}>
        <View>
          <Text style={s.bottomTotal}>{formatPrice(total)}</Text>
          <Text style={s.bottomSub}>Total amount</Text>
        </View>
        <TouchableOpacity style={s.payBtn} onPress={handlePay} disabled={paying} activeOpacity={0.85}>
          {paying ? <ActivityIndicator color="#fff" /> : <Text style={s.payBtnText}>Pay {formatPrice(total)} →</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  itemCard: { flexDirection: 'row', gap: 14, backgroundColor: C.surface, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.border, ...Shadow.card },
  itemImagePlaceholder: { width: 80, height: 80, borderRadius: R.sm, backgroundColor: C.sand, alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: C.text, lineHeight: 20 },
  itemPrice: { fontSize: 20, fontWeight: '800', color: C.honey, marginTop: 4 },
  itemCondition: { fontSize: 11, color: C.text3, textTransform: 'capitalize', marginTop: 2 },
  sellerBadge: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: C.forestLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  sellerBadgeText: { fontSize: 10, fontWeight: '700', color: C.forest },
  section: { marginTop: S.xl },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.ink, marginBottom: S.sm },
  addressCard: { backgroundColor: C.surface, borderRadius: R.sm, padding: 14, borderWidth: 0.5, borderColor: C.border, flexDirection: 'column', gap: 2 },
  addressText: { fontSize: 14, color: C.text, fontWeight: '500' },
  addressCity: { fontSize: 12, color: C.text3 },
  paymentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.sm, padding: 14, borderWidth: 1, borderColor: C.forest },
  upiIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.forestLight, alignItems: 'center', justifyContent: 'center' },
  paymentLabel: { fontSize: 14, fontWeight: '600', color: C.text },
  paymentSub: { fontSize: 11, color: C.text3, marginTop: 1 },
  radioOn: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.forest, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.forest },
  priceCard: { backgroundColor: C.surface, borderRadius: R.sm, padding: 16, borderWidth: 0.5, borderColor: C.border },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  priceLabel: { fontSize: 13, color: C.text3 },
  priceValue: { fontSize: 13, color: C.text, fontWeight: '500' },
  priceDivider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  totalValue: { fontSize: 15, fontWeight: '700', color: C.honey },
  guarantee: { flexDirection: 'row', gap: 12, backgroundColor: C.forestLight, borderRadius: R.lg, padding: 16, marginTop: S.xl, borderWidth: 1, borderColor: '#cde9dc' },
  guaranteeTitle: { fontSize: 14, fontWeight: '700', color: C.forest },
  guaranteeSub: { fontSize: 12, color: C.forestText, lineHeight: 17, marginTop: 2 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  bottomTotal: { fontSize: 18, fontWeight: '800', color: C.ink },
  bottomSub: { fontSize: 11, color: C.text3 },
  payBtn: { backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: 28, paddingVertical: 14, ...Shadow.glow },
  payBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  gateTitle: { fontSize: 20, fontWeight: '700', color: C.ink, marginBottom: 8 },
  gateSub: { fontSize: 13, color: C.text3, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  gateCta: { backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: 28, paddingVertical: 14 },
});
