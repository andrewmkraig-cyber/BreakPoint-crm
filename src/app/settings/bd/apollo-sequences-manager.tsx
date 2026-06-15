"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Save, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createBdSequence, updateBdSequence, deleteBdSequence } from "./actions";

export type BdSequenceRow = {
  // null for the hardcoded fallback row shown when the table is empty — those
  // are read-only (no edit/remove) since there is no DB row behind them.
  id: string | null;
  name: string;
  apolloSequenceId: string;
  verticalId: string | null;
  verticalName: string | null;
  active: boolean;
};

export type VerticalOption = { id: string; name: string };

export function ApolloSequencesManager({
  sequences,
  verticals,
  isConfigured,
}: {
  sequences: BdSequenceRow[];
  verticals: VerticalOption[];
  isConfigured: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
          Mapped sequences
        </p>
        {!adding && (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add sequence
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-court-border bg-court-surface">
        <table className="w-full text-sm">
          <thead className="bg-court-surface-subtle text-[11px] uppercase tracking-wide text-court-fg-muted">
            <tr>
              <Th>Sequence name</Th>
              <Th>Apollo ID</Th>
              <Th>Vertical</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-court-border">
            {sequences.length === 0 && !adding && (
              <tr>
                <Td className="text-court-fg-muted" colSpan={5}>
                  No sequences yet. Add one to make it selectable on saved searches.
                </Td>
              </tr>
            )}
            {sequences.map((s) =>
              editingId && s.id === editingId ? (
                <SequenceEditRow
                  key={s.id}
                  row={s}
                  verticals={verticals}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <SequenceViewRow
                  key={s.id ?? s.name}
                  row={s}
                  isConfigured={isConfigured}
                  onEdit={s.id ? () => setEditingId(s.id) : undefined}
                />
              ),
            )}
            {adding && (
              <SequenceEditRow
                row={{ id: null, name: "", apolloSequenceId: "", verticalId: null, verticalName: null, active: true }}
                verticals={verticals}
                onDone={() => setAdding(false)}
                isNew
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SequenceViewRow({
  row,
  isConfigured,
  onEdit,
}: {
  row: BdSequenceRow;
  isConfigured: boolean;
  onEdit?: () => void;
}) {
  const resolved = isConfigured && row.apolloSequenceId.length > 0;
  return (
    <tr>
      <Td className="font-medium text-court-fg">{row.name}</Td>
      <Td className="font-mono text-[11px] text-court-fg">
        {resolved ? row.apolloSequenceId : <span className="text-court-fg-muted">Pending API connection</span>}
      </Td>
      <Td>{row.verticalName ?? <span className="text-court-fg-muted">Unmapped</span>}</Td>
      <Td>
        {row.active ? (
          <span className="inline-flex items-center rounded-full border border-court-brand/30 bg-court-brand-tint px-2 py-0.5 text-[11px] font-semibold text-court-brand-dark">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-medium text-court-fg-muted">
            Paused
          </span>
        )}
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-1">
          {row.apolloSequenceId && (
            <a
              href={`https://app.apollo.io/#/emailer/sequences/${row.apolloSequenceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-brand-dark"
              aria-label="Open in Apollo"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {onEdit ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onEdit}
                aria-label="Edit sequence"
                className="px-2"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {row.id && <DeleteSequenceBtn id={row.id} />}
            </>
          ) : (
            <span className="px-1 text-[11px] text-court-fg-dim">default</span>
          )}
        </div>
      </Td>
    </tr>
  );
}

function SequenceEditRow({
  row,
  verticals,
  onDone,
  isNew = false,
}: {
  row: BdSequenceRow;
  verticals: VerticalOption[];
  onDone: () => void;
  isNew?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(row.name);
  const [apolloSequenceId, setApolloSequenceId] = useState(row.apolloSequenceId);
  const [verticalId, setVerticalId] = useState<string>(row.verticalId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    const input = {
      name: name.trim(),
      apolloSequenceId: apolloSequenceId.trim(),
      verticalId: verticalId || null,
      active: row.active,
    };
    if (!input.name || !input.apolloSequenceId) {
      setError("Name and Apollo sequence ID are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (isNew) await createBdSequence(input);
        else if (row.id) await updateBdSequence(row.id, input);
        router.refresh();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <tr className="bg-court-surface-subtle/40">
      <Td>
        <Input type="text" value={name} placeholder="Sequence name" onChange={(e) => setName(e.target.value)} />
      </Td>
      <Td>
        <Input
          type="text"
          value={apolloSequenceId}
          placeholder="Apollo sequence ID"
          onChange={(e) => setApolloSequenceId(e.target.value)}
        />
      </Td>
      <Td>
        <Select value={verticalId} onChange={(e) => setVerticalId(e.target.value)}>
          <option value="">Unmapped</option>
          {verticals.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      </Td>
      <Td colSpan={2}>
        <div className="flex items-center justify-end gap-2">
          {error && <span className="text-[11px] text-red-600 dark:text-red-300">{error}</span>}
          <Button variant="secondary" size="sm" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </Td>
    </tr>
  );
}

function DeleteSequenceBtn({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          variant="reject"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await deleteBdSequence(id);
                router.refresh();
              } catch (e) {
                alert(e instanceof Error ? e.message : "Delete failed");
                setConfirming(false);
              }
            })
          }
        >
          {pending ? "…" : "Remove"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
          aria-label="Cancel remove"
          className="px-2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setConfirming(true)}
      aria-label="Remove sequence"
      className="px-2"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left font-medium", className)}>{children}</th>;
}

function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-3 py-2 align-middle text-court-fg", className)}>
      {children}
    </td>
  );
}
