import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const { candidateId, direction, fromNumber, toNumber, status, duration, recordingUrl, krispcallId } = await req.json()
  const log = await prisma.callLog.create({
    data: { candidateId, direction, fromNumber, toNumber, status: status ?? 'initiated', duration, recordingUrl, krispcallId },
  })
  return NextResponse.json(log)
}

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get('candidateId')
  if (!candidateId) return NextResponse.json([])
  const logs = await prisma.callLog.findMany({
    where: { candidateId },
    include: { transcript: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(logs)
}
