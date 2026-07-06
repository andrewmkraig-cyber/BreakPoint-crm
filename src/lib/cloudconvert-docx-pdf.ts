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
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) return null;

  const base64 = docxBytes.toString("base64");
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
    redirect: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

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
  } finally {
    clearTimeout(timer);
  }

  if (!jobRes.ok) {
    const errText = await jobRes.text().catch(() => "(no body)");
    throw new Error(
      `CloudConvert job failed (${jobRes.status}): ${errText.slice(0, 300)}`,
    );
  }

  const jobData = (await jobRes.json()) as {
    data: { tasks: Record<string, unknown> | unknown[] };
  };

  // tasks may be an object keyed by name or an array — normalize.
  const tasks: unknown[] = Array.isArray(jobData?.data?.tasks)
    ? (jobData.data.tasks as unknown[])
    : Object.values(jobData?.data?.tasks ?? {});

  const exportTask = tasks.find(
    (t): t is { operation: string; status: string; result: { files: { url: string }[] } } =>
      typeof t === "object" &&
      t !== null &&
      (t as Record<string, unknown>).operation === "export/url" &&
      (t as Record<string, unknown>).status === "finished",
  );

  const fileUrl = exportTask?.result?.files?.[0]?.url;
  if (!fileUrl) {
    throw new Error(
      "CloudConvert: no output file URL in finished export task",
    );
  }

  const downloadController = new AbortController();
  const downloadTimer = setTimeout(() => downloadController.abort(), 30_000);
  let pdfRes: Response;
  try {
    pdfRes = await fetch(fileUrl, { signal: downloadController.signal });
  } finally {
    clearTimeout(downloadTimer);
  }

  if (!pdfRes.ok) {
    throw new Error(`CloudConvert: PDF download failed (${pdfRes.status})`);
  }

  return Buffer.from(await pdfRes.arrayBuffer());
}
