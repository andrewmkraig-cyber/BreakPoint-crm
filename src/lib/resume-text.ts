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
  const fromHeaderFooter = await tryRawXmlExtract(data, isHeaderFooterXmlPart);
  const merged = mergeDocxText(fromHeaderFooter, fromMammoth);
  if (merged.trim().length >= 50) return merged;

  const fromRawXml = await tryRawXmlExtract(data);
  if (fromRawXml.trim().length >= 50) return fromRawXml;

  const longer = fromRawXml.length >= merged.length ? fromRawXml : merged;
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

type XmlPartFilter = (path: string) => boolean;

function isHeaderFooterXmlPart(path: string): boolean {
  return /^word\/(?:header|footer)\d+\.xml$/i.test(path);
}

function isSearchableXmlPart(path: string): boolean {
  if (!path.startsWith("word/")) return false;
  if (!path.endsWith(".xml")) return false;
  if (path.endsWith(".rels")) return false;
  if (path === "word/theme/theme1.xml") return false;
  if (path === "word/styles.xml") return false;
  if (path === "word/settings.xml") return false;
  if (path === "word/fontTable.xml") return false;
  if (path === "word/webSettings.xml") return false;
  return true;
}

async function tryRawXmlExtract(
  data: Buffer,
  includePath: XmlPartFilter = isSearchableXmlPart,
): Promise<string> {
  try {
    const JSZipMod = await import("jszip");
    const JSZip = (JSZipMod.default ?? JSZipMod) as typeof import("jszip");
    const zip = await JSZip.loadAsync(data);
    const paths = Object.keys(zip.files).filter(includePath).sort();
    const parts: string[] = [];
    for (const path of paths) {
      const entry = zip.files[path];
      if (!entry || entry.dir) continue;
      const xml = await entry.async("string");
      parts.push(...extractTextLinesFromXml(xml));
    }
    return parts.join("\n").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  } catch {
    return "";
  }
}

function extractTextLinesFromXml(xml: string): string[] {
  const paragraphMatches = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  const source = paragraphMatches.length > 0 ? paragraphMatches : [xml];
  const lines: string[] = [];
  for (const block of source) {
    const runs: string[] = [];
    const re = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      runs.push(decodeXmlEntities(m[1]));
    }
    const line = runs.join("").replace(/[ \t]+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines;
}

function mergeDocxText(...texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const key = line.replace(/\s+/g, " ").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out.join("\n");
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
