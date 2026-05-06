"use client";

import { useState } from "react";
import { Copy, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { FindMatchesButton } from "@/components/game-plan/find-matches-button";
import type { MatchTarget } from "@/lib/find-matches-context";

// Quick-action row on the Overview tab. Find Matches is wired through
// the shared FindMatchesButton (real action). The other three are
// scaffold-only stubs while the deeper flows land:
//   - Edit Job → toast prompt to use the right-rail Edit toggle
//   - Copy Public Apply Link → real clipboard write, shows a toast
//   - Generate Job Description with Claude → "Coming soon"
export function JobOverviewQuickActions({
  matchTarget,
  applyLink,
}: {
  matchTarget: MatchTarget;
  applyLink: string | null;
}) {
  const [copying, setCopying] = useState(false);

  async function copyApplyLink() {
    if (!applyLink) {
      toast.message("No public apply link", {
        description: "Add one in the right-rail Overview card.",
      });
      return;
    }
    setCopying(true);
    try {
      await navigator.clipboard.writeText(applyLink);
      toast.success("Apply link copied");
    } catch {
      toast.error("Couldn't copy link");
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          toast.message("Edit job", {
            description: "Use the Edit toggle in the right-rail Overview card.",
          })
        }
      >
        <Pencil className="h-3.5 w-3.5" /> Edit Job
      </Button>
      <FindMatchesButton target={matchTarget} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={copyApplyLink}
        disabled={copying}
      >
        <Copy className="h-3.5 w-3.5" /> Copy Public Apply Link
      </Button>
      <button
        type="button"
        onClick={() =>
          toast.message("Generate Job Description with Claude", {
            description: "Coming soon.",
          })
        }
        className={CLAUDE_PILL_CLASS}
      >
        <Sparkles className="h-3 w-3" /> Generate Job Description with Claude
      </button>
    </div>
  );
}
