import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { isLikelyZip, validateUsCity, validateUsZip } from "@/lib/location-validation";

export const dynamic = "force-dynamic";
// Each upstream call is capped at ~5s in the lib; doubling that for
// the city+zip combined case gives us headroom plus the JSON parse.
export const maxDuration = 15;

// Pre-save US location validation endpoint. The /jobs/new form calls
// this before invoking the createJob server action so the recruiter
// gets an inline field error instead of a generic save failure. The
// updateJobOverview action also calls the underlying helpers directly
// as a defense-in-depth check.
//
// Tenant scope: the request must be authenticated and the user must
// resolve to an organization. We don't read or write any tenant data
// here, but gating on a valid session keeps the upstream Nominatim /
// Zippopotam quota from being spent by unauthenticated callers if the
// route is ever discovered.

type ValidateRequest = {
  city?: string | null;
  zip?: string | null;
};

type ValidateResponse = {
  ok: boolean;
  errors: { city?: string; zip?: string };
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json<ValidateResponse>(
      { ok: false, errors: { city: "Not signed in." } },
      { status: 401 },
    );
  }
  // Triggers a 401 path if the signed-in user doesn't belong to an org.
  await getCurrentOrg();

  let body: ValidateRequest;
  try {
    body = (await req.json()) as ValidateRequest;
  } catch {
    return NextResponse.json<ValidateResponse>(
      { ok: false, errors: { city: "Bad request body." } },
      { status: 400 },
    );
  }

  const city = (body.city ?? "").trim();
  const zip = (body.zip ?? "").trim();

  // If both inputs are blank, the spec says "do not block save" — so
  // ok:true with no errors. The form layer is responsible for not
  // calling this endpoint when both fields are blank, but we mirror
  // the rule here so retries / direct calls behave consistently.
  if (!city && !zip) {
    return NextResponse.json<ValidateResponse>({ ok: true, errors: {} });
  }

  // Guard against a recruiter typing a 5-digit zip into the city
  // field. Catch it client-side so the error message points at the
  // right control.
  if (city && isLikelyZip(city)) {
    return NextResponse.json<ValidateResponse>({
      ok: false,
      errors: { city: "Enter a US city name (not a zip code)." },
    });
  }

  const [cityResult, zipResult] = await Promise.all([
    city ? validateUsCity(city) : Promise.resolve({ ok: true as const }),
    zip ? validateUsZip(zip) : Promise.resolve({ ok: true as const }),
  ]);

  const errors: ValidateResponse["errors"] = {};
  if (!cityResult.ok) errors.city = cityResult.message;
  if (!zipResult.ok) errors.zip = zipResult.message;

  return NextResponse.json<ValidateResponse>({
    ok: cityResult.ok && zipResult.ok,
    errors,
  });
}
