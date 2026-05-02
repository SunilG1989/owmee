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
import { C, T, S, Home } from '../utils/tokens';
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
    paddingTop: S.md + 2,
    paddingBottom: S.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    marginBottom: S.md,
  },
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bolt: {
    fontSize: T.size.xxl - 2,
    lineHeight: 22,
  },
  titleMain: {
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: Home.dealsTitleText,
    letterSpacing: -0.3,
  },
  titleSub: {
    fontSize: T.size.sm,
    color: Home.dealsSubtitle,
    marginTop: 2,
  },
  countPill: {
    backgroundColor: Home.dealsAccent,
    paddingHorizontal: S.sm + 2,
    paddingVertical: S.xs,
    borderRadius: 999,
  },
  countText: {
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: C.white,
  },
  cardsWrap: {
    paddingHorizontal: S.lg,
  },
  loadingWrap: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allLinkWrap: {
    alignItems: 'center',
    paddingTop: S.md,
  },
  allLink: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: Home.dealsSubtitle,
  },
});
