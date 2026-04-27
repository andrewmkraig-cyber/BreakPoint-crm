import { ImageResponse } from "next/og";

// Next.js App Router auto-detects /app/icon.{tsx,ts,js} and injects a
// <link rel="icon"> pointing at the generated PNG. Keeps the favicon as
// a generated 32x32 PNG so older browsers without SVG-favicon support
// still get the BreakPoint mark; modern browsers use public/favicon.svg
// for crisper rendering on hi-dpi displays.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#5A9642",
          color: "white",
          fontSize: 22,
          fontWeight: 800,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        B
      </div>
    ),
    { ...size },
  );
}
