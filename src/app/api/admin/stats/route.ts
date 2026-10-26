import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-auth'
import { db } from '@/lib/db'
import { getCatalog } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

/** admin dashboard stats (spec 8.2) */
export async function GET(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  const catalog = await getCatalog()
  const [contribPending, contribTotal, imports, sharedCount, auditCount] = await Promise.all([
    db.contribution.count({ where: { status: 'pending' } }),
    db.contribution.count(),
    db.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    db.sharedPlan.count(),
    db.auditEntry.count(),
  ])

  const withSize = catalog.products.filter((p) => p.size).length
  const withNeed = catalog.products.filter((p) => p.need).length
  const needs30 = catalog.products.filter((p) => p.need && p.need.startsWith('cat.')).length
  const byCategory = catalog.categories.map((c) => ({
    id: c.id, nameAr: c.nameAr, priority: c.priority,
    count: catalog.products.filter((p) => p.category === c.id).length,
  })).sort((a, b) => b.count - a.count)

  return NextResponse.json({
    catalog: {
      version: catalog.version,
      productCount: catalog.products.length,
      withSize, withNeed, fallbackNeeds: needs30,
      stores: catalog.stores.length,
      categories: catalog.categories.length,
    },
    contributions: { pending: contribPending, total: contribTotal },
    imports: imports.map((i) => ({ id: i.id, source: i.source, format: i.format, mode: i.mode, stats: JSON.parse(i.stats ?? '{}'), createdAt: i.createdAt, appliedAt: i.appliedAt })),
    sharedPlans: sharedCount,
    auditEntries: auditCount,
    byCategory,
  })
}
