import { ImageResponse } from "next/og";

// Next.js App Router auto-detects /app/icon.{tsx,ts,js} and injects a
// <link rel="icon"> pointing at the generated PNG. Satori (the
// renderer behind next/og) does not support SVG <text> elements, so
// the PNG version is intentionally simpler than public/favicon.svg:
// solid green circle with a dark border and white "Ace" text. Modern
// browsers prefer the SVG (referenced via metadata.icons in
// app/layout.tsx) which carries the full tennis-ball seams.
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
          background: "#5A9642",
          borderRadius: "50%",
          borderColor: "#222222",
          borderWidth: 2,
          borderStyle: "solid",
          color: "white",
          fontFamily: "Arial, sans-serif",
          fontWeight: 900,
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        Ace
      </div>
    ),
    { ...size },
  );
}
