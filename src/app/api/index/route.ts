import { NextResponse } from 'next/server'
import { getCatalog } from '@/lib/server/catalog'
import { NEEDS_MAP } from '@/lib/engine'

export const dynamic = 'force-dynamic'

/**
 * Price index & standard baskets (spec 7.12): compute basket costs per store
 * from the live catalog. Baskets: family-4, infant, student.
 */
export async function GET() {
  const catalog = await getCatalog()
  const stores = catalog.stores.filter((s) => s.active)

  interface BasketItem { needId: string; qty: number }
  const baskets: { id: string; nameAr: string; items: BasketItem[] }[] = [
    {
      id: 'family-4', nameAr: 'سلة أسرة من 4 أفراد',
      items: [
        { needId: 'milk.uht.full', qty: 12000 }, { needId: 'eggs', qty: 90 },
        { needId: 'rice', qty: 14000 }, { needId: 'oil', qty: 3200 },
        { needId: 'sugar', qty: 3500 }, { needId: 'flour', qty: 3500 },
        { needId: 'chicken', qty: 12000 }, { needId: 'vegetables', qty: 22000 },
        { needId: 'fruits', qty: 16000 }, { needId: 'bread', qty: 140 },
        { needId: 'water', qty: 150000 }, { needId: 'tea', qty: 300 },
        { needId: 'laban', qty: 7000 }, { needId: 'toilet-paper', qty: 38 },
        { needId: 'laundry', qty: 3000 }, { needId: 'dish-soap', qty: 2200 },
      ],
    },
    {
      id: 'infant', nameAr: 'سلة رضيع (شهر واحد)',
      items: [
        { needId: 'diapers@3', qty: 200 }, { needId: 'formula@2', qty: 2500 },
        { needId: 'baby-wipes', qty: 2100 },
      ],
    },
    {
      id: 'student', nameAr: 'سلة طالب (شهر)',
      items: [
        { needId: 'milk.uht.full', qty: 5000 }, { needId: 'eggs', qty: 30 },
        { needId: 'rice', qty: 3000 }, { needId: 'pasta', qty: 2000 },
        { needId: 'chicken', qty: 4000 }, { needId: 'bread', qty: 45 },
        { needId: 'water', qty: 45000 }, { needId: 'coffee', qty: 250 },
        { needId: 'toilet-paper', qty: 10 },
      ],
    },
  ]

  // cheapest product per need (by unit price where available)
  const cheapestByNeed = new Map<string, { fils: number; perUnit: number; productId: string; name: string }>()
  for (const p of catalog.products) {
    if (!p.need || p.available !== true) continue
    const per = p.unitPriceFils ?? (p.medianFils > 0 && p.size ? Math.round(p.medianFils * 1000 / Math.max(1, p.size.baseQuantity)) : null)
    if (per == null || per <= 0) continue
    const cur = cheapestByNeed.get(p.need)
    if (!cur || per < cur.perUnit) cheapestByNeed.set(p.need, { perUnit: per, fils: p.medianFils, productId: p.id, name: p.nameAr || p.nameEn })
  }

  const results = baskets.map((basket) => {
    const perStore = stores.map((store) => {
      // for each basket need, cheapest product IN THIS STORE available
      let total = 0
      let covered = 0
      for (const item of basket.items) {
        const base = item.needId.split('@')[0]!
        let bestFils: number | null = null
        let bestPer: number | null = null
        for (const p of catalog.products) {
          if (p.need !== base || !p.prices[store.id]?.fils) continue
          if (item.needId.includes('@')) {
            const variant = item.needId.split('@')[1]!
            if (base === 'diapers') {
              const tag = p.tags.find((t) => t.startsWith('diaper:size='))
              if (tag && tag.split('=')[1] !== variant) continue
            }
            if (base === 'formula') {
              const tag = p.tags.find((t) => t.startsWith('baby:stage='))
              if (tag && tag.split('=')[1] !== variant) continue
            }
          }
          const size = p.size?.baseQuantity ?? 0
          if (size <= 0) continue
          const per = (p.prices[store.id]!.fils * 1000) / size
          if (bestPer == null || per < bestPer) { bestPer = per; bestFils = p.prices[store.id]!.fils }
        }
        if (bestFils != null && bestPer != null) {
          total += Math.round((bestPer / 1000) * item.qty)
          covered++
        }
      }
      return { storeId: store.id, storeNameAr: store.nameAr, totalFils: total, covered, itemCount: basket.items.length }
    }).sort((a, b) => a.totalFils - b.totalFils)
    return { id: basket.id, nameAr: basket.nameAr, stores: perStore }
  })

  // overall price stats per category (median of medians) for the index view
  const catStats = catalog.categories.map((cat) => {
    const medians = catalog.products.filter((p) => p.category === cat.id && p.medianFils > 0).map((p) => p.medianFils).sort((a, b) => a - b)
    const med = medians.length ? medians[Math.floor(medians.length / 2)]! : 0
    return { category: cat.id, nameAr: cat.nameAr, count: medians.length, medianFils: med }
  })

  return NextResponse.json({
    currency: catalog.currency,
    version: catalog.version,
    baskets: results,
    categoryStats: catStats.sort((a, b) => b.count - a.count),
  })
}
