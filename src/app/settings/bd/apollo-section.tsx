import { CheckCircle2, XCircle, ExternalLink, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type SequencePreview = {
  name: string;
  verticalName: string;
  steps: number;
  // Real Apollo identifier the enroll step uses as sequence_id. Empty
  // string means the sequence has no live wiring yet — UI falls back to
  // "Pending API connection".
  apolloId: string;
  status: "ACTIVE" | "PAUSED";
};

export function ApolloSection({
  isConfigured,
  maskedKey,
  sequences,
}: {
  isConfigured: boolean;
  maskedKey: string | null;
  sequences: SequencePreview[];
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
              title="Rotation ships in next session — set APOLLO_API_KEY in Vercel env for now"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs font-medium text-court-fg-muted opacity-60"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Rotate
            </span>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
          Mapped sequences
        </p>
        <div className="overflow-hidden rounded-lg border border-court-border bg-court-surface">
          <table className="w-full text-sm">
            <thead className="bg-court-surface-subtle text-[11px] uppercase tracking-wide text-court-fg-muted">
              <tr>
                <Th>Sequence name</Th>
                <Th>Apollo ID</Th>
                <Th>Vertical</Th>
                <Th className="text-center">Steps</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border">
              {sequences.map((s) => {
                const resolved = isConfigured && s.apolloId.length > 0;
                return (
                  <tr key={s.name}>
                    <Td className="font-medium text-court-fg">{s.name}</Td>
                    <Td className="font-mono text-[11px] text-court-fg">
                      {resolved ? (
                        s.apolloId
                      ) : (
                        <span className="text-court-fg-muted">Pending API connection</span>
                      )}
                    </Td>
                    <Td>{s.verticalName}</Td>
                    <Td className="text-center tabular-nums">{s.steps}</Td>
                    <Td>
                      {resolved ? (
                        <span className="inline-flex items-center rounded-full border border-court-brand/30 bg-court-brand-tint px-2 py-0.5 text-[11px] font-semibold text-court-brand-dark">
                          {s.status === "ACTIVE" ? "Active" : "Paused"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-medium text-court-fg-muted">
                          Pending
                        </span>
                      )}
                    </Td>
                    <Td>
                      {s.apolloId ? (
                        <a
                          href={`https://app.apollo.io/#/emailer/sequences/${s.apolloId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-court-brand-dark hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> Open in Apollo
                        </a>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left font-medium", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 text-court-fg", className)}>{children}</td>;
}
