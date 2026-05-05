import { redirect } from "next/navigation";

// Settings is now a left-nav + detail layout where each category
// owns its own route. The bare /settings URL has no content of its
// own — bounce to the first category so the user always lands on a
// real panel.
export const dynamic = "force-dynamic";

export default function SettingsRootPage() {
  redirect("/settings/appearance");
}
