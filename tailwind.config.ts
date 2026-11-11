import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "SF Mono",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        apple: {
          blue: "#0A84FF",
          orange: "#FF9F0A",
          green: "#30D158",
          purple: "#BF5AF2",
          indigo: "#5E5CE6",
          red: "#FF453A",
          yellow: "#FFD60A",
          gray: "#8E8E93",
        },
      },
      boxShadow: {
        "apple-window": "0 24px 70px -10px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.12)",
        "apple-card": "0 8px 30px -4px rgba(0, 0, 0, 0.3), inset 0 1px 1px 0 rgba(255, 255, 255, 0.15)",
        "apple-card-light": "0 8px 30px -4px rgba(0, 0, 0, 0.08), inset 0 1px 1px 0 rgba(255, 255, 255, 0.8)",
        "apple-glow": "0 0 25px -5px rgba(10, 132, 255, 0.45)",
      },
      backdropBlur: {
        "apple": "32px",
        "apple-heavy": "48px",
      },
    },
  },
  plugins: [],
};
export default config;
