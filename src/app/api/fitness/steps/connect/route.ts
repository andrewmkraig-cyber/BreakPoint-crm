import { NextResponse } from "next/server";

import {
  APPLE_HEALTH_SOURCE,
  FitnessHttpError,
  createFitnessHealthToken,
  fetchAppleHealthConnection,
  hashFitnessHealthToken,
  requireFitnessContext,
} from "@/lib/fitness-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function toErrorResponse(error: unknown) {
  if (error instanceof FitnessHttpError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  console.error("[fitness] Apple Health connection check failed", error);
  return NextResponse.json(
    { ok: false, error: "Apple Health is not connected to Ace yet" },
    { status: 500 },
  );
}

function buildIngestUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}/api/fitness/steps/ingest`;
}

export async function GET() {
  try {
    const ctx = await requireFitnessContext();
    const connection = await fetchAppleHealthConnection(
      ctx.organizationId,
      ctx.userId,
    );
    return NextResponse.json(
      {
        ok: true,
        ...connection,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireFitnessContext();
    const token = createFitnessHealthToken();
    const tokenHash = hashFitnessHealthToken(token);

    const connection = await prisma.fitnessHealthConnection.upsert({
      where: {
        organizationId_userId_source: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          source: APPLE_HEALTH_SOURCE,
        },
      },
      update: {
        tokenHash,
        enabled: true,
      },
      create: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        source: APPLE_HEALTH_SOURCE,
        tokenHash,
        enabled: true,
      },
      select: {
        enabled: true,
        source: true,
        lastSyncAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      connected: connection.enabled,
      source: connection.source,
      lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
      setup: {
        token,
        source: connection.source,
        ingestUrl: buildIngestUrl(req),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireFitnessContext();
    await prisma.fitnessHealthConnection.updateMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        source: APPLE_HEALTH_SOURCE,
      },
      data: { enabled: false },
    });
    return NextResponse.json({
      ok: true,
      connected: false,
      source: APPLE_HEALTH_SOURCE,
      lastSyncAt: null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
