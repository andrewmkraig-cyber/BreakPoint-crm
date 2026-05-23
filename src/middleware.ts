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
    //
    // PWA assets MUST be excluded for the same reason. A service worker
    // script is fetched with redirect mode "error": when the session has
    // lapsed (background ~24h update checks, iOS PWA relaunch after the
    // cookie expired) an un-excluded /sw.js 307s to the sign-in HTML, the
    // browser rejects the update, and the worker can't refresh until the
    // user re-authenticates. The manifest, icons, offline fallback, and
    // brand marks are gated the same way and have no business behind auth,
    // so they're excluded here too.
    "/((?!api|sign-in|pdfjs|sw.js|manifest.json|offline|icons|brand|apple-touch-icon|favicon|ace-mark|_next/static|_next/image).*)",
  ],
};
