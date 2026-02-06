/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gas-low': '#10b981',
        'gas-medium': '#f59e0b',
        'gas-high': '#ef4444',
      }
    },
  },
  plugins: [],
}