/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F7F4EF',
        ink: '#1A1A1A',
        clay: '#C4552D',
        done: '#4A6B4A',
        line: '#E5E0D8',
      },
      fontFamily: {
        display: ['Fraunces', 'Cormorant Garamond', 'Georgia', 'serif'],
        body: ['Satoshi', 'Manrope', 'Helvetica Neue', 'Helvetica', 'sans-serif'],
      },
    },
  },
  corePlugins: { preflight: false },
  plugins: [],
};
