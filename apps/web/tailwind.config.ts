import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        quorum: {
          50: "#f4f4ff",
          100: "#e9e8ff",
          400: "#8b7ef8",
          500: "#6f5cf0",
          600: "#5b45e0",
          700: "#4934bd",
          900: "#241a5e",
        },
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 15, 25, 0.04), 0 1px 1px rgba(15, 15, 25, 0.03)",
        "card-hover": "0 8px 24px -8px rgba(30, 20, 90, 0.16), 0 2px 6px -2px rgba(30, 20, 90, 0.08)",
        popover: "0 12px 32px -8px rgba(20, 15, 60, 0.18), 0 4px 10px -4px rgba(20, 15, 60, 0.1)",
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
