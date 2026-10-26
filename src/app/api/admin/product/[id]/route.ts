import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getProduct, getCatalog, bumpCatalogRev } from '@/lib/server/catalog'
import { requireAdmin } from '@/lib/server/admin-auth'
import { readJsonLimited } from '@/lib/server/request-body'
import { ProductPatchSchema } from '@/lib/validation/admin-product'
import { deriveProductOverride } from '@/lib/server/product-overlay'

export const dynamic = 'force-dynamic'

function parsePatchEnvelope(value: unknown): { patch: ReturnType<typeof ProductPatchSchema.parse> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !('patch' in record)) return null
  const parsed = ProductPatchSchema.safeParse(record.patch)
  return parsed.success ? { patch: parsed.data } : null
}


/** GET single product incl. its override. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const { id } = await ctx.params
  const product = await getProduct(id)
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const override = await db.productOverride.findUnique({ where: { id } })
  let parsedOverride: unknown = null
  try { parsedOverride = override ? JSON.parse(override.data) : null } catch { parsedOverride = null }
  return NextResponse.json({ product, override: parsedOverride })
}

/** PATCH: accept only human-editable fields; recompute all derived fields on the server. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const { id } = await ctx.params
  const body = await readJsonLimited(req, 64 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const envelope = parsePatchEnvelope(body.value)
  if (!envelope) return NextResponse.json({ error: 'invalid_patch' }, { status: 400 })
  const product = await getProduct(id)
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const catalog = await getCatalog()
  if (envelope.patch.category && !catalog.categories.some((category) => category.id === envelope.patch.category)) {
    return NextResponse.json({ error: 'unknown_category' }, { status: 422 })
  }
  if (envelope.patch.prices && Object.keys(envelope.patch.prices).some((storeId) => !catalog.stores.some((store) => store.id === storeId))) {
    return NextResponse.json({ error: 'unknown_store' }, { status: 422 })
  }

  const existing = await db.productOverride.findUnique({ where: { id } })
  let before: Record<string, unknown> = {}
  try { before = existing ? JSON.parse(existing.data) as Record<string, unknown> : {} } catch { return NextResponse.json({ error: 'override_data_corrupt' }, { status: 409 }) }
  let after: Record<string, unknown>
  try { after = deriveProductOverride(product, before, envelope.patch) }
  catch { return NextResponse.json({ error: 'invalid_product_patch' }, { status: 400 }) }
  await db.$transaction(async (tx) => {
    await tx.productOverride.upsert({ where: { id }, create: { id, data: JSON.stringify(after) }, update: { data: JSON.stringify(after) } })
    await tx.auditEntry.create({
      data: { actor: 'admin-api-key', action: 'update', targetType: 'product', targetId: id, before: JSON.stringify(before), after: JSON.stringify(after) },
    })
  })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true })
}

/** DELETE: soft-delete via overlay (restorable). No client-supplied actor is trusted. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const { id } = await ctx.params
  const product = await getProduct(id)
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const existing = await db.productOverride.findUnique({ where: { id } })
  let before: Record<string, unknown> = {}
  try { before = existing ? JSON.parse(existing.data) as Record<string, unknown> : {} } catch { return NextResponse.json({ error: 'override_data_corrupt' }, { status: 409 }) }
  const after = { ...before, deleted: true }
  await db.$transaction(async (tx) => {
    await tx.productOverride.upsert({ where: { id }, create: { id, data: JSON.stringify(after) }, update: { data: JSON.stringify(after) } })
    await tx.auditEntry.create({ data: { actor: 'admin-api-key', action: 'delete', targetType: 'product', targetId: id, before: JSON.stringify(before), after: JSON.stringify(after) } })
  })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true })
}
