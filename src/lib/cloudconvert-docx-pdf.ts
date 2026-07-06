// Convert .docx bytes to a formatting-faithful PDF via CloudConvert Jobs API.
// Reads CLOUDCONVERT_API_KEY from env; returns null when key is absent so
// callers can fall back without an exception.
//
// The sync endpoint (?sync=true) blocks until the job finishes, so this is
// one round-trip: POST job → wait → fetch output URL → return bytes.
// Timeout is 60s; a typical resume converts in 3-8s.

export async function convertDocxToPdfViaCloudConvert(
  docxBytes: Buffer,
  filename: string,
): Promise<Buffer | null> {
  // Outer catch: any unhandled throw is logged here before propagating to
  // the route's own catch block. Guarantees prod logs always see the error
  // even if Vercel flushes stdout just before killing the invocation.
  try {
    return await _convert(docxBytes, filename);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(
      "[docx-convert-diag] OUTER CATCH:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    throw err;
  }
}

async function _convert(
  docxBytes: Buffer,
  filename: string,
): Promise<Buffer | null> {
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] helper entry | key present:", !!apiKey,
    "| filename:", filename,
    "| source bytes:", docxBytes.byteLength,
  );
  if (!apiKey) return null;

  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] encoding docx as base64...");
  const base64 = docxBytes.toString("base64");
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] base64 length:", base64.length,
    "chars (~", Math.round(base64.length / 1024), "KB)",
  );

  const cleanName = /\.docx?$/i.test(filename) ? filename : `${filename}.docx`;

  const body = {
    tasks: {
      "import-file": {
        operation: "import/base64",
        file: base64,
        filename: cleanName,
      },
      "convert-file": {
        operation: "convert",
        input: "import-file",
        input_format: "docx",
        output_format: "pdf",
      },
      "export-file": {
        operation: "export/url",
        input: "convert-file",
      },
    },
    // NOTE: redirect:false is NOT a valid CloudConvert v2 field; omitted.
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] calling CloudConvert POST /v2/jobs?sync=true");
  let jobRes: Response;
  try {
    jobRes = await fetch("https://api.cloudconvert.com/v2/jobs?sync=true", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    const name = fetchErr instanceof Error ? fetchErr.name : "unknown";
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] fetch THREW:", name, "|", msg);
    if (name === "AbortError") {
      // eslint-disable-next-line no-console
      console.log("[docx-convert-diag] AbortError = 60s timeout hit waiting for CloudConvert ?sync=true");
    }
    throw fetchErr;
  }
  clearTimeout(timer);

  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] CloudConvert HTTP status:", jobRes.status);

  if (jobRes.status === 401 || jobRes.status === 403) {
    const errText = await jobRes.text().catch(() => "(no body)");
    // eslint-disable-next-line no-console
    console.log(
      `[docx-convert-diag] ${jobRes.status} from CloudConvert — check API key scopes (needs task.read + task.write). Body:`,
      errText.slice(0, 400),
    );
    throw new Error(`CloudConvert auth failed (${jobRes.status}) — check key scopes`);
  }

  // Read body text once; reuse for both error logging and JSON parsing.
  const rawBody = await jobRes.text().catch(() => "(body read failed)");

  if (!jobRes.ok) {
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] CloudConvert non-2xx body:", rawBody.slice(0, 500));
    throw new Error(
      `CloudConvert job failed (${jobRes.status}): ${rawBody.slice(0, 300)}`,
    );
  }

  // Log response even on 200 so we can see the exact shape in prod.
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] CloudConvert 200 response (first 600 chars):",
    rawBody.slice(0, 600),
  );

  let jobData: { data: { status?: string; tasks: Record<string, unknown> | unknown[] } };
  try {
    jobData = JSON.parse(rawBody) as typeof jobData;
  } catch (parseErr) {
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] failed to JSON.parse response:", parseErr);
    throw new Error("CloudConvert: could not parse response JSON");
  }

  // tasks may be an object keyed by name or an array — normalize.
  const tasksRaw = jobData?.data?.tasks;
  const tasks: unknown[] = Array.isArray(tasksRaw)
    ? (tasksRaw as unknown[])
    : Object.values(tasksRaw ?? {});

  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] job.status:", jobData?.data?.status,
    "| task count:", tasks.length,
  );
  for (const t of tasks) {
    if (typeof t === "object" && t !== null) {
      const task = t as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log(
        "[docx-convert-diag] task | name:", task.name ?? "(none)",
        "| operation:", task.operation ?? "(none)",
        "| status:", task.status ?? "(none)",
      );
    }
  }

  const exportTask = tasks.find(
    (t): t is { operation: string; status: string; result: { files: { url: string }[] } } =>
      typeof t === "object" &&
      t !== null &&
      (t as Record<string, unknown>).operation === "export/url" &&
      (t as Record<string, unknown>).status === "finished",
  );

  const fileUrl = exportTask?.result?.files?.[0]?.url;
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] export task found:", !!exportTask,
    "| file URL present:", !!fileUrl,
    "| url prefix:", fileUrl ? fileUrl.slice(0, 60) : "N/A",
  );
  if (!fileUrl) {
    throw new Error("CloudConvert: no output file URL in finished export task");
  }

  const downloadController = new AbortController();
  const downloadTimer = setTimeout(() => downloadController.abort(), 30_000);
  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] downloading converted PDF from CloudConvert CDN...");
  let pdfRes: Response;
  try {
    pdfRes = await fetch(fileUrl, { signal: downloadController.signal });
  } catch (dlErr) {
    clearTimeout(downloadTimer);
    const name = dlErr instanceof Error ? dlErr.name : "unknown";
    const msg = dlErr instanceof Error ? dlErr.message : String(dlErr);
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] PDF download THREW:", name, "|", msg);
    throw dlErr;
  }
  clearTimeout(downloadTimer);

  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] PDF download HTTP status:", pdfRes.status);
  if (!pdfRes.ok) {
    throw new Error(`CloudConvert: PDF download failed (${pdfRes.status})`);
  }

  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] CloudConvert SUCCESS — pdf bytes:", pdfBuf.byteLength);
  return pdfBuf;
}
