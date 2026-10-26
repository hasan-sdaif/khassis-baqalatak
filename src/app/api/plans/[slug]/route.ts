import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCatalog } from '@/lib/server/catalog'
import { generatePlan, DEFAULT_CONFIG, getAllPlanItems } from '@/lib/engine'
import { normalizeAdvanced } from '@/lib/engine/advanced'
import type { BudgetEnvelope, EngineInput, Household, PantryItem } from '@/lib/engine/types'
import { dateISOInTimeZone } from '@/lib/time'

export const dynamic = 'force-dynamic'

function safeObject(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  if (!/^[a-zA-Z0-9_-]{5,80}$/.test(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = await db.sharedPlan.findUnique({ where: { slug } })
  if (!row || !row.isPublic) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let input: {
    household: Household; budget: EngineInput['budget']; envelopes?: BudgetEnvelope[]
    mode?: EngineInput['mode']; season?: EngineInput['context']['season']; storeMode?: EngineInput['context']['storeMode']
    availableStores?: string[]; delivery?: boolean; locks?: EngineInput['locks']; pantry?: PantryItem[]; advanced?: unknown; dateISO?: string
  }
  try {
    input = JSON.parse(row.payload) as typeof input
  } catch {
    console.error('shared plan payload is invalid', { slug: row.slug })
    return NextResponse.json({ error: 'plan_data_unavailable' }, { status: 500 })
  }

  try {
    const catalog = await getCatalog()
    const validStoreIds = new Set(catalog.stores.filter((store) => store.active).map((store) => store.id))
    const availableStores = (input.availableStores ?? []).filter((storeId) => validStoreIds.has(storeId))
    const validProductIds = new Set(catalog.products.map((product) => product.id))
    const locks = (input.locks ?? []).filter((lock) => validProductIds.has(lock.productId))
    const dateISO = input.dateISO ?? dateISOInTimeZone(row.createdAt)
    const plan = generatePlan({
      catalog,
      household: input.household,
      budget: input.budget,
      context: {
        dateISO,
        season: input.season ?? 'normal',
        storeMode: input.storeMode ?? 'median',
        availableStores,
        delivery: input.delivery ?? true,
      },
      config: DEFAULT_CONFIG,
      locks,
      envelopes: input.envelopes ?? [],
      pantry: input.pantry ?? [],
      mode: input.mode ?? 'balanced',
      advanced: input.advanced ? normalizeAdvanced(input.advanced) : undefined,
      seed: 42,
    })
    const stats = safeObject(row.stats)
    return NextResponse.json({
      id: row.id,
      slug: row.slug,
      title: row.title,
      familyName: row.familyName,
      authorName: row.authorName,
      likes: row.likes,
      forks: row.forks,
      createdAt: row.createdAt,
      stats: { ...stats, items: getAllPlanItems(plan).length, costFils: plan.totals.costFils },
      input,
      plan,
    })
  } catch (err) {
    console.error('shared plan regeneration failed', err)
    return NextResponse.json({ error: 'plan_regeneration_failed' }, { status: 500 })
  }
}
