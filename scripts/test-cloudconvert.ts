// Standalone test for the CloudConvert DOCX→PDF helper.
// Reads CLOUDCONVERT_API_KEY from env, converts the docx file passed as
// the first argument, and writes the output PDF next to it.
//
// Run: npx tsx scripts/test-cloudconvert.ts <path-to-file.docx>
import * as fs from "fs";
import * as path from "path";
import { convertDocxToPdfViaCloudConvert } from "../src/lib/cloudconvert-docx-pdf";

async function main() {
  const docxPath = process.argv[2];
  if (!docxPath) {
    console.error("Usage: npx tsx scripts/test-cloudconvert.ts <path-to-file.docx>");
    process.exit(1);
  }

  const resolved = path.resolve(docxPath);
  if (!fs.existsSync(resolved)) {
    console.error("[test-cloudconvert] file not found:", resolved);
    process.exit(1);
  }

  const docxBytes = fs.readFileSync(resolved);

  let pdfBytes: Buffer | null = null;
  try {
    pdfBytes = await convertDocxToPdfViaCloudConvert(docxBytes, path.basename(resolved));
  } catch (err) {
    console.error("[test-cloudconvert] helper THREW — full error below:");
    console.error(err);
    process.exit(1);
  }

  if (!pdfBytes) {
    console.log("[test-cloudconvert] helper returned null (key absent or fallback path)");
    process.exit(0);
  }

  const outPath = resolved.replace(/\.docx?$/i, ".converted.pdf");
  fs.writeFileSync(outPath, pdfBytes);
  console.log("[test-cloudconvert] SUCCESS — wrote", pdfBytes.byteLength, "bytes to:", outPath);
}

main().catch((err) => {
  console.error("[test-cloudconvert] unhandled error:", err);
  process.exit(1);
});
