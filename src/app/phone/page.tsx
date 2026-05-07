import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PhoneView } from "@/app/phone/phone-view";
import { getQuoStatus } from "@/lib/connectors";
import { ConnectorBanner } from "@/components/connector-banner";

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

  // Ace 28.0: surface a Quo health banner if the API key isn't
  // resolving. The check pings /v1/phone-numbers — a healthy
  // response confirms outbound calls + SMS will work. Webhook
  // delivery is independent (and only verifiable by a real inbound
  // event), so the banner copy doesn't promise inbound health.
  const quoStatus = await getQuoStatus();

  // Viewport-bounded flex column so the threads list + dialer fit the
  // visible area exactly without the page itself scrolling. Negative
  // top margin claws against the AppShell gutter so the inline header
  // PhoneView renders sits flush with the topbar — matches /mail's
  // pattern. Height accounts for the slimmer h-16 topbar.
  return (
    <div className="-mt-2 flex h-[calc(100vh-7.5rem)] flex-col md:-mt-4 md:h-[calc(100vh-8.5rem)]">
      {quoStatus.state !== "connected" ? (
        <ConnectorBanner
          variant="quo-down"
          message={`Quo ${quoStatus.state === "degraded" ? "looks degraded" : "unreachable"} — calls and texts may not work. ${quoStatus.detail}`}
        />
      ) : null}
      <PhoneView />
    </div>
  );
}
