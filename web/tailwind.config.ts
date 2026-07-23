import type { Config } from "tailwindcss";

// OpenRouter-inspired: cool near-black neutrals + periwinkle-blue accent, all-sans.
// NOTE: token KEYS are kept stable (amber/teal/rust) but re-mapped to the new palette,
// so the whole app reskins without touching every className. amber = blue accent now.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0B0D", // app canvas (cool near-black)
        surface: "#141416", // panels
        raised: "#1B1B1F", // cards
        line: "#26262B", // hairline borders
        sand: "#F2F2F3", // primary text
        ash: "#9B9BA3", // muted text
        faint: "#6B6B73", // faintest text
        amber: "#C8FF00", // ACCENT (lime)
        "amber-2": "#D6FF4D", // accent hover
        teal: "#22D3EE", // "live" / success (cyan — distinct from lime accent)
        rust: "#F87171", // danger/warn
      },
      fontFamily: {
        display: ["var(--font-display)", "var(--font-sans)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.03) inset, 0 20px 40px -28px rgba(0,0,0,0.85)",
        glow: "0 0 0 1px rgba(200,255,0,0.35), 0 8px 24px -8px rgba(200,255,0,0.35)",
        "glow-sm": "0 4px 16px -6px rgba(200,255,0,0.4)",
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-live": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "rise-in": "rise-in 0.42s cubic-bezier(0.22,1,0.36,1) both",
        "pulse-live": "pulse-live 1.3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
