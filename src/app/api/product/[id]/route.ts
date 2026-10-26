import { NextRequest, NextResponse } from 'next/server'
import { getProduct, getCatalog, searchProducts } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const product = await getProduct(id)
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const catalog = await getCatalog()
  const storeMap = new Map(catalog.stores.map((s) => [s.id, s]))
  const prices = Object.entries(product.prices).map(([storeId, p]) => ({
    storeId,
    storeNameAr: storeMap.get(storeId)?.nameAr ?? storeId,
    storeNameEn: storeMap.get(storeId)?.nameEn ?? storeId,
    fils: p.fils,
    origFils: p.origFils,
    url: p.url,
  })).sort((a, b) => a.fils - b.fils)
  // similar products in same need/category
  const similar = product.need
    ? await searchProducts({ need: product.need, sort: 'popularity', limit: 7 })
    : await searchProducts({ category: product.category, sort: 'popularity', limit: 7 })
  return NextResponse.json({
    product,
    prices,
    similar: similar.items.filter((p) => p.id !== product.id).slice(0, 6),
  })
}
