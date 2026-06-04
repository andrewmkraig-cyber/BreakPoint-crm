import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  FITNESS_BODY_PARTS,
  slugifyFitnessName,
  type FitnessCreateExercisePayload,
} from "@/lib/fitness";
import {
  FitnessHttpError,
  requireFitnessContext,
} from "@/lib/fitness-server";

export const dynamic = "force-dynamic";

function toErrorResponse(error: unknown) {
  if (error instanceof FitnessHttpError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  console.error("[fitness] create exercise failed", error);
  return NextResponse.json(
    { ok: false, error: "Exercise failed to save" },
    { status: 500 },
  );
}

export async function POST(req: Request) {
  try {
    const ctx = await requireFitnessContext();
    let body: FitnessCreateExercisePayload;
    try {
      body = (await req.json()) as FitnessCreateExercisePayload;
    } catch {
      throw new FitnessHttpError("Invalid JSON body", 400);
    }

    const name = body.name?.trim();
    if (!name) throw new FitnessHttpError("Exercise name is required", 400);
    const slug = slugifyFitnessName(name);
    if (!slug) throw new FitnessHttpError("Exercise name is invalid", 400);

    const allowedBodyParts = new Set<string>(
      FITNESS_BODY_PARTS.filter((p) => p !== "All"),
    );
    const bodyPart =
      typeof body.bodyPart === "string" && allowedBodyParts.has(body.bodyPart)
      ? body.bodyPart
      : "Custom";
    const ownerKey = ctx.userId;

    const existing = await prisma.exercise.findUnique({
      where: {
        organizationId_ownerKey_slug: {
          organizationId: ctx.organizationId,
          ownerKey,
          slug,
        },
      },
    });
    const exercise =
      existing ??
      (await prisma.exercise.create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          ownerKey,
          name,
          slug,
          bodyPart,
          defaultDay: body.defaultDay?.trim() || null,
          sortOrder: 1000 + Date.now() % 100000,
          isDefault: false,
        },
      }));

    return NextResponse.json({
      ok: true,
      exercise: {
        id: exercise.id,
        name: exercise.name,
        slug: exercise.slug,
        bodyPart: exercise.bodyPart,
        defaultDay: exercise.defaultDay,
        sortOrder: exercise.sortOrder,
        isDefault: exercise.isDefault,
        isCustom: !exercise.isDefault,
        last: null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
