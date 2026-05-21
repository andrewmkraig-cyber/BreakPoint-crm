"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { claimClient } from "@/app/clients/[id]/actions";

// "Claim this client" CTA shown inside the Available banner for unowned
// clients. On success the page refreshes - the server re-renders with the
// caller as owner, which drops the banner and reveals the write buttons.
export function ClaimClientButton({ clientCuid }: { clientCuid: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClaim() {
    startTransition(async () => {
      const res = await claimClient(clientCuid);
      if (res.ok) {
        toast.success("Client claimed");
        router.refresh();
      } else {
        toast.error("Couldn't claim client", { description: res.error });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClaim}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
      Claim this client
    </button>
  );
}
