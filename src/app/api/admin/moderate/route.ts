import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bumpCatalogRev } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

/** moderate contributions (spec 8.9): approve (apply) / reject with reason */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const action = String(body?.action ?? '')
  const actor = String(body?.actor ?? 'admin')
  const note = body?.note ? String(body.note).slice(0, 400) : null
  const contrib = await db.contribution.findUnique({ where: { id } })
  if (!contrib) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (contrib.status !== 'pending') return NextResponse.json({ error: 'already_reviewed' }, { status: 409 })

  const payload = JSON.parse(contrib.payload ?? '{}') as Record<string, unknown>

  if (action === 'approve') {
    // apply the contribution to the catalog overlay
    if (contrib.productId && contrib.kind !== 'new-product') {
      const existing = await db.productOverride.findUnique({ where: { id: contrib.productId } })
      const cur = existing ? JSON.parse(existing.data) : {}
      const next: Record<string, unknown> = { ...cur, ...payload, __manual: true }
      await db.productOverride.upsert({ where: { id: contrib.productId }, create: { id: contrib.productId, data: JSON.stringify(next) }, update: { data: JSON.stringify(next) } })
      await db.auditEntry.create({ data: { actor, action: 'moderate', targetType: 'product', targetId: contrib.productId, before: existing?.data ?? null, after: JSON.stringify(next) } })
      await bumpCatalogRev()
    }
    await db.contribution.update({ where: { id }, data: { status: 'approved', reviewedAt: new Date(), reviewedBy: actor, reviewNote: note } })
    return NextResponse.json({ ok: true, status: 'approved' })
  }

  if (action === 'reject') {
    await db.contribution.update({ where: { id }, data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: actor, reviewNote: note } })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
