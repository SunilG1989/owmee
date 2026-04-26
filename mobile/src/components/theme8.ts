/**
 * Sprint 8 Phase 1 — additional color tokens for the new home page.
 * Imports the existing palette from tokens.ts and adds:
 *   - Blockbuster deals strip (amber gradient)
 *   - Sell block (sky blue gradient)
 *   - Owmee Verified badge (forest green)
 *   - Ship indicator (info blue)
 *
 * Kept separate from tokens.ts to avoid touching the existing palette
 * that's used across 30+ screens. Import from here in new components.
 */
export const C8 = {
  // Blockbuster deals strip
  dealsAmberStart: '#FFF3D9',
  dealsAmberEnd: '#F5E0B8',
  dealsAccent: '#BA7517',
  dealsTitleText: '#5A3508',
  dealsSubtitle: '#854F0B',
  dealsBadgeBg: '#BA7517',
  dealsBadgeText: '#FFFFFF',
  dealsCardShadow: 'rgba(186, 117, 23, 0.18)',

  // Standalone sell block
  sellBgStart: '#DCEBFB',
  sellBgEnd: '#E6F1FB',
  sellAccent: '#185FA5',
  sellTitle: '#0C447C',
  sellCtaBg: '#185FA5',
  sellCtaText: '#FFFFFF',

  // Owmee Verified badge
  verifiedBg: '#E1F5EE',
  verifiedText: '#0F6E56',
  verifiedDot: '#1D9E75',

  // Ship indicator
  shipText: '#185FA5',

  // Card image gradient backgrounds (subtle, varying per card type)
  cardBgGray: '#F0F0F0',
  cardBgPurple: '#F0F0FF',
  cardBgGreen: '#E4F2EA',
  cardBgPink: '#FFE8F0',
  cardBgAmber: '#FFF8EB',
  cardBgStone: '#F1EFE8',
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
