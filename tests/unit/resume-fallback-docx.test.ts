import assert from "node:assert/strict";
import { Document, Header, Packer, Paragraph, TextRun } from "docx";
import { fallbackParseCandidate } from "../../src/lib/resume-fallback";
import { DOCX_MIME } from "../../src/lib/resume-text";

async function main() {
  const bodyContactDoc = new Document({
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

  const bodyContactBuffer = await Packer.toBuffer(bodyContactDoc);
  const bodyContactParsed = await fallbackParseCandidate({
    resume: {
      filename: "Louise_Tao_Resume_JGR_Updated.docx",
      mimeType: DOCX_MIME,
      data: bodyContactBuffer,
    },
  });

  assert.equal(bodyContactParsed.first_name, "Louise");
  assert.equal(bodyContactParsed.last_name, "Tao");
  assert.equal(bodyContactParsed.email, "louise.tao@gmail.com");
  assert.equal(bodyContactParsed.phone, "+19255960099");
  assert.equal(bodyContactParsed.location, "Emeryville, CA");
  assert.match(bodyContactParsed.notes ?? "", /LOUISE TAO/);

  const headerContactDoc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph("Yu Chan"),
              new Paragraph("121 Fanuncio Lane, Hayward, CA 94544"),
              new Paragraph({
                children: [
                  new TextRun("brian_c"),
                  new TextRun("han2000@hotmail.com"),
                ],
              }),
              new Paragraph("(408)750-7500"),
            ],
          }),
        },
        children: [
          new Paragraph("Professional Experience"),
          new Paragraph("CBIZ Inc (San Mateo, CA) August 2025 - Present"),
          new Paragraph("Tax Supervisor"),
        ],
      },
    ],
  });

  const headerContactBuffer = await Packer.toBuffer(headerContactDoc);
  const headerContactParsed = await fallbackParseCandidate({
    resume: {
      filename: "Yu Chan- Tax Supervisor.docx",
      mimeType: DOCX_MIME,
      data: headerContactBuffer,
    },
  });

  assert.equal(headerContactParsed.first_name, "Yu");
  assert.equal(headerContactParsed.last_name, "Chan");
  assert.equal(headerContactParsed.email, "brian_chan2000@hotmail.com");
  assert.equal(headerContactParsed.phone, "+14087507500");
  assert.equal(headerContactParsed.location, "Hayward, CA 94544");
  assert.equal(headerContactParsed.zip, "94544");

  console.log("resume-fallback DOCX tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
