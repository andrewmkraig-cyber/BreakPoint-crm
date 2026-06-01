"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

import { getWeekData } from "./this-week-data";
import type { WeekViewData } from "./this-week-widget-client";

// Server action behind the This Week widget's ‹ › paging arrows. The
// client passes only a week offset; org + person are re-derived from the
// session here so the client can never widen scope past its own org
// (rule 8). The underlying query logic is unchanged - getWeekData runs
// the same fetch with the Mon-Fri window shifted by `weekOffset` weeks.
export async function fetchWeekData(weekOffset: number): Promise<WeekViewData> {
  // Coerce + clamp so a malformed/huge offset can't drive an absurd date
  // window; +/- 5 years of paging is far more than the widget needs.
  const offset = Math.max(-260, Math.min(260, Math.trunc(Number(weekOffset) || 0)));

  const [org, session] = await Promise.all([
    getCurrentOrg(),
    getServerSession(authOptions),
  ]);
  const selfPerson = {
    name: session?.user?.name ?? null,
    email: session?.user?.email ?? null,
  };
  return getWeekData(org.id, selfPerson, offset);
}
