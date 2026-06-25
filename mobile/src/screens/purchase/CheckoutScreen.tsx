/**
 * CheckoutScreen — "Buy Now" flow (Circle-inspired)
 * Item summary → delivery address → payment → platform fee breakdown → Owmee Guarantee → Pay
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice } from '../../utils/tokens';
import { Addresses, Listings, Orders, type Listing, type PaymentCheckout, type UserAddress } from '../../services/api';
import { BackButton, Button } from '../../components/ui';
import { parseApiError } from '../../utils/errors';
import { afterInteractions } from '../../utils/schedule';
import {
  canOpenRazorpayCheckout,
  isRazorpayCheckoutExpiredError,
  isUserCancelledRazorpay,
  openRazorpayCheckout,
  razorpayFailureFromError,
} from '../../utils/razorpayCheckout';

const DELIVERY_FEE_BY_CATEGORY: Record<string, number> = {
  'small-appliances': 100,
};

export default function CheckoutScreen({ navigation, route }: any) {
  const { listingId } = route.params;
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [address, setAddress] = useState<UserAddress | null>(null);
  const [orderNotes, setOrderNotes] = useState('');

  // Listing once on mount; address re-reads on focus so address picker /
  // edit flows propagate back here without a manual refresh.
  useEffect(() => {
    const cancelTask = afterInteractions(async () => {
      try {
        const listRes = await Listings.get(listingId);
        setListing(listRes.data);
      } catch {
        Alert.alert('Error', 'Could not load listing');
        navigation.goBack();
      } finally { setLoading(false); }
    });
    return cancelTask;
  }, [listingId, navigation]);

  const reloadAddress = useCallback(async () => {
    try {
      const res = await Addresses.list();
      const def =
        res.data.find((a) => a.is_default) ??
        (res.data.length > 0 ? res.data[0] : null);
      setAddress(def);
    } catch {
      setAddress(null);
    }
  }, []);

  useFocusEffect(useCallback(() => afterInteractions(reloadAddress), [reloadAddress]));

  if (loading || !listing) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={C.petrol} style={s.loading} />
      </SafeAreaView>
    );
  }

  const itemPrice = listing.price;
  const deliveryFee = DELIVERY_FEE_BY_CATEGORY[listing.category_slug || ''] || 0;
  const total = itemPrice + deliveryFee;

  // Address must have a recipient name + phone to be deliverable. Older
  // addresses stored before the P0.1 schema upgrade may be missing these —
  // route the buyer back to the address screen rather than failing at the FE.
  const recipientName = address?.full_name || '';
  const recipientPhone = address?.phone_number || '';
  const addressDeliverable = !!recipientName && !!recipientPhone;

  const handlePay = async () => {
    if (!addressDeliverable) {
      Alert.alert(
        'Missing recipient details',
        'Please add the recipient name and phone number to your delivery address.',
      );
      return;
    }
    setPaying(true);
    try {
      const res = await Orders.buyNow(listingId, orderNotes, address?.id);
      const txnId = res.data?.transaction_id;
      const checkout = res.data?.payment_checkout;
      const paymentLink = res.data?.payment_link;

      if (txnId && canOpenRazorpayCheckout(checkout)) {
        let payment;
        try {
          payment = await openRazorpayCheckout(checkout);
        } catch (paymentError) {
          if (isRazorpayCheckoutExpiredError(paymentError)) {
            Alert.alert(
              'Payment window expired',
              'This order can no longer be paid. Please check the order screen for the latest status.',
            );
            navigation.replace('TransactionDetail', { transactionId: txnId });
            return;
          }
          if (isUserCancelledRazorpay(paymentError)) {
            await releaseCancelledCheckout(txnId);
            showPaymentCancelledOptions(txnId);
            return;
          }
          await reportPaymentFailure(txnId, checkout, paymentError);
          showPaymentFailedOptions(txnId);
          return;
        }
        try {
          const confirm = await Orders.confirmPayment(txnId, payment);
          if (confirm.data?.status !== 'payment_captured') {
            Alert.alert(
              'Payment is being verified',
              'Razorpay accepted the payment. Owmee will update this order as soon as verification completes.',
            );
          }
        } catch {
          Alert.alert(
            'Payment is being verified',
            'Razorpay accepted the payment, but Owmee could not confirm it immediately. The webhook will update this order shortly.',
          );
        }
        navigation.replace('TransactionDetail', { transactionId: txnId });
      } else if (paymentLink) {
        await Linking.openURL(paymentLink);
        if (txnId) {
          navigation.replace('TransactionDetail', { transactionId: txnId });
        }
      } else if (txnId) {
        navigation.replace('TransactionDetail', { transactionId: txnId });
      } else {
        navigation.replace('OrderConfirmation', {
          transactionId: 'pending',
          listing: { title: listing.title, price: listing.price, image: listing.images?.[0] },
          total: Number(res.data?.gross_amount || total),
        });
      }
    } catch (e: any) {
      Alert.alert('Could not start payment', parseApiError(e, 'Could not create the payment link. Please try again.'));
    } finally { setPaying(false); }
  };

  const reportPaymentFailure = async (transactionId: string, checkout: PaymentCheckout, error: unknown) => {
    try {
      return await Orders.reportPaymentFailure(transactionId, razorpayFailureFromError(checkout, error));
    } catch {
      // Webhook/report retry will cover this; don't block the buyer on telemetry.
      return null;
    }
  };

  const releaseCancelledCheckout = async (transactionId: string) => {
    try {
      await Orders.cancelUnpaidTransaction(transactionId, 'buyer_cancelled_payment');
    } catch {
      // The timeout sweeper still releases abandoned unpaid orders. Keep the
      // buyer moving to the order screen if this best-effort call fails.
    }
  };

  const showPaymentCancelledOptions = (transactionId: string) => {
    Alert.alert(
      'Payment cancelled',
      'No money was collected. Owmee has released the item so other buyers are not blocked.',
      [
        {
          text: 'View listing',
          onPress: () => navigation.replace('ListingDetail', { listingId }),
        },
        { text: 'View order', style: 'cancel', onPress: () => navigation.replace('TransactionDetail', { transactionId }) },
      ],
    );
  };

  const showPaymentFailedOptions = (transactionId: string) => {
    Alert.alert(
      'Payment failed',
      'No money was collected. Owmee has released the item, so you can try again only if it is still available.',
      [
        {
          text: 'View listing',
          onPress: () => navigation.replace('ListingDetail', { listingId }),
        },
        { text: 'View order', style: 'cancel', onPress: () => navigation.replace('TransactionDetail', { transactionId }) },
      ],
    );
  };

  const categoryEmoji =
    listing.category_slug === 'phones' ? '📱' :
    listing.category_slug === 'laptops' ? '💻' : '📦';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Checkout</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.itemCard}>
          <View style={s.itemImagePlaceholder}>
            <Text style={s.itemImageEmoji}>{categoryEmoji}</Text>
          </View>
          <View style={s.itemInfo}>
            <Text style={s.itemTitle} numberOfLines={2}>{listing.title}</Text>
            <Text style={s.itemPrice}>{formatPrice(itemPrice)}</Text>
            {listing.condition && <Text style={s.itemCondition}>{listing.condition}</Text>}
            {listing.seller_verified && (
              <View style={s.sellerBadge}>
                <Text style={s.sellerBadgeText}>✓ Verified seller</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>📍 Deliver to</Text>
          <TouchableOpacity
            style={s.addressCard}
            onPress={() => navigation.navigate('AddressPicker', { returnTo: 'Checkout' })}
          >
            {address ? (
              <>
                {recipientName ? (
                  <Text style={s.addressName}>{recipientName}</Text>
                ) : (
                  <Text style={s.addressMissing}>Add recipient name</Text>
                )}
                {recipientPhone ? (
                  <Text style={s.addressPhone}>+91 {recipientPhone}</Text>
                ) : (
                  <Text style={s.addressMissing}>Add a contact number</Text>
                )}
                <Text style={s.addressText}>
                  {[address.flat_house_number, address.building_name, address.address_line_1, address.locality].filter(Boolean).join(', ') || address.city}
                </Text>
                <Text style={s.addressCity}>{address.city} {address.pincode}</Text>
              </>
            ) : (
              <Text style={s.addressText}>Add delivery address</Text>
            )}
            <Text style={s.addressChange}>Change ▾</Text>
          </TouchableOpacity>

          <Text style={s.notesLabel}>Delivery instructions (optional)</Text>
          <TextInput
            value={orderNotes}
            onChangeText={setOrderNotes}
            placeholder="e.g. gate code 4521, leave with security, ring twice"
            placeholderTextColor={C.text4}
            style={s.notesInput}
            multiline
            maxLength={200}
          />
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>💳 Payment</Text>
          <View style={s.paymentCard}>
            <View style={s.upiIcon}>
              <Text style={s.upiIconText}>UPI</Text>
            </View>
            <View style={s.flex1}>
              <Text style={s.paymentLabel}>UPI Payment</Text>
              <Text style={s.paymentSub}>GPay, PhonePe, Paytm or any UPI app</Text>
            </View>
            <View style={s.radioOn}><View style={s.radioDot} /></View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Price details</Text>
          <View style={s.priceCard}>
            <View style={s.priceRow}>
              <Text style={s.priceLabel}>Item price</Text>
              <Text style={s.priceValue}>{formatPrice(itemPrice)}</Text>
            </View>
            <View style={s.priceRow}>
              <Text style={s.priceLabel}>Owmee fee</Text>
              <Text style={s.priceValue}>₹0</Text>
            </View>
            {deliveryFee > 0 && (
              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Delivery fee</Text>
                <Text style={s.priceValue}>{formatPrice(deliveryFee)}</Text>
              </View>
            )}
            <View style={s.priceDivider} />
            <View style={s.priceRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalValue}>{formatPrice(total)}</Text>
            </View>
          </View>
        </View>

        <View style={s.guarantee}>
          <Text style={s.guaranteeIcon}>🛡️</Text>
          <View style={s.flex1}>
            <Text style={s.guaranteeTitle}>Owmee Guarantee</Text>
            <Text style={s.guaranteeSub}>
              Every item is inspected by an Owmee expert before delivery.
              ✓ 100% refund if it's not as promised — refund processed in 5-7 working days.
            </Text>
          </View>
        </View>

        <View style={s.bottomSpacer} />
      </ScrollView>

      <View style={s.bottomBar}>
        <View>
          <Text style={s.bottomTotal}>{formatPrice(total)}</Text>
          <Text style={s.bottomSub}>Pay securely</Text>
        </View>
        <Button
          label={`Open payment ${formatPrice(total)} →`}
          variant="primary"
          size="lg"
          loading={paying}
          disabled={paying}
          onPress={handlePay}
          style={s.payBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  flex1: { flex: 1 },
  loading: { marginTop: S.xxxl + S.xxxl },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  headerSpacer: { width: 24 },

  body: { flex: 1, paddingHorizontal: S.lg, paddingTop: S.lg },

  itemCard: {
    flexDirection: 'row', gap: S.md + 2,
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1, borderColor: C.border,
    ...Shadow.card,
  },
  itemImagePlaceholder: {
    width: 80, height: 80, borderRadius: R.sm,
    backgroundColor: C.bone2,
    alignItems: 'center', justifyContent: 'center',
  },
  itemImageEmoji: { fontSize: T.size.display + 2 },                 // 32
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text, lineHeight: 20 },
  itemPrice: { fontSize: T.size.xl, fontWeight: T.weight.heavy, color: C.petrol, marginTop: S.xs },
  itemCondition: { fontSize: T.size.sm, color: C.text3, textTransform: 'capitalize', marginTop: 2 },
  sellerBadge: {
    marginTop: S.xs + 2, alignSelf: 'flex-start',
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.sm, paddingVertical: 3,
    borderRadius: R.xs,
  },
  sellerBadgeText: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.petrol },

  section: { marginTop: S.xl },
  sectionTitle: { fontSize: T.size.sm + 1, fontWeight: T.weight.bold, color: C.ink, marginBottom: S.sm },

  addressCard: {
    backgroundColor: C.surface, borderRadius: R.sm,
    padding: S.md + 2,
    borderWidth: 0.5, borderColor: C.border,
    flexDirection: 'column', gap: 2,
  },
  addressName: { fontSize: T.size.md, color: C.text, fontWeight: T.weight.bold, marginBottom: 2 },
  addressPhone: { fontSize: T.size.base, color: C.text2, marginBottom: 6 },
  addressMissing: { fontSize: T.size.base, color: C.red, fontWeight: T.weight.semi, marginBottom: 4 },
  addressText: { fontSize: T.size.sm + 1, color: C.text, fontWeight: T.weight.medium },
  addressCity: { fontSize: T.size.sm, color: C.text3 },
  addressChange: { fontSize: T.size.base, color: C.petrol, fontWeight: T.weight.semi },
  notesLabel: {
    fontSize: T.size.base,
    color: C.text2,
    fontWeight: T.weight.semi,
    marginTop: S.md,
    marginBottom: S.xs,
  },
  notesInput: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    fontSize: T.size.base,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 64,
    textAlignVertical: 'top',
  },

  paymentCard: {
    flexDirection: 'row', alignItems: 'center', gap: S.md,
    backgroundColor: C.surface, borderRadius: R.sm,
    padding: S.md + 2,
    borderWidth: 1, borderColor: C.petrol,
  },
  upiIcon: {
    width: 40, height: 40, borderRadius: R.xs + 2,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
  },
  upiIconText: { fontSize: T.size.lg - 1, fontWeight: T.weight.bold, color: C.petrol },
  paymentLabel: { fontSize: T.size.sm + 1, fontWeight: T.weight.semi, color: C.text },
  paymentSub: { fontSize: T.size.sm, color: C.text3, marginTop: 1 },
  radioOn: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: C.petrol,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.petrol },

  priceCard: {
    backgroundColor: C.surface, borderRadius: R.sm,
    padding: S.lg,
    borderWidth: 0.5, borderColor: C.border,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.xs + 2 },
  priceLabel: { fontSize: T.size.base, color: C.text3 },
  priceValue: { fontSize: T.size.base, color: C.text, fontWeight: T.weight.medium },
  priceDivider: { height: 1, backgroundColor: C.border, marginVertical: S.sm },
  totalLabel: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.ink },
  totalValue: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.petrol },

  guarantee: {
    flexDirection: 'row', gap: S.md,
    backgroundColor: C.petrolLight, borderRadius: R.lg,
    padding: S.lg, marginTop: S.xl,
    borderWidth: 1, borderColor: C.border,
  },
  guaranteeIcon: { fontSize: T.size.xl },
  guaranteeTitle: { fontSize: T.size.sm + 1, fontWeight: T.weight.bold, color: C.petrol },
  guaranteeSub: { fontSize: T.size.sm, color: C.petrolText, lineHeight: 17, marginTop: 2 },

  bottomSpacer: { height: 120 },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.md + 2,
    backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  bottomTotal: { fontSize: T.size.lg + 1, fontWeight: T.weight.heavy, color: C.ink },
  bottomSub: { fontSize: T.size.sm, color: C.text3 },
  payBtn: { ...Shadow.glow },
});
