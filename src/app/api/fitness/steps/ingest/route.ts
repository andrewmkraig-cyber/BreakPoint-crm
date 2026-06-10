import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  APPLE_HEALTH_SOURCE,
  FitnessHttpError,
  hashFitnessHealthToken,
  isoDateOnly,
  parseDateOnly,
  todayInEastern,
} from "@/lib/fitness-server";

export const dynamic = "force-dynamic";

type StepEntry = {
  date?: unknown;
  steps?: unknown;
};

function toErrorResponse(error: unknown) {
  if (error instanceof FitnessHttpError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  console.error("[fitness] Apple Health ingest failed", error);
  return NextResponse.json(
    { ok: false, error: "Apple Health steps failed to sync" },
    { status: 500 },
  );
}

function cleanSteps(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 200_000) {
    throw new FitnessHttpError("Steps must be a valid daily count", 400);
  }
  return Math.round(n);
}

function normalizeEntries(body: {
  date?: unknown;
  steps?: unknown;
  entries?: unknown;
}): Array<{ date: Date; steps: number }> {
  const rawEntries = Array.isArray(body.entries)
    ? (body.entries as StepEntry[])
    : [{ date: body.date, steps: body.steps }];

  if (rawEntries.length === 0 || rawEntries.length > 31) {
    throw new FitnessHttpError("Send between 1 and 31 step entries", 400);
  }

  return rawEntries.map((entry) => ({
    date:
      typeof entry.date === "string" && entry.date.trim()
        ? parseDateOnly(entry.date)
        : todayInEastern(),
    steps: cleanSteps(entry.steps),
  }));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | {
          token?: unknown;
          date?: unknown;
          steps?: unknown;
          entries?: unknown;
        }
      | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) throw new FitnessHttpError("Missing Apple Health token", 401);

    const connection = await prisma.fitnessHealthConnection.findUnique({
      where: { tokenHash: hashFitnessHealthToken(token) },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        enabled: true,
      },
    });
    if (!connection?.enabled) {
      throw new FitnessHttpError("Apple Health token is invalid", 401);
    }

    const entries = normalizeEntries(body ?? {});
    const now = new Date();

    const manualRows = await prisma.dailySteps.findMany({
      where: {
        organizationId: connection.organizationId,
        userId: connection.userId,
        source: "manual",
        date: { in: entries.map((entry) => entry.date) },
      },
      select: { date: true },
    });
    const manualDates = new Set(manualRows.map((row) => isoDateOnly(row.date)));
    const syncEntries = entries.filter(
      (entry) => !manualDates.has(isoDateOnly(entry.date)),
    );

    await prisma.$transaction([
      ...syncEntries.map((entry) =>
        prisma.dailySteps.upsert({
          where: {
            organizationId_userId_date: {
              organizationId: connection.organizationId,
              userId: connection.userId,
              date: entry.date,
            },
          },
          update: {
            steps: entry.steps,
            source: APPLE_HEALTH_SOURCE,
          },
          create: {
            organizationId: connection.organizationId,
            userId: connection.userId,
            date: entry.date,
            steps: entry.steps,
            source: APPLE_HEALTH_SOURCE,
          },
        }),
      ),
      prisma.fitnessHealthConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: now },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      synced: syncEntries.length,
      skippedManual: entries.length - syncEntries.length,
      lastSyncAt: now.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
