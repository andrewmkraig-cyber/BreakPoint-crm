export { default } from "next-auth/middleware";

// /api/blob/* is exempt so Vercel Blob's server-to-server upload-completed
// webhook can reach us. handleUpload() signature-verifies those calls; the
// session check still lives inside onBeforeGenerateToken.
export const config = {
  matcher: [
    "/((?!api/auth|api/blob|sign-in|_next/static|_next/image|favicon.ico).*)",
  ],
};
