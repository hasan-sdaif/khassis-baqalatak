import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bumpCatalogRev } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

/** audit log (spec 8.8) with selective rollback */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const rows = await db.auditEntry.findMany({
    where: sp.get('targetType') ? { targetType: sp.get('targetType')! } : undefined,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(sp.get('limit') ?? 50), 200),
  })
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id, actor: r.actor, action: r.action, targetType: r.targetType, targetId: r.targetId,
      before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null,
      createdAt: r.createdAt, revertedAt: r.revertedAt,
    })),
  })
}

/** rollback one audit entry (restore `before` state) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const entry = await db.auditEntry.findUnique({ where: { id } })
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (entry.revertedAt) return NextResponse.json({ error: 'already_reverted' }, { status: 409 })
  if (entry.targetType !== 'product') return NextResponse.json({ error: 'unsupported_target' }, { status: 400 })

  if (entry.action === 'delete') {
    // restore: remove the deleted flag
    const ov = await db.productOverride.findUnique({ where: { id: entry.targetId } })
    if (ov) {
      const data = JSON.parse(ov.data) as Record<string, unknown>
      delete data.deleted
      await db.productOverride.update({ where: { id: entry.targetId }, data: { data: JSON.stringify(data) } })
    }
  } else if (entry.before != null) {
    // restore previous overlay state
    await db.productOverride.upsert({
      where: { id: entry.targetId },
      create: { id: entry.targetId, data: entry.before },
      update: { data: entry.before },
    })
  } else {
    // created => remove the overlay entirely
    await db.productOverride.deleteMany({ where: { id: entry.targetId } })
  }
  await db.auditEntry.update({ where: { id }, data: { revertedAt: new Date() } })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true })
}
