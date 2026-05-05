"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  addRule,
  deleteRule,
  updateRule,
  type PersonalTrainerRuleRow,
} from "@/app/settings/personal-trainer-actions";

type SubTab = "trainer" | "rules";

export function PersonalTrainerView({
  orgId,
  initialRules,
}: {
  orgId: string;
  initialRules: PersonalTrainerRuleRow[];
}) {
  const [rules, setRules] = useState<PersonalTrainerRuleRow[]>(initialRules);
  const [tab, setTab] = useState<SubTab>(initialRules.length === 0 ? "trainer" : "rules");

  return (
    <div className="space-y-5">
      {/* Sub-tab strip. Segmented control per ACE_DESIGN.md — active
          state filled, no heavy borders. Counts integrated cleanly. */}
      <div className="inline-flex rounded-md border border-court-border bg-court-surface-subtle p-1 text-sm">
        <SubTabButton active={tab === "trainer"} onClick={() => setTab("trainer")}>
          Trainer
        </SubTabButton>
        <SubTabButton active={tab === "rules"} onClick={() => setTab("rules")}>
          Rules ({rules.length})
        </SubTabButton>
      </div>

      {tab === "trainer" ? (
        <TrainerTab
          orgId={orgId}
          onAdded={(row) => {
            setRules((prev) => [...prev, row]);
            setTab("rules");
          }}
        />
      ) : (
        <RulesTab
          orgId={orgId}
          rules={rules}
          onUpdated={(id, text) =>
            setRules((prev) =>
              prev.map((r) =>
                r.id === id ? { ...r, text, updatedAt: new Date().toISOString() } : r,
              ),
            )
          }
          onDeleted={(id) => setRules((prev) => prev.filter((r) => r.id !== id))}
        />
      )}
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md px-3 py-1.5 font-medium transition " +
        (active
          ? "bg-court-surface text-court-fg shadow-sm"
          : "text-court-fg-muted hover:text-court-fg")
      }
    >
      {children}
    </button>
  );
}

function TrainerTab({
  orgId,
  onAdded,
}: {
  orgId: string;
  onAdded: (row: PersonalTrainerRuleRow) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Type a rule before adding.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addRule(orgId, trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const now = new Date().toISOString();
      onAdded({ id: res.value.id, text: trimmed, createdAt: now, updatedAt: now });
      setText("");
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Type a rule and press Add. Example: Never start a bullet with He."
        className="block w-full resize-y rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending}
          className="rounded-md bg-court-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-court-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Adding..." : "Add Rule"}
        </button>
      </div>
      <p className="text-xs text-court-fg-muted">
        Rules apply to every Claude response across Ace - Game Plan, email
        composer, edit-with-Claude, call summaries, and the new-client
        auto-parse.
      </p>
    </div>
  );
}

function RulesTab({
  orgId,
  rules,
  onUpdated,
  onDeleted,
}: {
  orgId: string;
  rules: PersonalTrainerRuleRow[];
  onUpdated: (id: string, text: string) => void;
  onDeleted: (id: string) => void;
}) {
  if (rules.length === 0) {
    return (
      <p className="text-sm text-court-fg-muted">
        No rules yet. Add your first rule in the Trainer tab.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-court-border">
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          orgId={orgId}
          rule={rule}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      ))}
    </ul>
  );
}

function RuleRow({
  orgId,
  rule,
  onUpdated,
  onDeleted,
}: {
  orgId: string;
  rule: PersonalTrainerRuleRow;
  onUpdated: (id: string, text: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Rule text is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateRule(orgId, rule.id, trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUpdated(rule.id, trimmed);
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!window.confirm("Delete this rule? It will no longer apply to any Claude output.")) {
      return;
    }
    startTransition(async () => {
      const res = await deleteRule(orgId, rule.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDeleted(rule.id);
    });
  }

  if (editing) {
    return (
      <li className="py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="block w-full resize-y rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-court-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-court-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(rule.text);
              setError(null);
            }}
            disabled={pending}
            className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:bg-court-surface-subtle"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-court-fg">
        {rule.text}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setDraft(rule.text);
            setEditing(true);
          }}
          aria-label="Edit rule"
          className="rounded-md p-1.5 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label="Delete rule"
          className="rounded-md p-1.5 text-court-fg-muted transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
