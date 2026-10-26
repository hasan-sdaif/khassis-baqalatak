import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** POST: vote on a contribution (up/down, one vote per user key) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const voterKey = String(body.voterKey ?? 'anon').slice(0, 60)
  const value = body.value === -1 ? -1 : 1
  const contrib = await db.contribution.findUnique({ where: { id } })
  if (!contrib) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const existing = await db.vote.findUnique({ where: { contributionId_voterKey: { contributionId: id, voterKey } } })
  if (existing) {
    if (existing.value === value) return NextResponse.json({ ok: true, votes: contrib.votes })
    await db.vote.update({ where: { id: existing.id }, data: { value } })
    await db.contribution.update({ where: { id }, data: { votes: { increment: value * 2 } } })
  } else {
    await db.vote.create({ data: { contributionId: id, voterKey, value } })
    await db.contribution.update({ where: { id }, data: { votes: { increment: value } } })
  }
  const updated = await db.contribution.findUnique({ where: { id } })
  return NextResponse.json({ ok: true, votes: updated?.votes ?? 0 })
}
