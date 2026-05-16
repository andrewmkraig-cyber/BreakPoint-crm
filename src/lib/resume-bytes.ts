// Shared accessors for CandidateResume bytes. Prompt 1 migrated uploads
// to Vercel Blob and made `data` nullable; new rows carry bytes in
// `blobUrl`, legacy rows still carry them in `data`. Every read path
// must route through here so neither generation breaks until the
// backfill clears the inline column.
//
// Uses @vercel/blob's head() for the downloadUrl handshake (matches the
// existing `fetchBlobBytes` in clients/[id]/actions.ts — works for both
// public and private blobs). Global `fetch` (Node 18+) avoids pulling
// in undici as a direct dep.

type ResumeBytesInput = {
  blobUrl?: string | null;
  data?: Uint8Array | null;
};

export async function getResumeBytes(resume: ResumeBytesInput): Promise<Buffer> {
  if (resume.blobUrl) {
    const { head } = await import("@vercel/blob");
    const meta = (await head(resume.blobUrl)) as { downloadUrl?: string; url?: string };
    const downloadUrl = meta.downloadUrl ?? meta.url ?? resume.blobUrl;
    const res = await fetch(downloadUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Blob fetch failed: ${res.status} ${resume.blobUrl}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (resume.data && resume.data.byteLength > 0) return Buffer.from(resume.data);
  throw new Error("CandidateResume has neither blobUrl nor data");
}

// For routes that hand a URL back to the browser. Prefers the direct
// Blob URL (CDN-served, no proxy hop). Legacy rows fall back to an
// inline data: URI built from the Postgres bytes — large but works
// without any new round-trip.
export function getResumeServeUrl(
  resume: ResumeBytesInput & { mimeType: string },
  fallbackBase64?: string,
): string {
  if (resume.blobUrl) return resume.blobUrl;
  const buf =
    resume.data && resume.data.byteLength > 0
      ? Buffer.from(resume.data)
      : fallbackBase64
        ? Buffer.from(fallbackBase64, "base64")
        : null;
  if (buf) return `data:${resume.mimeType};base64,${buf.toString("base64")}`;
  throw new Error("CandidateResume has neither blobUrl nor data");
}
