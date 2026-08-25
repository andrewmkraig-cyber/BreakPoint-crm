import { CampaignDetailView } from "@/app/campaigns/[id]/campaign-detail-view";

export const dynamic = "force-dynamic";

export default function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <CampaignDetailView campaignId={params.id} />;
}
