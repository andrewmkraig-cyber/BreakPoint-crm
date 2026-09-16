import type { SignatureInlineImage } from "@/lib/signature";

// Turns base64 `data:` images in an HTML body into `cid:` references plus
// the inline MIME parts the send pipeline embeds as multipart/related
// siblings (Content-Disposition: inline).
//
// Why: the composer stores a pasted / inserted / dropped picture as a
// data: URI inside the <img>. Gmail accepts that, but on send it rewrites
// every data: URI into its own cid: part and labels it with a filename,
// which Apple Mail, iOS Mail and Outlook then show as a bottom attachment
// the reader has to open, on top of (or instead of) the inline render.
// The signature already avoids this by emitting its own inline parts (see
// renderSignatureInline); this applies the same fix to the body so a deal
// announcement photo sits under the text in every client.
//
// Only base64 data: URIs with an image/* type are converted. Anything else
// (https:// images, cid: refs that are already inline parts) is left alone.
// Identical data: URIs share one part so a picture that appears twice is
// only embedded once.

const DATA_IMAGE_SRC_RE =
  /(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\2/gi;

// Display width applied when the <img> carries none. Matches the
// composer's INLINE_IMAGE_WIDTH.
const INLINE_BODY_IMAGE_WIDTH = 360;

const MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
};

export function extractInlineBodyImages(
  html: string,
  cidPrefix: string,
): { html: string; images: SignatureInlineImage[] } {
  const images: SignatureInlineImage[] = [];
  const seen = new Map<string, string>();
  const out = html.replace(
    DATA_IMAGE_SRC_RE,
    (_match, prefix: string, quote: string, mimeType: string, base64: string) => {
      const cleanMime = mimeType.toLowerCase();
      const cleanBase64 = base64.replace(/\s+/g, "");
      const dedupeKey = `${cleanMime}:${cleanBase64}`;
      let cid = seen.get(dedupeKey);
      if (!cid) {
        const index = images.length + 1;
        cid = `${cidPrefix}-${index}`;
        const ext = MIME_EXTENSION[cleanMime] ?? cleanMime.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "img";
        images.push({
          cid,
          mimeType: cleanMime,
          base64: cleanBase64,
          filename: `image-${index}.${ext}`,
        });
        seen.set(dedupeKey, cid);
      }
      return `${prefix}${quote}cid:${cid}${quote}`;
    },
  );
  // Any converted picture that still lacks a display width (an older
  // draft, a body built outside the composer) gets the standard one, so a
  // phone photo never renders at its native 3000px in the reading pane.
  const sized = out.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/\bsrc\s*=\s*["']cid:/i.test(tag) || !tag.includes(`cid:${cidPrefix}-`)) return tag;
    if (/\bwidth\s*=/i.test(tag)) return tag;
    return tag.replace(
      /<img\b/i,
      `<img width="${INLINE_BODY_IMAGE_WIDTH}" style="width:${INLINE_BODY_IMAGE_WIDTH}px;max-width:100%;height:auto"`,
    );
  });
  return { html: sized, images };
}
