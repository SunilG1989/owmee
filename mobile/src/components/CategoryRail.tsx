/**
 * CategoryRail — premium real-photo category row.
 *
 * Each tile renders a locally bundled real-photo crop generated for the
 * approved Warm Clay + Deep Teal home direction. The images are framed
 * like small commerce thumbnails instead of loose cutouts.
 *
 * Books has no canonical category_slug in the backend taxonomy yet, so
 * the home screen opens general search instead of leaving the tile dead.
 */
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ImageSourcePropType, useWindowDimensions,
} from 'react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';

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
  { label: 'Mobile', slug: 'smartphones', image: require('../../assets/owmee/home/cat-mobile-photo-v2.png') },
  { label: 'Laptop', slug: 'laptops', image: require('../../assets/owmee/home/cat-laptop-photo-v2.png') },
  { label: 'Home', slug: 'small-appliances', image: require('../../assets/owmee/home/cat-appliances-photo-v2.png') },
  { label: 'Kids', slug: 'kids-utility', image: require('../../assets/owmee/home/cat-kids-photo-v2.png') },
  { label: 'Books', slug: null, image: require('../../assets/owmee/home/cat-books-photo-v2.png') },
];

export default function CategoryRail({
  onCategoryPress, categories = DEFAULT_CATEGORIES,
}: Props) {
  const { width } = useWindowDimensions();
  const tileWidth = useMemo(() => {
    const gap = S.xs + 2;
    const available = width - (S.lg * 2) - (gap * (categories.length - 1));
    return Math.floor(available / categories.length);
  }, [categories.length, width]);
  const iconWidth = Math.max(40, Math.min(46, tileWidth - 18));

  return (
    <View style={s.block}>
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
              <Image source={cat.image} style={s.iconImage} resizeMode="cover" />
            </View>
            <Text style={[s.label, { width: tileWidth - 10 }]} numberOfLines={2}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    marginTop: S.sm + 2,
  },
  row: {
    paddingHorizontal: S.lg,
    gap: S.xs + 2,
  },
  tile: {
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.lg - 1,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.9)',
    paddingTop: S.xs + 2,
    paddingHorizontal: S.xs,
    paddingBottom: S.xs,
    ...Shadow.subtle,
  },
  iconFrame: {
    height: 34,
    borderRadius: R.sm + 2,
    backgroundColor: '#FFF8EE',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: {
    width: '100%',
    height: '100%',
  },
  label: {
    width: 60,
    marginTop: 3,
    fontSize: T.size.xs - 1,
    fontWeight: T.weight.medium,
    color: C.text2,
    textAlign: 'center',
    lineHeight: T.size.xs + 1,
  },
});
