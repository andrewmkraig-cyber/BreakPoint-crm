import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// Client uploads hit Vercel Blob directly. This route only issues a short-lived
// token — the actual bytes never traverse our serverless function, bypassing
// the 4.5MB request body limit on Hobby.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
          throw new Error("Not signed in");
        }
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            email: session.user.email,
            pathname,
            issuedAt: Date.now(),
          }),
        };
      },
      onUploadCompleted: async () => {
        // Client calls registerBenefitsFile() with metadata after upload —
        // no server-side work needed here.
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
