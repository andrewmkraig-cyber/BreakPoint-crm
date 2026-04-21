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
        navy: {
          DEFAULT: "#0F1B2D",
          600: "#1C2B44",
          400: "#49536A",
        },
        background: "#FFFFFF",
        foreground: "#0F1B2D",
        muted: {
          DEFAULT: "#F4F6F8",
          foreground: "#5B6476",
        },
        border: "#E5E8ED",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-cormorant)", "Georgia", "serif"],
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
