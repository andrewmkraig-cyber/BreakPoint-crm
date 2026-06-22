// Best-effort Netlify rebuild notifier for breakpointtalent.com. Job saves
// must never fail because Netlify is unavailable or the hook is not yet
// configured, so callers can safely await this after their database write.
export async function triggerJobsSiteRebuild(reason: string): Promise<void> {
  const url = process.env.NETLIFY_JOBS_BUILD_HOOK?.trim();
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, source: "ace" }),
      cache: "no-store",
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("[jobs-site-rebuild] Netlify hook failed", {
        reason,
        status: response.status,
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[jobs-site-rebuild] Netlify hook unavailable", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
