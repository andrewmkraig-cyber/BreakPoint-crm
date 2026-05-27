import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Branding merged into the "Personal Info + Brand" page. This route
// stays around so old bookmarks / in-app deep links keep landing on
// the branding section instead of 404'ing — the personal-info page
// renders Personal Info up top and Branding & Signature below it.
export default function BrandingSettingsPage() {
  redirect("/settings/personal-info#branding");
}
