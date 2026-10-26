import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { searchProducts, bumpCatalogRev, stableId, getProduct, getCatalog } from '@/lib/server/catalog'
import type { CatalogProduct } from '@/lib/engine/types'
import { requireAdmin } from '@/lib/server/admin-auth'
import { readJsonLimited } from '@/lib/server/request-body'
import { ProductBulkSchema, ProductCreateSchema } from '@/lib/validation/admin-product'
import { deriveProductOverride } from '@/lib/server/product-overlay'
import { normalizeArabic } from '@/lib/engine/normalize'
import { parseSize } from '@/lib/engine/size'
import { classifyNeed, extractTags } from '@/lib/engine/needs'

export const dynamic = 'force-dynamic'

/** Admin product search. All query parameters are bounded before reaching catalog search. */
export async function GET(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const sp = req.nextUrl.searchParams
  const rawLimit = Number.parseInt(sp.get('limit') ?? '50', 10)
  const rawOffset = Number.parseInt(sp.get('offset') ?? '0', 10)
  const sortValue = sp.get('sort')
  const allowedSorts = ['relevance', 'price-asc', 'price-desc', 'unit-asc', 'popularity'] as const
  const sort = allowedSorts.includes(sortValue as typeof allowedSorts[number]) ? sortValue as typeof allowedSorts[number] : 'relevance'
  const result = await searchProducts({
    q: (sp.get('q') ?? '').slice(0, 180) || undefined,
    category: (sp.get('category') ?? '').slice(0, 200) || undefined,
    need: (sp.get('need') ?? '').slice(0, 250) || undefined,
    sort,
    limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50,
    offset: Number.isFinite(rawOffset) ? Math.max(0, Math.min(rawOffset, 1_000_000)) : 0,
  })
  return NextResponse.json(result)
}

/** Admin: create a product or apply a validated atomic batch of field updates. */
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const body = await readJsonLimited(req, 256 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const catalog = await getCatalog()
  const validCategory = (id: string) => catalog.categories.some((category) => category.id === id)
  const validStores = (ids: string[]) => ids.every((id) => catalog.stores.some((store) => store.id === id))

  if (body.value && typeof body.value === 'object' && !Array.isArray(body.value) && (body.value as Record<string, unknown>).bulk === true) {
    const parsedBulk = ProductBulkSchema.safeParse(body.value)
    if (!parsedBulk.success) return NextResponse.json({ error: 'invalid_bulk_patch' }, { status: 400 })
    const prepared: { id: string; before: Record<string, unknown>; after: Record<string, unknown>; oldData: string | null }[] = []
    for (const item of parsedBulk.data.items) {
      if (item.patch.category && !validCategory(item.patch.category)) return NextResponse.json({ error: 'unknown_category', productId: item.id }, { status: 422 })
      if (item.patch.prices && !validStores(Object.keys(item.patch.prices))) return NextResponse.json({ error: 'unknown_store', productId: item.id }, { status: 422 })
      const product = await getProduct(item.id)
      if (!product) return NextResponse.json({ error: 'product_not_found', productId: item.id }, { status: 404 })
      const existing = await db.productOverride.findUnique({ where: { id: item.id } })
      let before: Record<string, unknown> = {}
      try { before = existing ? JSON.parse(existing.data) as Record<string, unknown> : {} }
      catch { return NextResponse.json({ error: 'override_data_corrupt', productId: item.id }, { status: 409 }) }
      try { prepared.push({ id: item.id, before, after: deriveProductOverride(product, before, item.patch), oldData: existing?.data ?? null }) }
      catch { return NextResponse.json({ error: 'invalid_product_patch', productId: item.id }, { status: 400 }) }
    }
    await db.$transaction(async (tx) => {
      for (const item of prepared) {
        await tx.productOverride.upsert({ where: { id: item.id }, create: { id: item.id, data: JSON.stringify(item.after) }, update: { data: JSON.stringify(item.after) } })
        await tx.auditEntry.create({ data: { actor: 'admin-api-key', action: 'update', targetType: 'product', targetId: item.id, before: item.oldData, after: JSON.stringify(item.after) } })
      }
    })
    await bumpCatalogRev()
    return NextResponse.json({ ok: true, applied: prepared.length })
  }

  const parsed = ProductCreateSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_product', issues: parsed.error.issues.slice(0, 4).map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 })
  const input = parsed.data
  if (!validCategory(input.category)) return NextResponse.json({ error: 'unknown_category' }, { status: 422 })
  if (!validStores(Object.keys(input.prices))) return NextResponse.json({ error: 'unknown_store' }, { status: 422 })
  const nameAr = input.nameAr.trim()
  const nameEn = input.nameEn.trim()
  const category = input.category
  const brand = input.brand?.trim() || null
  const sizeText = input.sizeText?.trim() || null
  const size = parseSize(sizeText)
  const flavors: string[] = []
  const need = input.need?.trim() || classifyNeed(nameEn, nameAr, brand, category, flavors)
  const tags = extractTags(nameEn, nameAr, flavors, sizeText)
  const prices: Record<string, { fils: number; available?: boolean }> = {}
  for (const [sid, price] of Object.entries(input.prices)) prices[sid] = { fils: price.fils, ...(typeof price.available === 'boolean' ? { available: price.available } : {}) }
  const priceVals = Object.values(prices).filter((price) => price.available !== false).map((price) => price.fils)
  const sortedPriceVals = [...priceVals].sort((a, b) => a - b)
  const priceMiddle = Math.floor(sortedPriceVals.length / 2)
  const medianFils = sortedPriceVals.length
    ? (sortedPriceVals.length % 2 ? sortedPriceVals[priceMiddle] ?? input.medianFils : Math.round(((sortedPriceVals[priceMiddle - 1] ?? input.medianFils) + (sortedPriceVals[priceMiddle] ?? input.medianFils)) / 2))
    : input.medianFils
  let unitPriceFils: number | null = null
  if (size && size.baseQuantity > 0 && size.unit !== 'pcs') {
    const per = size.unit === 'ml' || size.unit === 'g' ? 1000 : 1
    unitPriceFils = Math.round((medianFils * per) / size.baseQuantity)
  }
  const data: Partial<CatalogProduct> & { added?: boolean } = {
    added: true,
    nameAr, nameEn,
    nameNorm: normalizeArabic(`${nameAr} ${nameEn} ${brand ?? ''}`),
    brand, brandNorm: brand ? normalizeArabic(brand) : null,
    category, sizeText, size, tags, flavors, need,
    medianFils,
    minFils: priceVals.length ? Math.min(medianFils, ...priceVals) : medianFils,
    maxFils: priceVals.length ? Math.max(medianFils, ...priceVals) : medianFils,
    prices, storesCount: priceVals.length,
    unitPriceFils, rank: 500, available: priceVals.length > 0, dataConfidence: 0.8,
  }
  const id = input.id ?? stableId([category, brand ?? '', normalizeArabic(nameEn || nameAr), 'manual'])
  const existing = await db.productOverride.findUnique({ where: { id } })
  let before: string | null = null
  if (existing) return NextResponse.json({ error: 'product_id_exists' }, { status: 409 })
  await db.$transaction(async (tx) => {
    await tx.productOverride.create({ data: { id, data: JSON.stringify(data) } })
    await tx.auditEntry.create({ data: { actor: 'admin-api-key', action: 'create', targetType: 'product', targetId: id, before, after: JSON.stringify(data) } })
  })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true, id })
}
