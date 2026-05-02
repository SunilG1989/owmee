/**
 * CategoryRail — compact icon-circle row (2026-05-03).
 *
 * Marketplace standard pattern (OLX, Cashify, Cars24, Mercari): a thin
 * horizontal scroll of small circular category tiles with the label
 * directly below. Total height ~95dp so listings stay above the fold.
 *
 * Books has no canonical category_slug in the current backend taxonomy
 * (smartphones / laptops / tablets / small-appliances / kids-utility),
 * so the Books tile fires an empty-slug press — consumer should treat
 * `null` as a no-op until a Books slug exists.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { C, T, S, R } from '../utils/tokens';

export interface CategoryDef {
  label: string;
  slug: string | null;
  /** Emoji glyph that sits inside the circular tile. */
  emoji: string;
  /** Optional background tint for the icon circle (defaults to mintSoft). */
  tint?: string;
}

interface Props {
  onSeeAll: () => void;
  onCategoryPress: (cat: CategoryDef) => void;
  categories?: CategoryDef[];
}

const DEFAULT_CATEGORIES: CategoryDef[] = [
  { label: 'Mobiles',         slug: 'smartphones',      emoji: '📱', tint: C.mintSoft },
  { label: 'Laptops',         slug: 'laptops',          emoji: '💻', tint: C.blueSoft },
  { label: 'Kids',            slug: 'kids-utility',     emoji: '🧸', tint: C.amberSoft },
  { label: 'Books',           slug: null,               emoji: '📚', tint: C.mintSoft },
  { label: 'Appliances',      slug: 'small-appliances', emoji: '🧺', tint: C.blueSoft },
];

export default function CategoryRail({
  onSeeAll, onCategoryPress, categories = DEFAULT_CATEGORIES,
}: Props) {
  return (
    <View style={s.block}>
      <View style={s.header}>
        <Text style={s.title}>Browse by category</Text>
        <TouchableOpacity onPress={onSeeAll} activeOpacity={0.7} style={s.seeAll}>
          <Text style={s.seeAllText}>See all</Text>
          <Text style={s.seeAllArrow} allowFontScaling={false}>›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {categories.map(cat => (
          <TouchableOpacity
            key={cat.label}
            activeOpacity={0.85}
            onPress={() => onCategoryPress(cat)}
            style={s.tile}
          >
            <View style={[s.iconCircle, { backgroundColor: cat.tint || C.mintSoft }]}>
              <Text style={s.iconGlyph} allowFontScaling={false}>{cat.emoji}</Text>
            </View>
            <Text style={s.label} numberOfLines={1}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    marginTop: S.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    marginBottom: S.sm,
  },
  title: {
    fontSize: T.size.md,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: -0.2,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.petrol,
  },
  seeAllArrow: {
    fontSize: T.size.md,
    color: C.petrol,
    fontWeight: T.weight.heavy,
    marginLeft: 1,
  },
  row: {
    paddingHorizontal: S.lg,
    gap: S.lg,
  },
  tile: {
    width: 64,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: T.size.xl + 2,
  },
  label: {
    marginTop: S.xs + 2,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.semi,
    color: C.text,
    textAlign: 'center',
  },
});
