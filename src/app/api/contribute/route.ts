import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const ContributeSchema = z.object({
  kind: z.enum(['price-update', 'name-fix', 'size-fix', 'category-fix', 'new-product', 'availability', 'barcode', 'generic']),
  productId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  note: z.string().max(500).optional(),
  submittedBy: z.string().optional(),
})

/** GET: pending contributions queue (public counts, full list for moderators) */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const rows = await db.contribution.findMany({
    where: { status },
    orderBy: { votes: 'desc' },
    take: 50,
  })
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, productId: r.productId,
      payload: JSON.parse(r.payload ?? '{}'), votes: r.votes,
      status: r.status, createdAt: r.createdAt, note: r.reviewNote ?? undefined,
    })),
  })
}

/** POST: submit a contribution (no account required for simple fixes; rate-limited) */
export async function POST(req: NextRequest) {
  const parsed = ContributeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 4) }, { status: 400 })
  }
  const b = parsed.data
  const ip = req.headers.get('x-forwarded-for') ?? 'local'
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
      submittedBy: b.submittedBy ?? ip,
    },
  })
  return NextResponse.json({ id: row.id, status: 'pending' })
}
