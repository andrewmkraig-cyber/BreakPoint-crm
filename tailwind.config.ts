import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  // darkMode = "class" lets `.dark` on <html> flip every `dark:` utility —
  // we map Clay Court to that class. A parallel custom variant (see plugins
  // below) adds a `grass:` utility that targets `.grass` on <html> for the
  // Grass Court palette. Hard Court is the bare default (no class).
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
    },
    extend: {
      colors: {
        brand: {
          DEFAULT: "#5A9642",
          dark: "#3F7030",
          tint: "#EAF4E4",
        },
        ink: {
          DEFAULT: "#111111",
          600: "#2A2A2A",
          400: "#5A5A5A",
        },
        cream: {
          DEFAULT: "#FAF8F3",
          dark: "#F2EEE4",
        },
        background: "#FFFFFF",
        foreground: "#111111",
        muted: {
          DEFAULT: "#F4F6F8",
          foreground: "#5B6476",
        },
        border: "#E5E8ED",
        // Court Mode token namespace — values resolve from CSS variables
        // defined in globals.css (:root / .dark / .grass). Any component
        // using `bg-court-surface` / `text-court-fg` / etc. will re-skin
        // when the Court Mode selector flips the <html> class.
        court: {
          surface: "rgb(var(--court-surface) / <alpha-value>)",
          "surface-subtle": "rgb(var(--court-surface-subtle) / <alpha-value>)",
          fg: "rgb(var(--court-fg) / <alpha-value>)",
          "fg-muted": "rgb(var(--court-fg-muted) / <alpha-value>)",
          border: "rgb(var(--court-border) / <alpha-value>)",
          accent: "rgb(var(--court-accent) / <alpha-value>)",
          "accent-dark": "rgb(var(--court-accent-dark) / <alpha-value>)",
          "accent-tint": "rgb(var(--court-accent-tint) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-playfair)", "Georgia", "serif"],
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Register `grass:` as a first-class Tailwind variant so component code
    // can write `grass:bg-[#1a2e1a]` alongside `dark:bg-[#0f172a]`. The
    // selector matches any descendant of <html class="grass"> plus the
    // element itself (via `&.grass`), mirroring how Tailwind's built-in
    // `dark:` variant resolves against `.dark`.
    plugin(({ addVariant }) => {
      addVariant("grass", [".grass &", "&.grass"]);
    }),
  ],
};
export default config;
