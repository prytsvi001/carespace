/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ink: near-black primary — used for text, headings, dark buttons
        ink: '#0E0E0E',
        // accent: lime green — used sparingly for active states, key CTAs, highlights
        accent: '#A1F96E',
        // cream: warm off-white — page background
        cream: '#F9F5EA',
        // brand: ink-based scale (replaces the old blue scale)
        // brand-600 = primary dark ink, used by existing btn-primary/active classes
        brand: {
          50:  '#f5f5f5',
          100: '#ebebeb',
          200: '#d6d6d6',
          300: '#bbbbbb',
          400: '#959595',
          500: '#6e6e6e',
          600: '#0E0E0E',
          700: '#0a0a0a',
          800: '#080808',
          900: '#050505',
        },
      },
    },
  },
  plugins: [],
};
