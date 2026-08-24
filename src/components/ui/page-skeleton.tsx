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

// The three multi-pane pages below get bespoke skeletons rather than one of
// the generic shapes above, because each is a fixed viewport-height app
// layout: a generic stack would collapse to the wrong height and the real
// view would jolt into place on arrival. Heights and pane widths mirror the
// real components so the swap is positional, not just visual.

// /mail — MailView's `ace-mail-grid`: folders | thread list | reading pane.
// The two pane widths are user-resizable and persisted client-side, so the
// skeleton uses the same useState defaults MailView starts from (220 / 360).
// A skeleton can't read localStorage before hydration, so a recruiter who
// has dragged their panes sees one reflow on arrival — unavoidable, and far
// less jarring than the whole page appearing at once.
export function MailSkeleton() {
  return (
    <div
      className="flex h-[calc(100vh-7.5rem)] flex-col md:h-[calc(100vh-8rem)]"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[220px_6px_360px_6px_minmax(0,1fr)] lg:rounded-lg lg:border lg:border-court-border lg:bg-court-surface lg:shadow-sm">
        {/* Folder rail */}
        <div className="hidden flex-col gap-2 border-r border-court-border p-3 lg:flex">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={`h-7 w-full ${shimmer}`} />
          ))}
        </div>
        <div className="hidden lg:block" />
        {/* Thread list */}
        <div className="flex min-h-0 flex-col border-r border-court-border">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 border-b border-court-border-soft px-3 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className={`h-3 w-28 ${shimmer}`} />
                <div className={`h-3 w-10 ${shimmer}`} />
              </div>
              <div className={`h-3 w-full ${shimmer}`} />
              <div className={`h-3 w-2/3 ${shimmer}`} />
            </div>
          ))}
        </div>
        <div className="hidden lg:block" />
        {/* Reading pane */}
        <div className="hidden min-h-0 flex-col gap-4 p-6 lg:flex">
          <div className={`h-6 w-2/3 ${shimmer}`} />
          <div className={`h-3 w-40 ${shimmer}`} />
          <div className="space-y-2 pt-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={`h-3 ${shimmer}`}
                style={{ width: `${[96, 88, 92, 70, 84, 90, 62, 78][i]}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// /phone — PhoneView's 12-column split: nav rail (2) | threads (3) | dialer (7).
export function PhoneSkeleton() {
  return (
    <div
      className="flex h-[calc(100vh-8rem)] flex-col md:h-[calc(100vh-9rem)]"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        <aside className="hidden flex-col gap-2 overflow-hidden rounded-xl border border-court-border bg-court-surface p-3 shadow-sm lg:col-span-2 lg:flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`h-7 w-full ${shimmer}`} />
          ))}
        </aside>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 border-b border-court-border-soft px-3 py-3 last:border-b-0"
            >
              <div className={`h-3 w-24 ${shimmer}`} />
              <div className={`h-3 w-4/5 ${shimmer}`} />
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm lg:col-span-7">
          <div className={`h-10 w-56 ${shimmer}`} />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={`h-12 w-12 rounded-full ${shimmer}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// /calendar — toolbar, then the 280px left rail beside the month grid.
export function CalendarSkeleton() {
  return (
    <div className="flex min-h-0 flex-col gap-5" aria-busy="true" aria-label="Loading">
      {/* Toolbar: prev / next / today, then the month label */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-court-border bg-court-surface px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className={`h-9 w-9 rounded-full ${shimmer}`} />
          <div className={`h-9 w-9 rounded-full ${shimmer}`} />
          <div className={`ml-1 h-9 w-20 ${shimmer}`} />
        </div>
        <div className={`h-6 w-48 ${shimmer}`} />
        <div className={`ml-auto h-9 w-32 ${shimmer}`} />
      </div>

      <div className="flex min-w-0 gap-5">
        <aside className="hidden w-[280px] shrink-0 flex-col gap-4 lg:flex">
          {/* Mini month */}
          <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
            <div className={`mb-3 h-4 w-24 ${shimmer}`} />
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className={`h-6 w-full ${shimmer}`} />
              ))}
            </div>
          </div>
          {/* Filters / reminders */}
          <div className="space-y-3 rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`h-4 w-full ${shimmer}`} />
            ))}
          </div>
        </aside>

        {/* Month grid */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
          <div className="grid grid-cols-7 border-b border-court-border">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="px-2 py-2.5">
                <div className={`h-3 w-10 ${shimmer}`} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[92px] space-y-2 border-b border-r border-court-border-soft p-2"
              >
                <div className={`h-3 w-5 ${shimmer}`} />
                {i % 3 === 0 ? <div className={`h-4 w-full ${shimmer}`} /> : null}
                {i % 5 === 0 ? <div className={`h-4 w-2/3 ${shimmer}`} /> : null}
              </div>
            ))}
          </div>
        </div>
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
