import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { searchProducts, bumpCatalogRev, stableId } from '@/lib/server/catalog'
import { normalizeArabic } from '@/lib/engine/normalize'
import { parseSize } from '@/lib/engine/size'
import { classifyNeed, extractTags } from '@/lib/engine/needs'
import type { CatalogProduct } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'

/** admin products list (uses the shared search) */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const result = await searchProducts({
    q: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
    need: sp.get('need') ?? undefined,
    sort: (sp.get('sort') as 'relevance' | 'price-asc' | 'price-desc' | 'unit-asc' | 'popularity' | null) ?? 'relevance',
    limit: Math.min(Number(sp.get('limit') ?? 50), 100),
    offset: Number(sp.get('offset') ?? 0),
  })
  return NextResponse.json(result)
}

/** admin: create product (overlay with added:true) or bulk-update */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  const actor = String(body.actor ?? 'admin')

  if (body.bulk && Array.isArray(body.items)) {
    // bulk update: [{ id, patch }]
    let applied = 0
    for (const it of body.items.slice(0, 500)) {
      if (!it?.id) continue
      const existing = await db.productOverride.findUnique({ where: { id: it.id } })
      const cur = existing ? JSON.parse(existing.data) : {}
      const next = { ...cur, ...it.patch }
      await db.productOverride.upsert({ where: { id: it.id }, create: { id: it.id, data: JSON.stringify(next) }, update: { data: JSON.stringify(next) } })
      await db.auditEntry.create({ data: { actor, action: 'update', targetType: 'product', targetId: it.id, before: existing?.data ?? null, after: JSON.stringify(next) } })
      applied++
    }
    await bumpCatalogRev()
    return NextResponse.json({ ok: true, applied })
  }

  // single product create
  const nameAr = String(body.nameAr ?? '').trim()
  const nameEn = String(body.nameEn ?? '').trim()
  if (!nameAr && !nameEn) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const category = String(body.category ?? 'pantry-other')
  const brand = body.brand ? String(body.brand).trim() : null
  const sizeText = body.sizeText ? String(body.sizeText) : null
  const size = sizeText ? parseSize(sizeText) : null
  const flavors: string[] = []
  const need = body.need ? String(body.need) : classifyNeed(nameEn, nameAr, brand, category, flavors)
  const tags = extractTags(nameEn, nameAr, flavors, sizeText)
  const prices: Record<string, { fils: number; available?: boolean }> = {}
  for (const [sid, p] of Object.entries(body.prices ?? {})) {
    const fils = Number((p as { fils?: number })?.fils ?? 0)
    if (fils > 0) prices[sid] = { fils: Math.round(fils) }
  }
  const priceVals = Object.values(prices).map((p) => p.fils)
  const medianFils = body.medianFils ? Math.round(Number(body.medianFils)) : priceVals.length ? Math.round(priceVals.reduce((s, x) => s + x, 0) / priceVals.length) : 0
  if (medianFils <= 0) return NextResponse.json({ error: 'price_required' }, { status: 400 })
  let unitPriceFils: number | null = null
  if (size && size.baseQuantity > 0 && size.unit !== 'pcs') {
    const per = size.unit === 'ml' ? 1000 : size.unit === 'g' ? 1000 : 1
    unitPriceFils = Math.round((medianFils * per) / size.baseQuantity)
  }
  const data: Partial<CatalogProduct> & { added?: boolean } = {
    added: true,
    nameAr, nameEn,
    nameNorm: normalizeArabic(`${nameAr} ${nameEn} ${brand ?? ''}`),
    brand, brandNorm: brand ? normalizeArabic(brand) : null,
    category, sizeText, size, tags, flavors, need,
    medianFils, minFils: Math.min(medianFils, ...priceVals), maxFils: Math.max(medianFils, ...priceVals),
    prices, storesCount: priceVals.length || 1, unitPriceFils,
    rank: Number(body.rank ?? 500), available: true, dataConfidence: 0.95,
  }
  const id = String(body.id ?? stableId([category, brand ?? '', normalizeArabic(nameEn || nameAr), 'manual', Date.now()]))
  await db.productOverride.upsert({ where: { id }, create: { id, data: JSON.stringify(data) }, update: { data: JSON.stringify(data) } })
  await db.auditEntry.create({ data: { actor, action: 'create', targetType: 'product', targetId: id, after: JSON.stringify(data) } })
  await bumpCatalogRev()
  return NextResponse.json({ ok: true, id })
}
