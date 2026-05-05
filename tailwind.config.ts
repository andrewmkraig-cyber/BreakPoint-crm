import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  // darkMode = "class" lets `.dark` on <html> flip every `dark:` utility —
  // we map Clay Court to that class. A parallel custom variant (see plugins
  // below) adds a `grass:` utility that targets `.grass` on <html> for the
  // Grass Court palette. Hard Court is the bare default (no class).
  darkMode: ["selector", "[data-theme='dark']"],
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
        "grass-purple": "#6B3FA0",
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
          // Page surfaces
          bg: "rgb(var(--court-bg) / <alpha-value>)",
          surface: "rgb(var(--court-surface) / <alpha-value>)",
          "surface-subtle": "rgb(var(--court-surface-subtle) / <alpha-value>)",
          // Borders
          border: "rgb(var(--court-border) / <alpha-value>)",
          "border-soft": "rgb(var(--court-border-soft) / <alpha-value>)",
          // Foreground
          fg: "rgb(var(--court-fg) / <alpha-value>)",
          "fg-muted": "rgb(var(--court-fg-muted) / <alpha-value>)",
          "fg-dim": "rgb(var(--court-fg-dim) / <alpha-value>)",
          // Accent / slam
          accent: "rgb(var(--court-accent) / <alpha-value>)",
          "accent-dark": "rgb(var(--court-accent-dark) / <alpha-value>)",
          "accent-tint": "rgb(var(--court-accent-tint) / <alpha-value>)",
          "accent-border": "rgb(var(--court-accent-border) / <alpha-value>)",
          // Sidebar (active-bg consumed via bg-[var(--court-sidebar-active-bg)]
          // because Grass Light stores it as an rgba() literal for translucency)
          "sidebar-bg": "rgb(var(--court-sidebar-bg) / <alpha-value>)",
          "sidebar-border": "rgb(var(--court-sidebar-border) / <alpha-value>)",
          "sidebar-fg": "rgb(var(--court-sidebar-fg) / <alpha-value>)",
          "sidebar-fg-muted": "rgb(var(--court-sidebar-fg-muted) / <alpha-value>)",
          "sidebar-fg-dim": "rgb(var(--court-sidebar-fg-dim) / <alpha-value>)",
          "sidebar-icon": "rgb(var(--court-sidebar-icon) / <alpha-value>)",
          "sidebar-active-fg": "rgb(var(--court-sidebar-active-fg) / <alpha-value>)",
          "sidebar-rail": "rgb(var(--court-sidebar-rail) / <alpha-value>)",
          // Brand green (always available, even in non-grass modes)
          brand: "rgb(var(--court-brand) / <alpha-value>)",
          "brand-dark": "rgb(var(--court-brand-dark) / <alpha-value>)",
          "brand-tint": "rgb(var(--court-brand-tint) / <alpha-value>)",
          // Badge — note: --court-badge is stored as a complete CSS color
          // (rgb() or rgba()) per mode so light modes can use a tinted
          // accent wash. Consume via bg-[var(--court-badge)] arbitrary
          // value, NOT bg-court-badge. Only the fg/bg helpers stay as
          // standard Tailwind utilities since they're always solid.
          "badge-fg": "rgb(var(--court-badge-fg) / <alpha-value>)",
          "badge-bg": "rgb(var(--court-badge-bg) / <alpha-value>)",
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
      addVariant("clay", ["[data-surface='clay'] &", "&[data-surface='clay']"]);
      addVariant("grass", ["[data-surface='grass'] &", "&[data-surface='grass']"]);
      addVariant("hard", ["[data-surface='hard'] &", "&[data-surface='hard']"]);
    }),
  ],
};
export default config;
