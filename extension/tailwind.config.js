/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './*.tsx', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E0E0E',
        accent: '#A1F96E',
      },
    },
  },
  plugins: [],
};
