import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const { callLogId, transcript } = await req.json()
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
  const record = await prisma.callTranscript.findUnique({ where: { callLogId } })
  return NextResponse.json(record)
}
