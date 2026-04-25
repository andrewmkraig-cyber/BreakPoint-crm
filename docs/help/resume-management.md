# Resume management

The resume area on a candidate profile (RF-imported surface) now supports multiple uploaded versions, an inline rename of the displayed filename, and a Version dropdown to switch what's shown in the preview. Phase 5A.5.a.

## How to upload a new version

The old "Replace" button is gone. New uploads now create a **new version** instead of overwriting the previous one. Two ways to add a version:

- **First upload (no resume yet):** the dropzone in the resume panel handles drag-drop / click-to-pick.
- **Subsequent uploads:** click the **Upload new version** button in the resume header (icon-only, sits next to Download). Pick the file → it appears in the Version dropdown immediately.

Each upload is its own row in the database. Older versions stay around — the dropdown lists them all sorted newest first.

## Version dropdown

The header shows a small **Version** dropdown listing every saved version. Each entry has a friendly label:

- `Original (Apr 24, 2026)` — a raw upload, dated by upload date.
- `Redacted (Apr 24, 2026)` — the redacted variant attached to that upload (if you've used **Edit Resume** on it).

Default selection: **most recent redacted** if any version has been redacted, else most recent original. Picking a different entry swaps the inline PDF preview to that version. Download serves whatever version is currently selected.

Branded versions (coming in 5A.5.b) will slot into the same dropdown without any UI change — the architecture is designed around an extensible array of versions.

## Inline rename

Click the filename text in the resume header. It turns into an editable input pre-filled with the current display name (or the raw upload filename if you haven't renamed it yet).

- **Enter** saves.
- **Escape** cancels.
- The `.pdf` extension is preserved automatically — type "Linda Coran - BreakPoint Talent - Resume" and the download serves "Linda Coran - BreakPoint Talent - Resume.pdf".
- Saving an empty / whitespace-only name **clears the override** — the UI falls back to showing the raw upload filename. No risk of a blank resume name accidentally breaking the header.

The renamed name is used everywhere the filename appears: the header, the version dropdown labels, and the Content-Disposition filename when you click Download.

## Tenant scope

Every read and write scopes by `organizationId`. The rename mutation looks up the resume by id AND verifies it belongs to the caller's org before writing. A forged resume id from another tenant gets a clean "Resume not found" error.

## What was removed

- **Brand Resume** button — gone from both candidate-profile surfaces. Branding will move into the **Edit Resume** modal in 5A.5.b. The underlying brand logic (`BrandResumeButton` component) still lives in the codebase for that next step.
- **Replace** button — gone. Uploads always create new versions. If you genuinely want to discard an old version, use the trash icon (deletes ALL versions for the candidate today; per-version delete will land alongside 5A.5.b).

## Scope note

This release applies to the **RF-imported candidate profile** surface (`editable-resume.tsx`). The Ace-native surface (`local-profile.tsx`) had only the Brand Resume button, which is now removed; multi-version + inline rename for Ace-native candidates lands once those candidates can route uploads through the same `/api/uploads/candidate-resume` endpoint (queued for a follow-up).
