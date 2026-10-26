import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { readJsonLimited } from '@/lib/server/request-body'

export const dynamic = 'force-dynamic'

const ContributeSchema = z.object({
  kind: z.enum(['price-update', 'name-fix', 'size-fix', 'category-fix', 'new-product', 'availability', 'barcode', 'generic']),
  productId: z.string().max(200).optional(),
  payload: z.record(z.string().max(100), z.unknown()).superRefine((value, ctx) => {
    if (Object.keys(value).length > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too_many_payload_fields' })
  }),
  note: z.string().max(500).optional(),
  submittedBy: z.string().max(120).optional(),
})

/** Public GET exposes only the public pending queue, never internal review notes or other statuses. */
export async function GET(req: NextRequest) {
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

/** POST: submit a contribution (no account required for simple fixes; rate-limited) */
export async function POST(req: NextRequest) {
  const body = await readJsonLimited(req, 32 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const parsed = ContributeSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 4) }, { status: 400 })
  }
  const b = parsed.data
  // Deploy behind a trusted proxy that overwrites these headers; do not expose the app directly.
  const ip = (req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local').slice(0, 120)
  // simple rate limit: max 10 contributions per hour per ip
  const recent = await db.contribution.count({
    where: { submittedBy: ip, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  })
  if (recent >= 10) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const row = await db.contribution.create({
    data: {
      kind: b.kind,
      productId: b.productId ?? null,
      payload: JSON.stringify(b.payload ?? {}),
      // Rate-limit identity must be server-derived; never trust client submittedBy.
      submittedBy: ip,
    },
  })
  return NextResponse.json({ id: row.id, status: 'pending' })
}
