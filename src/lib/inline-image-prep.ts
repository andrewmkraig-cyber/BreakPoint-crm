// Browser-side prep for a picture going INTO an email body (pasted,
// dropped or inserted in the composer). A phone photo is 3000+ px wide and
// several MB; embedded as-is it fills the whole reading pane and bloats
// the message. Downscale the pixels to a sensible long edge and re-encode,
// returning the data: URL the editor's image node stores. Display width is
// separate (INLINE_IMAGE_WIDTH on the node) so the pixels still look
// sharp on retina screens.

export const INLINE_IMAGE_MAX_EDGE = 1200;
export const INLINE_IMAGE_WIDTH = 360;

function readAsDataUrl(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export async function prepareInlineImage(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  // GIFs lose animation through a canvas and SVGs don't need pixels
  // touched; hand those through untouched.
  if (file.type === "image/gif" || file.type === "image/svg+xml") return readAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > INLINE_IMAGE_MAX_EDGE ? INLINE_IMAGE_MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return readAsDataUrl(file);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    // PNG keeps transparency (screenshots, logos); everything else becomes
    // a JPEG, which is far smaller for photos.
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const out = canvas.toDataURL(mime, 0.85);
    return out && out.startsWith("data:image/") ? out : readAsDataUrl(file);
  } catch {
    return readAsDataUrl(file);
  }
}
