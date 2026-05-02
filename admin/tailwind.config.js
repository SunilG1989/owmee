/** @type {import('tailwindcss').Config}
 *
 * Owmee Admin — v6 Petrol palette.
 *
 * Mirrors the mobile app's design tokens (mobile/src/utils/tokens.ts)
 * so admin and mobile feel like one product. Whenever you change the
 * mobile palette, mirror the change here.
 *
 * Palette:
 *   petrol  → primary CTA / brand
 *   coral   → accent / "act now" surfaces (sale, ending soon, urgent)
 *   bone    → warm canvas
 *   ink     → deep blue-black for text on light surfaces
 */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary — petrol family
        petrol: {
          50:  '#D9EAE8',          // petrolLight
          100: '#B7D6D2',
          300: '#5FB8A8',          // petrolGlow / aqua
          500: '#1E5F5C',          // petrol (primary)
          600: '#134543',          // petrolDeep
          700: '#0B2D2C',          // petrolText
        },
        // Accent — coral (use sparingly, the v6 spotlight color)
        coral: {
          50:  '#FCE8E0',          // coralLight
          500: '#E87A5D',          // coral
          700: '#B85638',          // coralDeep
        },
        // Surfaces
        bone:  '#F6F1E7',          // primary canvas
        bone2: '#ECE5D4',          // raised surface
        // Inks (text)
        ink:   '#0F1A1F',
        ink2:  '#4A555B',
        ink3:  '#828A90',
        ink4:  '#BCC2C7',

        // ── Legacy v4 aliases — kept so old class names don't break.
        // Migrate one page at a time, then remove.
        honey: {
          50:  '#D9EAE8',          // → petrol-50
          100: '#B7D6D2',
          300: '#5FB8A8',
          500: '#1E5F5C',          // → petrol-500
          600: '#134543',
          700: '#0B2D2C',
        },
        cream: '#F6F1E7',          // → bone
        sand:  '#ECE5D4',          // → bone2
      },
    },
  },
  plugins: [],
};
