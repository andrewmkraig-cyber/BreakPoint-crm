// Route-level loading skeletons.
//
// Every page in Ace is `force-dynamic`, so a soft navigation blocks on the
// server until all of that route's queries resolve — the browser sits on the
// PREVIOUS page the whole time with no feedback that the click registered.
// A `loading.tsx` exporting one of these swaps the content column for a
// skeleton the instant the link is clicked, so navigation reads as immediate
// even though the server work takes exactly as long as before.
//
// These live under AppShell, which is a client component and therefore
// persists across navigation — the sidebar and topbar never blank out, so a
// skeleton only ever needs to stand in for the content column.
//
// Deliberately generic: pages delegate their real markup to view components
// (ClientsView, PipelineView, ...) and those change often. A skeleton that
// mirrored one exactly would silently drift out of sync. Matching the broad
// shape — header, then rows / cards / columns — survives redesigns and still
// reads as "your page is arriving".
//
// The pulse styling matches the established idiom in
// components/mail/tagged-thread-list.tsx: animate-pulse bars in
// `court-surface-subtle` on a `court-surface` card with a `court-border`.

const shimmer = "animate-pulse rounded bg-court-surface-subtle";

function HeaderBar() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className={`h-7 w-48 ${shimmer}`} />
      <div className={`h-9 w-32 ${shimmer}`} />
    </div>
  );
}

// List / table pages: candidates lists, clients, jobs, invoices, expenses,
// notes, BD activity. Header, then a stack of uniform rows.
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <HeaderBar />
      <div className="overflow-hidden rounded-lg border border-court-border bg-court-surface">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-court-border-soft px-4 py-3 last:border-b-0"
          >
            <div className={`h-3 w-40 ${shimmer}`} />
            <div className={`h-3 flex-1 ${shimmer}`} />
            <div className={`h-3 w-24 ${shimmer}`} />
            <div className={`h-3 w-16 ${shimmer}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Detail pages: candidate / client / job / invoice profiles. A title block,
// then a wide main column beside a narrower sidebar column.
export function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className={`h-8 w-64 ${shimmer}`} />
        <div className={`h-4 w-40 ${shimmer}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-lg border border-court-border bg-court-surface p-4"
            >
              <div className={`h-4 w-32 ${shimmer}`} />
              <div className={`h-3 w-full ${shimmer}`} />
              <div className={`h-3 w-5/6 ${shimmer}`} />
              <div className={`h-3 w-2/3 ${shimmer}`} />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-lg border border-court-border bg-court-surface p-4"
            >
              <div className={`h-4 w-24 ${shimmer}`} />
              <div className={`h-3 w-full ${shimmer}`} />
              <div className={`h-3 w-4/5 ${shimmer}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Card-grid pages: dashboard, finances, BD. Header, then a responsive grid of
// equal-height tiles.
export function CardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <HeaderBar />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-court-border bg-court-surface p-4"
          >
            <div className={`h-4 w-28 ${shimmer}`} />
            <div className={`h-8 w-20 ${shimmer}`} />
            <div className={`h-3 w-full ${shimmer}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Kanban pages: pipeline. Header, then side-by-side stage columns of cards.
export function BoardSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <HeaderBar />
      <div className="flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: columns }).map((_, col) => (
          <div key={col} className="w-64 shrink-0 space-y-3">
            <div className={`h-4 w-24 ${shimmer}`} />
            {Array.from({ length: 3 }).map((_, card) => (
              <div
                key={card}
                className="space-y-2 rounded-lg border border-court-border bg-court-surface p-3"
              >
                <div className={`h-3 w-3/4 ${shimmer}`} />
                <div className={`h-3 w-1/2 ${shimmer}`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Settings subpages: a single form column under the shared settings layout.
export function FormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className={`h-7 w-40 ${shimmer}`} />
      <div className="max-w-2xl space-y-5 rounded-lg border border-court-border bg-court-surface p-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className={`h-3 w-28 ${shimmer}`} />
            <div className={`h-9 w-full ${shimmer}`} />
          </div>
        ))}
        <div className={`h-9 w-28 ${shimmer}`} />
      </div>
    </div>
  );
}
