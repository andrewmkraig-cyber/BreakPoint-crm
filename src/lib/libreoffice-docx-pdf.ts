import { execFile as execFileCb } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { pathToFileURL } from "url";

const execFile = promisify(execFileCb);
const CONVERT_TIMEOUT_MS = 55_000;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

// Formatting-faithful local converter. Returns null when LibreOffice/soffice
// is not installed in the runtime so callers can fall through to CloudConvert
// errors instead of silently creating a flattened Mammoth PDF.
export async function convertDocxToPdfViaLibreOffice(
  docxBytes: Buffer,
  filename: string,
): Promise<Buffer | null> {
  const soffice = await findSofficeBinary();
  if (!soffice) return null;

  const ext = extensionFor(filename);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-docx-pdf-"));
  const userProfileDir = path.join(workDir, "lo-profile");
  const inputBase = `source-${randomUUID()}${ext}`;
  const inputPath = path.join(workDir, inputBase);
  const outputPath = path.join(workDir, inputBase.replace(/\.(docx?|DOCX?)$/, ".pdf"));

  try {
    await fs.writeFile(inputPath, docxBytes);
    await fs.mkdir(userProfileDir, { recursive: true });

    await execFile(
      soffice,
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--nolockcheck",
        "--norestore",
        `-env:UserInstallation=${pathToFileURL(userProfileDir).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ],
      {
        timeout: CONVERT_TIMEOUT_MS,
        env: {
          ...process.env,
          HOME: workDir,
          XDG_CACHE_HOME: path.join(workDir, "cache"),
          TMPDIR: workDir,
        },
        maxBuffer: 1024 * 1024,
      },
    );

    const pdfBytes = await fs.readFile(outputPath);
    if (!looksLikePdf(pdfBytes)) {
      throw new Error("LibreOffice did not produce a valid PDF.");
    }
    return pdfBytes;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function extensionFor(filename: string): ".doc" | ".docx" {
  return /\.doc$/i.test(filename) ? ".doc" : ".docx";
}

function looksLikePdf(bytes: Buffer): boolean {
  return bytes.byteLength >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function findSofficeBinary(): Promise<string | null> {
  const explicit = [
    process.env.SOFFICE_PATH,
    process.env.LIBREOFFICE_PATH,
  ].map((v) => v?.trim()).filter((v): v is string => Boolean(v));

  const candidates = [
    ...explicit,
    "soffice",
    "libreoffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/opt/homebrew/bin/soffice",
    "/opt/homebrew/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];

  for (const candidate of candidates) {
    try {
      await execFile(candidate, ["--version"], { timeout: 5_000 });
      return candidate;
    } catch {
      // Try the next known location/name.
    }
  }

  return null;
}

export function isDocxMimeOrName(mimeType: string | null | undefined, filename: string): boolean {
  return (
    mimeType === DOCX_MIME ||
    mimeType === LEGACY_DOC_MIME ||
    /\.docx?$/i.test(filename)
  );
}
