"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mailbox, CheckCircle2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBdDateTime } from "@/app/bd/date-format";
import { updateBdOrgConfig } from "./actions";

export type ReplyRoutingConfig = {
  replyForwardApollo: boolean;
  replyPromptCreateClient: boolean;
  replyOooFilter: boolean;
};

export function ReplyRoutingSection({
  config,
  lastReplyIso,
  webhookPath,
}: {
  config: ReplyRoutingConfig;
  lastReplyIso: string | null;
  webhookPath: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = (key: keyof ReplyRoutingConfig, value: boolean) => {
    startTransition(async () => {
      await updateBdOrgConfig({ [key]: value });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl bg-court-brand-tint p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mailbox className="h-4 w-4 text-court-brand-dark" />
            <p className="text-[13px] font-semibold text-court-brand-dark">
              All BD replies route into Ace Mail
            </p>
          </div>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-court-surface px-2.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark">
            <CheckCircle2 className="h-3 w-3" />
            Healthy
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-court-brand-dark/80">
          <span>
            Webhook:{" "}
            <code className="rounded bg-court-surface px-1.5 py-0.5 font-mono text-[11px] text-court-fg">
              {webhookPath}
            </code>
          </span>
          <span>
            Last reply received:{" "}
            <span className="font-medium text-court-brand-dark">
              {lastReplyIso ? formatBdDateTime(new Date(lastReplyIso)) : "No replies yet"}
            </span>
          </span>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          Downstream behavior
        </p>
        <div className="flex flex-wrap gap-2">
          <RoutingPill
            label="Also forward to Apollo inbox"
            on={config.replyForwardApollo}
            disabled={pending}
            onChange={(v) => toggle("replyForwardApollo", v)}
          />
          <RoutingPill
            label="Prompt to create client on positive reply"
            on={config.replyPromptCreateClient}
            disabled={pending}
            onChange={(v) => toggle("replyPromptCreateClient", v)}
          />
          <RoutingPill
            label="Out-of-office filter"
            on={config.replyOooFilter}
            disabled={pending}
            onChange={(v) => toggle("replyOooFilter", v)}
          />
        </div>
      </div>
    </div>
  );
}

function RoutingPill({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-60",
        on
          ? "bg-court-brand-tint text-court-brand-dark"
          : "bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
      )}
    >
      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </button>
  );
}
