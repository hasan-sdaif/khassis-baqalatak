import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { readJsonLimited } from '@/lib/server/request-body'
import { rateLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/** POST: vote on a contribution (up/down, one vote per user key) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const limited = rateLimit(req, 'vote', 60, 60_000)
  if (limited) return limited
  const bodyResult = await readJsonLimited(req, 4 * 1024)
  if (!bodyResult.ok) return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status })
  const schema = z.object({ voterKey: z.string().min(8).max(60), value: z.union([z.literal(1), z.literal(-1)]) })
  const parsed = schema.safeParse(bodyResult.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const { voterKey, value } = parsed.data
  try {
    const contrib = await db.contribution.findUnique({ where: { id } })
    if (!contrib) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (contrib.status !== 'pending') return NextResponse.json({ error: 'already_reviewed' }, { status: 409 })
    const existing = await db.vote.findUnique({ where: { contributionId_voterKey: { contributionId: id, voterKey } } })
    if (existing) {
      if (existing.value === value) return NextResponse.json({ ok: true, votes: contrib.votes })
      await db.vote.update({ where: { id: existing.id }, data: { value } })
      await db.contribution.update({ where: { id }, data: { votes: { increment: value * 2 } } })
    } else {
      try {
        await db.vote.create({ data: { contributionId: id, voterKey, value } })
      } catch (err) {
        // Concurrent first-vote race: the unique (contributionId, voterKey) constraint
        // rejects the second insert — fall through to the count update below.
        const code = (err as { code?: string } | null)?.code
        if (code !== 'P2002') throw err
      }
      await db.contribution.update({ where: { id }, data: { votes: { increment: value } } })
    }
    const updated = await db.contribution.findUnique({ where: { id } })
    return NextResponse.json({ ok: true, votes: updated?.votes ?? 0 })
  } catch (err) {
    console.error('vote failed', { contributionId: id, error: (err as Error | null)?.message ?? 'unknown' })
    return NextResponse.json({ error: 'vote_failed' }, { status: 500 })
  }
}
