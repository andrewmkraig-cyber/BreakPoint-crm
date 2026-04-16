import { cn } from "@/lib/utils";

export function BrandMark({ className, withTag = false }: { className?: string; withTag?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
        <span className="font-serif text-lg font-semibold leading-none">B</span>
      </div>
      <div className="leading-tight">
        <div className="font-serif text-base font-semibold text-navy">BreakPoint</div>
        {withTag && <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Talent CRM</div>}
      </div>
    </div>
  );
}
