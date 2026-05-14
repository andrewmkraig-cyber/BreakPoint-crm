import { redirect } from "next/navigation";

// /invoices is now a tab inside /finances. Keep this route alive as a
// permanent redirect so existing bookmarks, inbound links, and any
// stale references (e.g. revalidatePath calls, attribution rows) don't
// 404 after the consolidation.
export default function InvoicesIndexRedirect() {
  redirect("/finances?tab=invoices");
}
