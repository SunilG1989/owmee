/**
 * BlockbusterDealsStrip — Sprint 8 Phase 1
 *
 * Horizontal scrolling strip of top deals. Calls /v1/feed/blockbuster-deals
 * on mount. Hidden if fewer than 3 deals (avoids half-empty section).
 *
 * Visual: solid amber background tint (no react-native-linear-gradient
 * dependency to keep this build dep-free).
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { C, Home } from '../utils/tokens';
import { DealCard } from './OwmeeListingCard';
import type { FeedListing } from '../services/api';

interface Props {
  deals: FeedListing[];
  loading: boolean;
  onDealPress: (listing: FeedListing) => void;
  onSeeAll?: () => void;
}

const MIN_DEALS_TO_SHOW = 3;

export default function BlockbusterDealsStrip({
  deals,
  loading,
  onDealPress,
  onSeeAll,
}: Props) {
  if (!loading && deals.length < MIN_DEALS_TO_SHOW) {
    // Hide entirely — half-empty deal strips look sad
    return null;
  }

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <View style={s.titleBlock}>
          <Text style={s.bolt}>⚡</Text>
          <View style={{ marginLeft: 6 }}>
            <Text style={s.titleMain}>Blockbuster deals</Text>
            <Text style={s.titleSub}>Biggest savings · Refreshes daily</Text>
          </View>
        </View>
        {!loading && deals.length > 0 && (
          <View style={s.countPill}>
            <Text style={s.countText}>{deals.length} live</Text>
          </View>
        )}
      </View>

      {loading && deals.length === 0 ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={Home.dealsAccent} size="small" />
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.cardsWrap}
          >
            {deals.map((deal, i) => (
              <DealCard
                key={deal.id}
                listing={deal}
                variant="deal"
                index={i}
                onPress={() => onDealPress(deal)}
              />
            ))}
          </ScrollView>

          {onSeeAll && deals.length >= MIN_DEALS_TO_SHOW && (
            <View style={s.allLinkWrap}>
              <Text style={s.allLink} onPress={onSeeAll}>
                See all {deals.length} deals →
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: Home.dealsBgStart,
    paddingTop: 14,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bolt: {
    fontSize: 22,
    lineHeight: 22,
  },
  titleMain: {
    fontSize: 17,
    fontWeight: '700',
    color: Home.dealsTitleText,
    letterSpacing: -0.3,
  },
  titleSub: {
    fontSize: 11,
    color: Home.dealsSubtitle,
    marginTop: 2,
  },
  countPill: {
    backgroundColor: Home.dealsAccent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.white,
  },
  cardsWrap: {
    paddingHorizontal: 16,
  },
  loadingWrap: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allLinkWrap: {
    alignItems: 'center',
    paddingTop: 12,
  },
  allLink: {
    fontSize: 12,
    fontWeight: '600',
    color: Home.dealsSubtitle,
  },
});
