import { NextRequest, NextResponse } from 'next/server'
import { getCatalog } from '@/lib/server/catalog'
import { generatePlan, DEFAULT_CONFIG } from '@/lib/engine'
import type { BudgetEnvelope, EngineInput, Household, LockedChoice, PantryItem, PlanContext, Budget } from '@/lib/engine/types'
import { normalizeAdvanced } from '@/lib/engine/advanced'
import { PlanBodySchema } from '@/lib/validation/plan-input'
import { readJsonLimited } from '@/lib/server/request-body'
import { rateLimit } from '@/lib/server/rate-limit'
import { dateISOInTimeZone } from '@/lib/time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'plan', 60, 60_000)
  if (limited) return limited
  const bodyResult = await readJsonLimited(req, 512 * 1024)
  if (!bodyResult.ok) return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status })
  const body = bodyResult.value
  const parsed = PlanBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 5) }, { status: 400 })
  }
  const b = parsed.data
  try {
    const catalog = await getCatalog()
    const activeStoreIds = new Set(catalog.stores.filter((store) => store.active).map((store) => store.id))
    const invalidStores = b.availableStores.filter((storeId) => !activeStoreIds.has(storeId))
    if (invalidStores.length) return NextResponse.json({ error: 'unknown_or_inactive_store', storeIds: invalidStores.slice(0, 10) }, { status: 422 })
    const productIds = new Set(catalog.products.map((product) => product.id))
    const invalidLocks = b.locks.filter((lock) => !productIds.has(lock.productId))
    if (invalidLocks.length) return NextResponse.json({ error: 'unknown_locked_product', productIds: invalidLocks.slice(0, 10).map((lock) => lock.productId) }, { status: 422 })
    const context: PlanContext = {
      dateISO: b.dateISO ?? dateISOInTimeZone(),
      season: b.season,
      storeMode: b.storeMode,
      availableStores: b.availableStores,
      delivery: b.delivery,
    }
    const budget: Budget = {
      fils: b.budget.fils,
      period: b.budget.period,
      horizonDays: b.budget.horizonDays,
      paydayWeekday: b.budget.paydayWeekday,
      flexibilityPct: b.budget.flexibilityPct,
      reservePct: b.budget.reservePct,
    }
    const household = b.household as unknown as Household
    const input: EngineInput = {
      catalog,
      household,
      budget,
      context,
      config: DEFAULT_CONFIG,
      locks: b.locks as LockedChoice[],
      envelopes: b.envelopes as unknown as BudgetEnvelope[],
      pantry: b.pantry as unknown as PantryItem[],
      mode: b.mode,
      seed: b.seed,
      advanced: b.advanced ? normalizeAdvanced(b.advanced) : undefined,
    }
    const t0 = Date.now()
    const plan = generatePlan(input)
    const ms = Date.now() - t0
    return NextResponse.json({ plan, engineMs: ms })
  } catch (err) {
    console.error('plan generation failed', err)
    return NextResponse.json({ error: 'engine_error' }, { status: 500 })
  }
}
