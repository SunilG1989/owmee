/**
 * Shared listing components
 * Used across Home, Search, Browse, Kids screens.
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Dimensions,
} from 'react-native';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../utils/tokens';
import type { Listing } from '../../services/api';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - Spacing.screen * 2 - Spacing.sm) / 2;

// ── Trust badge ───────────────────────────────────────────────────────────────

interface TrustBadgeProps {
  kyc_verified: boolean;
  deal_count?: number;
  avg_rating?: number;
  size?: 'sm' | 'md';
}

export function TrustBadge({ kyc_verified, deal_count, avg_rating, size = 'sm' }: TrustBadgeProps) {
  if (!kyc_verified) return null;

  const isSm = size === 'sm';
  const fs = isSm ? 8 : 10;
  const py = isSm ? 2 : 4;
  const px = isSm ? 6 : 8;

  return (
    <View style={[styles.trustBadge, { paddingVertical: py, paddingHorizontal: px }]}>
      <View style={[styles.trustDot, isSm && styles.trustDotSm]} />
      <Text style={[styles.trustText, { fontSize: fs }]}>
        {deal_count !== undefined && deal_count > 0
          ? `KYC · ★${avg_rating ?? '—'} · ${deal_count} deals`
          : 'KYC verified'}
      </Text>
    </View>
  );
}

// ── Condition badge ───────────────────────────────────────────────────────────

const CONDITION_LABELS: Record<string, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
};

export function ConditionBadge({ condition }: { condition: string }) {
  return (
    <View style={styles.condBadge}>
      <Text style={styles.condText}>{CONDITION_LABELS[condition] ?? condition}</Text>
    </View>
  );
}

// ── Negotiable pill ───────────────────────────────────────────────────────────

export function NegotiablePill({ is_negotiable }: { is_negotiable: boolean }) {
  if (is_negotiable) return null; // negotiable is default, only show fixed
  return (
    <View style={styles.fixedPill}>
      <Text style={styles.fixedText}>Fixed price</Text>
    </View>
  );
}

// ── Listing card (2-col grid) ─────────────────────────────────────────────────

interface ListingCardProps {
  listing: Listing;
  onPress: () => void;
  isKidsContext?: boolean;
}

export function ListingCard({ listing, onPress, isKidsContext }: ListingCardProps) {
  const price = parseFloat(listing.price).toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  });

  return (
    <TouchableOpacity
      style={[styles.card, isKidsContext && styles.cardKids]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Image */}
      <View style={styles.imageBox}>
        {listing.thumbnail_url ? (
          <Image source={{ uri: listing.thumbnail_url }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderIcon}>📷</Text>
          </View>
        )}
        {/* Verified dot overlay */}
        {listing.seller_verified && (
          <View style={styles.verifiedDot} />
        )}
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardPrice}>₹{price}</Text>
        <Text style={styles.cardTitle} numberOfLines={1}>{listing.title}</Text>

        {/* Kids-specific badges */}
        {isKidsContext && listing.age_suitability && (
          <View style={styles.kidsMeta}>
            <View style={styles.kidsPill}>
              <Text style={styles.kidsPillText}>{listing.age_suitability}</Text>
            </View>
          </View>
        )}

        {/* Standard meta row */}
        {!isKidsContext && (
          <View style={styles.metaRow}>
            {listing.seller_verified && <View style={styles.metaDot} />}
            <Text style={styles.metaText} numberOfLines={1}>
              {listing.locality ?? listing.city}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Listing card (full-width row) ─────────────────────────────────────────────

export function ListingRow({ listing, onPress }: { listing: Listing; onPress: () => void }) {
  const price = parseFloat(listing.price).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.rowImage}>
        {listing.thumbnail_url ? (
          <Image source={{ uri: listing.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={styles.rowImageIcon}>📷</Text>
        )}
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={2}>{listing.title}</Text>
        <Text style={styles.rowPrice}>₹{price}</Text>
        <View style={styles.metaRow}>
          {listing.seller_verified && <View style={styles.metaDot} />}
          <Text style={styles.metaText}>{listing.city}</Text>
          <ConditionBadge condition={listing.condition} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

export function SkeletonCard() {
  return (
    <View style={[styles.card, styles.skeleton]}>
      <View style={styles.skeletonImage} />
      <View style={styles.cardInfo}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      </View>
    </View>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

export function SectionHeader({
  title, subtitle, onSeeAll,
}: {
  title: string; subtitle?: string; onSeeAll?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
      {onSeeAll && (
        <TouchableOpacity onPress={onSeeAll}>
          <Text style={styles.seeAll}>See all</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Activity ticker ───────────────────────────────────────────────────────────

export function ActivityTicker({ deals, listings }: { deals: string; listings: string }) {
  return (
    <View style={styles.ticker}>
      <Text style={styles.tickerText}>📦 {deals}</Text>
      <View style={styles.tickerDivider} />
      <Text style={styles.tickerText}>✨ {listings}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Trust badge
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.tealLight,
    borderRadius: Radius.full,
  },
  trustDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.teal,
  },
  trustDotSm: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  trustText: {
    color: Colors.teal,
    fontWeight: '500',
  },

  // Condition badge
  condBadge: {
    backgroundColor: Colors.border2,
    borderRadius: Radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  condText: {
    fontSize: 9,
    color: Colors.text2,
    fontWeight: '500',
  },

  // Fixed price pill
  fixedPill: {
    backgroundColor: Colors.border2,
    borderRadius: Radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  fixedText: {
    fontSize: 9,
    color: Colors.text3,
    fontWeight: '500',
  },

  // Grid card
  card: {
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 0.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.card,
  },
  cardKids: {
    borderColor: 'rgba(255,154,92,0.2)',
  },
  imageBox: {
    height: 110,
    backgroundColor: Colors.border2,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F3',
  },
  imagePlaceholderIcon: {
    fontSize: 28,
  },
  verifiedDot: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.teal,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  cardInfo: {
    padding: Spacing.sm,
    paddingTop: 7,
  },
  cardPrice: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
  },
  cardTitle: {
    fontSize: 10,
    color: Colors.text2,
    marginTop: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    flexWrap: 'wrap',
  },
  metaDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.teal,
  },
  metaText: {
    fontSize: 9,
    color: Colors.text3,
  },
  kidsMeta: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  kidsPill: {
    backgroundColor: Colors.kidsLight,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kidsPillText: {
    fontSize: 8,
    color: Colors.kids,
    fontWeight: '500',
  },

  // Row
  row: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 0.5,
    borderColor: Colors.border,
    marginHorizontal: Spacing.screen,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
    ...Shadow.card,
  },
  rowImage: {
    width: 80,
    height: 80,
    backgroundColor: Colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowImageIcon: {
    fontSize: 28,
  },
  rowInfo: {
    flex: 1,
    padding: Spacing.sm,
    justifyContent: 'center',
    gap: 3,
  },
  rowTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.text,
  },
  rowPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },

  // Skeleton
  skeleton: {
    opacity: 0.6,
  },
  skeletonImage: {
    height: 110,
    backgroundColor: Colors.border2,
  },
  skeletonLine: {
    height: 12,
    backgroundColor: Colors.border2,
    borderRadius: 6,
    marginBottom: 6,
  },
  skeletonLineShort: {
    width: '60%',
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screen,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  sectionHeaderText: {
    gap: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
  },
  sectionSubtitle: {
    fontSize: 10,
    color: Colors.text3,
    marginTop: 1,
  },
  seeAll: {
    fontSize: 11,
    color: Colors.teal,
    fontWeight: '500',
  },

  // Ticker
  ticker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.tealLight,
    paddingHorizontal: Spacing.screen,
    paddingVertical: 7,
  },
  tickerText: {
    fontSize: 11,
    color: Colors.tealText,
    flex: 1,
  },
  tickerDivider: {
    width: 0.5,
    height: 14,
    backgroundColor: Colors.teal,
    opacity: 0.3,
  },
});
