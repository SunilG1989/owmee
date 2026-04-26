/**
 * ListingDetailScreen
 *
 * All trust signals above the fold (design v3):
 * - Price + condition + KYC badge
 * - Accessories, warranty, locality, battery — 2×2 metadata grid
 * - "Protected transaction" trust bar
 * - Seller: name, rating, deal count, verified
 * - IMEI-verified / price anomaly warning if applicable
 *
 * CTAs: Make offer (secondary) + Reserve now (primary)
 * India UX: is_negotiable determines if offer is available
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, ActivityIndicator, Image, Alert, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius, Shadow } from '../../utils/tokens';
import { Listings, Wishlist, Offers } from '../../services/api';
import type { Listing } from '../../services/api';
import { TrustBadge, ConditionBadge } from '../../components/listing/ListingCard';
import type { AppStackParams } from '../../navigation/RootNavigator';
import { useAuthStore } from '../../store/authStore';

const { width } = Dimensions.get('window');
type Nav = NativeStackNavigationProp<AppStackParams>;
type Route = RouteProp<AppStackParams, 'ListingDetail'>;

// ── Metadata tile ─────────────────────────────────────────────────────────────

function MetaTile({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <View style={styles.metaTile}>
      <Text style={styles.metaTileLabel}>{label}</Text>
      <Text style={styles.metaTileValue} numberOfLines={1}>
        {icon ? `${icon} ` : ''}{value}
      </Text>
    </View>
  );
}

// ── Kids safety checklist ─────────────────────────────────────────────────────

function KidsSafetyChecklist({ listing }: { listing: Listing }) {
  if (!listing.is_kids_item) return null;
  return (
    <View style={styles.kidsChecklist}>
      <Text style={styles.kidsChecklistTitle}>safety checklist</Text>
      {listing.age_suitability && (
        <View style={styles.kidsRow}>
          <Text style={styles.kidsCheck}>✓</Text>
          <Text style={styles.kidsCheckText}>Age suitability: {listing.age_suitability}</Text>
        </View>
      )}
      {listing.hygiene_status && (
        <View style={styles.kidsRow}>
          <Text style={styles.kidsCheck}>✓</Text>
          <Text style={styles.kidsCheckText}>{listing.hygiene_status}</Text>
        </View>
      )}
      {listing.accessories && (
        <View style={styles.kidsRow}>
          <Text style={styles.kidsCheck}>✓</Text>
          <Text style={styles.kidsCheckText}>{listing.accessories}</Text>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ListingDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { listingId } = route.params;
  const { tier } = useAuthStore();

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerLoading, setOfferLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Listings.get(listingId);
      setListing(res.data);
    } catch (e) {
      Alert.alert('Error', 'Could not load this listing.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  const handleWishlist = async () => {
    if (!listing) return;
    try {
      if (wishlisted) {
        await Wishlist.remove(listing.id);
        setWishlisted(false);
      } else {
        await Wishlist.add(listing.id);
        setWishlisted(true);
      }
    } catch (e) { /* silent */ }
  };

  const handleOffer = () => {
    if (tier !== 'verified') {
      navigation.navigate('KycFlow', { returnTo: `listing/${listingId}` });
      return;
    }
    setOfferPrice(listing ? String(Math.round(Number(listing.price) * 0.9)) : '');
    setShowOfferModal(true);
  };

  const submitOffer = async () => {
    const price = parseInt(offerPrice, 10);
    if (!price || price <= 0) {
      Alert.alert('Invalid price', 'Enter a valid offer amount.');
      return;
    }
    setOfferLoading(true);
    try {
      await Offers.make(listingId, price, offerNote || undefined);
      setShowOfferModal(false);
      setOfferNote('');
      Alert.alert('Offer sent!', 'The seller will respond within the offer window.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not send offer');
    } finally {
      setOfferLoading(false);
    }
  };

  const handleReserve = () => {
    if (tier !== 'verified') {
      navigation.navigate('KycFlow', { returnTo: `listing/${listingId}` });
      return;
    }
    // Reserve = offer at listed price
    const price = listing ? Number(listing.price) : 0;
    Alert.alert(
      'Reserve at listed price?',
      `Send an offer of ₹${price.toLocaleString('en-IN')} — the seller can accept immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reserve',
          onPress: async () => {
            try {
              await Offers.make(listingId, price);
              Alert.alert('Reserved!', 'Seller has been notified. They will confirm the meetup.');
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not reserve');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.teal} />
      </View>
    );
  }

  if (!listing) return null;

  const price = parseFloat(listing.price).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const seller = listing.seller;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>{listing.title}</Text>
        <TouchableOpacity onPress={handleWishlist} style={styles.wishlistBtn}>
          <Text style={styles.wishlistIcon}>{wishlisted ? '❤️' : '♡'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Image */}
        <View style={styles.imageContainer}>
          {listing.image_urls.length > 0 ? (
            <Image
              source={{ uri: listing.image_urls[0] }}
              style={styles.mainImage}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.mainImage, styles.imagePlaceholder]}>
              <Text style={styles.imagePlaceholderText}>📷</Text>
            </View>
          )}
          {/* Image count pill */}
          {listing.image_urls.length > 1 && (
            <View style={styles.imageCount}>
              <Text style={styles.imageCountText}>1 / {listing.image_urls.length}</Text>
            </View>
          )}
        </View>

        {/* Main content */}
        <View style={styles.mainContent}>

          {/* Price + condition + badges */}
          <View style={styles.priceRow}>
            <View style={styles.priceLeft}>
              <Text style={styles.price}>₹{price}</Text>
              {!listing.is_negotiable && (
                <View style={styles.fixedBadge}>
                  <Text style={styles.fixedBadgeText}>Fixed price</Text>
                </View>
              )}
            </View>
            <ConditionBadge condition={listing.condition} />
          </View>

          {/* Trust badges row */}
          <View style={styles.badgeRow}>
            {seller?.kyc_verified && (
              <TrustBadge
                kyc_verified={seller.kyc_verified}
                deal_count={seller.deal_count}
                avg_rating={seller.avg_rating}
                size="md"
              />
            )}
          </View>

          {/* Metadata grid — all above fold per design v3 */}
          {(listing.accessories || listing.warranty_info || listing.locality || listing.battery_health) && (
            <View style={styles.metaGrid}>
              {listing.accessories && (
                <MetaTile label="Accessories" value={listing.accessories} />
              )}
              {listing.warranty_info && (
                <MetaTile label="Warranty" value={listing.warranty_info} />
              )}
              {listing.locality && (
                <MetaTile label="Listed in" value={listing.locality} />
              )}
              {listing.battery_health != null && (
                <MetaTile label="Battery" value={`${listing.battery_health}% health`} />
              )}
            </View>
          )}

          {/* Kids safety checklist */}
          <KidsSafetyChecklist listing={listing} />

          {/* Trust bar — "Protected transaction" */}
          <View style={styles.trustBar}>
            <Text style={styles.trustBarIcon}>🔒</Text>
            <View style={styles.trustBarText}>
              <Text style={styles.trustBarTitle}>Protected transaction</Text>
              <Text style={styles.trustBarSub}>Pay only after you verify the item in person</Text>
            </View>
          </View>

          {/* Seller */}
          {seller && (
            <View style={styles.sellerCard}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerAvatarText}>
                  {listing.seller?.id?.slice(0, 1).toUpperCase() ?? 'S'}
                </Text>
              </View>
              <View style={styles.sellerInfo}>
                <Text style={styles.sellerName}>Seller</Text>
                <Text style={styles.sellerMeta}>
                  {seller.avg_rating ? `★ ${seller.avg_rating.toFixed(1)}` : '★ —'}
                  {' · '}{seller.deal_count} deal{seller.deal_count !== 1 ? 's' : ''}
                  {seller.kyc_verified ? ' · KYC verified' : ''}
                </Text>
              </View>
              <Text style={styles.sellerChevron}>›</Text>
            </View>
          )}

          {/* Description */}
          {listing.description ? (
            <View style={styles.descSection}>
              <Text style={styles.descTitle}>About this listing</Text>
              <Text style={styles.descText}>{listing.description}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.ctaBar}>
        {listing.is_negotiable ? (
          <TouchableOpacity style={styles.btnOffer} onPress={handleOffer} activeOpacity={0.8}>
            <Text style={styles.btnOfferText}>Make offer</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.btnReserve, !listing.is_negotiable && styles.btnReserveFull]}
          onPress={handleReserve}
          activeOpacity={0.8}
        >
          <Text style={styles.btnReserveText}>
            {listing.is_negotiable ? 'Reserve now →' : `Buy · ₹${price}`}
          </Text>
        </TouchableOpacity>
      </View>
    
      {/* Offer modal */}
      <Modal visible={showOfferModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Make an offer</Text>
            <Text style={styles.modalSub}>Listed at ₹{listing ? Number(listing.price).toLocaleString('en-IN') : ''}</Text>
            <View style={styles.modalInputRow}>
              <Text style={styles.modalCurrency}>₹</Text>
              <TextInput
                style={styles.modalInput}
                value={offerPrice}
                onChangeText={setOfferPrice}
                keyboardType="number-pad"
                placeholder="Your offer"
                placeholderTextColor={Colors.text4}
                autoFocus
              />
            </View>
            <TextInput
              style={styles.modalNoteInput}
              value={offerNote}
              onChangeText={setOfferNote}
              placeholder="Add a note (optional) — e.g. I can pick up today"
              placeholderTextColor={Colors.text4}
              maxLength={200}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowOfferModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, offerLoading && {opacity: 0.5}]}
                onPress={submitOffer}
                disabled={offerLoading}
              >
                {offerLoading
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.modalSubmitText}>Send offer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9F9F7' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9F9F7' },
  scroll: { flex: 1 },
  content: { paddingBottom: 100 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  backIcon: { fontSize: 18, color: Colors.text3 },
  topBarTitle: { flex: 1, fontSize: 14, fontWeight: '500', color: Colors.text },
  wishlistBtn: { padding: 4 },
  wishlistIcon: { fontSize: 18 },

  imageContainer: {
    height: 220,
    backgroundColor: '#EFEFED',
    position: 'relative',
  },
  mainImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: { fontSize: 56 },
  imageCount: {
    position: 'absolute',
    bottom: 10,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  imageCountText: { fontSize: 10, color: Colors.white },

  mainContent: {
    padding: Spacing.screen,
    gap: Spacing.md,
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  priceLeft: { gap: 4 },
  price: { fontSize: 26, fontWeight: '500', color: Colors.text, letterSpacing: -0.5 },
  fixedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.border2,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  fixedBadgeText: { fontSize: 10, color: Colors.text3, fontWeight: '500' },

  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },

  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  metaTile: {
    width: (width - Spacing.screen * 2 - Spacing.sm) / 2,
    backgroundColor: '#F5F5F3',
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  metaTileLabel: { fontSize: 9, color: Colors.text3, marginBottom: 3 },
  metaTileValue: { fontSize: 11, fontWeight: '500', color: Colors.text },

  trustBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.tealLight,
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
  },
  trustBarIcon: { fontSize: 16 },
  trustBarText: { flex: 1 },
  trustBarTitle: { fontSize: 12, fontWeight: '500', color: Colors.tealText },
  trustBarSub: { fontSize: 10, color: Colors.teal, marginTop: 2, lineHeight: 15 },

  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 0.5,
    borderColor: Colors.border,
    padding: Spacing.sm,
  },
  sellerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.tealLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerAvatarText: { fontSize: 14, fontWeight: '500', color: Colors.teal },
  sellerInfo: { flex: 1 },
  sellerName: { fontSize: 12, fontWeight: '500', color: Colors.text },
  sellerMeta: { fontSize: 10, color: Colors.teal, marginTop: 1 },
  sellerChevron: { fontSize: 16, color: Colors.text4 },

  descSection: { gap: 6 },
  descTitle: { fontSize: 11, fontWeight: '500', color: Colors.text2 },
  descText: { fontSize: 12, color: Colors.text2, lineHeight: 18 },

  kidsChecklist: {
    backgroundColor: Colors.kidsLight,
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
    borderWidth: 0.5,
    borderColor: 'rgba(255,154,92,0.2)',
  },
  kidsChecklistTitle: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.06,
    textTransform: 'uppercase',
    color: Colors.kids,
    marginBottom: 7,
  },
  kidsRow: { flexDirection: 'row', gap: 7, marginBottom: 4, alignItems: 'flex-start' },
  kidsCheck: { fontSize: 11, color: '#16a34a', fontWeight: '600', marginTop: 1 },
  kidsCheckText: { fontSize: 11, color: Colors.text2, flex: 1 },

  ctaBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  btnOffer: {
    flex: 1,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOfferText: { fontSize: 13, fontWeight: '500', color: Colors.teal },
  btnReserve: {
    flex: 2,
    padding: 13,
    borderRadius: 12,
    backgroundColor: Colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnReserveFull: { flex: 1 },
  btnReserveText: { fontSize: 13, fontWeight: '500', color: Colors.white },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.xl, paddingBottom: 40, gap: Spacing.md,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: Colors.text },
  modalSub: { fontSize: 13, color: Colors.text3, marginTop: -6 },
  modalInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bg, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border, paddingHorizontal: 14,
  },
  modalCurrency: { fontSize: 20, color: Colors.text, marginRight: 4 },
  modalInput: { flex: 1, fontSize: 24, fontWeight: '500', color: Colors.text, paddingVertical: 14 },
  modalNoteInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border,
    padding: 14, fontSize: 14, color: Colors.text, minHeight: 60,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.sm },
  modalCancel: {
    flex: 1, padding: 13, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center',
  },
  modalCancelText: { fontSize: 14, color: Colors.text2, fontWeight: '500' },
  modalSubmit: { flex: 2, padding: 13, borderRadius: Radius.md, backgroundColor: Colors.teal, alignItems: 'center' },
  modalSubmitText: { fontSize: 14, color: Colors.white, fontWeight: '500' },
});
