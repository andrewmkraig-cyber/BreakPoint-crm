export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const LEGACY_DOC_MIME = "application/msword";

export function looksLikeDocx(filename: string, mimeType: string): boolean {
  if (mimeType.toLowerCase() === DOCX_MIME) return true;
  return filename.toLowerCase().endsWith(".docx");
}

// Marker prefix so callers can distinguish "this .docx has no readable
// text at all" from other parse failures and surface a targeted UX.
export const DOCX_UNPARSEABLE_PREFIX = "DOCX_UNPARSEABLE";

// Dynamic imports keep mammoth / jszip out of bundles that never touch Word
// documents. Some DOCX templates use text boxes, nested tables, or drawing
// canvas layouts that mammoth can miss, so the raw XML pass harvests every
// <w:t> text node before giving up.
export async function extractDocxText(data: Buffer): Promise<string> {
  const fromMammoth = await tryMammothExtract(data);
  if (fromMammoth.trim().length >= 50) return fromMammoth;

  const fromRawXml = await tryRawXmlExtract(data);
  if (fromRawXml.trim().length >= 50) return fromRawXml;

  const longer = fromRawXml.length >= fromMammoth.length ? fromRawXml : fromMammoth;
  if (longer.trim().length > 0) return longer;

  throw new Error(`${DOCX_UNPARSEABLE_PREFIX}: no readable text found in the document.`);
}

async function tryMammothExtract(data: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
    if (typeof extract !== "function") return "";
    const result = await extract({ buffer: data });
    return result.value ?? "";
  } catch {
    return "";
  }
}

async function tryRawXmlExtract(data: Buffer): Promise<string> {
  try {
    const JSZipMod = await import("jszip");
    const JSZip = (JSZipMod.default ?? JSZipMod) as typeof import("jszip");
    const zip = await JSZip.loadAsync(data);
    const paths = Object.keys(zip.files).filter((p) => {
      if (!p.startsWith("word/")) return false;
      if (!p.endsWith(".xml")) return false;
      if (p.endsWith(".rels")) return false;
      if (p === "word/theme/theme1.xml") return false;
      if (p === "word/styles.xml") return false;
      if (p === "word/settings.xml") return false;
      if (p === "word/fontTable.xml") return false;
      if (p === "word/webSettings.xml") return false;
      return true;
    });
    const parts: string[] = [];
    for (const path of paths) {
      const entry = zip.files[path];
      if (!entry || entry.dir) continue;
      const xml = await entry.async("string");
      const re = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const t = decodeXmlEntities(m[1]);
        if (t) parts.push(t);
      }
      if (xml.includes("</w:p>")) parts.push("\n");
    }
    return parts.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  } catch {
    return "";
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
