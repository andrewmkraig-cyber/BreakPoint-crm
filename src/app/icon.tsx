import { ImageResponse } from "next/og";

// Next.js App Router auto-detects /app/icon.{tsx,ts,js} and injects a
// <link rel="icon"> pointing at the generated PNG. Renders the same
// tennis-ball Ace mark as public/favicon.svg so older browsers that
// don't support SVG favicons still get the brand visual; modern
// browsers prefer the SVG version referenced via metadata.icons.
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
            strokeWidth="2"
          />
          <path
            d="M 10 20 Q 20 32 10 44"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M 54 20 Q 44 32 54 44"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <text
            x="32"
            y="38"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontWeight="bold"
            fontSize="20"
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
