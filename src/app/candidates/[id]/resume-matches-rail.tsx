"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  findResumeMatches,
  type ResumeMatchSnippet,
} from "@/app/candidates/[id]/actions";

// Same palette as the prior in-resume aside. Each entry is a full
// class string so Tailwind's JIT picks it up — dynamic `bg-${color}`
// would be silently dropped.
const TOKEN_COLORS = [
  "bg-amber-100 text-amber-900",
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-purple-100 text-purple-800",
  "bg-rose-100 text-rose-800",
] as const;

function buildTokenColorMap(tokens: string[]): Map<string, string> {
  const m = new Map<string, string>();
  tokens.forEach((t, i) => {
    m.set(t, TOKEN_COLORS[i % TOKEN_COLORS.length]);
  });
  return m;
}

export function ResumeMatchesRail({
  resumeId,
  tokens,
}: {
  resumeId: string | null;
  tokens: string[];
}) {
  const colorMap = useMemo(() => buildTokenColorMap(tokens), [tokens]);
  if (tokens.length === 0) return null;
  return (
    <section className="flex flex-col rounded-2xl border border-court-border bg-court-surface-subtle/60">
      <HighlightTokenChips
        tokens={tokens}
        className="border-b border-court-border px-3 py-2"
      />
      {resumeId ? (
        <ResumeMatchesPanel
          resumeId={resumeId}
          tokens={tokens}
          colorMap={colorMap}
        />
      ) : (
        <div className="px-3 py-2 text-[11px] text-court-fg-muted">
          No resume on file yet.
        </div>
      )}
    </section>
  );
}

// Shared chip row: label + colored pills, wrapping. Used by the rail's
// header and by EditableResume above the viewer so both surfaces read
// off the same TOKEN_COLORS palette as <MarkedSnippet>'s <mark> tags.
export function HighlightTokenChips({
  tokens,
  className,
  label = "Highlighting:",
}: {
  tokens: string[];
  className?: string;
  label?: string;
}) {
  const colorMap = useMemo(() => buildTokenColorMap(tokens), [tokens]);
  if (tokens.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {label && (
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          {label}
        </span>
      )}
      {tokens.map((t) => (
        <span
          key={t}
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            colorMap.get(t) ?? TOKEN_COLORS[0],
          )}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function ResumeMatchesPanel({
  resumeId,
  tokens,
  colorMap,
}: {
  resumeId: string;
  tokens: string[];
  colorMap: Map<string, string>;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ready";
        snippets: ResumeMatchSnippet[];
        totalMatches: number;
        hasExtractedText: boolean;
      }
    | { kind: "error"; error: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      const res = await findResumeMatches(resumeId, tokens);
      if (cancelled) return;
      if (!res.ok) {
        setState({ kind: "error", error: res.error });
        return;
      }
      setState({
        kind: "ready",
        snippets: res.snippets,
        totalMatches: res.totalMatches,
        hasExtractedText: res.hasExtractedText,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeId, tokens]);

  if (state.kind === "loading") {
    return (
      <div className="px-3 py-2 text-[11px] text-court-fg-muted">
        Looking for matches in resume text…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="px-3 py-2 text-[11px] text-court-fg-muted">
        Couldn&apos;t load resume matches: {state.error}
      </div>
    );
  }
  if (!state.hasExtractedText) {
    return (
      <div className="px-3 py-2 text-[11px] text-court-fg-muted">
        No extracted resume text on file yet — scan the PDF manually.
      </div>
    );
  }
  if (state.totalMatches === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-court-fg-muted">
        No matches found in resume text.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        Matches in resume text
        {state.totalMatches > state.snippets.length && (
          <span className="ml-2 normal-case tracking-normal">
            (+{state.totalMatches - state.snippets.length} more)
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {state.snippets.map((s, i) => (
          <li key={i} className="text-xs leading-snug text-court-fg">
            <MarkedSnippet
              text={s.text}
              tokens={s.matchedTokens}
              colorMap={colorMap}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarkedSnippet({
  text,
  tokens,
  colorMap,
}: {
  text: string;
  tokens: string[];
  colorMap: Map<string, string>;
}) {
  const segments = useMemo(() => {
    if (tokens.length === 0) return [{ text, token: null }] as { text: string; token: string | null }[];
    const escaped = tokens
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const re = new RegExp(`\\b(${escaped})\\b`, "gi");
    const out: { text: string; token: string | null }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), token: null });
      const hit = m[0];
      const origin = tokens.find((t) => t.toLowerCase() === hit.toLowerCase()) ?? null;
      out.push({ text: hit, token: origin });
      last = m.index + hit.length;
      if (hit.length === 0) re.lastIndex++;
    }
    if (last < text.length) out.push({ text: text.slice(last), token: null });
    return out;
  }, [text, tokens]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.token ? (
          <mark
            key={i}
            className={cn(
              "rounded-sm px-0.5",
              colorMap.get(seg.token) ?? TOKEN_COLORS[0],
            )}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
