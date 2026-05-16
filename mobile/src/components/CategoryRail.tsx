/**
 * CategoryRail — premium real-photo category row.
 *
 * Each tile renders a locally bundled real-photo crop generated for the
 * approved Warm Clay + Deep Teal home direction. The images are framed
 * like small commerce thumbnails instead of loose cutouts.
 *
 */
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ImageSourcePropType, useWindowDimensions,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';

const SECTION_GAP = S.sm;

export interface CategoryDef {
  label: string;
  slug: string | null;
  query?: string;
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
  { label: 'Phones', slug: 'smartphones', image: require('../../assets/owmee/home/cat-mobile.webp') },
  { label: 'Laptops', slug: 'laptops', image: require('../../assets/owmee/home/cat-laptop.webp') },
  { label: 'Books', slug: null, query: 'books', image: require('../../assets/owmee/home/cat-books.webp') },
  { label: 'Kids & Toys', slug: 'kids-utility', image: require('../../assets/owmee/home/cat-kids.webp') },
  { label: 'Appliances', slug: 'small-appliances', image: require('../../assets/owmee/home/cat-appliances.webp') },
];

export default function CategoryRail({
  onSeeAll, onCategoryPress, categories = DEFAULT_CATEGORIES,
}: Props) {
  const { width } = useWindowDimensions();
  const tileWidth = useMemo(() => {
    const gap = S.xs + 1;
    const available = width - (S.lg * 2) - (gap * 4);
    return Math.max(68, Math.min(78, Math.floor(available / 5)));
  }, [width]);
  const iconWidth = Math.max(54, Math.min(62, tileWidth - 10));

  return (
    <View style={s.block}>
      <View style={s.head}>
        <Text style={s.title}>Categories</Text>
        <TouchableOpacity activeOpacity={0.78} style={s.seeAll} onPress={onSeeAll}>
          <Text style={s.seeAllText}>See all</Text>
          <ChevronRight size={14} strokeWidth={2.4} color={C.petrolText} />
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
            style={[s.tile, { width: tileWidth }]}
            accessibilityRole="button"
            accessibilityLabel={`${cat.label.replace('\n', ' ')} category`}
          >
            <View style={[s.iconFrame, { width: iconWidth }]}>
              <Image source={cat.image} style={s.iconImage} resizeMode="contain" />
            </View>
            <Text
              style={[s.label, { width: tileWidth - 8 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    marginTop: SECTION_GAP,
  },
  head: {
    paddingHorizontal: S.lg,
    paddingBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },
  title: {
    flex: 1,
    fontSize: T.size.base,
    color: C.text,
    fontWeight: T.weight.heavy,
  },
  seeAll: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: S.sm,
  },
  seeAllText: {
    fontSize: T.size.sm,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },
  row: {
    paddingHorizontal: S.lg,
    gap: S.xs + 1,
  },
  tile: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: R.md,
    backgroundColor: 'rgba(255, 253, 248, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.76)',
    paddingTop: 3,
    paddingHorizontal: 4,
    paddingBottom: 3,
    ...Shadow.subtle,
  },
  iconFrame: {
    height: 35,
    borderRadius: R.sm + 1,
    backgroundColor: 'rgba(241, 248, 246, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: {
    width: '112%',
    height: '112%',
  },
  label: {
    width: 60,
    fontSize: T.size.xs - 1,
    fontWeight: T.weight.semi,
    color: C.text,
    textAlign: 'center',
    lineHeight: T.size.xs + 1,
  },
});
