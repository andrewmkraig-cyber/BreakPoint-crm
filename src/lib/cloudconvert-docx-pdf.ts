// Convert .docx bytes to a formatting-faithful PDF via CloudConvert Jobs API.
// Reads CLOUDCONVERT_API_KEY from env; returns null when key is absent so
// callers can fall back without an exception.
//
// The sync endpoint (?sync=true) blocks until the job finishes, so this is
// one round-trip: POST job → wait → fetch output URL → return bytes.
// CloudConvert abort timeout is 55s; Vercel maxDuration is 60s. The 5s gap
// ensures the AbortError catch runs and its logs flush BEFORE Vercel SIGKILL.

export async function convertDocxToPdfViaCloudConvert(
  docxBytes: Buffer,
  filename: string,
): Promise<Buffer | null> {
  try {
    return await _convert(docxBytes, filename);
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack
      ? err.stack.split("\n")[1]?.trim() ?? "(no stack line)"
      : "(no stack)";
    // eslint-disable-next-line no-console
    console.log(
      "[docx-convert-diag] helper THREW:",
      name, "|", msg, "|", stack,
    );
    throw err;
  }
}

async function _convert(
  docxBytes: Buffer,
  filename: string,
): Promise<Buffer | null> {
  // --- ENTRY ------------------------------------------------------------------
  const apiKey = process.env.CLOUDCONVERT_API_KEY?.trim();
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] helper entry | key present:", !!apiKey,
    "| key length (trimmed):", apiKey?.length ?? 0,
    "| filename:", filename,
    "| source bytes:", docxBytes.byteLength,
  );

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] key absent — returning null (mammoth fallback will run)");
    return null;
  }

  // --- BASE64 ENCODE ---------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] PRE-BASE64: about to encode", docxBytes.byteLength, "bytes");
  const base64 = docxBytes.toString("base64");
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] POST-BASE64: encoded length:", base64.length,
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
  };

  // --- CLOUDCONVERT FETCH ----------------------------------------------------
  // 55s timeout leaves a 5s window for the catch/log to flush before
  // Vercel's 60s maxDuration SIGKILL. Without this gap the abort fires
  // simultaneously with the process kill and its logs are lost.
  const CLOUDCONVERT_URL = "https://api.cloudconvert.com/v2/jobs?sync=true";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);

  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] fetch START | url:", CLOUDCONVERT_URL);
  let jobRes: Response;
  try {
    jobRes = await fetch(CLOUDCONVERT_URL, {
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
    if (name === "AbortError") {
      // eslint-disable-next-line no-console
      console.log("[docx-convert-diag] CloudConvert fetch ABORTED (55s timeout) — job took too long");
    } else {
      // eslint-disable-next-line no-console
      console.log("[docx-convert-diag] CloudConvert fetch THREW (network error):", name, "|", msg);
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
      `[docx-convert-diag] ${jobRes.status} — check API key scopes (needs task.read + task.write). Body:`,
      errText.slice(0, 400),
    );
    throw new Error(`CloudConvert auth failed (${jobRes.status}) — check key scopes`);
  }

  const rawBody = await jobRes.text().catch(() => "(body read failed)");

  if (!jobRes.ok) {
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] CloudConvert non-2xx body:", rawBody.slice(0, 500));
    throw new Error(`CloudConvert job failed (${jobRes.status}): ${rawBody.slice(0, 300)}`);
  }

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

  // --- PDF DOWNLOAD ----------------------------------------------------------
  const downloadController = new AbortController();
  const downloadTimer = setTimeout(() => downloadController.abort(), 30_000);
  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] PDF download START");
  let pdfRes: Response;
  try {
    pdfRes = await fetch(fileUrl, { signal: downloadController.signal });
  } catch (dlErr) {
    clearTimeout(downloadTimer);
    const name = dlErr instanceof Error ? dlErr.name : "unknown";
    const msg = dlErr instanceof Error ? dlErr.message : String(dlErr);
    if (name === "AbortError") {
      // eslint-disable-next-line no-console
      console.log("[docx-convert-diag] PDF download ABORTED (30s timeout)");
    } else {
      // eslint-disable-next-line no-console
      console.log("[docx-convert-diag] PDF download THREW (network error):", name, "|", msg);
    }
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
