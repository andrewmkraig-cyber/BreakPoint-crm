import { redirect } from "next/navigation";

// Triggers settings unified into /settings/templates as of Item 33.
// Kept as a permanent redirect so old bookmarks / cross-references
// land on the Triggers tab of the merged page. The hash drives the
// client-side TabStrip in TemplatesTriggersView.
export default function TriggersSettingsRedirect() {
  redirect("/settings/templates#triggers");
}
