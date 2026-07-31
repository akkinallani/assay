import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "'Instrument Sans'",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
      },
      colors: {
        // Warm neutral ink scale — replaces the old indigo/violet "AI SaaS"
        // accent. quorum-50/100 double as the cream background tints;
        // quorum-600+ is the primary dark accent (CTAs, links, active states).
        quorum: {
          50: "#f6f4ee",
          100: "#eae5d8",
          200: "#ddd6c4",
          400: "#8a8477",
          500: "#57534a",
          600: "#2a2620",
          700: "#171512",
          900: "#0b0a08",
        },
        // One small, deliberately restrained accent color — used only for
        // tiny tags/badges, never as a primary brand color.
        accent: {
          50: "#eef3f6",
          400: "#5b8aa6",
          600: "#3d6a84",
        },
        // Muted, warm-toned semantic colors for risk/status signaling —
        // desaturated versions of red/amber/green so alerts read as part of
        // the same design system instead of stock bright Tailwind colors.
        danger: {
          50: "#fbeeec",
          100: "#f5dbd6",
          200: "#e8b6ac",
          600: "#a8453a",
          700: "#8a372e",
        },
        warning: {
          50: "#faf1e1",
          100: "#f2ddb3",
          600: "#b07f2c",
          700: "#8f6522",
        },
        success: {
          50: "#eef2ea",
          100: "#dae4d1",
          600: "#5c7a48",
          700: "#4a6339",
        },
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20, 18, 14, 0.04), 0 1px 1px rgba(20, 18, 14, 0.03)",
        "card-hover": "0 8px 24px -8px rgba(20, 18, 14, 0.14), 0 2px 6px -2px rgba(20, 18, 14, 0.08)",
        popover: "0 12px 32px -8px rgba(20, 18, 14, 0.16), 0 4px 10px -4px rgba(20, 18, 14, 0.1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 400ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "scale-in": "scale-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both",
        shimmer: "shimmer 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
