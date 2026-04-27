import { ImageResponse } from "next/og";

// Next.js App Router auto-detects /app/icon.{tsx,ts,js} and injects a
// <link rel="icon"> pointing at the generated PNG. Mirrors the
// public/favicon.svg tennis-ball design so older browsers without SVG
// favicon support still get the brand visual; modern browsers prefer
// the SVG version referenced via metadata.icons in app/layout.tsx.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r="30"
            fill="#5A9642"
            stroke="#222222"
            strokeWidth="2.5"
          />
          <path
            d="M 8 24 Q 22 32 8 42"
            fill="none"
            stroke="white"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M 56 24 Q 42 32 56 42"
            fill="none"
            stroke="white"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <text
            x="32"
            y="37"
            textAnchor="middle"
            fontFamily="Arial Black, Arial, sans-serif"
            fontWeight="900"
            fontSize="19"
            fill="white"
          >
            Ace
          </text>
        </svg>
      </div>
    ),
    { ...size },
  );
}
