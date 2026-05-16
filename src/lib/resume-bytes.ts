// Shared accessor for CandidateResume bytes. Prompt 1 migrated uploads
// to Vercel Blob and made `data` nullable; new rows carry bytes in
// `blobUrl`, legacy rows still carry them in `data` (before backfill
// runs). Every read path must route through here so neither generation
// breaks until the backfill clears the inline column.
//
// Private-blob reads use get(url, { access: "private" }) — not head() +
// raw fetch. head() returns metadata but the raw blob URL is 403 to an
// unauthenticated fetcher. get() drains a stream authenticated by
// BLOB_READ_WRITE_TOKEN and works whether the blob lives in a public
// or private store.

import { get } from "@vercel/blob";

type ResumeBytesInput = {
  blobUrl?: string | null;
  data?: Uint8Array | null;
};

export async function getResumeBytes(resume: ResumeBytesInput): Promise<Buffer> {
  if (resume.blobUrl) {
    const result = await get(resume.blobUrl, { access: "private" });
    if (!result) throw new Error(`Blob not found: ${resume.blobUrl}`);
    if (result.statusCode !== 200) {
      throw new Error(`Blob fetch failed: ${result.statusCode} ${resume.blobUrl}`);
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  if (resume.data && resume.data.byteLength > 0) return Buffer.from(resume.data);
  throw new Error("CandidateResume has neither blobUrl nor data");
}
