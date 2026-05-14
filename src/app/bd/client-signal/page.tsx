export const dynamic = "force-dynamic";

export default function ClientSignalPage() {
  return (
    <section className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Client Signal
        </p>
        <h2 className="font-serif text-xl font-bold tracking-tight text-court-fg">
          Existing clients hiring publicly
        </h2>
        <p className="max-w-2xl text-sm text-court-fg-muted">
          Daily Indeed scan flags clients posting publicly. That usually means they aren&apos;t
          filling it internally, so reach out before someone else does.
        </p>
      </header>

      <p className="text-sm text-court-fg-muted">
        No client signals yet - signals will appear here in a future update.
      </p>
    </section>
  );
}
