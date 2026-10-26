import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCatalog } from '@/lib/server/catalog'
import { generatePlan, DEFAULT_CONFIG } from '@/lib/engine'
import type { BudgetEnvelope, EngineInput, Household, LockedChoice, PantryItem, PlanContext, Budget } from '@/lib/engine/types'
import { normalizeAdvanced } from '@/lib/engine/advanced'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NeedOverrideSchema = z.object({
  mode: z.enum(['auto', 'mult', 'abs']).default('auto'),
  mult: z.number().min(0).max(3).optional(),
  abs: z.number().min(0).optional(),
})

const AdvancedSchema = z.object({
  v: z.number().default(1),
  enabled: z.boolean().default(true),
  needOverrides: z.record(z.string(), NeedOverrideSchema).default({}),
  diet: z.record(z.string(), z.boolean()).default({}),
  categoryTiers: z.record(z.string(), z.enum(['auto', 'econ', 'standard', 'premium'])).default({}),
  weights: z.object({
    target: z.number().min(0).max(100).default(40),
    value: z.number().min(0).max(100).default(12),
    quality: z.number().min(0).max(100).default(28),
    brand: z.number().min(0).max(100).default(10),
    local: z.number().min(0).max(100).default(10),
  }).default({ target: 40, value: 12, quality: 28, brand: 10, local: 10 }),
  allocation: z.object({
    grains: z.number().min(0).max(100).default(18),
    protein: z.number().min(0).max(100).default(26),
    dairy: z.number().min(0).max(100).default(9),
    produce: z.number().min(0).max(100).default(16),
    fats: z.number().min(0).max(100).default(4),
    pantry: z.number().min(0).max(100).default(11),
    cleaning: z.number().min(0).max(100).default(10),
    treats: z.number().min(0).max(100).default(6),
    enforce: z.boolean().default(false),
  }).default({ grains: 18, protein: 26, dairy: 9, produce: 16, fats: 4, pantry: 11, cleaning: 10, treats: 6, enforce: false }),
  lifestyle: z.object({
    homeCookingPct: z.number().min(0).max(100).nullable().default(null),
    sweetToothPct: z.number().min(0).max(200).default(100),
    snacksLevelPct: z.number().min(0).max(200).default(100),
    wasteTolerancePct: z.number().min(0).max(30).nullable().default(null),
    tripsPreference: z.enum(['monthly', 'biweekly', 'weekly', 'twice-weekly', 'auto']).default('auto'),
    reservePct: z.number().min(0).max(15).nullable().default(null),
    treatCapPct: z.number().min(0).max(20).nullable().default(null),
    varietyLevel: z.number().min(0).max(100).default(50),
    packSizeBias: z.enum(['auto', 'small', 'medium', 'large']).default('auto'),
    customModeOffsetPct: z.number().min(-35).max(25).default(0),
  }).default({ homeCookingPct: null, sweetToothPct: 100, snacksLevelPct: 100, wasteTolerancePct: null, tripsPreference: 'auto', reservePct: null, treatCapPct: null, varietyLevel: 50, packSizeBias: 'auto', customModeOffsetPct: 0 }),
  stores: z.object({
    banned: z.array(z.string()).default([]),
    preferred: z.array(z.string()).default([]),
    maxSplitStores: z.number().int().min(1).max(3).default(3),
    includeDeliveryFees: z.boolean().default(true),
  }).default({ banned: [], preferred: [], maxSplitStores: 3, includeDeliveryFees: true }),
})

const HouseholdSchema = z.object({
  familyName: z.string().optional(),
  members: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    ageMonths: z.number().int().min(0).max(1440),
    gender: z.enum(['m', 'f']).optional(),
    activity: z.enum(['low', 'medium', 'high']).optional(),
    specials: z.array(z.string()).default([]),
  })),
  habits: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))).default({}),
  dietary: z.object({
    halalOnly: z.boolean().default(true),
    sugarFree: z.boolean().optional(),
    lowSodium: z.boolean().optional(),
    glutenFree: z.boolean().optional(),
    lactoseFree: z.boolean().optional(),
    nutFree: z.boolean().optional(),
  }),
  prefs: z.object({
    favoriteBrands: z.array(z.string()).default([]),
    blockedBrands: z.array(z.string()).default([]),
    blockedProducts: z.array(z.string()).default([]),
    qualityBias: z.record(z.string(), z.number()).default({}),
    globalQualityBias: z.number().default(0),
    brandAffinity: z.record(z.string(), z.number()).optional(),
  }),
  eatingOutPerWeek: z.number().min(0).max(21).default(2),
  guestsPerMonth: z.number().min(0).max(120).default(4),
  hasWaterDispenser: z.boolean().default(false),
  storage: z.enum(['small', 'medium', 'large']).default('medium'),
})

const BudgetSchema = z.object({
  fils: z.number().int().min(0).max(1_000_000_000),
  period: z.enum(['week', 'biweekly', 'month', 'custom']).default('month'),
  horizonDays: z.number().int().min(1).max(120).default(30),
  paydayWeekday: z.number().int().min(0).max(6).optional(),
  flexibilityPct: z.number().min(0).max(0.3).default(0),
  reservePct: z.number().min(0).max(0.3).default(0.05),
})

const EnvelopeSchema = z.object({
  id: z.string(),
  name: z.string(),
  groups: z.array(z.string()).default([]),
  mode: z.enum(['range', 'fixed', 'quantity', 'frequency']).default('range'),
  minFils: z.number().int().optional(),
  maxFils: z.number().int().optional(),
  fixedFils: z.number().int().optional(),
  quantity: z.object({ value: z.number(), unit: z.string(), needId: z.string().optional() }).optional(),
  frequency: z.object({ perPeriod: z.number(), period: z.enum(['week', 'month']) }).optional(),
  priority: z.enum(['must', 'high', 'normal', 'ifLeft']).default('ifLeft'),
  fillToMax: z.boolean().default(false),
  preferences: z.object({
    avoidTags: z.array(z.string()).optional(),
    sizeBias: z.enum(['small', 'medium', 'large']).optional(),
    tierBias: z.enum(['econ', 'mid', 'premium']).optional(),
    variety: z.enum(['low', 'normal', 'high']).optional(),
  }).optional(),
  audience: z.array(z.enum(['adults', 'kids', 'all'])).optional(),
})

const PlanBodySchema = z.object({
  household: HouseholdSchema,
  budget: BudgetSchema,
  mode: z.enum(['crisis', 'economy', 'balanced', 'comfortable', 'custom']).default('balanced'),
  season: z.enum(['normal', 'ramadan', 'eid', 'back-to-school', 'summer']).default('normal'),
  storeMode: z.enum(['median', 'best-single', 'split']).default('median'),
  availableStores: z.array(z.string()).default([]),
  delivery: z.boolean().default(true),
  locks: z.array(z.object({
    productId: z.string(),
    qty: z.number().int().positive().optional(),
    fromEnvelopeId: z.string().optional(),
  })).default([]),
  envelopes: z.array(EnvelopeSchema).default([]),
  pantry: z.array(z.object({
    id: z.string(),
    productId: z.string().optional(),
    name: z.string(),
    needId: z.string().optional(),
    qtyBaseUnit: z.number().min(0),
    unit: z.enum(['ml', 'g', 'pcs', 'sheets', 'rolls', 'bags']).default('pcs'),
    addedAtISO: z.string().default(''),
  })).default([]),
  seed: z.number().int().default(42),
  dateISO: z.string().optional(),
  advanced: AdvancedSchema.optional(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PlanBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.slice(0, 5) }, { status: 400 })
  }
  const b = parsed.data
  try {
    const catalog = await getCatalog()
    const context: PlanContext = {
      dateISO: b.dateISO ?? new Date().toISOString().slice(0, 10),
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
    return NextResponse.json({ error: 'engine_error', message: String(err) }, { status: 500 })
  }
}
