import { z } from 'zod'

/** Shared runtime contract for generating or explicitly sharing a grocery plan. */
export const NeedOverrideSchema = z.object({
  mode: z.enum(['auto', 'mult', 'abs']).default('auto'),
  mult: z.number().min(0).max(3).optional(),
  abs: z.number().min(0).optional(),
})

export const AdvancedSchema = z.object({
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

export const HouseholdSchema = z.object({
  familyName: z.string().max(120).optional(),
  members: z.array(z.object({
    id: z.string().min(1).max(100),
    name: z.string().max(80).optional(),
    ageMonths: z.number().int().min(0).max(1440),
    gender: z.enum(['m', 'f']).optional(),
    activity: z.enum(['low', 'medium', 'high']).optional(),
    specials: z.array(z.string().max(100)).max(40).default([]),
  })).min(1).max(40),
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
    favoriteBrands: z.array(z.string().max(200)).max(500).default([]),
    blockedBrands: z.array(z.string().max(200)).max(500).default([]),
    blockedProducts: z.array(z.string().max(200)).max(2_000).default([]),
    qualityBias: z.record(z.string(), z.number()).default({}),
    globalQualityBias: z.number().default(0),
    brandAffinity: z.record(z.string(), z.number()).optional(),
  }),
  eatingOutPerWeek: z.number().min(0).max(21).default(2),
  guestsPerMonth: z.number().min(0).max(120).default(4),
  hasWaterDispenser: z.boolean().default(false),
  storage: z.enum(['small', 'medium', 'large']).default('medium'),
})

export const BudgetSchema = z.object({
  fils: z.number().int().min(0).max(1_000_000_000),
  period: z.enum(['week', 'biweekly', 'month', 'custom']).default('month'),
  horizonDays: z.number().int().min(1).max(120).default(30),
  paydayWeekday: z.number().int().min(0).max(6).optional(),
  flexibilityPct: z.number().min(0).max(0.3).default(0),
  reservePct: z.number().min(0).max(0.3).default(0.05),
})

export const EnvelopeSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  groups: z.array(z.string().min(1).max(100)).max(100).default([]),
  mode: z.enum(['range', 'fixed', 'quantity', 'frequency']).default('range'),
  minFils: z.number().int().min(0).max(1_000_000_000).optional(),
  maxFils: z.number().int().min(0).max(1_000_000_000).optional(),
  fixedFils: z.number().int().min(0).max(1_000_000_000).optional(),
  quantity: z.object({ value: z.number().min(0).max(1_000_000), unit: z.string().min(1).max(40), needId: z.string().max(200).optional() }).optional(),
  frequency: z.object({ perPeriod: z.number().min(0).max(10_000), period: z.enum(['week', 'month']) }).optional(),
  priority: z.enum(['must', 'high', 'normal', 'ifLeft']).default('ifLeft'),
  fillToMax: z.boolean().default(false),
  preferences: z.object({
    avoidTags: z.array(z.string().max(120)).max(250).optional(),
    sizeBias: z.enum(['small', 'medium', 'large']).optional(),
    tierBias: z.enum(['econ', 'mid', 'premium']).optional(),
    variety: z.enum(['low', 'normal', 'high']).optional(),
  }).optional(),
  audience: z.array(z.enum(['adults', 'kids', 'all'])).max(40).optional(),
}).refine((envelope) => envelope.minFils == null || envelope.maxFils == null || envelope.minFils <= envelope.maxFils, {
  message: 'minFils must not exceed maxFils',
  path: ['maxFils'],
})

export const LockedChoiceSchema = z.object({
  productId: z.string().min(1).max(200),
  qty: z.number().int().positive().max(60).optional(),
  fromEnvelopeId: z.string().max(200).optional(),
})

export const PantryItemSchema = z.object({
  id: z.string().min(1).max(200),
  productId: z.string().max(200).optional(),
  name: z.string().min(1).max(200),
  needId: z.string().max(200).optional(),
  qtyBaseUnit: z.number().min(0).max(1_000_000_000),
  unit: z.enum(['ml', 'g', 'pcs', 'sheets', 'rolls', 'bags']).default('pcs'),
  addedAtISO: z.string().max(80).default(''),
})

const ValidDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0))
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day
}, { message: 'dateISO must be a real calendar date' })

export const PlanBodySchema = z.object({
  household: HouseholdSchema,
  budget: BudgetSchema,
  mode: z.enum(['crisis', 'economy', 'balanced', 'comfortable', 'custom']).default('balanced'),
  season: z.enum(['normal', 'ramadan', 'eid', 'back-to-school', 'summer']).default('normal'),
  storeMode: z.enum(['median', 'best-single', 'split']).default('median'),
  availableStores: z.array(z.string().min(1).max(100)).max(100).default([]),
  delivery: z.boolean().default(true),
  locks: z.array(LockedChoiceSchema).max(500).default([]),
  envelopes: z.array(EnvelopeSchema).max(100).default([]),
  pantry: z.array(PantryItemSchema).max(1_000).default([]),
  seed: z.number().int().min(-2_147_483_648).max(2_147_483_647).default(42),
  dateISO: ValidDateSchema.optional(),
  advanced: AdvancedSchema.optional(),
})


/** Payload accepted when a user explicitly publishes a household plan. */
export const PlanShareSchema = z.object({
  title: z.string().trim().min(1).max(120),
  familyName: z.string().max(80).optional(),
  authorName: z.string().max(80).optional(),
  household: HouseholdSchema,
  budget: BudgetSchema,
  envelopes: z.array(EnvelopeSchema).max(100).default([]),
  mode: z.enum(['crisis', 'economy', 'balanced', 'comfortable', 'custom']).default('balanced'),
  season: z.enum(['normal', 'ramadan', 'eid', 'back-to-school', 'summer']).default('normal'),
  storeMode: z.enum(['median', 'best-single', 'split']).default('median'),
  availableStores: z.array(z.string().min(1).max(100)).max(100).default([]),
  delivery: z.boolean().default(true),
  locks: z.array(LockedChoiceSchema).max(500).default([]),
  pantry: z.array(PantryItemSchema).max(1_000).default([]),
  advanced: AdvancedSchema.optional(),
  dateISO: ValidDateSchema.optional(),
  isAnonymous: z.boolean().default(true),
  /** Explicit opt-in: public sharing includes household age bands, habits, diet, budget, pantry and preferences. */
  consentToPublishHousehold: z.literal(true),
})
