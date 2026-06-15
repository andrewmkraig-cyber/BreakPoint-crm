import { CheckCircle2, XCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ApolloSequencesManager,
  type BdSequenceRow,
  type VerticalOption,
} from "./apollo-sequences-manager";

export type { BdSequenceRow, VerticalOption };

export function ApolloSection({
  isConfigured,
  maskedKey,
  sequences,
  verticals,
}: {
  isConfigured: boolean;
  maskedKey: string | null;
  sequences: BdSequenceRow[];
  verticals: VerticalOption[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-court-border bg-court-surface-subtle px-4 py-3">
        <ConnectionPill isConfigured={isConfigured} />
        <p className="text-xs text-court-fg-muted">
          {isConfigured
            ? "API key resolved from APOLLO_API_KEY environment variable."
            : "Set APOLLO_API_KEY in Vercel project env to connect."}
        </p>
      </div>

      <div className="rounded-lg border border-court-border bg-court-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
              API key
            </p>
            <p className="mt-1 font-mono text-sm text-court-fg">
              {maskedKey ?? <span className="text-court-fg-muted">Not configured</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              title="Rotation ships in next session. Set APOLLO_API_KEY in Vercel env for now"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs font-medium text-court-fg-muted opacity-60"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Rotate
            </span>
          </div>
        </div>
      </div>

      <ApolloSequencesManager
        sequences={sequences}
        verticals={verticals}
        isConfigured={isConfigured}
      />
    </div>
  );
}

function ConnectionPill({ isConfigured }: { isConfigured: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        isConfigured
          ? "border-court-brand/30 bg-court-brand-tint text-court-brand-dark"
          : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
      )}
    >
      {isConfigured ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {isConfigured ? "Connected" : "Not connected"}
    </span>
  );
}
