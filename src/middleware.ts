import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Server actions arrive as POSTs to page URLs with a Next-Action header.
// Passing those through next-auth's redirect-on-miss would turn our action
// responses into sign-in HTML, which then shows up back in the UI as raw
// source or corrupted panels. We short-circuit those requests here: if there
// is no token, return a 401 JSON (the client will show an error toast); if a
// token is present, let the action run.
export async function middleware(req: NextRequest) {
  const token = await getToken({ req });
  const isServerAction = req.method === "POST" && req.headers.has("next-action");

  if (!token) {
    if (isServerAction) {
      return new NextResponse(JSON.stringify({ error: "Session expired. Reload and sign in again." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip all /api routes so they can self-auth and return JSON (otherwise
    // the sign-in HTML would leak into JSON callers like /api/generate-submittal).
    // Also skip /pdfjs/* so the self-hosted pdf.worker is publicly fetchable
    // — Web Workers instantiated from a redirected script get blocked by
    // browsers, so we can't afford middleware interception here.
    "/((?!api|sign-in|pdfjs|_next/static|_next/image|favicon.ico).*)",
  ],
};
