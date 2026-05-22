import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentOrg } from '@/lib/auth/getCurrentOrg'

export async function POST(req: NextRequest) {
  const { candidateId, direction, fromNumber, toNumber, status, duration, recordingUrl, krispcallId } = await req.json()
  // Tenant scope (NN #8): stamp organizationId so the row is visible to
  // the org-scoped Phone tab + activity reads. Prefer the candidate's
  // org when we have one; fall back to the active session org. Mirrors
  // the SmsMessage create in /api/sms.
  let organizationId: string | null = null
  if (typeof candidateId === 'string' && candidateId.length > 0) {
    const cand = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { organizationId: true },
    })
    organizationId = cand?.organizationId ?? null
  }
  if (!organizationId) {
    try {
      organizationId = (await getCurrentOrg()).id
    } catch {
      // Leave null rather than 500 the call-logging path.
    }
  }
  const log = await prisma.callLog.create({
    data: { candidateId, organizationId, direction, fromNumber, toNumber, status: status ?? 'initiated', duration, recordingUrl, krispcallId },
  })
  return NextResponse.json(log)
}

export async function GET(req: NextRequest) {
  // Accept either candidateId or clientId. Candidate scoping is the
  // primary use case; clientId scoping powers the call log on the
  // client profile activity tab. If both arrive somehow, candidateId
  // takes precedence.
  const candidateId = req.nextUrl.searchParams.get('candidateId')
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!candidateId && !clientId) return NextResponse.json([])
  // Tenant scope (NN #8): never return rows from another org even if a
  // caller passes a candidate/client id that isn't theirs.
  const org = await getCurrentOrg()
  const logs = await prisma.callLog.findMany({
    where: candidateId
      ? { candidateId, organizationId: org.id }
      : { clientId: clientId!, organizationId: org.id },
    include: { transcript: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(logs)
}
