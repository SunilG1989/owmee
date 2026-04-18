/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        honey: {
          50:  '#FFF8EB',
          100: '#FFF1D4',
          300: '#FFCF4A',
          500: '#E8920D',
          600: '#C27A08',
          700: '#8B5A06',
        },
        cream: '#FEFBF4',
        sand:  '#F5F0E6',
        ink:   '#1A1812',
        ink2:  '#5C5647',
        ink3:  '#9A9285',
        ink4:  '#C4BDB0',
      },
    },
  },
  plugins: [],
};
