import Link from "next/link";
import { Megaphone, ArrowLeft } from "lucide-react";
import { CollapsibleSection } from "@/components/settings/collapsible-section";

export const dynamic = "force-dynamic";

// Phase 3 placeholder. The full BD Settings surface (CRUD on
// Verticals, SavedSearches, SendingDomains + the pause-all toggle
// currently hardcoded false in /bd/launch) lands next session. This
// page exists so the BD Settings link in /bd's layout top-right has a
// real destination instead of a 404.
export default function BdSettingsPage() {
  return (
    <CollapsibleSection
      id="bd"
      title="BD Engine"
      description="Configure verticals, saved searches, and warmed sending domains for the daily outbound run."
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-6">
        <div className="flex items-center gap-2 text-court-fg">
          <Megaphone className="h-4 w-4 text-court-brand-dark" />
          <span className="text-sm font-semibold">BD Settings — shipping in next session</span>
        </div>
        <p className="text-sm text-court-fg-muted">
          What lands here in BD Phase 3:
        </p>
        <ul className="ml-1 space-y-1 text-sm text-court-fg-muted">
          <li>· Verticals — add / rename / archive the BD verticals that drive the segmented control on Today&apos;s Launch.</li>
          <li>· Saved searches — criteria, daily contact cap, sequence id, target titles, locations, company size, freshness window.</li>
          <li>· Sending domains — add / pause / cool warmed Apollo domains; set per-domain daily caps and rotation order.</li>
          <li>· Global pause toggle — currently hardcoded off in <code className="rounded bg-court-surface px-1 py-0.5 text-[11px]">/bd/launch/page.tsx</code>.</li>
        </ul>
        <p className="text-xs text-court-fg-muted">
          Until Phase 3 ships, edit these tables directly via{" "}
          <code className="rounded bg-court-surface px-1 py-0.5 text-[11px]">npm run db:studio</code> or the
          <Link href="/bd/launch" className="ml-1 text-court-brand-dark underline-offset-2 hover:underline">
            Today&apos;s Launch
          </Link>{" "}
          flow.
        </p>
        <div>
          <Link
            href="/bd"
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to BD
          </Link>
        </div>
      </div>
    </CollapsibleSection>
  );
}
