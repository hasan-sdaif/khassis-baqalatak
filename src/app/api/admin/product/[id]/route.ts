import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getProduct, bumpCatalogRev } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

/** GET single product incl. its overlay */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const product = await getProduct(id)
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const override = await db.productOverride.findUnique({ where: { id } })
  return NextResponse.json({ product, override: override ? JSON.parse(override.data) : null })
}

/** PATCH: edit product fields (overlay) */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body?.patch) return NextResponse.json({ error: 'patch_required' }, { status: 400 })
  const product = await getProduct(id)
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const existing = await db.productOverride.findUnique({ where: { id } })
  const before = existing ? JSON.parse(existing.data) : {}
  const after = { ...before, ...body.patch }
  delete (after as { deleted?: boolean }).deleted
  await db.productOverride.upsert({ where: { id }, create: { id, data: JSON.stringify(after) }, update: { data: JSON.stringify(after) } })
  await db.auditEntry.create({
    data: { actor: String(body.actor ?? 'admin'), action: 'update', targetType: 'product', targetId: id, before: JSON.stringify(before), after: JSON.stringify(after) },
  })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true })
}

/** DELETE: soft-delete via overlay (restorable) */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const existing = await db.productOverride.findUnique({ where: { id } })
  const before = existing ? JSON.parse(existing.data) : {}
  const after = { ...before, deleted: true }
  await db.productOverride.upsert({ where: { id }, create: { id, data: JSON.stringify(after) }, update: { data: JSON.stringify(after) } })
  await db.auditEntry.create({ data: { actor: String(body?.actor ?? 'admin'), action: 'delete', targetType: 'product', targetId: id, before: JSON.stringify(before), after: JSON.stringify(after) } })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true })
}
