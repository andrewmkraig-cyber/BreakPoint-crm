// Convert .docx bytes to a formatting-faithful PDF via CloudConvert Jobs API.
// Reads CLOUDCONVERT_API_KEY from env; returns null when key is absent so
// callers can fall back without an exception.
//
// The sync endpoint blocks until the job finishes — one round-trip:
// POST job → wait → fetch output URL → return bytes.
// AbortController timeout at 55s; Vercel maxDuration must be ≥60s on callers.

export async function convertDocxToPdfViaCloudConvert(
  docxBytes: Buffer,
  filename: string,
): Promise<Buffer | null> {
  const apiKey = process.env.CLOUDCONVERT_API_KEY?.trim();
  if (!apiKey) return null;

  const base64 = docxBytes.toString("base64");
  const cleanName = /\.docx?$/i.test(filename) ? filename : `${filename}.docx`;
  const inputFormat = /\.doc$/i.test(cleanName) ? "doc" : "docx";

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
        input_format: inputFormat,
        output_format: "pdf",
      },
      "export-file": {
        operation: "export/url",
        input: "convert-file",
      },
    },
  };

  // 55s leaves a 5s gap before the Vercel SIGKILL so error handling can flush.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);

  let jobRes: Response;
  try {
    jobRes = await fetch("https://sync.api.cloudconvert.com/v2/jobs", {
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
    throw fetchErr;
  }
  clearTimeout(timer);

  if (jobRes.status === 401 || jobRes.status === 403) {
    await jobRes.text().catch(() => null);
    throw new Error(`CloudConvert auth failed (${jobRes.status}) — check key scopes`);
  }

  const rawBody = await jobRes.text().catch(() => "(body read failed)");
  if (!jobRes.ok) {
    throw new Error(`CloudConvert job failed (${jobRes.status}): ${rawBody.slice(0, 300)}`);
  }

  let jobData: { data: { status?: string; tasks: Record<string, unknown> | unknown[] } };
  try {
    jobData = JSON.parse(rawBody) as typeof jobData;
  } catch {
    throw new Error("CloudConvert: could not parse response JSON");
  }

  const tasksRaw = jobData?.data?.tasks;
  const tasks: unknown[] = Array.isArray(tasksRaw)
    ? (tasksRaw as unknown[])
    : Object.values(tasksRaw ?? {});

  const exportTask = tasks.find(
    (
      t,
    ): t is {
      operation: string;
      status: string;
      result: { files: Array<{ url?: string }> };
    } =>
      typeof t === "object" &&
      t !== null &&
      (t as Record<string, unknown>).operation === "export/url" &&
      (t as Record<string, unknown>).status === "finished",
  );

  const fileUrl = exportTask?.result?.files?.find(
    (file) => typeof file.url === "string" && file.url.length > 0,
  )?.url;
  if (!fileUrl) {
    throw new Error(
      `CloudConvert: no output file URL (${summarizeJobTasks(jobData.data.status, tasks)})`,
    );
  }

  const downloadController = new AbortController();
  const downloadTimer = setTimeout(() => downloadController.abort(), 30_000);
  let pdfRes: Response;
  try {
    pdfRes = await fetch(fileUrl, { signal: downloadController.signal });
  } catch (dlErr) {
    clearTimeout(downloadTimer);
    throw dlErr;
  }
  clearTimeout(downloadTimer);

  if (!pdfRes.ok) {
    throw new Error(`CloudConvert: PDF download failed (${pdfRes.status})`);
  }

  return Buffer.from(await pdfRes.arrayBuffer());
}

function summarizeJobTasks(status: string | undefined, tasks: unknown[]): string {
  const taskSummary = tasks
    .map((task) => {
      if (!task || typeof task !== "object") return "unknown";
      const record = task as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "unnamed";
      const operation = typeof record.operation === "string" ? record.operation : "unknown-op";
      const taskStatus = typeof record.status === "string" ? record.status : "unknown-status";
      return `${name}:${operation}:${taskStatus}`;
    })
    .join(", ");
  return `job=${status ?? "unknown"} tasks=[${taskSummary || "none"}]`;
}
