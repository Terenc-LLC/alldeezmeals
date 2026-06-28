/** @type {import('tailwindcss').Config} */
const sharedPreset = require("../../packages/shared/tailwind-preset.cjs");

module.exports = {
  presets: [sharedPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  plugins: [require("tailwindcss-animate")],
};
