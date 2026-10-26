import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCatalog } from '@/lib/server/catalog'
import { generatePlan, DEFAULT_CONFIG } from '@/lib/engine'
import { normalizeAdvanced } from '@/lib/engine/advanced'
import type { BudgetEnvelope, EngineInput, Household } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const row = await db.sharedPlan.findUnique({ where: { slug } })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const input = JSON.parse(row.payload) as {
    household: Household; budget: EngineInput['budget']; envelopes: BudgetEnvelope[]
    mode: EngineInput['mode']; season: string; storeMode: string; availableStores: string[]; locks: EngineInput['locks']; advanced?: unknown
  }
  const catalog = await getCatalog()
  const plan = generatePlan({
    catalog,
    household: input.household,
    budget: input.budget,
    context: {
      dateISO: row.createdAt.toISOString().slice(0, 10),
      season: (input.season as EngineInput['context']['season']) ?? 'normal',
      storeMode: (input.storeMode as EngineInput['context']['storeMode']) ?? 'median',
      availableStores: input.availableStores ?? [],
      delivery: true,
    },
    config: DEFAULT_CONFIG,
    locks: input.locks ?? [],
    envelopes: input.envelopes ?? [],
    mode: input.mode ?? 'balanced',
    advanced: input.advanced ? normalizeAdvanced(input.advanced) : undefined,
    seed: 42,
  })
  return NextResponse.json({
    id: row.id,
    slug: row.slug,
    title: row.title,
    familyName: row.familyName,
    authorName: row.authorName,
    likes: row.likes,
    forks: row.forks,
    createdAt: row.createdAt,
    stats: JSON.parse(row.stats ?? '{}'),
    input,
    plan,
  })
}
