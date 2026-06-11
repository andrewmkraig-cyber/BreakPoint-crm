import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCurrentOrg } from '@/lib/auth/getCurrentOrg'
import { prisma } from '@/lib/prisma'
import { callLineWhere, getQuoLineDigitsForUserEmail } from '@/lib/quo-line-owner'

async function canAccessCallLog(callLogId: string): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return false
  const org = await getCurrentOrg()
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session.user.email)
  if (lineDigits.length === 0) return false
  const row = await prisma.callLog.findFirst({
    where: { id: callLogId, organizationId: org.id, AND: [callLineWhere(lineDigits)] },
    select: { id: true },
  })
  return !!row
}

export async function POST(req: NextRequest) {
  const { callLogId, transcript } = await req.json()
  if (!callLogId || !(await canAccessCallLog(callLogId))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const record = await prisma.callTranscript.upsert({
    where: { callLogId },
    create: { callLogId, transcript },
    update: { transcript },
  })
  return NextResponse.json(record)
}

export async function GET(req: NextRequest) {
  const callLogId = req.nextUrl.searchParams.get('callLogId')
  if (!callLogId) return NextResponse.json(null)
  if (!(await canAccessCallLog(callLogId))) return NextResponse.json(null)
  const record = await prisma.callTranscript.findUnique({ where: { callLogId } })
  return NextResponse.json(record)
}
