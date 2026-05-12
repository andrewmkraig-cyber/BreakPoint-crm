export const dynamic = "force-dynamic";

export default function ActivityPage() {
  return (
    <div className="rounded-lg border border-court-border bg-court-surface p-8 text-center text-sm text-court-fg-muted">
      <p className="font-semibold text-court-fg">BD Activity</p>
      <p className="mt-1">
        Scan completes, opens, replies, bounces, domain warm/cool events. Wired in the next BD
        session.
      </p>
    </div>
  );
}
