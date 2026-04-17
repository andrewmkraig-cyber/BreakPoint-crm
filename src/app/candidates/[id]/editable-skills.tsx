"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/app/candidates/[id]/editable-helpers";
import { updateCandidate } from "@/app/candidates/[id]/actions";

export function EditableSkills({
  candidateId,
  initial,
}: {
  candidateId: number;
  initial: string[];
}) {
  const router = useRouter();
  const [skills, setSkills] = useState<string[]>(dedupe(initial));
  const [input, setInput] = useState("");
  const [isPending, startSave] = useTransition();

  function persist(next: string[]) {
    const snapshot = skills;
    setSkills(next);
    startSave(async () => {
      const result = await updateCandidate({ id: candidateId, skills: next });
      if (!result.ok) {
        setSkills(snapshot);
        toast.error("Couldn't save skills", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill();
    } else if (e.key === "Backspace" && !input && skills.length > 0) {
      const last = skills[skills.length - 1];
      setInput(last);
      persist(skills.slice(0, -1));
    }
  }

  function addSkill() {
    const trimmed = input.trim().replace(/,$/, "");
    if (!trimmed) return;
    const next = dedupe([...skills, trimmed]);
    setInput("");
    persist(next);
  }

  function removeAt(i: number) {
    const next = skills.filter((_, idx) => idx !== i);
    persist(next);
  }

  return (
    <SectionCard
      title="Skills"
      right={
        isPending ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {skills.length} {skills.length === 1 ? "skill" : "skills"}
          </span>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {skills.map((s, i) => (
          <span
            key={`${s}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-dark"
          >
            {s}
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="rounded-full p-0.5 hover:bg-brand/20"
              aria-label={`Remove ${s}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          onBlur={addSkill}
          placeholder={skills.length === 0 ? "Add a skill and press Enter…" : "Add…"}
          className="min-w-[120px] flex-1 rounded-md border border-transparent bg-muted/30 px-2 py-1 text-xs text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:bg-white focus:outline-none"
        />
        <button
          type="button"
          onClick={addSkill}
          disabled={!input.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
    </SectionCard>
  );
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const norm = s.trim();
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}
