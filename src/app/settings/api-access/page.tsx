import { headers } from "next/headers";
import { ApiAccessView } from "@/app/settings/api-access-view";
import { listApiKeys } from "@/app/settings/api-access-actions";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { EXPOSED_TOOLS } from "@/lib/api-access/registry";

export const dynamic = "force-dynamic";

// Resolve the public origin for the copyable endpoint URLs. Vercel sets
// x-forwarded-host/proto; locally we fall back to the Host header.
async function publicOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ApiAccessSettingsPage() {
  const [keys, origin] = await Promise.all([listApiKeys(), publicOrigin()]);
  const tools = EXPOSED_TOOLS.map((t) => ({ name: t.name, scope: t.scope }));
  return (
    <CollapsibleSection
      id="api-access"
      title="API Access"
      description="Let an outside agent (Grok, another Claude, a script) use the Assistant's tools through a key you can revoke any time."
    >
      <ApiAccessView initialKeys={keys} origin={origin} tools={tools} />
    </CollapsibleSection>
  );
}
