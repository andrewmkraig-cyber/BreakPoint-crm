import { buildJobsXml } from "@/lib/jobs-feed-xml";
import { getPublishedWebsiteJobs } from "@/lib/public-jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const result = await getPublishedWebsiteJobs();
  if (!result.ok) {
    return new Response(result.error, {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  return new Response(buildJobsXml(result.jobs), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Job boards poll this URL. Every request should reflect the current DB
      // rather than a previously cached publish/unpublish state.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
