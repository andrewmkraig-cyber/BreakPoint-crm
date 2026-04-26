# Resume branding (Brand mode)

The Edit Resume modal now has two tabs: **Redact** (the existing white-rectangle redactor) and **Brand**. Brand stamps the BreakPoint logo onto a resume and saves it as a new "Branded" version that slots into the Version dropdown alongside Original and Redacted entries. Phase 5A.5.b.

## How to brand a resume

1. Open a candidate profile and pick the version you want to brand from the Version dropdown (Original or Redacted both work).
2. Click **Edit Resume** in the resume header. The modal opens on the Redact tab when the selected version is a raw original; otherwise it opens on Brand.
3. Switch to the **Brand** tab. The full resume preview renders at readable size with the transparent BreakPoint logo placed in the center of page 1 by default.
4. Drag the logo to the spot you want stamped. Each click on a page also drops the logo there at the click point — the logo is anchored to whichever page you drop it on.
5. Adjust the size with the **Size** range slider (40px–200px; default 80px).
6. (Multi-page resumes only) Tick **Apply to all pages** to repeat the same coordinates on every page on save.
7. Click **Save branded version**. The branded PDF is saved as a new CandidateResume row with `variant="branded"` and shows up in the Version dropdown labeled `Branded (date)`.

The base layer of the branded copy is whichever version was selected when you opened the modal — so branding the Redacted version preserves the redactions and adds the logo on top.

## Where it works

- **RF-imported candidates** (e.g. Lesley Snell): always available.
- **Ace-native candidates**: same UI as RF-imported. The first time an Ace-native candidate's profile loads after 5A.5.b ships, their existing resume is automatically migrated into the multi-version table so all of upload-new-version, rename, redact, and brand work without any manual step.

## Where it doesn't work

- DOC / DOCX uploads can't be branded because pdf-lib doesn't render Word documents. The Brand entry point is only enabled when the selected version is a PDF.
- Branding requires a PDF base layer; if the original is a DOC, redact-and-save first (the redactor outputs a PDF), then brand the redacted version.

## Multiple branded versions

Saving Brand multiple times produces multiple branded rows — each gets its own dropdown entry sorted newest first. Delete works on the whole candidate's resume history (matches existing 5A.5.a behavior).

## What gets stored

- Branded versions are stored as standalone CandidateResume rows with `variant="branded"`. The `data` column holds the pre-stamped PDF bytes; preview / download serve them via `/api/candidate-resumes/by-id/<id>` with no `variant=` query param.
- The original and redacted versions stay untouched — brand mode never overwrites either.

## Logo source

The transparent BreakPoint logo embedded in the PDF is `public/brand/breakpoint_logo_transparent.png`, base64-baked into `src/lib/default-brand-logo.ts` so serverless functions can read it without filesystem access. The email-signature flow continues to use the white-background variant from the same module.
