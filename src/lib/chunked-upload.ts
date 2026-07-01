// Client-side chunked upload.
//
// Vercel Hobby caps serverless function request bodies at ~4.5MB. A 5MB PDF
// as base64 JSON is ~7MB — too big in one shot. We split the file into 2MB
// raw slices (~2.7MB base64, ~2.8MB JSON with overhead) and POST them
// sequentially to the given endpoint. The server appends bytes to a DB row
// and returns the row id on each response.
//
// The first chunk creates the row and carries all the metadata; subsequent
// chunks reference the row id and the server appends to the existing bytes.
// The final chunk flips `uploadComplete` to true.

export type ChunkUploadMeta = Record<string, string | number | null | undefined>;

export type ChunkUploadResult = {
  id: string;
  totalBytesStored?: number;
};

function inferMimeType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  return null;
}

export async function uploadFileInChunks(
  file: File,
  endpoint: string,
  extra: ChunkUploadMeta = {},
  opts: {
    onProgress?: (percentage: number) => void;
    signal?: AbortSignal;
    chunkSize?: number;
  } = {},
): Promise<ChunkUploadResult> {
  const chunkSize = opts.chunkSize ?? 2 * 1024 * 1024; // 2MB raw ≈ 2.7MB base64
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  let recordId: string | undefined;
  let totalBytesStored: number | undefined;

  for (let i = 0; i < totalChunks; i++) {
    if (opts.signal?.aborted) throw new DOMException("Upload aborted", "AbortError");

    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const slice = file.slice(start, end);
    const buffer = await slice.arrayBuffer();
    const dataBase64 = arrayBufferToBase64(buffer);

    const isFirst = i === 0;
    const isLast = i === totalChunks - 1;
    const payload = {
      ...extra,
      ...(isFirst
        ? {
            filename: file.name,
            mimeType: file.type || inferMimeType(file.name) || "application/octet-stream",
            size: file.size,
          }
        : { id: recordId }),
      chunkIndex: i,
      totalChunks,
      isLast,
      data: dataBase64,
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: opts.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Chunk ${i + 1}/${totalChunks} failed (${res.status}): ${msg.slice(0, 200)}`);
    }
    const json = (await res.json()) as { id: string; totalBytesStored?: number };
    recordId = json.id;
    totalBytesStored = json.totalBytesStored;

    opts.onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
  }

  if (!recordId) throw new Error("Upload completed without a record id.");
  return { id: recordId, totalBytesStored };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Chunked String.fromCharCode to avoid stack overflow on large buffers.
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}
