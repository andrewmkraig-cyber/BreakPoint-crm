"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

type RemoteState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "hidden" }
  | {
      phase: "ready";
      senderName: string;
      senderEmail: string;
      domain: string | null;
      companyName: string;
      contacts: Array<{
        firstName: string;
        lastName: string;
        title: string;
        linkedinUrl: string | null;
      }>;
    };

type CreateResult = {
  ok: true;
  slug?: string;
  duplicate?: { slug: string; name: string };
} | { ok: false; error?: string };

// Renders the inline "Create client from this reply?" banner above the
// first message in a thread when (a) the org has the prompt enabled, (b)
// the thread carries the BD Gmail label, and (c) the recruiter hasn't
// already actioned the prompt for this thread. The component does the
// fetch itself so the parent mail-view doesn't need to thread state in.
export function BdReplyPromptBanner({
  threadId,
  isBd,
  senderName,
  senderEmail,
}: {
  threadId: string;
  isBd: boolean;
  senderName: string;
  senderEmail: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<RemoteState>({ phase: "idle" });
  const [pendingAction, setPendingAction] = useState<"yes" | "skip" | null>(null);

  useEffect(() => {
    setState({ phase: "idle" });
    setPendingAction(null);
  }, [threadId]);

  useEffect(() => {
    if (!isBd) {
      setState({ phase: "hidden" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    const params = new URLSearchParams({
      senderEmail,
      senderName,
    });
    fetch(
      `/api/bd/reply-prompt/${encodeURIComponent(threadId)}?${params.toString()}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((data: {
        shouldShow: boolean;
        sender?: { name: string; email: string; domain: string | null };
        suggestedCompanyName?: string | null;
        suggestedContacts?: Array<{
          firstName: string;
          lastName: string;
          title: string;
          linkedinUrl: string | null;
        }>;
      }) => {
        if (cancelled) return;
        if (!data.shouldShow) {
          setState({ phase: "hidden" });
          return;
        }
        const domain = data.sender?.domain ?? null;
        const fallbackName = domain ?? data.sender?.email ?? "(unknown company)";
        setState({
          phase: "ready",
          senderName: data.sender?.name || senderName || data.sender?.email || "",
          senderEmail: data.sender?.email || senderEmail,
          domain,
          companyName: data.suggestedCompanyName?.trim() || fallbackName,
          contacts: data.suggestedContacts ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "hidden" });
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, isBd, senderEmail, senderName]);

  if (state.phase !== "ready") return null;

  async function handleSkip() {
    setPendingAction("skip");
    try {
      await fetch(`/api/bd/reply-prompt/${encodeURIComponent(threadId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip" }),
      });
      setState({ phase: "hidden" });
    } catch {
      toast.error("Couldn't dismiss the prompt.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCreate() {
    if (state.phase !== "ready") return;
    setPendingAction("yes");
    try {
      const res = await fetch(`/api/bd/reply-prompt/${encodeURIComponent(threadId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          senderName: state.senderName,
          senderEmail: state.senderEmail,
          companyName: state.companyName,
          domain: state.domain,
          contacts: state.contacts,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CreateResult;
      if (!res.ok || data.ok === false) {
        const msg = data.ok === false ? data.error : "Couldn't create client.";
        toast.error(msg ?? "Couldn't create client.");
        setPendingAction(null);
        return;
      }
      if (data.duplicate) {
        toast.message(`Client already exists: ${data.duplicate.name}`, {
          action: {
            label: "Open",
            onClick: () => router.push(`/clients/${data.duplicate!.slug}`),
          },
        });
      } else if (data.slug) {
        toast.success("Client created", {
          action: {
            label: "Open",
            onClick: () => router.push(`/clients/${data.slug}`),
          },
        });
      }
      setState({ phase: "hidden" });
      router.refresh();
    } catch {
      toast.error("Couldn't create client.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-court-brand/30 bg-court-brand-tint p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 text-court-brand-dark" />
          <div className="text-sm text-court-brand-dark">
            <p className="font-semibold">Create client from this reply?</p>
            <p className="mt-0.5 text-xs text-court-brand-dark/80">
              {state.companyName}
              {state.contacts.length > 0
                ? ` · ${state.contacts.length + 1} contact${state.contacts.length === 0 ? "" : "s"} from Apollo`
                : null}
              {state.domain ? (
                <>
                  {" · "}
                  <Link
                    href={`https://${state.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-court-brand-dark"
                  >
                    {state.domain}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
          >
            {pendingAction === "skip" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Skip
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand px-3 py-1.5 text-xs font-semibold text-court-on-brand shadow-sm transition hover:bg-court-brand-dark disabled:opacity-60"
          >
            {pendingAction === "yes" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Yes — Create Client
          </button>
        </div>
      </div>
    </div>
  );
}
