/**
 * Advanced preferences system — the "extreme flexibility" layer (user directive:
 * basic choices in the wizard + an advanced page with HUNDREDS of options).
 *
 * The AdvancedProfile is:
 *   - fully serializable (localStorage + API body)
 *   - versioned (v1)
 *   - merged into the engine at every stage (demand → filtering → scoring →
 *     allocation → refinement → diagnostics), never bypassing it
 *
 * Option count at engine level:
 *   ~87 need-quantity overrides + 34 diet/health flags + 43 category quality
 *   tiers + 5 engine-weight percentages + 8 budget-allocation percentages +
 *   ~12 lifestyle controls + 37 store toggles + 365 brand ratings (UI layer)
 *   + product pin/block (39,831 products, UI layer) → 500+ user-selectable
 *   levers, all individually resettable.
 */
import type { AlgorithmConfig, HouseholdMember, NeedClass } from './types'
import { adultEquivalent } from './habits'

export const ADVANCED_VERSION = 1

// ---------------------------------------------------------------------------
// Types

export type NeedOverrideMode = 'auto' | 'mult' | 'abs'

export interface NeedOverride {
  mode: NeedOverrideMode
  /** demand multiplier (0 = exclude this need entirely, 2 = double) — only in 'mult' mode */
  mult?: number
  /** absolute quantity in the need's base unit for the whole horizon — only in 'abs' mode */
  abs?: number
}

export interface DietFlags {
  vegetarian: boolean
  vegan: boolean
  pescatarian: boolean
  keto: boolean
  lowCarb: boolean
  noAddedSugar: boolean
  lowSodium: boolean
  glutenFree: boolean
  lactoseFree: boolean
  nutFree: boolean
  eggFree: boolean
  soyFree: boolean
  shellfishFree: boolean
  halalStrict: boolean
  organicLean: boolean
  highProtein: boolean
  highFiber: boolean
  lowFat: boolean
  diabeticFriendly: boolean
  hypertensionFriendly: boolean
  avoidFried: boolean
  avoidProcessed: boolean
  avoidCanned: boolean
  avoidFrozen: boolean
  avoidInstant: boolean
  avoidSugaryDrinks: boolean
  avoidEnergyDrinks: boolean
  avoidCarbonated: boolean
  noCaffeine: boolean
  noTobacco: boolean
  noVape: boolean
  preferLocal: boolean
  preferWholeGrain: boolean
  preferFamilyPacks: boolean
}

export type CategoryTier = 'auto' | 'econ' | 'standard' | 'premium'

export interface WeightPercents {
  /** sweet-spot fit % — how close to the ideal price percentile */
  target: number
  /** pure price value % */
  value: number
  /** quality: pack-fit + waste + data confidence % */
  quality: number
  /** brand affinity + personal preferences % */
  brand: number
  /** availability + popularity (how easy to find) % */
  local: number
}

export type AllocGroupId = 'grains' | 'protein' | 'dairy' | 'produce' | 'fats' | 'pantry' | 'cleaning' | 'treats'

export interface AllocationPercents {
  grains: number
  protein: number
  dairy: number
  produce: number
  fats: number
  pantry: number
  cleaning: number
  treats: number
  /** soft-enforce the allocation during upgrades (vs informational only) */
  enforce: boolean
}

export interface LifestylePrefs {
  /** 0..100 — share of meals cooked at home (100 = full home cooking) */
  homeCookingPct: number | null
  /** 0..200 (100 = neutral) — scales treat-class demand */
  sweetToothPct: number
  /** 0..200 (100 = neutral) — scales snack-class demand */
  snacksLevelPct: number
  /** 0..30 — accepted waste ceiling (feeds tauW: higher tolerance → larger packs allowed) */
  wasteTolerancePct: number | null
  /** monthly shopping rhythm */
  tripsPreference: 'monthly' | 'biweekly' | 'weekly' | 'twice-weekly' | 'auto'
  /** 0..15 — share of budget held back as flexibility reserve (default 5%) */
  reservePct: number | null
  /** 0..20 — hard cap on treats share of budget (default 8%) */
  treatCapPct: number | null
  /** 0..100 (50 = neutral) — variety pressure across brands */
  varietyLevel: number
  /** preferred pack size direction */
  packSizeBias: 'auto' | 'small' | 'medium' | 'large'
  /** custom mode percentile offset in percent (-35..+25) applied when mode = 'custom' */
  customModeOffsetPct: number
}

export interface StorePrefs {
  /** store ids to exclude from price references & optimization */
  banned: string[]
  /** preferred stores get a mild scoring availability boost */
  preferred: string[]
  /** max stores in split mode (1..3) */
  maxSplitStores: number
  /** include delivery fees when comparing stores (default true) */
  includeDeliveryFees: boolean
}

export interface AdvancedProfile {
  v: number
  enabled: boolean
  needOverrides: Record<string, NeedOverride>
  diet: DietFlags
  categoryTiers: Record<string, CategoryTier>
  weights: WeightPercents
  allocation: AllocationPercents
  lifestyle: LifestylePrefs
  stores: StorePrefs
}

// ---------------------------------------------------------------------------
// Defaults (inspiration: خطط-البقالة-الشهرية-البحرين file 01 §2 — the anatomy
// of a 100-BHD basket, normalized to 100%)

export const DEFAULT_ALLOCATION: AllocationPercents = {
  grains: 18,
  protein: 26,
  dairy: 9,
  produce: 16,
  fats: 4,
  pantry: 11,
  cleaning: 10,
  treats: 6,
  enforce: false,
}

export const DEFAULT_WEIGHTS: WeightPercents = {
  target: 40,
  value: 12,
  quality: 28,
  brand: 10,
  local: 10,
}

export const DEFAULT_ADVANCED: AdvancedProfile = {
  v: ADVANCED_VERSION,
  enabled: true,
  needOverrides: {},
  diet: {
    vegetarian: false,
    vegan: false,
    pescatarian: false,
    keto: false,
    lowCarb: false,
    noAddedSugar: false,
    lowSodium: false,
    glutenFree: false,
    lactoseFree: false,
    nutFree: false,
    eggFree: false,
    soyFree: false,
    shellfishFree: false,
    halalStrict: false,
    organicLean: false,
    highProtein: false,
    highFiber: false,
    lowFat: false,
    diabeticFriendly: false,
    hypertensionFriendly: false,
    avoidFried: false,
    avoidProcessed: false,
    avoidCanned: false,
    avoidFrozen: false,
    avoidInstant: false,
    avoidSugaryDrinks: false,
    avoidEnergyDrinks: false,
    avoidCarbonated: false,
    noCaffeine: false,
    noTobacco: false,
    noVape: false,
    preferLocal: false,
    preferWholeGrain: false,
    preferFamilyPacks: false,
  },
  categoryTiers: {},
  weights: { ...DEFAULT_WEIGHTS },
  allocation: { ...DEFAULT_ALLOCATION },
  lifestyle: {
    homeCookingPct: null,
    sweetToothPct: 100,
    snacksLevelPct: 100,
    wasteTolerancePct: null,
    tripsPreference: 'auto',
    reservePct: null,
    treatCapPct: null,
    varietyLevel: 50,
    packSizeBias: 'auto',
    customModeOffsetPct: 0,
  },
  stores: {
    banned: [],
    preferred: [],
    maxSplitStores: 3,
    includeDeliveryFees: true,
  },
}

export function defaultAdvanced(): AdvancedProfile {
  return JSON.parse(JSON.stringify(DEFAULT_ADVANCED)) as AdvancedProfile
}

/** merge a persisted/patched profile onto defaults (forward-compatible) */
export function normalizeAdvanced(raw: unknown): AdvancedProfile {
  const base = defaultAdvanced()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AdvancedProfile>
  return {
    ...base,
    ...r,
    v: ADVANCED_VERSION,
    diet: { ...base.diet, ...(r.diet ?? {}) },
    categoryTiers: { ...(r.categoryTiers ?? {}) },
    weights: { ...base.weights, ...(r.weights ?? {}) },
    allocation: { ...base.allocation, ...(r.allocation ?? {}) },
    lifestyle: { ...base.lifestyle, ...(r.lifestyle ?? {}) },
    stores: { ...base.stores, ...(r.stores ?? {}) },
    needOverrides: { ...(r.needOverrides ?? {}) },
  }
}

// ---------------------------------------------------------------------------
// Diet → banned needs (demand-level exclusion). Infant/medical needs are NEVER
// banned (formula/diapers stay — they're medical, per spec 6.4 & pediatric guidance).

const PROTECTED_NEEDS = new Set(['formula', 'diapers', 'baby-wipes', 'baby-food', 'water'])

const MEAT_NEEDS = ['chicken', 'meat.red', 'meat.processed', 'cat.meat-poultry']
const FISH_NEEDS = ['fish', 'cat.fish-seafood']
const DAIRY_NEEDS = [
  'milk.fresh.full', 'milk.fresh.low', 'milk.uht.full', 'milk.uht.low', 'milk.evaporated',
  'milk.flavored', 'milk.powder', 'laban', 'cheese', 'butter', 'cream',
  'cat.milk', 'cat.yogurt-laban', 'cat.cheese', 'cat.butter-cream',
  'cat.ice-cream', 'cat.desserts-chilled',
]
const EGG_NEEDS = ['eggs']
const CARB_NEEDS = [
  'rice', 'pasta', 'flour', 'bread', 'sugar', 'oats',
  'cat.breakfast-cereals', 'cat.rice-pasta-grains', 'cat.baking-supplies',
  'cat.biscuits-cookies', 'cat.chocolate-sweets', 'cat.arabic-sweets', 'cat.honey-spreads',
  'dates',
]
const SUGARY_DRINK_NEEDS = ['juice', 'soft-drinks', 'milk.flavored', 'cat.juices', 'cat.soft-drinks']

/** need ids whose demand is removed given the diet flags */
export function bannedNeedsFor(diet: DietFlags): Set<string> {
  const ban = new Set<string>()
  if (diet.vegetarian || diet.vegan || diet.pescatarian) {
    for (const n of MEAT_NEEDS) ban.add(n)
  }
  if (diet.vegetarian || diet.vegan) for (const n of FISH_NEEDS) ban.add(n)
  if (diet.vegan) {
    for (const n of [...DAIRY_NEEDS, ...EGG_NEEDS, 'cat.honey-spreads']) ban.add(n)
  }
  if (diet.keto) {
    for (const n of CARB_NEEDS) ban.add(n)
    for (const n of SUGARY_DRINK_NEEDS) ban.add(n)
    ban.add('dates')
  }
  if (diet.lowCarb) {
    for (const n of ['rice', 'pasta', 'flour', 'bread', 'sugar', 'cat.breakfast-cereals', 'cat.rice-pasta-grains', 'cat.biscuits-cookies']) ban.add(n)
  }
  if (diet.avoidSugaryDrinks) for (const n of SUGARY_DRINK_NEEDS) ban.add(n)
  if (diet.avoidEnergyDrinks || diet.noCaffeine) { ban.add('energy-drinks'); ban.add('cat.energy-drinks') }
  if (diet.noCaffeine) { ban.add('coffee'); ban.add('tea'); ban.add('cat.coffee-tea') }
  if (diet.noTobacco) { ban.add('tobacco'); ban.add('cat.vape-tobacco') }
  if (diet.noVape) ban.add('cat.vape-tobacco')
  if (diet.avoidCanned) ban.add('cat.canned-food')
  if (diet.avoidFrozen) ban.add('cat.frozen-food')
  if (diet.avoidCarbonated) { ban.add('soft-drinks'); ban.add('cat.soft-drinks') }
  // never ban protected needs
  for (const p of PROTECTED_NEEDS) ban.delete(p)
  return ban
}

// ---------------------------------------------------------------------------
// Product-level filters from diet flags (name/keyword based, deterministic)

export interface ProductDietFilter {
  hay: string
  blocked: boolean
}

const RX = {
  nuts: /nut|مكسر|بندق|فستق|كاجو|عين جمل|كاشيو|peanut|almond|hazelnut|walnut|pistachio|لوز/i,
  egg: /egg|بيض/i,
  soy: /soy|صويا|soya/i,
  shellfish: /shrimp|روبيان|جمبري|prawn|lobster|كركند|crab|سلطعون|oyster|محار|muscle|mussel|بلح البحر/i,
  gluten: /wheat|قمح|شعير|barley|برغل|bulgur|شوفان|oat|معكرونة|macaroni|spaghetti|pasta|برغل/i,
  fried: /مقلي|مقرمش|fried|fries|بطاطس مقلية|crispy|فرنش/i,
  processed: /مرتديلا|مورتاديلا|سجق|نقانق|برجر|burger|سوسج|processed|luncheon|لانشون|بسطرمة/i,
  instant: /فوري|instant|نودلز|noodles|إندومي|اندومي|indomie|رامن|ramen/i,
  caffein: /قهوة|coffee|نسكافيه|espresso|شاي|tea|ماتشا/i,
  fullFat: /كامل الدسم|كامل الدسم|full fat|full cream|full-fat|fullcream/i,
  organic: /عضوي|organic|\bbio\b|طبيعي 100/i,
  wholeGrain: /نخالة|بر\b|whole grain|wholegrain|wholemeal|brown rice|أرز أسمر|ارز اسمر|بني|multigrain/i,
  highProt: /بروتين|protein|تونة|tuna|صدور|chicken breast|عدس|lentil|حمص|chickpea|فول|beans/i,
  highFiber: /نخالة|fiber|fibre|ألياف|شوفان|oats|عدس|lentil|فول|beans|خضار|vegetable/i,
}

/** hard product filter — returns true when the product must be EXCLUDED */
export function productBlockedByDiet(diet: DietFlags, nameEn: string, nameAr: string, tags: string[]): boolean {
  const hay = `${nameEn} ${nameAr}`.toLowerCase()
  if (diet.nutFree && RX.nuts.test(hay)) return true
  if (diet.eggFree && RX.egg.test(hay)) return true
  if (diet.soyFree && RX.soy.test(hay)) return true
  if (diet.shellfishFree && RX.shellfish.test(hay)) return true
  if (diet.glutenFree && !tags.includes('dietary:gluten-free') && RX.gluten.test(hay)) return true
  if (diet.avoidFried && RX.fried.test(hay)) return true
  if (diet.avoidProcessed && RX.processed.test(hay)) return true
  if (diet.avoidInstant && RX.instant.test(hay)) return true
  return false
}

/** soft scoring boost −1..+1 from diet leanings */
export function dietPrefBoost(diet: DietFlags, nameEn: string, nameAr: string, tags: string[], category: string): number {
  const hay = `${nameEn} ${nameAr}`.toLowerCase()
  let b = 0
  if (diet.noAddedSugar || diet.diabeticFriendly) {
    if (tags.includes('dietary:sugar-free') || /sugar free|بدون سكر|خالي من السكر|zero sugar|ديت|diet|zero/i.test(hay)) b += 0.5
  }
  if (diet.lowSodium || diet.hypertensionFriendly) {
    if (tags.includes('sodium:low') || /ملح مخفض|low sodium|reduced sodium/i.test(hay)) b += 0.5
  }
  if (diet.organicLean && RX.organic.test(hay)) b += 0.4
  if (diet.preferWholeGrain && RX.wholeGrain.test(hay)) b += 0.45
  if (diet.highProtein && RX.highProt.test(hay)) b += 0.3
  if (diet.highFiber && RX.highFiber.test(hay)) b += 0.3
  if (diet.lowFat) {
    if (/قليل الدسم|low fat|skim|منزوع|light|لايت/i.test(hay)) b += 0.35
    if (RX.fullFat.test(hay)) b -= 0.35
  }
  if (diet.preferLocal && LOCAL_BRAND_HINTS.some((h) => hay.includes(h))) b += 0.35
  if (diet.halalStrict) {
    // non-halal markers are rare in BH groceries; flag obvious ones out of caution
    if (/pork|خنزير|لحم خنزير|gelatin|جلاتين/i.test(hay)) b -= 0.9
  }
  void category
  return Math.max(-1, Math.min(1, b))
}

/** Bahraini/GCC national-brand hints (stores' own labels + local producers) */
export const LOCAL_BRAND_HINTS = ['التنمية', 'تنمية', 'tanh', 'أوال', 'اوال', 'awal', 'المطاحن', 'مطاحن', 'عذاري', 'adhari', 'بحر ', 'dilmun', 'دلمون', 'lulu', 'لولو', 'الجزيرة', 'al jazira', 'aljazira', 'هايبر ماكس', 'hypermax', 'سنابل الخير', 'العلالي', 'alaluslus']

// ---------------------------------------------------------------------------
// Category tiers → target-percentile shifts

export const TIER_OFFSET: Record<Exclude<CategoryTier, 'auto'>, number> = {
  econ: -0.18,
  standard: 0,
  premium: 0.15,
}

// ---------------------------------------------------------------------------
// Engine weights (user percentages) → effective AlgorithmConfig weights.
// The 5 percentages are normalized to 100 then mapped onto the internal weights.

export function normalizeWeights(w: WeightPercents): WeightPercents {
  const sum = (w.target + w.value + w.quality + w.brand + w.local) || 1
  return {
    target: (w.target / sum) * 100,
    value: (w.value / sum) * 100,
    quality: (w.quality / sum) * 100,
    brand: (w.brand / sum) * 100,
    local: (w.local / sum) * 100,
  }
}

export function applyWeightsToConfig(config: AlgorithmConfig, w: WeightPercents): AlgorithmConfig {
  const n = normalizeWeights(w)
  const t = n.target / 100
  const v = n.value / 100
  const q = n.quality / 100
  const b = n.brand / 100
  const l = n.local / 100
  return {
    ...config,
    wTarget: t,
    wValue: v,
    wFit: q * 0.5,
    wWaste: q * 0.3,
    wConf: q * 0.2,
    wBrand: b * 0.6,
    wPref: b * 0.4,
    wAvail: l * 0.4,
    wPop: l * 0.6,
  }
}

// ---------------------------------------------------------------------------
// Budget allocation groups → need ids (inspiration file 01 §2)

export const ALLOC_GROUPS: Record<AllocGroupId, { nameAr: string; needs: string[] }> = {
  grains: {
    nameAr: 'الحبوب والخبز',
    needs: ['rice', 'pasta', 'flour', 'bread', 'oats', 'cat.breakfast-cereals', 'cat.rice-pasta-grains', 'cat.bakery', 'cat.baking-supplies'],
  },
  protein: {
    nameAr: 'البروتينات',
    needs: ['chicken', 'meat.red', 'meat.processed', 'fish', 'eggs', 'pulses', 'cat.meat-poultry', 'cat.fish-seafood', 'cat.canned-food'],
  },
  dairy: {
    nameAr: 'الألبان',
    needs: ['milk.fresh.full', 'milk.fresh.low', 'milk.uht.full', 'milk.uht.low', 'milk.evaporated', 'milk.powder', 'laban', 'cheese', 'butter', 'cream', 'cat.milk', 'cat.yogurt-laban', 'cat.cheese', 'cat.butter-cream'],
  },
  produce: {
    nameAr: 'الخضار والفواكه',
    needs: ['vegetables', 'fruits', 'cat.fruits-vegetables'],
  },
  fats: {
    nameAr: 'الدهون',
    needs: ['oil', 'olive-oil', 'cat.cooking-oils'],
  },
  pantry: {
    nameAr: 'المؤونة (سكر/شاي/بهارات)',
    needs: ['sugar', 'coffee', 'tea', 'vinegar', 'dates', 'juice', 'cat.coffee-tea', 'cat.sauces-condiments', 'cat.honey-spreads', 'cat.pantry-other'],
  },
  cleaning: {
    nameAr: 'المنظفات والنظافة',
    needs: ['cat.household-cleaning', 'cleaners', 'floor-cleaner', 'toilet-cleaner', 'dish-soap', 'laundry', 'fabric-softener', 'cat.personal-care', 'shampoo', 'soap', 'toothpaste', 'deodorant', 'cat.disposables', 'toilet-paper', 'tissues', 'garbage-bags', 'kitchen-towel', 'cat.health-pharmacy', 'cat.home-kitchenware'],
  },
  treats: {
    nameAr: 'الحلويات والترفيه',
    needs: ['cat.chocolate-sweets', 'cat.biscuits-cookies', 'cat.arabic-sweets', 'cat.salty-snacks', 'cat.desserts-chilled', 'cat.ice-cream', 'nuts', 'soft-drinks', 'energy-drinks'],
  },
}

/** normalize allocation percentages to exactly 100 */
export function normalizeAllocation(a: AllocationPercents): AllocationPercents {
  const keys: (keyof Omit<AllocationPercents, 'enforce'>)[] = ['grains', 'protein', 'dairy', 'produce', 'fats', 'pantry', 'cleaning', 'treats']
  const vals = keys.map((k) => Math.max(0, a[k] ?? 0))
  const sum = vals.reduce((s, x) => s + x, 0) || 1
  const out = { ...a }
  // largest-remainder rounding to keep the sum exactly 100
  const raw = vals.map((x) => (x / sum) * 100)
  const flo = raw.map(Math.floor)
  let rem = 100 - flo.reduce((s, x) => s + x, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((x, y) => y.frac - x.frac)
  for (const { i } of order) {
    if (rem <= 0) break
    flo[i]! += 1
    rem -= 1
  }
  keys.forEach((k, i) => {
    ;(out[k] as number) = flo[i]!
  })
  return out
}

// ---------------------------------------------------------------------------
// Lifestyle → engine deltas

export function lifestyleTauW(tolerancePct: number | null, base: number): number {
  if (tolerancePct == null) return base
  // tolerance 0..30% maps tauW 0.12..0.6 (higher tolerance → waste penalized less)
  return 0.12 + (Math.max(0, Math.min(30, tolerancePct)) / 30) * 0.48
}

export function tripsPerMonth(pref: LifestylePrefs['tripsPreference']): number | null {
  switch (pref) {
    case 'monthly': return 1
    case 'biweekly': return 2
    case 'weekly': return 4
    case 'twice-weekly': return 8
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Budget suggester (inspiration file 00 §6 ladder + user's bachelor-40 anchor)
//
//   single: economy 40 / balanced 50 / comfortable 75 / crisis 30
//   The ladder scales with adult-equivalents; crisis stays at the 30-BHD
//   survival protocol from file 09 (with an honest warning for big families).

export type SuggestMode = 'crisis' | 'economy' | 'balanced' | 'comfortable'

export function suggestBudgetFils(members: HouseholdMember[], mode: SuggestMode): { fils: number; noteAr: string } {
  const eq = members.reduce((s, m) => s + adultEquivalent(m), 0)
  const extra = Math.max(0, eq - 1)
  let fils: number
  switch (mode) {
    case 'crisis': fils = 30_000; break
    case 'economy': fils = 40_000 + Math.round(extra * 11_000); break
    case 'balanced': fils = 50_000 + Math.round(extra * 16_000); break
    case 'comfortable': fils = 75_000 + Math.round(extra * 24_000); break
  }
  fils = Math.round(fils / 500) * 500
  const noteAr =
    mode === 'crisis'
      ? eq > 1.5
        ? 'بروتوكول الطوارئ (٣٠ د.ب): وضع بقاء منظم مؤقت — للعائلات الكبيرة فعّل موارد الدعم المجتمعية من اليوم الأول'
        : 'بروتوكول الطوارئ للعازب (٣٠ د.ب): تغطية صحية كاملة ≈٢٥٥٠ سعرة/يوم'
      : mode === 'economy'
        ? `اقتصاد عاقل: يغطي الأساسيات كاملة بلا نقص (الأساس: ٤٠ د.ب للفرد الأول + ١١ د.ب لكل مكافئ بالغ إضافي)`
        : mode === 'balanced'
          ? `التوازن الأمثل الموصى به (٥٠ د.ب للفرد الأول + ١٦ د.ب لكل مكافئ بالغ إضافي)`
          : `الاكتفاء الكريم بتنويع مريح (٧٥ د.ب للفرد الأول + ٢٤ د.ب لكل مكافئ بالغ إضافي)`
  return { fils, noteAr }
}

/** A/B/C/D level ladder for a household (inspiration §3.4 السلة المتدرجة) */
export function levelLadderFils(members: HouseholdMember[]): { level: 'A' | 'B' | 'C' | 'D'; nameAr: string; fils: number; descAr: string }[] {
  const eq = members.reduce((s, m) => s + adultEquivalent(m), 0)
  const extra = Math.max(0, eq - 1)
  const scale = (base: number, inc: number) => Math.round((base + extra * inc) / 500) * 500
  return [
    { level: 'A', nameAr: 'الاكتفاء الكريم', fils: scale(95_000, 26_000), descAr: 'تنويع مريح: فواكه يومية، عسل ومربى، مياهاً معبأة' },
    { level: 'B', nameAr: 'التوازن الأمثل', fils: scale(70_000, 18_000), descAr: 'الموصى به دائماً: بروتين مريح + ألبان + ضيافة لائقة' },
    { level: 'C', nameAr: 'الاقتصاد العاقل', fils: scale(45_000, 10_000), descAr: 'بلا نقص: طاقة كافية، بروتين من البيض والبقول' },
    { level: 'D', nameAr: 'بروتوكول الطوارئ', fils: 30_000, descAr: '٣٠ د.ب: طاقة من ٤ مصادر + بروتين اقتصادي محمي للأطفال' },
  ]
}

// ---------------------------------------------------------------------------
// Need-class helpers for lifestyle scaling

export const TREAT_CLASS_NEEDS_SCALERS: Record<string, (pct: number) => number> = {
  // sweet tooth scales sweets; snacks level scales salty snacks
  'cat.chocolate-sweets': (p) => p / 100,
  'cat.arabic-sweets': (p) => p / 100,
  'cat.biscuits-cookies': (p) => p / 100,
  'cat.desserts-chilled': (p) => p / 100,
  'cat.ice-cream': (p) => p / 100,
  'cat.salty-snacks': (p) => p / 100,
}

export function treatDemandScale(clazz: NeedClass, needId: string, lifestyle: LifestylePrefs): number {
  if (clazz !== 'treat' && clazz !== 'comfort') return 1
  const sweetish = ['cat.chocolate-sweets', 'cat.arabic-sweets', 'cat.biscuits-cookies', 'cat.desserts-chilled', 'cat.ice-cream', 'sugar']
  const snackish = ['cat.salty-snacks']
  if (sweetish.includes(needId)) return Math.max(0, lifestyle.sweetToothPct / 100)
  if (snackish.includes(needId)) return Math.max(0, lifestyle.snacksLevelPct / 100)
  if (needId === 'juice' || needId === 'soft-drinks') return Math.max(0, lifestyle.sweetToothPct / 100)
  return 1
}

/** count of active (non-default) options — for the UI badge */
export function countActiveOptions(p: AdvancedProfile): number {
  let n = 0
  for (const o of Object.values(p.needOverrides)) if (o.mode !== 'auto') n++
  for (const f of Object.values(p.diet)) if (f === true) n++
  for (const t of Object.values(p.categoryTiers)) if (t && t !== 'auto') n++
  if (JSON.stringify(normalizeWeights(p.weights)) !== JSON.stringify(normalizeWeights(DEFAULT_WEIGHTS))) n++
  const na = normalizeAllocation(p.allocation)
  const da = normalizeAllocation(DEFAULT_ALLOCATION)
  for (const k of ['grains', 'protein', 'dairy', 'produce', 'fats', 'pantry', 'cleaning', 'treats'] as const) {
    if (na[k] !== da[k]) { n++; break }
  }
  if (p.allocation.enforce !== DEFAULT_ALLOCATION.enforce) n++
  const L = p.lifestyle
  if (L.homeCookingPct != null) n++
  if (L.sweetToothPct !== 100) n++
  if (L.snacksLevelPct !== 100) n++
  if (L.wasteTolerancePct != null) n++
  if (L.tripsPreference !== 'auto') n++
  if (L.reservePct != null) n++
  if (L.treatCapPct != null) n++
  if (L.varietyLevel !== 50) n++
  if (L.packSizeBias !== 'auto') n++
  if (L.customModeOffsetPct !== 0) n++
  n += p.stores.banned.length + p.stores.preferred.length
  if (p.stores.maxSplitStores !== 3) n++
  if (!p.stores.includeDeliveryFees) n++
  return n
}
