import { redirect } from "next/navigation";

// /finances was the old combined three-tab surface (Revenue & Profitability
// / Invoices / Expenses). Ace 74.0 split it into standalone /invoices and
// /expenses pages and deleted Revenue & Profitability entirely (its three
// Revenue cards moved to the Placements page). This route is kept alive as
// a redirect so old bookmarks, inbound links, and any stale
// revalidatePath("/finances") calls still land somewhere sensible:
// ?tab=expenses -> /expenses, everything else -> /invoices.
type RawParams = { tab?: string };
type ParamsInput = Promise<RawParams> | RawParams;

export default async function FinancesRedirect({
  searchParams,
}: {
  searchParams?: ParamsInput;
}) {
  const params = (await Promise.resolve(searchParams ?? {})) as RawParams;
  if (params.tab === "expenses") redirect("/expenses");
  redirect("/invoices");
}
