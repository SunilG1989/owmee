/** @type {import('tailwindcss').Config}
 *
 * Owmee Admin — v21 Warm Trust Pastels palette.
 *
 * Mirrors the mobile app's design tokens (mobile/src/utils/tokens.ts)
 * so admin and mobile feel like one product. Whenever you change the
 * mobile palette, mirror the change here.
 *
 * Palette:
 *   petrol  → muted trust blue primary / brand
 *   coral   → quiet warm taupe / "act now" surfaces (sale, ending soon, urgent)
 *   bone    → warm ivory canvas
 *   ink     → deep navy text on light surfaces
 */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary — warm trust blue family
        petrol: {
          50:  '#F1F8F6',          // petrolLight
          100: '#DDEBE8',
          300: '#C9DDD7',          // petrolGlow / aqua
          500: '#4F7F86',          // petrol (primary)
          600: '#355F63',          // petrolDeep
          700: '#4B7280',          // petrolText
        },
        // Accent — quiet warm taupe (use sparingly, the spotlight color)
        coral: {
          50:  '#FBE9E2',          // coralLight
          500: '#D7A89E',          // coral
          700: '#6E4C45',          // coralDeep
        },
        // Surfaces
        bone:  '#FFFAF4',          // primary canvas
        bone2: '#F7EFE7',          // raised surface
        // Inks (text)
        ink:   '#172033',
        ink2:  '#5E6A75',
        ink3:  '#67727E',
        ink4:  '#C7CED6',

        // ── Legacy v4 aliases — kept so old class names don't break.
        // Migrate one page at a time, then remove.
        honey: {
          50:  '#F1F8F6',          // → petrol-50
          100: '#DDEBE8',
          300: '#C9DDD7',
          500: '#4F7F86',          // → petrol-500
          600: '#355F63',
          700: '#4B7280',
        },
        cream: '#FFFAF4',          // → bone
        sand:  '#F7EFE7',          // → bone2
      },
    },
  },
  plugins: [],
};
