import { NextResponse } from 'next/server'
import { getCatalog } from '@/lib/server/catalog'
import { GENERIC_GROUPS, NEEDS } from '@/lib/engine'

export const dynamic = 'force-dynamic'

/** lightweight catalog meta for the client (categories, stores, groups, needs, brands) */
export async function GET() {
  const catalog = await getCatalog()
  // brand registry for the advanced preferences page (365 brands w/ product counts)
  const brandMap = new Map<string, { brand: string; count: number; topCategoryId: string }>()
  for (const p of catalog.products) {
    if (!p.brand) continue
    const b = brandMap.get(p.brand) ?? { brand: p.brand, count: 0, topCategoryId: p.category }
    b.count += 1
    brandMap.set(p.brand, b)
  }
  const brands = [...brandMap.values()]
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand))
    .slice(0, 400)
  return NextResponse.json({
    version: catalog.version,
    generatedAt: catalog.generatedAt,
    currency: catalog.currency,
    productCount: catalog.products.length,
    categories: catalog.categories,
    stores: catalog.stores,
    groups: GENERIC_GROUPS.map((g) => ({ id: g.id, nameAr: g.nameAr, nameEn: g.nameEn, icon: g.icon, parent: g.parent ?? null, clazz: g.clazz })),
    needs: NEEDS.map((n) => ({ id: n.id, nameAr: n.nameAr, nameEn: n.nameEn, baseUnit: n.baseUnit, clazz: n.clazz, visibleInWizard: n.visibleInWizard ?? false })),
    brands,
  })
}
