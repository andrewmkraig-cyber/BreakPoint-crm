import { Sparkles } from "lucide-react";

export function StubPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-dashed border-brand/40 bg-brand-tint/40 p-6">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-court-surface text-brand-dark shadow-sm">
        <Sparkles className="h-5 w-5" />
      </div>
      <div>
        <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-court-fg-muted">{description}</p>
      </div>
    </div>
  );
}
