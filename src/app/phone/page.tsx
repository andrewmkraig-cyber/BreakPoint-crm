import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PhoneView } from "@/app/phone/phone-view";

// Phone Tab Phase 1 foundation. Calls + SMS are already in Neon
// (CallLog / SmsMessage tables, populated via Quo webhook), but until
// now there's been no dedicated UI page — recruiters could only see
// per-candidate history on the candidate profile. This is the
// inbox-style cross-cutting view.
//
// Auth gate matches /mail's pattern. Data fetching lives on the
// client so the layout reuses the mail-tab visual language and we
// can keep the fetch path simple — Phase 1 data volume is tiny
// (tens of rows org-wide), no SSR speed pressure.
export const dynamic = "force-dynamic";

export default async function PhonePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return (
      <div className="p-6 text-sm text-court-fg-muted">
        Sign in to view your calls and texts.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Phone"
        title="Calls & Texts"
        description="Your Quo texts and calls."
      />
      <PhoneView />
    </div>
  );
}
