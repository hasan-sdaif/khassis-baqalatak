import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { bumpCatalogRev, getCatalog, getProduct, stableId } from '@/lib/server/catalog'
import { requireAdmin } from '@/lib/server/admin-auth'
import { readJsonLimited } from '@/lib/server/request-body'
import { normalizeArabic } from '@/lib/engine/normalize'
import { parseSize } from '@/lib/engine/size'
import { classifyNeed, extractTags } from '@/lib/engine/needs'
import { deriveProductOverride } from '@/lib/server/product-overlay'

export const dynamic = 'force-dynamic'
const ModerateSchema = z.object({
  id: z.string().trim().min(1).max(200),
  action: z.enum(['approve', 'reject']),
  note: z.string().max(400).optional(),
}).strict()

function asObject(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] ?? 0 : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
}

/** Moderation applies only explicit, structured fields; free-text notes never become catalog columns. */
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const body = await readJsonLimited(req, 16 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const parsed = ModerateSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const { id, action } = parsed.data
  const note = parsed.data.note?.trim() || null
  const actor = 'admin-api-key'
  const contrib = await db.contribution.findUnique({ where: { id } })
  if (!contrib) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (contrib.status !== 'pending') return NextResponse.json({ error: 'already_reviewed' }, { status: 409 })

  if (action === 'reject') {
    await db.contribution.update({ where: { id }, data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: actor, reviewNote: note } })
    return NextResponse.json({ ok: true, status: 'rejected', appliedToCatalog: false })
  }

  const payload = asObject(contrib.payload)
  const catalog = await getCatalog()

  // New products require enough structured data to establish a traceable first price.
  if (contrib.kind === 'new-product') {
    const nameAr = typeof payload.nameAr === 'string' ? payload.nameAr.trim().slice(0, 1_000) : ''
    const category = typeof payload.category === 'string' ? payload.category : ''
    const brand = typeof payload.brand === 'string' ? payload.brand.trim().slice(0, 250) || null : null
    const sizeText = typeof payload.sizeText === 'string' ? payload.sizeText.trim().slice(0, 500) || null : null
    const storeId = typeof payload.storeId === 'string' ? payload.storeId : ''
    const fils = payload.fils
    if (!nameAr || !catalog.categories.some((entry) => entry.id === category) || !catalog.stores.some((store) => store.id === storeId) || typeof fils !== 'number' || !Number.isSafeInteger(fils) || fils <= 0 || fils > 1_000_000_000) {
      return NextResponse.json({ error: 'new_product_requires_name_category_store_and_price' }, { status: 422 })
    }
    const size = parseSize(sizeText)
    const normalized = normalizeArabic(`${nameAr} ${brand ?? ''}`)
    const duplicate = catalog.products.find((product) => product.category === category && normalizeArabic(`${product.nameAr} ${product.brand ?? ''}`) === normalized && (product.sizeText ?? null) === sizeText)
    if (duplicate) return NextResponse.json({ error: 'possible_duplicate_product', existingProductId: duplicate.id }, { status: 409 })
    const productId = stableId([category, brand ?? '', normalized, sizeText ?? '', 'community-review'])
    if (catalog.products.some((product) => product.id === productId) || await db.productOverride.findUnique({ where: { id: productId } })) {
      return NextResponse.json({ error: 'product_id_exists', existingProductId: productId }, { status: 409 })
    }
    const nameEn = typeof payload.nameEn === 'string' ? payload.nameEn.trim().slice(0, 1_000) : ''
    const flavors: string[] = []
    const prices = { [storeId]: { fils, available: true } }
    const unitFactor = size?.unit === 'ml' || size?.unit === 'g' ? 1000 : 1
    const data = {
      added: true,
      nameAr,
      nameEn,
      nameNorm: normalizeArabic(`${nameAr} ${nameEn} ${brand ?? ''}`),
      brand,
      brandNorm: brand ? normalizeArabic(brand) : null,
      category,
      sizeText,
      size,
      flavors,
      tags: extractTags(nameEn, nameAr, flavors, sizeText),
      rank: 500,
      storesCount: 1,
      available: true,
      medianFils: fils,
      minFils: fils,
      maxFils: fils,
      prices,
      unitPriceFils: size && size.unit !== 'pcs' && size.baseQuantity > 0 ? Math.round(fils * unitFactor / size.baseQuantity) : null,
      need: classifyNeed(nameEn, nameAr, brand, category, flavors),
      dataConfidence: 0.6,
      __manual: true,
      contributionId: contrib.id,
    }
    await db.$transaction(async (tx) => {
      await tx.productOverride.create({ data: { id: productId, data: JSON.stringify(data) } })
      await tx.auditEntry.create({ data: { actor, action: 'community-create', targetType: 'product', targetId: productId, before: null, after: JSON.stringify(data) } })
      await tx.contribution.update({ where: { id }, data: { status: 'approved', productId, reviewedAt: new Date(), reviewedBy: actor, reviewNote: note ?? `أُضيف المنتج ${productId}` } })
    })
    await bumpCatalogRev()
    return NextResponse.json({ ok: true, status: 'approved', appliedToCatalog: true, productId })
  }

  if (!contrib.productId || !['price-update', 'availability', 'name-fix'].includes(contrib.kind)) {
    return NextResponse.json({ error: 'structured_update_required', message: 'هذه المساهمة لا تحتوي حقولاً منظمة كافية للتطبيق المباشر؛ عدّل المنتج يدوياً من لوحة الإدارة أو ارفض المساهمة.' }, { status: 422 })
  }
  const product = await getProduct(contrib.productId)
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 })
  const existing = await db.productOverride.findUnique({ where: { id: contrib.productId } })
  const cur = asObject(existing?.data ?? null)
  const prices: Record<string, { fils: number; origFils?: number; url?: string; available?: boolean }> = { ...product.prices }
  let changes: Record<string, unknown> = {}

  if (contrib.kind === 'price-update') {
    const storeId = typeof payload.storeId === 'string' ? payload.storeId : ''
    const fils = payload.fils
    if (!catalog.stores.some((store) => store.id === storeId) || typeof fils !== 'number' || !Number.isSafeInteger(fils) || fils <= 0 || fils > 1_000_000_000) {
      return NextResponse.json({ error: 'price_requires_valid_store_and_amount' }, { status: 422 })
    }
    prices[storeId] = { ...(prices[storeId] ?? {}), fils, available: true }
    const values = Object.values(prices).filter((price) => price.available !== false && Number.isSafeInteger(price.fils) && price.fils > 0).map((price) => price.fils)
    if (!values.length) return NextResponse.json({ error: 'no_valid_prices' }, { status: 422 })
    const medianFils = median(values)
    const size = product.size
    const unitFactor = size?.unit === 'ml' || size?.unit === 'g' ? 1000 : 1
    changes = {
      prices,
      medianFils,
      minFils: Math.min(...values),
      maxFils: Math.max(...values),
      storesCount: values.length,
      unitPriceFils: size && size.unit !== 'pcs' && size.baseQuantity > 0 ? Math.round(medianFils * unitFactor / size.baseQuantity) : null,
      __manual: true,
    }
  } else if (contrib.kind === 'availability') {
    const storeId = typeof payload.storeId === 'string' ? payload.storeId : ''
    if (!catalog.stores.some((store) => store.id === storeId) || typeof payload.available !== 'boolean') {
      return NextResponse.json({ error: 'availability_requires_store_and_state' }, { status: 422 })
    }
    const existingPrice = prices[storeId]
    if (!existingPrice) return NextResponse.json({ error: 'store_price_missing' }, { status: 422 })
    prices[storeId] = { ...existingPrice, available: payload.available }
    const availableValues = Object.values(prices).filter((price) => price.available !== false && Number.isSafeInteger(price.fils) && price.fils > 0).map((price) => price.fils)
    const medianFils = availableValues.length ? median(availableValues) : product.medianFils
    const size = product.size
    const unitFactor = size?.unit === 'ml' || size?.unit === 'g' ? 1000 : 1
    changes = {
      prices,
      storesCount: availableValues.length,
      available: availableValues.length > 0,
      medianFils,
      minFils: availableValues.length ? Math.min(...availableValues) : medianFils,
      maxFils: availableValues.length ? Math.max(...availableValues) : medianFils,
      unitPriceFils: size && size.unit !== 'pcs' && size.baseQuantity > 0 ? Math.round(medianFils * unitFactor / size.baseQuantity) : null,
      __manual: true,
    }
  } else {
    const nameAr = typeof payload.nameAr === 'string' ? payload.nameAr.trim().slice(0, 1_000) : ''
    const nameEn = typeof payload.nameEn === 'string' ? payload.nameEn.trim().slice(0, 1_000) : ''
    if (!nameAr && !nameEn) return NextResponse.json({ error: 'name_fields_required' }, { status: 422 })
    changes = {
      ...deriveProductOverride(product, cur, {
        nameAr: nameAr || product.nameAr,
        nameEn: nameEn || product.nameEn,
      }),
      __manual: true,
    }
  }
  const next: Record<string, unknown> = { ...cur, ...changes }
  await db.$transaction(async (tx) => {
    await tx.productOverride.upsert({ where: { id: contrib.productId! }, create: { id: contrib.productId!, data: JSON.stringify(next) }, update: { data: JSON.stringify(next) } })
    await tx.auditEntry.create({ data: { actor, action: 'moderate', targetType: 'product', targetId: contrib.productId!, before: existing?.data ?? null, after: JSON.stringify(next) } })
    await tx.contribution.update({ where: { id }, data: { status: 'approved', reviewedAt: new Date(), reviewedBy: actor, reviewNote: note } })
  })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true, status: 'approved', appliedToCatalog: true, productId: contrib.productId })
}
