/**
 * theme8 — accent palette for home-page-specific surfaces.
 *
 * Originally Sprint 8 Phase 1 added off-brand colors here (sky blue Sell
 * block, candy-pink card backgrounds, etc) that clashed with the warm-
 * trust v4 palette in tokens.ts. v4 update: every color here is now drawn
 * from the same warm-amber + sage-emerald + parchment family — variety
 * without violating brand cohesion.
 *
 * Card-bg palette is intentionally muted so the listing photos pop
 * against them, not compete.
 */
export const C8 = {
  // Blockbuster deals strip — saffron/honey gradient, matches v4 honey
  dealsAmberStart: '#FBF1DC',     // honeyLight — same as tokens.honeyLight
  dealsAmberEnd: '#F5E0B8',       // slightly deeper toward gold
  dealsAccent: '#A56B22',         // honeyDeep
  dealsTitleText: '#6E4716',      // honeyText (deepest, AA-readable)
  dealsSubtitle: '#A56B22',       // honeyDeep
  dealsBadgeBg: '#A56B22',
  dealsBadgeText: '#FFFFFF',
  dealsCardShadow: 'rgba(122, 90, 53, 0.18)',  // matches Shadow.card tint

  // Sell block — was sky blue (off-brand). Now warm forest, signals
  // "trust + grow" without breaking palette unity.
  sellBgStart: '#E5EFE9',         // forestLight
  sellBgEnd: '#D6E5DA',           // slightly deeper
  sellAccent: '#3D7A5C',          // forest
  sellTitle: '#2C5E45',           // forestText
  sellCtaBg: '#3D7A5C',
  sellCtaText: '#FFFFFF',

  // Owmee Verified badge — refined sage, paired with v4 forest
  verifiedBg: '#E5EFE9',          // forestLight
  verifiedText: '#2C5E45',        // forestText
  verifiedDot: '#4F9272',         // forestVivid

  // Ship indicator — was sky blue, now forest to keep palette cohesive
  shipText: '#3D7A5C',

  // Card image gradient backgrounds — warm palette only. Variety from
  // hue-shifts within parchment+sage+amber, NOT pink/purple/blue.
  cardBgGray: '#F0E8D5',          // sand
  cardBgPurple: '#EFE3DC',        // warm dusty mauve (in family)
  cardBgGreen: '#E5EFE9',         // forestLight
  cardBgPink: '#F5E5D8',          // warm peach (replaces candy-pink)
  cardBgAmber: '#FBF1DC',         // honeyLight
  cardBgStone: '#F0E9D9',         // warmer than v3
};

/**
 * Pick a card background color based on listing index. Gives the masonry
 * feed a varied, organic feel without backend doing the work.
 */
const CARD_BGS = [
  C8.cardBgGray,
  C8.cardBgPurple,
  C8.cardBgGreen,
  C8.cardBgPink,
  C8.cardBgAmber,
  C8.cardBgStone,
];

export function pickCardBg(index: number): string {
  return CARD_BGS[index % CARD_BGS.length];
}

/**
 * Alternating aspect ratios for masonry feel. Index-based so it's
 * stable across re-renders (no random jitter).
 */
export function pickAspectRatio(index: number): number {
  // Square most cards, every 3rd is taller (4:5)
  return index % 3 === 0 ? 4 / 5 : 1;
}
