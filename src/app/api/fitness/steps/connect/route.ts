import { NextResponse } from "next/server";

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
  console.error("[fitness] Apple Health connection check failed", error);
  return NextResponse.json(
    { ok: false, error: "Apple Health is not connected to Ace yet" },
    { status: 500 },
  );
}

export async function POST() {
  try {
    await requireFitnessContext();
    return NextResponse.json(
      {
        ok: false,
        error: "Apple Health is not connected to Ace yet.",
      },
      { status: 501 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
