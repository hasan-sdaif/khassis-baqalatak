/**
 * Khassis Baqalatak — shared type system.
 * Money is ALWAYS integer fils (1 BHD = 1000 fils). No floating-point currency.
 * Engine is pure/deterministic: same inputs => same outputs (bit-for-bit).
 */

// ------------------------------- Catalog -------------------------------

export type UnitKind = 'ml' | 'g' | 'pcs' | 'sheets' | 'rolls' | 'bags'

export interface ParsedSize {
  /** total base quantity in the base unit (ml for liquids, g for solids, pcs otherwise) */
  baseQuantity: number
  unit: UnitKind
  /** number of sub-packs (6x200ml => 6) */
  packCount: number
  /** size of a single sub-pack (6x200ml => 200) */
  unitSize: number
  /** 0..1 parse confidence; low-confidence items are flagged for review */
  confidence: number
  /** human explanation of how it was parsed (for review UI) */
  trace: string
}

export type NeedClass =
  | 'mandatory' // fixed habit (diapers when selected, formula, tobacco) — budgeted first
  | 'essential' // core food/water/hygiene
  | 'regular' // staple household
  | 'comfort' // quality-of-life
  | 'treat' // sweets/snacks luxuries

export interface NeedDef {
  id: string
  slug: string
  nameAr: string
  nameEn: string
  category: string
  baseUnit: UnitKind
  clazz: NeedClass
  priorityWeight: number
  /** shelf life in days: [sealed, opened]; opened used for waste simulation */
  shelfSealedDays: number
  shelfOpenedDays: number
  storage: 'ambient' | 'chilled' | 'frozen'
  perishable: boolean
  /** adult monthly consumption in base unit (consumption_rules seed, overridable) */
  adultMonthly: number
  /** child factor vs adult (0..1) applied for members < 13 */
  childFactor: number
  /** buy this in weekly trips rather than monthly stocking */
  weeklyTrip: boolean
  /** fallback need per category when nothing more specific matches */
  fallbackForCategory?: boolean
  visibleInWizard?: boolean
}

export type ProductStatus = 'active' | 'discontinued' | 'pending-review' | 'hidden'

export interface StorePrice {
  fils: number
  origFils?: number
  url?: string
  available?: boolean
}

export interface CatalogProduct {
  id: string
  category: string
  nameEn: string
  nameAr: string
  nameNorm: string // normalized for Arabic search
  brand: string | null
  brandNorm: string | null
  sizeText: string | null
  size: ParsedSize | null
  flavors: string[]
  tags: string[]
  rank: number // source_rank: practical-need ordering from the archive
  storesCount: number
  available: boolean
  medianFils: number
  minFils: number
  maxFils: number
  prices: Record<string, StorePrice>
  /** recomputed unit price in fils per base unit (per liter/kg/pc) */
  unitPriceFils: number | null
  need: string | null
  /** 0..1 data confidence */
  dataConfidence: number
}

export interface StoreDef {
  id: string
  nameAr: string
  nameEn: string
  url?: string
  kind: 'hypermarket' | 'quick-commerce' | 'market' | 'specialty'
  deliveryFeeFils: number
  freeDeliveryThresholdFils: number | null
  minOrderFils: number
  deliveryTimeText: string
  active: boolean
}

export interface CategoryDef {
  id: string
  nameAr: string
  nameEn: string
  priority: 1 | 2 | 3 | 4
  icon: string
}

export interface Catalog {
  version: string
  generatedAt: string
  currency: string
  stores: StoreDef[]
  categories: CategoryDef[]
  products: CatalogProduct[]
}

// ------------------------------- Household -------------------------------

export type MemberSpecial =
  | 'pregnant'
  | 'nursing'
  | 'diabetic'
  | 'hypertension'
  | 'celiac'
  | 'lactose-intolerant'
  | 'nut-allergy'
  | 'none'

export interface HouseholdMember {
  id: string
  name?: string // optional display alias only
  ageMonths: number // age in months (infants!)
  gender?: 'm' | 'f'
  activity?: 'low' | 'medium' | 'high'
  specials: MemberSpecial[]
}

export interface HabitAnswers {
  [habitId: string]: Record<string, string | number | boolean>
}

export interface Household {
  familyName?: string
  members: HouseholdMember[]
  habits: HabitAnswers
  dietary: {
    halalOnly: boolean
    sugarFree?: boolean
    lowSodium?: boolean
    glutenFree?: boolean
    lactoseFree?: boolean
    nutFree?: boolean
  }
  prefs: {
    favoriteBrands: string[]
    blockedBrands: string[]
    blockedProducts: string[]
    /** per-need quality slider: -1 econ .. 0 balanced .. +1 premium */
    qualityBias: Record<string, number>
    globalQualityBias: number // -1 .. 1
    /** learned brand affinity -1..+1 (spec 6.15, local only) */
    brandAffinity?: Record<string, number>
  }
  eatingOutPerWeek: number // meals eaten out per week (reduces home demand)
  guestsPerMonth: number // hospitality factor
  hasWaterDispenser: boolean
  storage: 'small' | 'medium' | 'large'
}

import type { AdvancedProfile } from './advanced'

// ------------------------------- Budget / envelopes -------------------------------

export type PlanMode = 'crisis' | 'economy' | 'balanced' | 'comfortable' | 'custom'

export interface Budget {
  fils: number
  period: 'week' | 'biweekly' | 'month' | 'custom'
  horizonDays: number
  paydayWeekday?: number
  flexibilityPct: number // 0..0.2
  reservePct: number // default 0.05
}

export interface BudgetEnvelope {
  id: string
  name: string
  groups: string[] // generic group ids
  mode: 'range' | 'fixed' | 'quantity' | 'frequency'
  minFils?: number
  maxFils?: number
  fixedFils?: number
  quantity?: { value: number; unit: string; needId?: string }
  frequency?: { perPeriod: number; period: 'week' | 'month' }
  priority: 'must' | 'high' | 'normal' | 'ifLeft'
  fillToMax: boolean
  preferences?: {
    avoidTags?: string[]
    sizeBias?: 'small' | 'medium' | 'large'
    tierBias?: 'econ' | 'mid' | 'premium'
    variety?: 'low' | 'normal' | 'high'
  }
  audience?: ('adults' | 'kids' | 'all')[]
}

// ------------------------------- Engine input/output -------------------------------

export interface PlanContext {
  dateISO: string
  season: 'normal' | 'ramadan' | 'eid' | 'back-to-school' | 'summer'
  storeMode: 'median' | 'best-single' | 'split'
  availableStores: string[] // store ids the household can use
  delivery: boolean
}

export interface AlgorithmConfig {
  version: string
  // sweet-spot weights (6.7)
  A: number // target percentile amplitude, 0.30
  kappa: number // 1.5
  piMin: number // 0.12
  piMax: number // 0.85
  sigma: number // 0.22
  wTarget: number
  wFit: number
  wValue: number
  wAvail: number
  wPop: number
  wBrand: number
  wPref: number
  wWaste: number
  wConf: number
  // allocation
  reservePct: number
  lambdaMin: number // marginal-utility floor: do not spend for spending's sake
  treatCapPct: number // max share of budget for treats, 0.08
  varietyBrandCapPct: number // one brand can't dominate a diversity group
  minCoverageEssential: number // 0.92
  // waste simulation
  tauW: number
  tauK: number
  kComfort: number
  allowShortfallPct: number // 0.08
  // envelope solver
  envStepFils: number // grid step for spend levels, 250
  lambdaVariety: number
  lambdaTarget: number
  lambdaAudience: number
  lambdaWaste: number
  lambdaOverbuy: number
  // safety
  maxMedianMultiple: number // 2.5
  minMedianMultiple: number // 0.35
}

export interface LockedChoice {
  productId: string
  qty?: number // pack count; default computed
  fromEnvelopeId?: string
}

export interface EngineInput {
  catalog: Catalog
  household: Household
  budget: Budget
  context: PlanContext
  config: AlgorithmConfig
  locks: LockedChoice[]
  envelopes: BudgetEnvelope[]
  mode: PlanMode
  seed: number
  pantry?: PantryItem[]
  /** hundreds-of-options profile from the advanced preferences page */
  advanced?: AdvancedProfile
}

export interface DemandItem {
  needId: string
  qtyBaseUnit: number
  confidence: number
  derivation: string[] // human-readable Arabic trace lines
}

export interface PlanItem {
  key: string
  productId: string
  needId: string
  productName: string
  brand: string | null
  sizeText: string | null
  packQty: number
  unitQtyBase: number // total base units
  costFils: number
  unitCostFils: number | null // per base unit
  storeId: string | null // chosen store (median by default)
  wastePct: number
  coverage: number // demand coverage 0..n
  score: number
  percentile: number
  /** transparent score composition as percentages (why-this-product bars) */
  scoreParts?: Record<string, number>
  locked: boolean
  reasons: ReasonCode[]
  alternatives: Alternative[]
  envelopeId?: string
  /** trips this item belongs to (1 = main stock trip, 2+ = fresh trips) */
  trip: number
  /** estimated run-out date ISO within horizon */
  lastsUntilISO?: string
}

export interface ReasonCode {
  code: string
  args?: Record<string, string | number>
  ar: string // rendered Arabic sentence
}

export interface Alternative {
  productId: string
  productName: string
  brand: string | null
  sizeText: string | null
  packQty: number
  costFils: number
  deltaFils: number
  kind: 'cheaper' | 'equivalent' | 'better'
  note: string
}

export interface EnvelopeResult {
  envelopeId: string
  name: string
  spentFils: number
  minFils?: number
  maxFils?: number
  items: PlanItem[]
  explanation: string[]
  variety: number
}

export interface StoreSplit {
  storeId: string
  itemsCount: number
  subtotalFils: number
  deliveryFils: number
}

export interface PlanDiagnostics {
  totalCostFils: number
  budgetFils: number
  targetFils: number
  surplusFils: number
  shortfallFils: number
  wastePct: number
  avgPercentile: number
  coverageMin: number
  varietyIndex: number
  confidence: number
  distributionByClass: { clazz: NeedClass; fils: number; pct: number }[]
  /** achieved vs target budget allocation per group (percentages, spec user directive) */
  allocation?: { group: string; nameAr: string; targetPct: number; achievedPct: number }[]
  /** mode percentile offset applied, as percent */
  modeOffsetPct?: number
  reserveFils?: number
  treatSharePct?: number
  /** refinement passes applied by the local-search optimizer */
  refinementPasses?: number
  refinementGains?: number
  warnings: string[]
  notes: string[]
}

export interface PlanTrip {
  trip: number
  label: string
  dateISO?: string
  itemKeys: string[]
  fils: number
}

export interface PlanResult {
  fingerprint: string
  engineVersion: string
  configVersion: string
  mode: PlanMode
  horizonDays: number
  demand: DemandItem[]
  items: PlanItem[]
  envelopes: EnvelopeResult[]
  trips: PlanTrip[]
  storeSplits: StoreSplit[]
  totals: {
    costFils: number
    optimisticFils: number
    pessimisticFils: number
    savingsVsMedianFils: number
    wastePct: number
    coverageEssentials: number
  }
  diagnostics: PlanDiagnostics
  nutrition: {
    groups: { group: string; pct: number; targetPct: number }[]
    approxCaloriesPerDay: number
    /** estimated cost of 1,000 kcal from the planned staples (fils) — calorie-density metric */
    costPer1000kcalFils?: number | null
    disclaimer: string
  }
  fixedItems: PlanItem[] // habit-locked (tobacco etc.)
  generatedAt: string
}

// ------------------------------- Pantry / spending -------------------------------

export interface PantryItem {
  id: string
  productId?: string
  name: string
  needId?: string
  qtyBaseUnit: number
  unit: UnitKind
  addedAtISO: string
}

export interface SpendLogEntry {
  id: string
  dateISO: string
  planItemKey?: string
  envelopeId?: string
  name: string
  plannedFils: number
  actualFils: number
  storeId?: string
}

// ------------------------------- Generic groups -------------------------------

export interface GenericGroup {
  id: string
  nameAr: string
  nameEn: string
  icon: string
  parent?: string
  /** membership rules: needs and/or categories and/or tags/keywords */
  needs: string[]
  categories: string[]
  keywords: string[]
  /** sensible consumption ceiling per adult per month (base estimate) */
  ceilingPerAdultMonthly?: number
  clazz: NeedClass
  allergenTags: string[]
  audience: 'all' | 'kids' | 'adults'
}

// ------------------------------- Reports -------------------------------

export type ReportType =
  | 'full-plan'
  | 'shopping-list'
  | 'budget'
  | 'spending'
  | 'store-compare'
  | 'consumption'
  | 'product-compare'
  | 'calculator'
  | 'pantry'
  | 'admin-quality'

export interface ReportNames {
  reportName: string
  familyName?: string
  preparerName?: string
  planName?: string
  showNames: boolean
}

export interface ReportOptions {
  paper: 'A4' | 'A5' | 'letter' | '80mm'
  inkSaver: boolean
  detailed: boolean // detailed (products) vs generic (groups+amounts)
  sections: Record<string, boolean>
  orientation: 'portrait' | 'landscape'
  hijriOptional?: boolean
}
