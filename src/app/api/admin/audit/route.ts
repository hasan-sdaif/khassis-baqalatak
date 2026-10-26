import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bumpCatalogRev } from '@/lib/server/catalog'
import { requireAdmin } from '@/lib/server/admin-auth'
import { readJsonLimited } from '@/lib/server/request-body'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

function safeJson(raw: string | null): unknown { try { return raw ? JSON.parse(raw) as unknown : null } catch { return null } }

/** audit log (spec 8.8) with selective rollback */
export async function GET(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const sp = req.nextUrl.searchParams
  const rows = await db.auditEntry.findMany({
    where: sp.get('targetType') ? { targetType: sp.get('targetType')! } : undefined,
    orderBy: { createdAt: 'desc' },
    take: (() => { const n = Number.parseInt(sp.get('limit') ?? '50', 10); return Number.isFinite(n) ? Math.max(1, Math.min(n, 200)) : 50 })(),
  })
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id, actor: r.actor, action: r.action, targetType: r.targetType, targetId: r.targetId,
      before: safeJson(r.before), after: safeJson(r.after),
      createdAt: r.createdAt, revertedAt: r.revertedAt,
    })),
  })
}

/** rollback one audit entry (restore `before` state) */
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const body = await readJsonLimited(req, 4 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const parsed = z.object({ id: z.string().trim().min(1).max(200) }).strict().safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const id = parsed.data.id
  const entry = await db.auditEntry.findUnique({ where: { id } })
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (entry.revertedAt) return NextResponse.json({ error: 'already_reverted' }, { status: 409 })
  if (entry.targetType !== 'product') return NextResponse.json({ error: 'unsupported_target' }, { status: 400 })

  if (entry.action === 'delete') {
    // restore: remove the deleted flag
    const ov = await db.productOverride.findUnique({ where: { id: entry.targetId } })
    if (ov) {
      const data = safeJson(ov.data) as Record<string, unknown> | null
      if (!data || typeof data !== 'object' || Array.isArray(data)) return NextResponse.json({ error: 'override_data_corrupt' }, { status: 409 })
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
