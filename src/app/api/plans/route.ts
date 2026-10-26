import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCatalog } from '@/lib/server/catalog'
import { generatePlan, DEFAULT_CONFIG } from '@/lib/engine'
import { normalizeAdvanced } from '@/lib/engine/advanced'
import type { BudgetEnvelope, EngineInput, Household } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'

const ShareSchema = z.object({
  title: z.string().min(1).max(120),
  familyName: z.string().max(80).optional(),
  authorName: z.string().max(80).optional(),
  household: z.record(z.string(), z.unknown()),
  budget: z.record(z.string(), z.unknown()),
  envelopes: z.array(z.record(z.string(), z.unknown())).default([]),
  mode: z.enum(['crisis', 'economy', 'balanced', 'comfortable', 'custom']).default('balanced'),
  season: z.string().default('normal'),
  storeMode: z.string().default('median'),
  availableStores: z.array(z.string()).default([]),
  locks: z.array(z.record(z.string(), z.unknown())).default([]),
  /** advanced preferences profile — travels with the share so the plan reproduces exactly */
  advanced: z.record(z.string(), z.unknown()).optional(),
  isAnonymous: z.boolean().default(true),
})

function slugify(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

/** GET: community gallery list */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const sort = sp.get('sort') ?? 'recent'
  const mine = sp.get('mine') ?? undefined
  const rows = await db.sharedPlan.findMany({
    where: { isPublic: true },
    orderBy: sort === 'likes' ? { likes: 'desc' } : { createdAt: 'desc' },
    take: Math.min(Number(sp.get('limit') ?? 24), 60),
  })
  const items = rows
    .filter((r) => !mine || JSON.parse(r.stats ?? '{}')?.userKey === mine)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      familyName: r.familyName,
      authorName: r.authorName,
      likes: r.likes,
      forks: r.forks,
      createdAt: r.createdAt,
      stats: JSON.parse(r.stats ?? '{}'),
    }))
  return NextResponse.json({ items })
}

/** POST: share a plan (community gallery; the full household data is stored server-side only on explicit share) */
export async function POST(req: NextRequest) {
  const parsed = ShareSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 4) }, { status: 400 })
  }
  const b = parsed.data
  // regenerate the plan server-side from the shared inputs (no client tampering of results)
  const catalog = await getCatalog()
  try {
    const input: EngineInput = {
      catalog,
      household: b.household as unknown as Household,
      budget: b.budget as unknown as EngineInput['budget'],
      context: {
        dateISO: new Date().toISOString().slice(0, 10),
        season: (b.season as EngineInput['context']['season']) ?? 'normal',
        storeMode: (b.storeMode as EngineInput['context']['storeMode']) ?? 'median',
        availableStores: b.availableStores,
        delivery: true,
      },
      config: DEFAULT_CONFIG,
      locks: b.locks as unknown as EngineInput['locks'],
      envelopes: b.envelopes as unknown as BudgetEnvelope[],
      mode: b.mode,
      advanced: b.advanced ? normalizeAdvanced(b.advanced) : undefined,
      seed: 42,
    }
    const plan = generatePlan(input)
    const stats = {
      costFils: plan.totals.costFils,
      items: plan.items.length + plan.fixedItems.length + plan.envelopes.length,
      members: (b.household as { members?: unknown[] })?.members?.length ?? 0,
      mode: b.mode,
      coverage: plan.totals.coverageEssentials,
      wastePct: plan.totals.wastePct,
    }
    const row = await db.sharedPlan.create({
      data: {
        slug: slugify(),
        title: b.title,
        familyName: b.isAnonymous ? null : b.familyName ?? null,
        authorName: b.isAnonymous ? null : b.authorName ?? null,
        payload: JSON.stringify({ household: b.household, budget: b.budget, envelopes: b.envelopes, mode: b.mode, season: b.season, storeMode: b.storeMode, availableStores: b.availableStores, locks: b.locks, advanced: b.advanced ?? null }),
        stats: JSON.stringify(stats),
      },
    })
    return NextResponse.json({ id: row.id, slug: row.slug, stats })
  } catch (err) {
    return NextResponse.json({ error: 'share_failed', message: String(err) }, { status: 500 })
  }
}
