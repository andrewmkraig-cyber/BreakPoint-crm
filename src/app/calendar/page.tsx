import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Calendar · Ace",
};

export default function CalendarPage() {
  // Resolve "now" on the server and hand it to the client component so
  // SSR and CSR agree on today's date. Without this anchor, the client
  // would compute a fresh Date during hydration and risk mismatching
  // the markup the server emitted.
  return <CalendarView initialDate={new Date()} />;
}
