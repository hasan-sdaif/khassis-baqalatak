import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCatalog } from '@/lib/server/catalog'
import { generatePlan, DEFAULT_CONFIG, getAllPlanItems } from '@/lib/engine'
import { normalizeAdvanced } from '@/lib/engine/advanced'
import type { BudgetEnvelope, EngineInput, Household, PantryItem } from '@/lib/engine/types'
import { PlanShareSchema } from '@/lib/validation/plan-input'
import { readJsonLimited } from '@/lib/server/request-body'
import { dateISOInTimeZone } from '@/lib/time'

export const dynamic = 'force-dynamic'

function safeStats(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** GET: public gallery. Corrupt historical rows are isolated rather than breaking the whole gallery. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const sort = sp.get('sort') === 'likes' ? 'likes' : 'recent'
  const requested = Number.parseInt(sp.get('limit') ?? '24', 10)
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 60)) : 24
  const rows = await db.sharedPlan.findMany({
    where: { isPublic: true },
    orderBy: sort === 'likes' ? { likes: 'desc' } : { createdAt: 'desc' },
    take: limit,
  })
  const items = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    familyName: r.familyName,
    authorName: r.authorName,
    likes: r.likes,
    forks: r.forks,
    createdAt: r.createdAt,
    stats: safeStats(r.stats),
  }))
  return NextResponse.json({ items })
}

/** POST: publish only after an explicit, validated household-data consent. */
export async function POST(req: NextRequest) {
  const body = await readJsonLimited(req, 512 * 1024)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
  const parsed = PlanShareSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 })
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
    // Remove potentially identifying names before public storage while retaining data needed to recalculate the plan.
    const householdForPublication: Household = {
      ...b.household,
      familyName: undefined,
      members: b.household.members.map((member, index) => ({
        ...member,
        id: `shared-member-${index + 1}`,
        name: undefined,
      })),
    } as Household
    const dateISO = b.dateISO ?? dateISOInTimeZone()
    const input: EngineInput = {
      catalog,
      household: householdForPublication,
      budget: b.budget as EngineInput['budget'],
      context: {
        dateISO,
        season: b.season,
        storeMode: b.storeMode,
        availableStores: b.availableStores,
        delivery: b.delivery,
      },
      config: DEFAULT_CONFIG,
      locks: b.locks,
      envelopes: b.envelopes as BudgetEnvelope[],
      pantry: b.pantry as PantryItem[],
      mode: b.mode,
      advanced: b.advanced ? normalizeAdvanced(b.advanced) : undefined,
      seed: 42,
    }
    const plan = generatePlan(input)
    const stats = {
      costFils: plan.totals.costFils,
      items: getAllPlanItems(plan).length,
      members: householdForPublication.members.length,
      mode: b.mode,
      coverage: plan.totals.coverageEssentials,
      wastePct: plan.totals.wastePct,
      dateISO,
    }
    const row = await db.sharedPlan.create({
      data: {
        slug: `p-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        title: b.title,
        familyName: b.isAnonymous ? null : b.familyName ?? null,
        authorName: b.isAnonymous ? null : b.authorName ?? null,
        payload: JSON.stringify({
          household: householdForPublication,
          budget: b.budget,
          envelopes: b.envelopes,
          mode: b.mode,
          season: b.season,
          storeMode: b.storeMode,
          availableStores: b.availableStores,
          delivery: b.delivery,
          locks: b.locks,
          pantry: b.pantry,
          advanced: b.advanced ?? null,
          dateISO,
        }),
        stats: JSON.stringify(stats),
      },
    })
    return NextResponse.json({ id: row.id, slug: row.slug, stats })
  } catch (err) {
    console.error('plan sharing failed', err)
    return NextResponse.json({ error: 'share_failed' }, { status: 500 })
  }
}
