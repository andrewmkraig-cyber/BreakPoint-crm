import { CampaignsView } from "@/app/campaigns/campaigns-view";

export const dynamic = "force-dynamic";

// Campaigns - read-only Instantly monitoring.
//
// Data is fetched client-side through Ace's own /api/instantly/* routes
// rather than server-rendered. That is deliberate: the Instantly key is
// server-only, the routes are the single boundary the browser talks to,
// and the replies pane needs to re-fetch as the rate-limit budget frees
// up. Server-rendering the first paint would fix neither and would put a
// slow third-party call in the page's critical path.
export default function CampaignsPage() {
  return <CampaignsView />;
}
