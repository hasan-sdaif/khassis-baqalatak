import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { readJsonLimited } from '@/lib/server/request-body'
import { clientIp, rateLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

const ContributeSchema = z.object({
  kind: z.enum(['price-update', 'name-fix', 'size-fix', 'category-fix', 'new-product', 'availability', 'barcode', 'generic']),
  productId: z.string().max(200).optional(),
  payload: z.record(z.string().max(100), z.unknown()).superRefine((value, ctx) => {
    if (Object.keys(value).length > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too_many_payload_fields' })
  }),
  note: z.string().max(500).optional(),
})

/** GET: public pending queue — no internal review notes, no submitter identity. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 'contrib-queue', 60, 60_000)
  if (limited) return limited
  const requestedStatus = req.nextUrl.searchParams.get('status') ?? 'pending'
  if (requestedStatus !== 'pending') {
    return NextResponse.json({ error: 'unsupported_status' }, { status: 400 })
  }
  const rows = await db.contribution.findMany({
    where: { status: 'pending' },
    orderBy: { votes: 'desc' },
    take: 50,
  })
  return NextResponse.json({
    items: rows.map((r) => {
      let payload: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(r.payload ?? '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>
      } catch {
        // Corrupt legacy payloads are omitted as empty objects so one bad row cannot break the queue.
      }
      return {
        id: r.id, kind: r.kind, productId: r.productId,
        payload, votes: r.votes, status: 'pending', createdAt: r.createdAt,
      }
    }),
  })
}

/** POST: submit a contribution (no account required; rate-limited per client). */
export async function POST(req: NextRequest) {
  // Burst protection (per process) + durable per-day quota below.
  const limited = rateLimit(req, 'contribute', 6, 60_000)
  if (limited) return limited
  const body = await readJsonLimited(req, 32 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const parsed = ContributeSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 4) }, { status: 400 })
  }
  const b = parsed.data
  // Rate-limit identity is server-derived and privacy-minimized: a daily-salted
  // one-way hash of the client IP (never the raw IP, never a client-supplied id).
  const ip = clientIp(req)
  const daySalt = new Date().toISOString().slice(0, 10)
  const submitterHash = createHash('sha256').update(`contribute:${ip}:${daySalt}`).digest('hex').slice(0, 64)
  // durable quota: max 10 contributions per hour per submitter hash
  const recent = await db.contribution.count({
    where: { submittedBy: submitterHash, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  })
  if (recent >= 10) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const row = await db.contribution.create({
    data: {
      kind: b.kind,
      productId: b.productId ?? null,
      payload: JSON.stringify(b.payload ?? {}),
      // Rate-limit identity must be server-derived; never trust client submittedBy.
      submittedBy: submitterHash,
    },
  })
  return NextResponse.json({ id: row.id, status: 'pending' })
}
