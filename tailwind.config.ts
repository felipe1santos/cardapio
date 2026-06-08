import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        main: "#FFFFFF",
        page: "#EDEEF1",
        border: "#E5E7EB",
        "text-main": "#1F2937",
        "text-subtle": "#6B7280",
        sidebar: {
          bg: "#111827",
          hover: "#1F2937",
          text: "#9CA3AF",
        },
        primary: {
          DEFAULT: "#06B6D4",
          dark: "#0891B2",
        },
        "status-pending": "#F97316",
        "status-preparing": "#3B82F6",
        "status-ready": "#10B981",
        price: {
          bg: "#DCFCE7",
          text: "#16A34A",
        },
        alert: {
          bg: "#E0F2FE",
          text: "#0369A1",
        },
        danger: "#EF4444",
        "danger-bg": "#FEE2E2",
        warn: "#F59E0B",
        "warn-bg": "#FEF3C7",
        purple: "#A855F7",
      },
      borderRadius: {
        menuzia: "3px",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
