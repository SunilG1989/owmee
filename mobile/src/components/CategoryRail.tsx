/**
 * CategoryRail — compact image-circle row (2026-05-03).
 *
 * v16 locked spec: each tile renders a real local image cutout
 * (mobile/assets/images/cat-*.png), NOT emoji. Drop transparent PNGs
 * at those paths; require() resolves at bundle time.
 *
 * Books has no canonical category_slug in the backend taxonomy yet;
 * tile fires an empty-slug press — consumer treats `null` as no-op
 * until a Books slug exists.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ImageSourcePropType,
} from 'react-native';
import { C, T, S, R } from '../utils/tokens';

export interface CategoryDef {
  label: string;
  slug: string | null;
  /** Local cutout PNG asset for the tile. */
  image: ImageSourcePropType;
  /** Optional background tint for the icon circle (defaults to bg_soft). */
  tint?: string;
}

interface Props {
  onSeeAll: () => void;
  onCategoryPress: (cat: CategoryDef) => void;
  categories?: CategoryDef[];
}

// Category cutouts at locked spec path. Drop real .webp cutouts at
// mobile/assets/owmee/home/cat-*.webp — placeholders resolve until
// real assets land. NO emoji fallback per rule 14.
const DEFAULT_CATEGORIES: CategoryDef[] = [
  { label: 'Mobiles',    slug: 'smartphones',      image: require('../../assets/owmee/home/cat-mobile.webp'),     tint: C.mintSoft },
  { label: 'Laptops',    slug: 'laptops',          image: require('../../assets/owmee/home/cat-laptop.webp'),     tint: C.bone2 },
  { label: 'Kids',       slug: 'kids-utility',     image: require('../../assets/owmee/home/cat-kids.webp'),       tint: C.amberSoft },
  { label: 'Books',      slug: null,               image: require('../../assets/owmee/home/cat-books.webp'),      tint: C.blueSoft },
  { label: 'Appliances', slug: 'small-appliances', image: require('../../assets/owmee/home/cat-appliances.webp'), tint: C.bone2 },
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
            <View style={[s.iconCircle, { backgroundColor: cat.tint || C.bone2 }]}>
              <Image source={cat.image} style={s.iconImage} resizeMode="cover" />
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
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border2,
  },
  // v18: image fills the circle (cover) so it's clipped to round shape,
  // not letterboxed inside a circle. Square photos clip cleanly.
  iconImage: {
    width: '100%',
    height: '100%',
  },
  label: {
    marginTop: S.xs + 2,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.semi,
    color: C.text,
    textAlign: 'center',
  },
});
