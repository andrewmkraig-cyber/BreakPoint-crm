"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ExternalLink, Globe2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setJobWebsitePublished } from "@/app/jobs/[id]/job-website-actions";
import { Button } from "@/components/ui/button";

type Requirement = {
  label: string;
  met: boolean;
  detail: string;
};

export function PromoteTab({
  jobId,
  published,
  websiteUrl,
  requirements,
}: {
  jobId: string;
  published: boolean;
  websiteUrl: string;
  requirements: Requirement[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const eligible = requirements.every((requirement) => requirement.met);
  const live = published && eligible;

  function setPublished(next: boolean) {
    startTransition(async () => {
      const result = await setJobWebsitePublished({ jobId, published: next });
      if (!result.ok) {
        toast.error(next ? "Couldn't publish job" : "Couldn't remove job", {
          description: result.error,
        });
        return;
      }
      toast.success(next ? "Job sent to the BreakPoint website" : "Job removed from the website");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-court-border/40 bg-court-surface p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-court-accent" />
              <h2 className="font-serif text-xl font-semibold text-court-fg">
                BreakPoint Website
              </h2>
              <span
                className={
                  live
                    ? "rounded-full border border-brand bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-dark"
                    : published
                      ? "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700"
                      : "rounded-full border border-court-border bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted"
                }
              >
                {live ? "Live" : published ? "Blocked" : "Not published"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-court-fg-muted">
              You decide which Active jobs appear on breakpointtalent.com. Publishing creates a
              dedicated job page, adds it to the Open Roles page and sitemap, and makes it eligible
              for Google Jobs when every requirement below is complete.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {live && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View job page
              </a>
            )}
            {published ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => setPublished(false)}
                disabled={pending}
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Remove from website
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setPublished(true)}
                disabled={pending || !eligible}
                title={!eligible ? "Complete every requirement before publishing." : undefined}
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Publish to website
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {requirements.map((requirement) => (
            <div
              key={requirement.label}
              className={
                requirement.met
                  ? "flex gap-3 rounded-lg border border-brand/30 bg-brand-tint/40 p-4"
                  : "flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
              }
            >
              {requirement.met ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              ) : (
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div>
                <div className="text-sm font-semibold text-court-fg">{requirement.label}</div>
                <div className="mt-0.5 text-xs leading-5 text-court-fg-muted">
                  {requirement.detail}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!eligible && !published && (
          <p className="mt-4 text-xs font-medium text-amber-700 dark:text-amber-300">
            This job will not be sent to the website or Google until every requirement is complete.
          </p>
        )}
      </section>
    </div>
  );
}
