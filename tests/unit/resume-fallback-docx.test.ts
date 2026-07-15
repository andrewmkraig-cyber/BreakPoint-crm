import assert from "node:assert/strict";
import { Document, Packer, Paragraph } from "docx";
import { fallbackParseCandidate } from "../../src/lib/resume-fallback";
import { DOCX_MIME } from "../../src/lib/resume-text";

async function main() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph("LOUISE TAO"),
          new Paragraph("925.596.0099        louise.tao@gmail.com        Emeryville, CA"),
          new Paragraph("SENIOR TAX SPECIALIST AND ACCOUNTING PROFESSIONAL"),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const parsed = await fallbackParseCandidate({
    resume: {
      filename: "Louise_Tao_Resume_JGR_Updated.docx",
      mimeType: DOCX_MIME,
      data: buffer,
    },
  });

  assert.equal(parsed.first_name, "Louise");
  assert.equal(parsed.last_name, "Tao");
  assert.equal(parsed.email, "louise.tao@gmail.com");
  assert.equal(parsed.phone, "+19255960099");
  assert.equal(parsed.location, "Emeryville, CA");
  assert.match(parsed.notes ?? "", /LOUISE TAO/);

  console.log("resume-fallback DOCX tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
