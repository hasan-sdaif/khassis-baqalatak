/**
 * Recommendation engine orchestrator (spec 6.2, stages 1–9).
 * Pure, deterministic, no I/O. Same inputs => same outputs.
 */
import type {
  AlgorithmConfig, Alternative, Budget, BudgetEnvelope, Catalog, CatalogProduct,
  DemandItem, EngineInput, EnvelopeResult, Household, LockedChoice, NeedDef,
  PantryItem, PlanContext, PlanDiagnostics, PlanItem, PlanResult, PlanTrip,
  PlanMode, ReasonCode, StoreSplit, GenericGroup,
} from './types'
import { DEFAULT_CONFIG, ENGINE_VERSION, MODE_OFFSET, CLASS_DELTA, CLASS_WEIGHT, seededRandom } from './config'
import { NEEDS_MAP, categoryFallbackNeed } from './needs'
import { computeDemand, resolveNeed } from './demand'
import { infantInfos, adultCount, childCount, formulaStageFromName, adultEquivalent } from './habits'
import { GENERIC_GROUPS } from './groups'
import { stableId } from './normalize'
import {
  ALLOC_GROUPS, DEFAULT_ALLOCATION, TIER_OFFSET, applyWeightsToConfig, dietPrefBoost,
  lifestyleTauW, normalizeAllocation, productBlockedByDiet, tripsPerMonth,
  type AdvancedProfile, type AllocGroupId,
} from './advanced'

const ENGINE_INPUT_VERSION = '1'

// ---------------------------------------------------------------------------
// internal candidate structure
interface Candidate {
  product: CatalogProduct
  k: number // pack count
  packPriceFils: number // price of ONE pack (chosen price mode)
  q: number // base units per pack
  r: number // daily consumption rate
  sOpen: number
  sSealed: number
  demandUnits: number
  kComfort: number
  weeklyTrips: number
  costFils: number
  unitQty: number // total base units bought
  usable: number // consumable units
  wastePct: number
  coverage: number // usable/demand
  uEff: number | null // fils per usable base unit
  fit: number
  percentile: number // π_i within need (0..1 by effective price)
  score: number
  storeId: string | null
  /** pack-size bias multiplier applied inside fit (advanced) */
  packBiasF: number
  /** transparent score composition: percentages per component */
  scoreParts?: Record<string, number>
}

/** recompute all k-dependent metrics (used by shortfall ladder & qty edits) */
function withK(c: Candidate, k: number, config: AlgorithmConfig): Candidate {
  const kk = Math.max(0, Math.min(60, Math.round(k)))
  if (kk === 0) return { ...c, k: 0, costFils: 0, unitQty: 0, usable: 0, coverage: 0, uEff: null, wastePct: 0, fit: 0 }
  const perPackUsable = Math.min(c.q, c.r * c.sOpen)
  // sealed expiry is evaluated PER TRIP for weekly needs (stock bought in trips,
  // not upfront) — spec 6.5 "purchase in batches for perishables"
  const packsPerTrip = Math.max(1, Math.ceil(kk / Math.max(1, c.weeklyTrips)))
  const tripConsumptionDays = (packsPerTrip - 1) * c.q / Math.max(1e-9, c.r)
  const sealedLossUnits = Math.max(0, tripConsumptionDays - c.sSealed) * c.r * Math.max(1, c.weeklyTrips)
  const usable = Math.max(0, Math.min(kk * c.q, kk * perPackUsable - sealedLossUnits))
  const bought = kk * c.q
  const wastePct = bought > 0 ? clamp(1 - usable / bought, 0, 1) : 0
  const coverage = c.demandUnits > 0 ? usable / c.demandUnits : 1
  const costFils = kk * c.packPriceFils
  const uEff = usable > 0 ? costFils / usable : null
  const fit = c.packBiasF * Math.exp(-wastePct / config.tauW) * Math.exp(-Math.abs(Math.log(Math.max(1, kk) / c.kComfort)) / config.tauK) * (kk > 6 * c.kComfort ? 0.4 : 1)
  return { ...c, k: kk, costFils, unitQty: bought, usable, wastePct, coverage, uEff, fit }
}

/** tight-budget swap: among candidates with sane per-unit price (≤2× need median),
 *  pick the one with the lowest TOTAL cost — prefers smaller affordable packs. */
function affordableSwap(ctx: NeedCtx): Candidate | null {
  const medianU = ctx.medianUEff
  const sane = ctx.candidates.filter((c) => {
    if (c.uEff == null) return c.costFils < 3000
    if (medianU != null && c.uEff > medianU * 2) return false
    return true
  })
  const pool = sane.length ? sane : ctx.candidates
  return [...pool].sort((a, b) => a.costFils - b.costFils || (a.uEff ?? 9e9) - (b.uEff ?? 9e9))[0] ?? null
}

interface NeedCtx {
  need: NeedDef
  demand: DemandItem
  candidates: Candidate[]
  shortlist: Candidate[]
  chosen: Candidate | null
  targetPi: number
  medianUEff: number | null
  refUnitFils: number | null
}

const DEFAULT_PACK_QTY: Record<string, number> = {
  diapers: 40, 'baby-wipes': 80, 'toilet-paper': 10, tissues: 100,
  'kitchen-towel': 2, 'garbage-bags': 30, tobacco: 20, bread: 6, eggs: 30, tea: 25,
}

// ---------------------------------------------------------------------------
export function generatePlan(input: EngineInput): PlanResult {
  // ---- ADVANCED profile resolution (hundreds-of-options layer)
  const adv = input.advanced
  const advActive = adv == null || adv.enabled !== false // default-on when provided
  let config = input.config ?? DEFAULT_CONFIG
  if (adv && advActive) {
    config = applyWeightsToConfig(config, adv.weights)
    if (adv.lifestyle.wasteTolerancePct != null) config = { ...config, tauW: lifestyleTauW(adv.lifestyle.wasteTolerancePct, config.tauW) }
    if (adv.lifestyle.reservePct != null) config = { ...config, reservePct: clamp(adv.lifestyle.reservePct / 100, 0, 0.15) }
    if (adv.lifestyle.treatCapPct != null) config = { ...config, treatCapPct: clamp(adv.lifestyle.treatCapPct / 100, 0, 0.2) }
    if (adv.lifestyle.varietyLevel !== 50) config = { ...config, varietyBrandCapPct: clamp(0.6 + (adv.lifestyle.varietyLevel - 50) / 250, 0.3, 0.9) }
  }
  const catalog = input.catalog
  const household = input.household
  const budget = input.budget
  const context = input.context
  const H = budget.horizonDays
  const rng = seededRandom(input.seed || 1)
  const generatedAt = new Date().toISOString()

  // ---------- Stage 1: demand (advanced: need overrides + lifestyle + diet bans)
  const { demand: demandList, fixedSpends, warnings, advancedNotes } = computeDemand(catalog, household, H, context, input.pantry ?? [], adv && advActive ? adv : undefined)

  // index products by need
  const byNeed = new Map<string, CatalogProduct[]>()
  for (const p of catalog.products) {
    if (!p.need || p.available !== true) continue
    if (p.medianFils <= 0) continue
    const arr = byNeed.get(p.need)
    if (arr) arr.push(p)
    else byNeed.set(p.need, [p])
  }

  // ---------- Stage 2+3: candidates & pack-fit per need
  const needCtxs: NeedCtx[] = []
  const demandMap = new Map(demandList.map((d) => [d.needId, d]))
  const lockMap = new Map(input.locks.map((l) => [l.productId, l]))

  for (const d of demandList) {
    // variant needs: 'formula@1' / 'diapers@3' split by stage/size
    const atIdx = d.needId.indexOf('@')
    const baseNeedId = atIdx >= 0 ? d.needId.slice(0, atIdx) : d.needId
    const variant = atIdx >= 0 ? d.needId.slice(atIdx + 1) : null
    const need = resolveNeed(baseNeedId, byNeed.get(baseNeedId)?.[0]?.category ?? '')
    if (!need) continue
    let products = byNeed.get(baseNeedId) ?? []
    if (!products.length) continue

    // variant filtering
    if (baseNeedId === 'formula' && variant) {
      const stage = Number(variant)
      products = products.filter((p) => {
        const stageTag = p.tags.find((t) => t.startsWith('baby:stage='))
        return (stageTag ? Number(stageTag.split('=')[1]) : formulaStageFromName(p.nameEn, p.nameAr)) === stage
      })
    }
    if (baseNeedId === 'diapers' && variant) {
      const size = Number(variant)
      products = products.filter((p) => {
        const sizeTag = p.tags.find((t) => t.startsWith('diaper:size='))
        return sizeTag ? Number(sizeTag.split('=')[1]) === size : true
      })
    }

    const r = d.qtyBaseUnit / H // daily rate
    const ctx: NeedCtx = {
      need, demand: d, candidates: [], shortlist: [], chosen: null,
      targetPi: 0.5, medianUEff: null, refUnitFils: null,
    }

    // percentile reference over effective unit prices
    const uEffList: { v: number; w: number }[] = []
    for (const p of products) {
      const u = effectiveUnitFils(p, need)
      if (u != null && u > 0) uEffList.push({ v: u, w: weightOf(p) })
    }
    if (uEffList.length) {
      uEffList.sort((a, b) => a.v - b.v)
      const totalW = uEffList.reduce((s, x) => s + x.w, 0)
      ctx.medianUEff = weightedPercentile(uEffList, totalW * 0.5)
    }

    for (const p of products) {
      // size-less products can't serve ml/g demands (spec 5.3: they stay out of
      // unit comparison; pcs needs use default pack quantities)
      if (!p.size && (need.baseUnit === 'ml' || need.baseUnit === 'g')) {
        if (!(p.id in lockMap)) continue
      }
      const c = buildCandidate(p, need, d, r, H, config, household, lockMap.get(p.id), context, adv && advActive ? adv : undefined)
      if (c) ctx.candidates.push(c)
    }
    if (!ctx.candidates.length) continue
    needCtxs.push(ctx)
  }

  // ---------- Stage 4: sweet-spot targets
  // B_ref: quick reference cost at π=0.5
  let bRef = 0
  for (const ctx of needCtxs) {
    if (ctx.medianUEff != null && ctx.medianUEff > 0) {
      bRef += (ctx.demand.qtyBaseUnit * ctx.medianUEff) / 1 // fils
    } else {
      // fallback: median pack price × estimated packs
      const med = median(ctx.candidates.map((c) => c.costFils))
      const estPacks = Math.max(1, Math.round(ctx.demand.qtyBaseUnit / Math.max(1, avgPackQty(ctx.candidates))))
      bRef += med * estPacks
    }
  }
  for (const fs of fixedSpends) bRef += fs.fils

  const fixedTotal = fixedSpends.reduce((s, f) => s + f.fils, 0)
  const mandatoryReserve = Math.round(budget.fils * config.reservePct)
  const bAvail = budget.fils - fixedTotal - mandatoryReserve
  const T = bRef > 0 ? bAvail / bRef : 1.5

  for (const ctx of needCtxs) {
    const userBias = household.prefs.qualityBias[ctx.need.id] ?? 0
    const globalBias = household.prefs.globalQualityBias ?? 0
    // advanced: custom-mode offset + per-category quality tier
    const modeOffset = input.mode === 'custom' && adv && advActive
      ? clamp((adv.lifestyle.customModeOffsetPct ?? 0) / 100, -0.35, 0.25)
      : (MODE_OFFSET[input.mode] ?? 0)
    const tierOffset = adv && advActive ? (TIER_OFFSET[adv.categoryTiers[ctx.need.category] as 'econ' | 'standard' | 'premium'] ?? 0) : 0
    let pi = 0.5 + config.A * Math.tanh(config.kappa * (T - 1)) + (CLASS_DELTA[ctx.need.clazz] ?? 0) + userBias * 0.25 + globalBias * 0.15 + modeOffset + tierOffset
    // tightness: severe shortfall pushes down harder
    if (T < 0.75) pi -= (0.75 - T) * 0.25
    ctx.targetPi = clamp(pi, config.piMin, config.piMax)
  }

  // score all candidates — percentiles computed in ONE pass per need (O(N log N))
  for (const ctx of needCtxs) {
    const ranked = [...ctx.candidates]
      .map((c) => ({ id: c.product.id, v: c.uEff ?? c.costFils, w: weightOf(c.product) }))
      .sort((a, b) => a.v - b.v || a.id.localeCompare(b.id))
    const totalW = ranked.reduce((s, x) => s + x.w, 0) || 1
    let acc = 0
    const piMap = new Map<string, number>()
    for (const x of ranked) {
      piMap.set(x.id, clamp(acc / totalW, 0, 1))
      acc += x.w
    }
    for (const c of ctx.candidates) {
      c.percentile = piMap.get(c.product.id) ?? 0.5
      c.score = scoreCandidate(c, ctx, config, household, context, adv && advActive ? adv : undefined)
    }
    // safety filters (spec 6.7-5)
    ctx.candidates = ctx.candidates.filter((c) => {
      if (c.product.id in lockMap) return true
      if (ctx.medianUEff != null && c.uEff != null) {
        const ratio = c.uEff / ctx.medianUEff
        if (ratio > config.maxMedianMultiple) return false
        if (ratio < config.minMedianMultiple && c.product.storesCount < 5) return false
      }
      return true
    })
    // sort by score desc, stable tie-break
    ctx.candidates.sort((a, b) => b.score - a.score || (b.uEff ?? 9e9) - (a.uEff ?? 9e9) || b.product.storesCount - a.product.storesCount || a.product.id.localeCompare(b.product.id))
  }

  // ---------- Stage 5: shortlists (≤8, tier representation)
  for (const ctx of needCtxs) {
    const tiers = { econ: [] as Candidate[], mid: [] as Candidate[], prem: [] as Candidate[] }
    for (const c of ctx.candidates) {
      if (c.percentile < 0.33) tiers.econ.push(c)
      else if (c.percentile < 0.7) tiers.mid.push(c)
      else tiers.prem.push(c)
    }
    const short: Candidate[] = []
    const pushTop = (arr: Candidate[], n: number) => {
      for (const c of arr.slice(0, n)) if (!short.includes(c)) short.push(c)
    }
    pushTop(tiers.mid, 4)
    pushTop(tiers.econ, 2)
    pushTop(tiers.prem, 2)
    // favorite brands ensured
    for (const fb of household.prefs.favoriteBrands) {
      const hit = ctx.candidates.find((c) => (c.product.brandNorm ?? '').includes(fb))
      if (hit && !short.includes(hit)) short.push(hit)
    }
    // Pareto-ish trim: drop options that cost more AND score less AND cover less
    ctx.shortlist = short.slice(0, 8).filter((c, i, arr) =>
      i === arr.findIndex((o) => !(o.costFils <= c.costFils && o.score >= c.score && o.coverage >= c.coverage && (o.product.id !== c.product.id)))
    )
    if (!ctx.shortlist.length && ctx.candidates.length) ctx.shortlist = ctx.candidates.slice(0, 4)
  }

  // ---------- Envelopes (spec 6.20): assortment per spend level
  const envelopeResults: EnvelopeResult[] = []
  const envelopeOptions: { env: BudgetEnvelope; levels: { spendFils: number; items: PlanItem[]; utility: number }[] }[] = []
  const groups = getGenericGroups()
  for (const env of input.envelopes) {
    const solved = solveEnvelope(env, groups, catalog, household, context, config, H)
    envelopeOptions.push(solved)
  }

  // ---------- Stage 6: greedy MCKP allocation
  const mandatoryCtxs = needCtxs.filter((c) => c.need.clazz === 'mandatory')
  const otherCtxs = needCtxs.filter((c) => c.need.clazz !== 'mandatory')

  // choose base (cheapest acceptable) for each need
  for (const ctx of needCtxs) {
    const lock = ctx.candidates.find((c) => c.product.id in lockMap)
    if (lock) { ctx.chosen = lock; continue }
    const acceptable = ctx.shortlist.length ? ctx.shortlist : ctx.candidates
    // base = cheapest by uEff/cost with sane coverage
    let base: Candidate | null = null
    for (const c of [...acceptable].sort((a, b) => (a.uEff ?? a.costFils) - (b.uEff ?? b.costFils))) {
      if (c.coverage >= Math.min(config.minCoverageEssential, 0.85) || ctx.need.clazz === 'treat' || ctx.need.clazz === 'comfort') { base = c; break }
      if (!base) base = c
    }
    ctx.chosen = base ?? acceptable[0] ?? null
  }

  // envelope chosen levels start at level 0 (min)
  const envChoice = new Map<string, number>() // envelopeId -> level index
  for (const eo of envelopeOptions) envChoice.set(eo.env.id, 0)

  const spentBase = (): number => {
    let s = fixedTotal
    for (const ctx of needCtxs) if (ctx.chosen) s += ctx.chosen.costFils
    for (const eo of envelopeOptions) {
      const idx = envChoice.get(eo.env.id) ?? 0
      s += eo.levels[idx]?.spendFils ?? 0
    }
    return s
  }

  // ---------- Shortfall ladder (spec 6.10): transparent reduction when base > budget
  // Order: treats -> comfort -> downgrade regular products -> downgrade essential
  // products -> reduce regular quantities -> reduce essential quantities (last resort).
  // Infant/mandatory items are NEVER touched.
  const ladderCuts: string[] = []
  {
    const target0 = Math.round(budget.fils * (1 - config.reservePct))
    const over0 = () => Math.max(0, spentBase() - target0)
    if (spentBase() > target0) {
      // 1) drop treats entirely
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'treat')) {
        if (over0() === 0) break
        if (ctx.chosen) { ladderCuts.push(`حذف «${ctx.need.nameAr}» (بند ترفيهي) بسبب ضيق الميزانية`); ctx.chosen = null }
      }
      // 2) drop comfort
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'comfort')) {
        if (over0() === 0) break
        if (ctx.chosen) { ladderCuts.push(`حذف «${ctx.need.nameAr}» (بند رفاهية) بسبب ضيق الميزانية`); ctx.chosen = null }
      }
      // 3) downgrade regular products: affordable pack (sane unit price, lowest total)
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'regular' && c.chosen)) {
        if (over0() === 0) break
        const cheapest = affordableSwap(ctx)
        if (cheapest && cheapest.costFils < ctx.chosen!.costFils) { ladderCuts.push(`تخفيض «${ctx.need.nameAr}» إلى عبوة أوفر`); ctx.chosen = cheapest }
      }
      // 4) downgrade essential products: affordable pack
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'essential' && c.chosen)) {
        if (over0() === 0) break
        const cheapest = affordableSwap(ctx)
        if (cheapest && cheapest.costFils < ctx.chosen!.costFils) { ladderCuts.push(`تخفيض «${ctx.need.nameAr}» إلى عبوة أوفر`); ctx.chosen = cheapest }
      }
      // 5) reduce regular quantities (and swap to smaller packs when k=1)
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'regular' && c.chosen)) {
        if (over0() === 0) break
        if (ctx.chosen!.k > 1) {
          const drop = Math.max(1, Math.floor(over0() / ctx.chosen!.packPriceFils))
          const k = Math.max(1, ctx.chosen!.k - drop)
          if (k < ctx.chosen!.k) {
            ladderCuts.push(`تقليص كمية «${ctx.need.nameAr}» إلى ${k} عبوة (تغطية أقل)`)
            ctx.chosen = withK(ctx.chosen!, k, config)
          }
        } else {
          const smaller = affordableSwap(ctx)
          if (smaller && smaller.costFils < ctx.chosen!.costFils) { ladderCuts.push(`تخفيض «${ctx.need.nameAr}» إلى عبوة أصغر`); ctx.chosen = smaller }
        }
      }
      // 6) reduce essential quantities (last resort, never below 1 pack)
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'essential' && c.chosen)) {
        if (over0() === 0) break
        if (ctx.chosen!.k > 1) {
          const drop = Math.max(1, Math.floor(over0() / ctx.chosen!.packPriceFils))
          const k = Math.max(1, ctx.chosen!.k - drop)
          if (k < ctx.chosen!.k) {
            ladderCuts.push(`تقليص كمية «${ctx.need.nameAr}» إلى ${k} عبوة لتلائم الميزانية`)
            ctx.chosen = withK(ctx.chosen!, k, config)
          }
        } else {
          const smaller = affordableSwap(ctx)
          if (smaller && smaller.costFils < ctx.chosen!.costFils) { ladderCuts.push(`تخفيض «${ctx.need.nameAr}» إلى عبوة أصغر`); ctx.chosen = smaller }
        }
      }
    }
  }

  // utility of an option (concave g on score, coverage multiplier)
  // ADVANCED: allocation enforcement multiplies utility per group so the greedy
  // upgrades steer spend toward the user's target percentages (soft constraint).
  const allocMap = new Map<string, AllocGroupId>()
  for (const [g, def] of Object.entries(ALLOC_GROUPS)) {
    for (const n of def.needs) allocMap.set(n, g as AllocGroupId)
  }
  const allocTargets = normalizeAllocation(adv?.allocation ?? DEFAULT_ALLOCATION)
  const allocEnforce = !!(adv && advActive && adv.allocation.enforce)
  const baseNeedIdOf = (id: string) => (id.includes('@') ? id.slice(0, id.indexOf('@')) : id)
  const allocGroupOf = (needId: string): AllocGroupId | undefined => allocMap.get(baseNeedIdOf(needId))

  const computeAllocAchieved = (): Record<string, number> => {
    const filsByGroup: Record<string, number> = {}
    let total = fixedTotal
    for (const ctx of needCtxs) {
      if (!ctx.chosen) continue
      const g = allocGroupOf(ctx.demand.needId) ?? 'other'
      filsByGroup[g] = (filsByGroup[g] ?? 0) + ctx.chosen.costFils
      total += ctx.chosen.costFils
    }
    for (const eo of envelopeOptions) {
      const idx = envChoice.get(eo.env.id) ?? 0
      const s = eo.levels[idx]?.spendFils ?? 0
      filsByGroup['treats'] = (filsByGroup['treats'] ?? 0) + s
      total += s
    }
    const out: Record<string, number> = {}
    for (const [g, f] of Object.entries(filsByGroup)) out[g] = total > 0 ? (f / total) * 100 : 0
    return out
  }
  const allocW = (needId: string, achieved: Record<string, number>): number => {
    if (!allocEnforce) return 1
    const g = allocGroupOf(needId)
    if (!g) return 1
    const target = allocTargets[g] ?? 0
    const ach = achieved[g] ?? 0
    return clamp(1 + ((target - ach) / 100) * 1.2, 0.6, 1.7)
  }

  const optionUtility = (ctx: NeedCtx, c: Candidate, achieved: Record<string, number>): number => {
    const W = CLASS_WEIGHT[ctx.need.clazz] ?? 0.5
    const g = c.score / (c.score + 0.45) // concave
    const cov = Math.min(1.15, c.coverage)
    const covPenalty = ctx.need.clazz === 'essential' && cov < config.minCoverageEssential ? 0.35 : 1
    return W * g * Math.min(1.15, cov) * covPenalty * allocW(ctx.demand.needId, achieved)
  }

  const spent = (): number => spentBase()

  // upgrade queue: (needCtx, candidate) pairs + envelope level upgrades
  type Upgrade = { kind: 'need' | 'env'; ctx?: NeedCtx; cand?: Candidate; envId?: string; fromLevel?: number; toLevel?: number; fromCost: number; toCost: number; fromU: number; toU: number }
  const buildUpgrades = (): Upgrade[] => {
    const achieved = computeAllocAchieved()
    const ups: Upgrade[] = []
    for (const ctx of otherCtxs) {
      if (!ctx.chosen) continue
      for (const c of ctx.shortlist) {
        if (c === ctx.chosen) continue
        const fromU = optionUtility(ctx, ctx.chosen, achieved)
        const toU = optionUtility(ctx, c, achieved)
        if (toU > fromU && c.costFils > ctx.chosen.costFils) {
          ups.push({ kind: 'need', ctx, cand: c, fromCost: ctx.chosen.costFils, toCost: c.costFils, fromU, toU })
        }
      }
      // quantity/coverage upgrade: buy one more pack of the chosen product
      if (ctx.chosen.k < 60 && ctx.chosen.k > 0) {
        const next = withK(ctx.chosen, ctx.chosen.k + 1, config)
        if (next.coverage > ctx.chosen.coverage + 0.005) {
          const fromU = optionUtility(ctx, ctx.chosen, achieved)
          const toU = optionUtility(ctx, next, achieved)
          if (toU > fromU) {
            ups.push({ kind: 'need', ctx, cand: next, fromCost: ctx.chosen.costFils, toCost: next.costFils, fromU, toU })
          }
        }
      }
    }
    for (const eo of envelopeOptions) {
      const cur = envChoice.get(eo.env.id) ?? 0
      const from = eo.levels[cur]
      if (!from) continue
      for (let i = cur + 1; i < eo.levels.length; i++) {
        const to = eo.levels[i]!
        if (to.utility > from.utility) {
          ups.push({ kind: 'env', envId: eo.env.id, fromLevel: cur, toLevel: i, fromCost: from.spendFils, toCost: to.spendFils, fromU: from.utility, toU: to.utility })
          break // next level only (incremental upgrades)
        }
      }
    }
    return ups.sort((a, b) => (b.toU - b.fromU) / Math.max(1, b.toCost - b.fromCost) - (a.toU - a.fromU) / Math.max(1, a.toCost - a.fromCost))
  }

  const target = Math.round(budget.fils * (1 - config.reservePct))
  // greedy upgrades while budget allows and marginal utility worth it
  let guard = 0
  while (guard++ < 600) {
    const ups = buildUpgrades()
    const next = ups.find((u) => {
      const dCost = u.toCost - u.fromCost
      const dU = u.toU - u.fromU
      if (dCost <= 0) return true // free improvement
      if (spent() + dCost > target) return false
      return dU / dCost >= config.lambdaMin
    })
    if (!next) break
    if (next.kind === 'need' && next.ctx && next.cand) next.ctx.chosen = next.cand
    if (next.kind === 'env' && next.envId != null && next.toLevel != null) envChoice.set(next.envId, next.toLevel)
  }

  // treat cap: treats can't exceed cap of budget unless envelope must
  {
    let treatFils = needCtxs.filter((c) => c.need.clazz === 'treat').reduce((s, c) => s + (c.chosen?.costFils ?? 0), 0)
    const cap = Math.round(budget.fils * config.treatCapPct)
    if (treatFils > cap) {
      for (const ctx of needCtxs.filter((c) => c.need.clazz === 'treat').sort((a, b) => (b.chosen?.costFils ?? 0) - (a.chosen?.costFils ?? 0))) {
        if (treatFils <= cap) break
        // downgrade to cheapest acceptable or drop
        const cheapest = [...(ctx.shortlist.length ? ctx.shortlist : ctx.candidates)].sort((a, b) => (a.uEff ?? a.costFils) - (b.uEff ?? b.costFils))[0]
        if (cheapest && cheapest.costFils < (ctx.chosen?.costFils ?? 0)) { treatFils -= ctx.chosen!.costFils - cheapest.costFils; ctx.chosen = cheapest }
        else { treatFils -= ctx.chosen?.costFils ?? 0; ctx.chosen = null }
      }
    }
  }

  // ---------- Stage 6.5: local-search refinement (hill-climbing, NEW algorithm)
  // Multi-pass improvement over the greedy solution: swaps within shortlists
  // AND quantity downgrades, weighted by allocation targets. Deterministic order.
  let refinementPasses = 0
  let refinementGains = 0
  {
    const orderedCtxs = [...needCtxs]
      .sort((a, b) => b.demand.qtyBaseUnit - a.demand.qtyBaseUnit || a.need.id.localeCompare(b.need.id))
    for (let pass = 0; pass < 3; pass++) {
      const achieved = computeAllocAchieved()
      let improved = false
      for (const ctx of orderedCtxs) {
        if (ctx.need.clazz === 'mandatory') continue
        if (!ctx.chosen) continue
        if (ctx.chosen.product.id in lockMap) continue
        const curU = optionUtility(ctx, ctx.chosen, achieved)
        let bestC = ctx.chosen
        let bestU = curU
        const pool = ctx.shortlist.length ? ctx.shortlist : ctx.candidates.slice(0, 8)
        for (const c of pool) {
          if (c === ctx.chosen || c.product.id in lockMap) continue
          const dCost = c.costFils - ctx.chosen.costFils
          if (spent() + dCost > target) continue
          const u = optionUtility(ctx, c, achieved)
          if (u > bestU + 1e-6) { bestU = u; bestC = c }
        }
        // quantity refinement: one pack down when utility holds (waste trim)
        if (ctx.chosen.k > 1) {
          const down = withK(ctx.chosen, ctx.chosen.k - 1, config)
          const u = optionUtility(ctx, down, achieved)
          if (u > bestU + 1e-6) { bestU = u; bestC = down }
        }
        if (bestC !== ctx.chosen) {
          refinementGains += bestU - curU
          ctx.chosen = bestC
          improved = true
        }
      }
      refinementPasses = pass + 1
      if (!improved) break
    }
  }

  // ---------- assemble plan items
  const items: PlanItem[] = []
  const fixedItems: PlanItem[] = []

  for (const ctx of needCtxs) {
    const c = ctx.chosen
    if (!c) continue
    const isFixed = ctx.need.clazz === 'mandatory' || c.product.id in lockMap
    const item = makeItem(ctx, c, isFixed, 1)
    ;(isFixed ? fixedItems : items).push(item)
  }

  // fixed manual spends (tobacco manual entry etc.)
  for (const fs of fixedSpends) {
    fixedItems.push({
      key: `fixed-${fs.needId}-${stableId([fs.label])}`,
      productId: `manual:${fs.needId}`,
      needId: fs.needId,
      productName: fs.label,
      brand: null, sizeText: null, packQty: 1, unitQtyBase: 0,
      costFils: fs.fils, unitCostFils: null, storeId: null,
      wastePct: 0, coverage: 1, score: 1, percentile: 0.5, locked: true,
      reasons: [{ code: 'habit-fixed', ar: fs.note }], alternatives: [], trip: 1,
    })
  }

  // envelopes: choose level (respect priority & budget)
  for (const eo of envelopeOptions) {
    const env = eo.env
    const chosenLevelIdx = envChoice.get(env.id) ?? 0
    let level = eo.levels[Math.max(0, Math.min(chosenLevelIdx, eo.levels.length - 1))] ?? eo.levels[0]
    if (!level) continue
    // priority must: min reserved regardless
    if (env.priority === 'must' && env.minFils && level.spendFils < env.minFils) {
      level = eo.levels.find((l) => l.spendFils >= env.minFils!) ?? level
    }
    // clamp to budget headroom
    const headroom = target - spent() + (eo.levels[chosenLevelIdx]?.spendFils ?? 0)
    if (level.spendFils > headroom) {
      const affordable = eo.levels.filter((l) => l.spendFils <= headroom)
      level = (env.priority === 'must' ? affordable[affordable.length - 1] : affordable[0]) ?? eo.levels[0] ?? level
    }
    const er: EnvelopeResult = {
      envelopeId: env.id, name: env.name, spentFils: level.spendFils,
      minFils: env.minFils, maxFils: env.maxFils,
      items: level.items, explanation: [], variety: 0,
    }
    envelopeResults.push(er)
    ;(eo as unknown as { finalLevel?: typeof level }).finalLevel = level
  }

  // ---------- Stage 7: stores (advanced: banned stores, max split, fee inclusion)
  const { storeSplits, savingsVsMedianFils: savingsVsMedian } = optimizeStores(items, fixedItems, catalog, context, input.envelopes.length ? envelopeResults.flatMap((e) => e.items) : [], adv && advActive ? adv : undefined)

  // ---------- Stage 8: invariants & local polish
  const finalAllocAchieved = computeAllocAchieved()
  const allocationDiag = (Object.keys(ALLOC_GROUPS) as AllocGroupId[]).map((g) => ({
    group: g,
    nameAr: ALLOC_GROUPS[g].nameAr,
    targetPct: allocTargets[g] ?? 0,
    achievedPct: Math.round((finalAllocAchieved[g] ?? 0) * 10) / 10,
  }))
  const diagnostics = buildDiagnostics(items, fixedItems, envelopeResults, needCtxs, budget, target, [...warnings, ...ladderCuts], config, {
    allocation: allocationDiag,
    modeOffsetPct: input.mode === 'custom' && adv && advActive ? (adv.lifestyle.customModeOffsetPct ?? 0) : Math.round((MODE_OFFSET[input.mode] ?? 0) * 100),
    reserveFils: mandatoryReserve,
    refinementPasses,
    refinementGains: Math.round(refinementGains * 1000) / 1000,
    advancedNotes,
  })

  // ---------- Stage 9: explanations, alternatives, trips, nutrition
  for (const it of items) {
    const ctx = needCtxs.find((c) => c.demand.needId === it.needId)
    if (ctx) {
      it.reasons = explainItem(ctx, ctx.candidates.find((c) => c.product.id === it.productId) ?? null, it, config, T)
      it.alternatives = buildAlternatives(ctx, it, config)
    }
  }
  for (const er of envelopeResults) {
    const eo = envelopeOptions.find((e) => e.env.id === er.envelopeId)
    er.explanation = explainEnvelope(er, eo, household, H)
    er.variety = varietyOf(er.items)
  }

  const trips = buildTrips(items, H, context)
  const nutrition = estimateNutrition(items, needCtxs, H, household)
  const totalCost = items.reduce((s, i) => s + i.costFils, 0) + fixedItems.reduce((s, i) => s + i.costFils, 0) + envelopeResults.reduce((s, e) => s + e.spentFils, 0)
  const optimistic = items.reduce((s, i) => s + Math.round(i.costFils * 0.92), 0) + fixedItems.reduce((s, i) => s + i.costFils, 0) + envelopeResults.reduce((s, e) => s + Math.round(e.spentFils * 0.92), 0)
  const pessimistic = items.reduce((s, i) => s + Math.round(i.costFils * 1.08), 0) + fixedItems.reduce((s, i) => s + i.costFils, 0) + envelopeResults.reduce((s, e) => s + Math.round(e.spentFils * 1.08), 0)

  const fingerprint = stableId([
    ENGINE_VERSION, config.version, catalog.version, input.mode,
    stableId([JSON.stringify({ m: household.members, h: household.habits, b: budget.fils, e: input.envelopes.map((e) => e.id), l: input.locks.map((l) => l.productId), c: [context.season, context.storeMode], a: adv ? [adv.v, adv.enabled, adv.lifestyle, adv.weights, adv.allocation, adv.diet, adv.needOverrides, adv.categoryTiers, adv.stores] : null })]),
  ])

  return {
    fingerprint,
    engineVersion: ENGINE_VERSION,
    configVersion: config.version,
    mode: input.mode,
    horizonDays: H,
    demand: demandList,
    items,
    envelopes: envelopeResults,
    trips,
    storeSplits,
    totals: {
      costFils: totalCost,
      optimisticFils: optimistic,
      pessimisticFils: pessimistic,
      savingsVsMedianFils: savingsVsMedian,
      wastePct: diagnostics.wastePct,
      coverageEssentials: diagnostics.coverageMin,
    },
    diagnostics,
    nutrition,
    fixedItems,
    generatedAt,
  }
}

// ---------------------------------------------------------------------------
// helpers

function clamp(x: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, x)) }

function weightOf(p: CatalogProduct): number { return 1 + p.storesCount + Math.max(0, 300 - p.rank) / 100 }

function weightedPercentile(sorted: { v: number; w: number }[], targetW: number): number {
  let acc = 0
  for (const x of sorted) {
    acc += x.w
    if (acc >= targetW) return x.v
  }
  return sorted[sorted.length - 1]?.v ?? 0
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

function avgPackQty(cs: Candidate[]): number {
  const qs = cs.map((c) => c.product.size?.baseQuantity).filter((q): q is number => q != null && q > 0)
  return qs.length ? median(qs) : 1
}

/** effective unit price used for percentiles (uEff-based when possible) */
function effectiveUnitFils(p: CatalogProduct, need: NeedDef): number | null {
  if (p.unitPriceFils && p.unitPriceFils > 0) return p.unitPriceFils
  if (need.baseUnit === 'pcs') return p.medianFils
  return null
}

function percentileOf(ctx: NeedCtx, c: Candidate): number {
  // candidates already sorted by effective price ascending? compute from scratch for determinism
  const list = ctx.candidates
    .map((x) => ({ id: x.product.id, v: x.uEff ?? x.costFils, w: weightOf(x.product) }))
    .sort((a, b) => a.v - b.v || a.id.localeCompare(b.id))
  const totalW = list.reduce((s, x) => s + x.w, 0)
  let acc = 0
  const myV = c.uEff ?? c.costFils
  for (const x of list) {
    if (x.id === c.product.id) return clamp(acc / totalW, 0, 1)
    if (x.v < myV) acc += x.w
    else if (x.v === myV && x.id.localeCompare(c.product.id) < 0) acc += x.w
  }
  return clamp(acc / Math.max(1, totalW), 0, 1)
}

function scoreCandidate(c: Candidate, ctx: NeedCtx, config: AlgorithmConfig, household: Household, context: PlanContext, adv?: AdvancedProfile): number {
  const piDiff = c.percentile - ctx.targetPi
  const gauss = Math.exp(-(piDiff * piDiff) / (2 * config.sigma * config.sigma))
  let availability = Math.min(1, c.product.storesCount / 8) * (context.availableStores.length ? (context.availableStores.some((s) => c.product.prices[s]) ? 1 : 0.4) : 1)
  if (adv) {
    // preferred stores raise availability confidence; banned stores lower it
    const carried = Object.keys(c.product.prices).filter((s) => adv.stores.banned.includes(s)).length
    if (carried > 0 && carried >= Object.keys(c.product.prices).length) availability *= 0.5
    if (adv.stores.preferred.some((s) => c.product.prices[s])) availability = Math.min(1, availability * 1.15 + 0.05)
  }
  const popularity = clamp(1 - c.product.rank / 400, 0, 1) * 0.6 + Math.min(1, c.product.storesCount / 10) * 0.4
  const brandNorm = c.product.brandNorm ?? ''
  let brandTrust = 0.5
  if (brandNorm) {
    if (household.prefs.favoriteBrands.some((b) => brandNorm.includes(b))) brandTrust = 1
    else if (household.prefs.brandAffinity && household.prefs.brandAffinity[c.product.brand ?? '']) brandTrust = clamp(0.5 + household.prefs.brandAffinity[c.product.brand ?? '']!, 0, 1)
  }
  let pref = prefScore(c, household)
  if (adv) {
    pref = clamp(pref + dietPrefBoost(adv.diet, c.product.nameEn, c.product.nameAr, c.product.tags, c.product.category) * 0.6, 0, 1.5)
  }
  const waste = c.wastePct
  const conf = c.product.dataConfidence

  const score = config.wTarget * gauss
    + config.wFit * c.fit
    + config.wValue * (1 - c.percentile)
    + config.wAvail * availability
    + config.wPop * popularity
    + config.wBrand * brandTrust
    + config.wPref * pref
    - config.wWaste * waste
    - config.wConf * (1 - conf)

  // transparent score composition — percentages per user-facing bucket
  const mags: Record<string, number> = {
    target: Math.abs(config.wTarget * gauss),
    quality: Math.abs(config.wFit * c.fit),
    value: Math.abs(config.wValue * (1 - c.percentile)),
    brand: Math.abs(config.wBrand * brandTrust + config.wPref * pref),
    local: Math.abs(config.wAvail * availability + config.wPop * popularity),
    penalty: Math.abs(config.wWaste * waste + config.wConf * (1 - conf)),
  }
  const magSum = Object.values(mags).reduce((s, x) => s + x, 0) || 1
  c.scoreParts = {}
  for (const [k, v] of Object.entries(mags)) c.scoreParts[k] = Math.round((v / magSum) * 1000) / 10
  return score
}

function prefScore(c: Candidate, household: Household): number {
  let s = 0.5
  const tags = c.product.tags
  if (household.dietary.sugarFree && tags.includes('dietary:sugar-free')) s += 0.3
  if (household.dietary.lowSodium && tags.includes('sodium:low')) s += 0.3
  if (household.dietary.glutenFree && tags.includes('dietary:gluten-free')) s += 0.3
  if (household.dietary.lactoseFree && tags.includes('dietary:lactose-free')) s += 0.3
  // flavor affinity from habit answers (soft)
  return clamp(s, 0, 1)
}
function buildCandidate(
  p: CatalogProduct, need: NeedDef, d: DemandItem, r: number, H: number,
  config: AlgorithmConfig, household: Household, lock: LockedChoice | undefined,
  context: PlanContext, adv?: AdvancedProfile
): Candidate | null {
  // hard filters (spec 6.4)
  if (p.available !== true) return null
  if (household.prefs.blockedProducts.includes(p.id)) return null
  if (p.brandNorm && household.prefs.blockedBrands.some((b) => p.brandNorm!.includes(b))) return null
  // dietary
  if (household.dietary.nutFree) {
    const hay = `${p.nameEn} ${p.nameAr}`.toLowerCase()
    if (/nut|مكسر|بندق|فستق|كاجو|عين جمل|كاشيو|peanut|almond|hazelnut|walnut|pistachio/.test(hay)) return null
  }
  // ADVANCED: product-level diet filters (~34 flags)
  if (adv && productBlockedByDiet(adv.diet, p.nameEn, p.nameAr, p.tags)) return null
  // ADVANCED: banned stores — product must keep at least one usable price reference
  if (adv && adv.stores.banned.length) {
    const usableStores = Object.keys(p.prices).filter((s) => !adv.stores.banned.includes(s))
    if (usableStores.length === 0) return null
  }
  // baby constraints (base need ids; variants already pre-filtered above)
  const baseId = need.id
  if (baseId === 'formula') {
    const currentBrand = String(household.habits['formula']?.currentBrand ?? '').toLowerCase()
    if (currentBrand && p.brandNorm && !p.brandNorm.includes(currentBrand)) return null
    // special formula types
    const special = String(household.habits['formula']?.specialType ?? '')
    if (special && special !== 'standard') {
      const hay = `${p.nameEn} ${p.nameAr}`.toLowerCase()
      const markers: Record<string, RegExp> = {
        lactose: /lactose|لاكتوز/, ha: /\bha\b|hypoallerg|حساسية/, ar: /\bar\b|reflux|ارتجاع/, soy: /soy|صويا/, goat: /goat|ماعز/,
      }
      const m = markers[special]
      if (m && !m.test(hay)) return null
    }
  }
  if (baseId === 'diapers') {
    const dtype = String(household.habits['diapers']?.type ?? '')
    if (dtype === 'pants') {
      const hay = `${p.nameEn} ${p.nameAr}`.toLowerCase()
      if (!/pants|سروال|pull/.test(hay)) return null
    }
  }
  // store availability when restricted
  if (context.availableStores.length && context.storeMode !== 'median') {
    if (!context.availableStores.some((s) => p.prices[s]?.fils)) return null
  }

  // structural guard: unit families must match (ml product can't serve a g need)
  if (p.size) {
    const sizeUnit = p.size.unit
    if (need.baseUnit === 'g' && (sizeUnit === 'ml' || sizeUnit === 'bags')) return null
    if (need.baseUnit === 'ml' && (sizeUnit === 'g' || sizeUnit === 'rolls' || sizeUnit === 'sheets')) return null
    if ((need.baseUnit === 'rolls' || need.baseUnit === 'sheets') && sizeUnit !== need.baseUnit && sizeUnit !== 'pcs') return null
  }

  // pack fit simulation
  let q = p.size?.baseQuantity ?? DEFAULT_PACK_QTY[need.id] ?? 1
  if (need.id === 'tea' && p.size?.unit === 'g') q = Math.max(1, Math.round(p.size.baseQuantity / 2)) // loose tea ≈ 2g/bag
  const sOpen = need.shelfOpenedDays
  const sSealed = need.shelfSealedDays
  const c = priceFor(p, context)

  let k: number
  let weeklyTrips = 1
  let demandUnits = d.qtyBaseUnit
  if (need.weeklyTrip) {
    const weekUnits = r * 7.2
    const kPerTrip = Math.max(1, Math.ceil((weekUnits * (1 - config.allowShortfallPct)) / q))
    // ADVANCED: trips rhythm preference (monthly/biweekly/weekly/twice-weekly)
    const prefTrips = adv ? tripsPerMonth(adv.lifestyle.tripsPreference) : null
    weeklyTrips = prefTrips != null ? Math.max(1, Math.round(prefTrips * (H / 30))) : Math.max(1, Math.ceil(H / 7))
    k = kPerTrip * weeklyTrips
    demandUnits = r * 7.2 * weeklyTrips
  } else {
    const floorK = Math.floor((demandUnits * (1 - config.allowShortfallPct)) / q)
    const ceilK = Math.ceil(demandUnits / q)
    k = chooseK(demandUnits, q, r, sOpen, sSealed, c, floorK, ceilK, config)
  }
  if (lock?.qty && lock.qty > 0) k = lock.qty
  k = clamp(k, 0, 60)
  if (k === 0) return null

  const perPackUsable = Math.min(q, r * sOpen)
  // sealed expiry evaluated per trip for weekly needs (spec 6.5 batch purchasing)
  const packsPerTrip0 = Math.max(1, Math.ceil(k / Math.max(1, weeklyTrips)))
  const tripConsumptionDays0 = ((packsPerTrip0 - 1) * q) / Math.max(1e-9, r)
  const sealedLossUnits = Math.max(0, tripConsumptionDays0 - sSealed) * r * Math.max(1, weeklyTrips)
  const usable = Math.max(0, Math.min(k * q, k * perPackUsable - sealedLossUnits))
  const bought = k * q
  const wastePct = bought > 0 ? clamp(1 - usable / bought, 0, 1) : 0
  const coverage = demandUnits > 0 ? usable / demandUnits : 1
  const costFils = k * c
  const uEff = usable > 0 ? costFils / usable : null
  const kComfort = need.weeklyTrip
    ? weeklyTrips * clamp(Math.ceil((r * 7.2) / q), 1, 3)
    : clamp(Math.round(demandUnits / q / 2) || 1, 1, config.kComfort + 2)
  // ADVANCED: pack-size bias multiplier (applies inside fit here AND in withK)
  let packBiasF = 1
  if (adv) {
    const bias = adv.lifestyle.packSizeBias
    if (bias === 'small' && q > 2500) packBiasF = 0.78
    else if (bias === 'small' && q > 1200) packBiasF = 0.9
    else if (bias === 'large' && q < 300) packBiasF = 0.78
    else if (bias === 'large' && q > 400) packBiasF = 1.08
    else if (bias === 'medium' && (q > 6000 || q < 150)) packBiasF = 0.92
    if (adv.diet.preferFamilyPacks && q >= 400) packBiasF *= 1.06
  }
  const fit = packBiasF * Math.exp(-wastePct / config.tauW) * Math.exp(-Math.abs(Math.log(Math.max(1, k) / kComfort)) / config.tauK) * (k > 6 * kComfort ? 0.4 : 1)

  return {
    product: p, k, packPriceFils: c, q, r, sOpen, sSealed, demandUnits, kComfort,
    costFils, unitQty: bought, usable, wastePct, coverage, uEff, fit,
    percentile: 0.5, score: 0, storeId: null, weeklyTrips, packBiasF,
  }
}

function chooseK(d: number, q: number, r: number, sOpen: number, sSealed: number, c: number, floorK: number, ceilK: number, config: AlgorithmConfig): number {
  const uRef = c / Math.max(1e-9, q) // naive unit price as reference for penalties
  let best = Math.max(1, ceilK)
  let bestPenalty = Infinity
  for (const k of new Set([Math.max(0, floorK), Math.max(1, ceilK), Math.max(1, Math.ceil(d * (1 - config.allowShortfallPct) / q))])) {
    if (k <= 0) continue
    const perPackUsable = Math.min(q, r * sOpen)
    const usable = Math.max(0, Math.min(k * q, k * perPackUsable)) // per-trip expiry handled outside
    const wasteValue = (k * q - usable) * uRef
    const shortage = Math.max(0, d - usable)
    const penalty = k * c + wasteValue * 1.2 + shortage * uRef * 2.5 + k * 0.2 // small pack-count penalty
    if (penalty < bestPenalty) { bestPenalty = penalty; best = k }
  }
  return best
}

function priceFor(p: CatalogProduct, context: PlanContext): number {
  if (context.storeMode === 'median' || !context.availableStores.length) return p.medianFils
  const avail = context.availableStores.map((s) => p.prices[s]?.fils).filter((f): f is number => f != null && f > 0)
  if (!avail.length) return p.medianFils
  return Math.min(...avail)
}

function makeItem(ctx: NeedCtx, c: Candidate, locked: boolean, trip: number): PlanItem {
  return {
    key: `${ctx.demand.needId}-${c.product.id}`,
    productId: c.product.id,
    needId: ctx.demand.needId,
    productName: displayName(c.product),
    brand: c.product.brand,
    sizeText: c.product.sizeText,
    packQty: c.k,
    unitQtyBase: Math.round(c.unitQty * 100) / 100,
    costFils: c.costFils,
    unitCostFils: c.uEff != null ? Math.round(c.uEff * 100) / 100 : null,
    storeId: c.storeId,
    wastePct: Math.round(c.wastePct * 1000) / 10,
    coverage: Math.round(Math.min(2, c.coverage) * 1000) / 1000,
    score: Math.round(c.score * 1000) / 1000,
    percentile: Math.round(c.percentile * 1000) / 1000,
    scoreParts: c.scoreParts,
    locked,
    reasons: [],
    alternatives: [],
    trip: ctx.need.weeklyTrip ? Math.min(2, c.weeklyTrips) : 1,
  }
}

export function displayName(p: CatalogProduct): string {
  return p.nameAr?.trim() || p.nameEn?.trim() || p.brand || p.id
}

// ---------------------------------------------------------------------------
// Stage 7: store optimization

function optimizeStores(items: PlanItem[], fixedItems: PlanItem[], catalog: Catalog, context: PlanContext, envelopeItems: PlanItem[], adv?: AdvancedProfile): { storeSplits: StoreSplit[]; savingsVsMedianFils: number } {
  const catalogMap = new Map(catalog.products.map((p) => [p.id, p]))
  const allItems = [...items, ...fixedItems, ...envelopeItems]
  const medianTotal = allItems.reduce((s, i) => s + i.costFils, 0)

  if (context.storeMode === 'median' || context.storeMode !== 'split' && context.storeMode !== 'best-single') {
    return {
      storeSplits: [{ storeId: 'median', itemsCount: allItems.length, subtotalFils: medianTotal, deliveryFils: 0 }],
      savingsVsMedianFils: 0,
    }
  }

  const banned = new Set(adv?.stores.banned ?? [])
  const stores = (context.availableStores.length ? context.availableStores : catalog.stores.filter((s) => s.active).map((s) => s.id)).filter((s) => !banned.has(s))
  const includeFees = adv?.stores.includeDeliveryFees !== false

  if (context.storeMode === 'best-single') {
    let bestStore: string | null = null
    let bestTotal = Infinity
    for (const sid of stores) {
      const store = catalog.stores.find((s) => s.id === sid)
      if (!store || !store.active) continue
      let subtotal = 0
      let covered = 0
      for (const it of allItems) {
        const p = catalogMap.get(it.productId)
        const price = p?.prices[sid]?.fils
        if (price != null && price > 0) { subtotal += Math.round(price * it.packQty / (p?.size?.baseQuantity ? 1 : 1)) || price * it.packQty; covered++ }
        else subtotal += it.costFils
      }
      const delivery = !includeFees || subtotal >= (store.freeDeliveryThresholdFils ?? Infinity) ? 0 : store.deliveryFeeFils
      const total = subtotal + delivery
      if (total < bestTotal && covered >= Math.ceil(allItems.length * 0.6)) { bestTotal = total; bestStore = sid }
    }
    if (!bestStore) return { storeSplits: [{ storeId: 'median', itemsCount: allItems.length, subtotalFils: medianTotal, deliveryFils: 0 }], savingsVsMedianFils: 0 }
    const store = catalog.stores.find((s) => s.id === bestStore)!
    let subtotal = 0
    for (const it of allItems) {
      const p = catalogMap.get(it.productId)
      const price = p?.prices[bestStore]?.fils
      if (price != null && price > 0) { it.storeId = bestStore; subtotal += price * it.packQty }
      else subtotal += it.costFils
    }
    const delivery = !includeFees || subtotal >= (store.freeDeliveryThresholdFils ?? Infinity) ? 0 : store.deliveryFeeFils
    return {
      storeSplits: [{ storeId: bestStore, itemsCount: allItems.length, subtotalFils: subtotal, deliveryFils: delivery }],
      savingsVsMedianFils: Math.max(0, medianTotal + (includeFees ? store.deliveryFeeFils : 0) - (subtotal + delivery)),
    }
  }

  // split mode: item -> cheapest available store, then merge small stores
  const assignment = new Map<string, string>()
  for (const it of allItems) {
    const p = catalogMap.get(it.productId)
    if (!p) continue
    let bestSid: string | null = null
    let bestPrice = Infinity
    for (const sid of stores) {
      const price = p.prices[sid]?.fils
      if (price != null && price > 0 && price < bestPrice) { bestPrice = price; bestSid = sid }
    }
    if (bestSid) {
      assignment.set(it.key, bestSid)
      it.costFils = bestPrice * it.packQty
      it.storeId = bestSid
    }
  }
  // merge: move items of stores with small subtotals when fees outweigh savings
  const storeIds = [...new Set([...assignment.values()])]
  let splits: StoreSplit[] = []
  const storeMeta = new Map(catalog.stores.map((s) => [s.id, s]))
  const recompute = () => {
    splits = []
    for (const sid of storeIds) {
      const its = allItems.filter((i) => assignment.get(i.key) === sid)
      if (!its.length) continue
      const subtotal = its.reduce((s, i) => s + i.costFils, 0)
      const store = storeMeta.get(sid)
      const delivery = !includeFees || !store || subtotal >= (store.freeDeliveryThresholdFils ?? Infinity) ? 0 : store.deliveryFeeFils
      splits.push({ storeId: sid, itemsCount: its.length, subtotalFils: subtotal, deliveryFils: delivery })
    }
  }
  recompute()
  // greedy merge while > K stores (K from advanced prefs, default 3)
  const maxStores = Math.max(1, Math.min(3, adv?.stores.maxSplitStores ?? 3))
  let guard = 0
  while (splits.length > maxStores && guard++ < 20) {
    const smallest = [...splits].sort((a, b) => a.subtotalFils - b.subtotalFils)[0]
    if (!smallest) break
    const savings = smallest.deliveryFils
    const others = splits.filter((s) => s.storeId !== smallest.storeId)
    const targetStore = others.sort((a, b) => a.subtotalFils - b.subtotalFils)[0]
    if (!targetStore || savings <= 0) break
    // move items
    for (const it of allItems) {
      if (assignment.get(it.key) === smallest.storeId) {
        const p = catalogMap.get(it.productId)
        const price = p?.prices[targetStore.storeId]?.fils
        const old = it.costFils
        it.costFils = price != null && price > 0 ? price * it.packQty : old
        it.storeId = price != null ? targetStore.storeId : it.storeId
        assignment.set(it.key, price != null ? targetStore.storeId : smallest.storeId)
      }
    }
    recompute()
  }
  const totalNow = splits.reduce((s, x) => s + x.subtotalFils + x.deliveryFils, 0)
  return { storeSplits: splits, savingsVsMedianFils: Math.max(0, medianTotal - totalNow) }
}

// ---------------------------------------------------------------------------
// diagnostics

function buildDiagnostics(items: PlanItem[], fixedItems: PlanItem[], envelopes: EnvelopeResult[], needCtxs: NeedCtx[], budget: Budget, target: number, warnings: string[], config: AlgorithmConfig, extras?: { allocation?: PlanDiagnostics['allocation']; modeOffsetPct?: number; reserveFils?: number; refinementPasses?: number; refinementGains?: number; advancedNotes?: string[] }): PlanDiagnostics {
  const allItems = [...items, ...fixedItems, ...envelopes.flatMap((e) => e.items)]
  const totalCost = allItems.reduce((s, i) => s + i.costFils, 0) + envelopes.reduce((s, e) => s + e.spentFils, 0)
  const byClass = new Map<string, number>()
  for (const it of [...items, ...fixedItems]) {
    const ctx = needCtxs.find((c) => c.need.id === it.needId)
    const clazz = ctx?.need.clazz ?? 'regular'
    byClass.set(clazz, (byClass.get(clazz) ?? 0) + it.costFils)
  }
  for (const e of envelopes) byClass.set('treat', (byClass.get('treat') ?? 0) + e.spentFils)

  const essentials = needCtxs.filter((c) => c.need.clazz === 'essential' && c.chosen)
  const coverageMin = essentials.length ? Math.min(...essentials.map((c) => c.chosen!.coverage)) : 1
  const wasteAvg = items.length ? items.reduce((s, i) => s + i.wastePct, 0) / items.length : 0 // already percent
  const avgPi = items.length ? items.reduce((s, i) => s + i.percentile, 0) / items.length : 0.5
  const brands = new Set(items.map((i) => i.brand ?? ''))
  const varietyIndex = items.length ? clamp(brands.size / Math.max(4, items.length * 0.6), 0, 1) : 0
  const confidence = items.length ? items.reduce((s, i) => s + (needCtxs.find((c) => c.demand.needId === i.needId)?.candidates.find((x) => x.product.id === i.productId)?.product.dataConfidence ?? 0.7), 0) / items.length : 0.7

  const dist = [...byClass.entries()].map(([clazz, fils]) => ({ clazz: clazz as PlanDiagnostics['distributionByClass'][number]['clazz'], fils, pct: totalCost > 0 ? Math.round((fils / totalCost) * 1000) / 10 : 0 }))

  const notes: string[] = [...(extras?.advancedNotes ?? [])]
  const shortfall = Math.max(0, totalCost - target)
  const surplus = Math.max(0, target - totalCost)
  if (shortfall > 0) notes.push(`الخطة تتجاوز سقف الميزانية بمقدار ${(shortfall / 1000).toFixed(3)} د.ب — طبقنا سلّم التقليص الشفاف (الرضّع محفوظون دائماً): بنود الرضّع لا تُمسّ، ثم الأساسيات، والترفيهي يُحذف أولاً`)
  if (surplus > budget.fils * 0.25) notes.push(`يوجد وفر متوقع ≈ ${(surplus / 1000).toFixed(3)} د.ب — يمكنك ترقيته أو ادخاره`)
  const treatShare = totalCost > 0 ? (byClass.get('treat') ?? 0) / totalCost : 0
  if ((extras?.refinementPasses ?? 0) > 0) notes.push(`حسّنا الخطة بـ${extras!.refinementPasses} جولات تبديل ذكية (تحسين محلي بعد التوزيع الطماعي)`)

  return {
    totalCostFils: totalCost,
    budgetFils: budget.fils,
    targetFils: target,
    surplusFils: surplus,
    shortfallFils: shortfall,
    wastePct: Math.round(wasteAvg * 10) / 10,
    avgPercentile: Math.round(avgPi * 1000) / 1000,
    coverageMin: Math.round(coverageMin * 1000) / 1000,
    varietyIndex: Math.round(varietyIndex * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    distributionByClass: dist.sort((a, b) => b.fils - a.fils),
    allocation: extras?.allocation,
    modeOffsetPct: extras?.modeOffsetPct,
    reserveFils: extras?.reserveFils,
    treatSharePct: Math.round(treatShare * 1000) / 10,
    refinementPasses: extras?.refinementPasses,
    refinementGains: extras?.refinementGains,
    warnings,
    notes,
  }
}

// ---------------------------------------------------------------------------
// explanations & alternatives

function explainItem(ctx: NeedCtx, cand: Candidate | null, item: PlanItem, config: AlgorithmConfig, T: number): ReasonCode[] {
  const reasons: ReasonCode[] = []
  const need = ctx.need
  const unitLabelAr = need.baseUnit === 'ml' ? 'مل' : need.baseUnit === 'g' ? 'جم' : need.baseUnit === 'rolls' ? 'رول' : need.baseUnit === 'sheets' ? 'منديل' : 'حبة'
  const demandQty = Math.round(ctx.demand.qtyBaseUnit)

  reasons.push({
    code: 'demand',
    ar: `احتياج أسرتك تقديراً: ${demandQty.toLocaleString('ar-BH')} ${unitLabelAr} خلال ${ctx.demand.derivation.length ? 'الفترة' : 'الفترة'} — ${ctx.demand.derivation[0] ?? 'من قواعد الاستهلاك المرجعية'}`,
  })
  if (cand) {
    if (cand.wastePct > 0.02) {
      reasons.push({ code: 'waste', ar: `الهدر المتوقع ${item.wastePct}% فقط (الصلاحية بعد الفتح ${need.shelfOpenedDays} يوم × معدل استهلاككم اليومي)` })
    } else {
      reasons.push({ code: 'waste-none', ar: 'لا هدر متوقع: العبوة تُستهلك ضمن مدة صلاحيتها بعد الفتح' })
    }
    if (item.unitCostFils != null && ctx.medianUEff != null) {
      const diffPct = Math.round((1 - item.unitCostFils / ctx.medianUEff) * 100)
      reasons.push({
        code: 'price',
        ar: diffPct >= 0
          ? `الكلفة الفعّالة ${(item.unitCostFils / 1000).toFixed(3)} د.ب/${unitLabelAr} — أعلى من وسيط الفئة بـ ${diffPct}% (خيار أنسب ليس الأرخص)`
          : `الكلفة الفعّالة ${(item.unitCostFils / 1000).toFixed(3)} د.ب/${unitLabelAr} — أوفر من وسيط الفئة بـ ${Math.abs(diffPct)}% مع جودة مقبولة`,
      })
    }
    reasons.push({
      code: 'sweet-spot',
      ar: `اخترناه عند المستوى المئيلي ${Math.round(item.percentile * 100)}% من أسعار الفئة — نقطة «الأنسب» لأسرتكم (مؤشر سعة الميزانية T≈${T.toFixed(2)})`,
    })
    if (ctx.need.clazz === 'treat') reasons.push({ code: 'treat', ar: 'بند ترفيهي ضمن سقف محدود للميزانية' })
    if (cand.product.storesCount >= 6) reasons.push({ code: 'popular', ar: `متوفر في ${cand.product.storesCount} متاجر — سهل إيجاده` })
  }
  return reasons
}

function buildAlternatives(ctx: NeedCtx, item: PlanItem, config: AlgorithmConfig): Alternative[] {
  const list = (ctx.shortlist.length ? ctx.shortlist : ctx.candidates).filter((c) => c.product.id !== item.productId)
  const byCost = [...list].sort((a, b) => a.costFils - b.costFils)
  const mk = (c: Candidate, kind: Alternative['kind'], note: string): Alternative => ({
    productId: c.product.id,
    productName: displayName(c.product),
    brand: c.product.brand,
    sizeText: c.product.sizeText,
    packQty: c.k,
    costFils: c.costFils,
    deltaFils: c.costFils - item.costFils,
    kind, note,
  })
  const alts: Alternative[] = []
  const cheaper = byCost.find((c) => c.costFils < item.costFils)
  if (cheaper) {
    const why = cheaper.wastePct > item.wastePct + 0.05 ? `أرخص لكن بهدر أعلى (${Math.round(cheaper.wastePct * 100)}%)` : cheaper.score < item.score - 0.05 ? 'أرخص بجودة/ملاءمة أقل' : 'خيار أوفر مقبول'
    alts.push(mk(cheaper, 'cheaper', why))
  }
  const similar = list.sort((a, b) => Math.abs(a.costFils - item.costFils) - Math.abs(b.costFils - item.costFils))[0]
  if (similar) alts.push(mk(similar, 'equivalent', 'بديل مكافئ بسعر مشابه'))
  const better = [...list].sort((a, b) => b.score - a.score)[0]
  if (better && better.score > (ctx.candidates.find((c) => c.product.id === item.productId)?.score ?? 0)) {
    alts.push(mk(better, 'better', better.costFils > item.costFils ? 'أفضل ملاءمة بكلفة أعلى قليلاً' : 'أفضل ملاءمة بسعر مماثل'))
  }
  return alts.slice(0, 3)
}

// ---------------------------------------------------------------------------
// trips & nutrition

function buildTrips(items: PlanItem[], H: number, context: PlanContext): PlanTrip[] {
  const fresh = items.filter((i) => i.trip >= 2)
  const stock = items.filter((i) => i.trip < 2)
  const trips: PlanTrip[] = []
  const start = new Date(context.dateISO)
  trips.push({
    trip: 1,
    label: 'رحلة التموين الرئيسية',
    dateISO: context.dateISO,
    itemKeys: stock.map((i) => i.key),
    fils: stock.reduce((s, i) => s + i.costFils, 0),
  })
  const weeks = Math.max(1, Math.ceil(H / 7))
  for (let w = 1; w <= Math.min(weeks, 5); w++) {
    const d = new Date(start)
    d.setDate(d.getDate() + w * 7 - 7)
    const wkItems = fresh.filter((_, idx) => idx % Math.min(weeks, 5) === w - 1)
    if (!wkItems.length) continue
    trips.push({
      trip: w + 1,
      label: `رحلة الطازج الأسبوعية ${w}`,
      dateISO: d.toISOString().slice(0, 10),
      itemKeys: wkItems.map((i) => i.key),
      fils: wkItems.reduce((s, i) => s + i.costFils, 0),
    })
  }
  return trips
}

function estimateNutrition(items: PlanItem[], needCtxs: NeedCtx[], H: number, household: Household): PlanResult['nutrition'] {
  // rough food-group coverage from planned needs (informational only)
  const baseIdOf = (id: string) => (id.includes('@') ? id.slice(0, id.indexOf('@')) : id)
  const groupsMap: Record<string, string[]> = {
    dairy: ['milk.fresh.full', 'milk.fresh.low', 'milk.uht.full', 'milk.uht.low', 'laban', 'cheese'],
    produce: ['fruits', 'vegetables'],
    grains: ['rice', 'pasta', 'flour', 'bread', 'cat.breakfast-cereals'],
    protein: ['chicken', 'meat.red', 'fish', 'eggs', 'meat.processed'],
    sweets: ['sugar', 'milk.flavored', 'cat.chocolate-sweets', 'cat.biscuits-cookies', 'cat.ice-cream'],
  }
  const costByNeed = new Map<string, number>()
  for (const it of items) costByNeed.set(baseIdOf(it.needId), (costByNeed.get(baseIdOf(it.needId)) ?? 0) + it.costFils)
  const total = items.reduce((s, i) => s + i.costFils, 0) || 1
  const targets: Record<string, number> = { dairy: 15, produce: 25, grains: 20, protein: 25, sweets: 8 }
  const groups = Object.entries(groupsMap).map(([group, needs]) => {
    const fils = needs.reduce((s, n) => s + (costByNeed.get(n) ?? 0), 0)
    return { group, pct: Math.round((fils / total) * 1000) / 10, targetPct: targets[group] ?? 10 }
  })
  // ---- calorie estimate (inspiration file 00 §3.3 calorie economics) ----
  // kcal per base unit for core staples; only needs with reliable densities contribute.
  const KCAL_PER_UNIT: Record<string, number> = {
    rice: 3.6, pasta: 3.7, flour: 3.5, bread: 2.6, sugar: 4.0, oil: 8.84,
    'olive-oil': 8.84, oats: 3.8, pulses: 3.4, dates: 2.8,
    chicken: 1.9, 'meat.red': 2.5, 'meat.processed': 3.0, fish: 1.6, eggs: 78,
    'milk.fresh.full': 0.64, 'milk.uht.full': 0.64, 'milk.uht.low': 0.45, 'milk.fresh.low': 0.45,
    'milk.evaporated': 1.35, 'milk.powder': 4.4, laban: 0.6, cheese: 2.5, butter: 7.2,
    vegetables: 0.7, fruits: 0.6,
    'cat.biscuits-cookies': 4.5, 'cat.chocolate-sweets': 5.0, 'cat.canned-food': 1.2,
  }
  let totalKcal = 0
  let staplesCostFils = 0
  for (const it of items) {
    const base = baseIdOf(it.needId)
    const kcal = KCAL_PER_UNIT[base]
    if (kcal && it.unitQtyBase > 0) {
      totalKcal += kcal * it.unitQtyBase
      staplesCostFils += it.costFils
    }
  }
  const eq = household.members.reduce((s, m) => s + adultEquivalent(m), 0) || 1
  const approxCaloriesPerDay = H > 0 ? Math.round(totalKcal / H / Math.max(0.5, eq)) : 0
  const costPer1000kcalFils = totalKcal > 500 ? Math.round((staplesCostFils / totalKcal) * 1000) : null

  return {
    groups,
    approxCaloriesPerDay,
    costPer1000kcalFils,
    disclaimer: 'تقدير معلوماتي مبسّط بحسب كثافة الطاقة للأساسيات المخططة (السعرات لكل وحدة قياس) — ليس نصيحة غذائية أو طبية. المصادر: توصيات WHO/FAO العامة (≥400 جم فواكه وخضار يومياً) وجدول اقتصاد السعرات في دليل خطط البقالة البحرينية.',
  }
}

function varietyOf(items: PlanItem[]): number {
  const brands = new Set(items.map((i) => i.brand ?? i.productName))
  const names = new Set(items.map((i) => i.productName))
  return Math.round(clamp(((brands.size + names.size) / 2) / Math.max(3, items.length), 0, 1) * 100)
}

// ---------------------------------------------------------------------------
// envelope solving (spec 6.20) — assortment per spend level

interface EnvelopeLevels { env: BudgetEnvelope; levels: { spendFils: number; items: PlanItem[]; utility: number }[] }

function getGenericGroups(): GenericGroup[] {
  return GENERIC_GROUPS
}

function solveEnvelope(
  env: BudgetEnvelope,
  groups: GenericGroup[],
  catalog: Catalog,
  household: Household,
  context: PlanContext,
  config: AlgorithmConfig,
  H: number
): EnvelopeLevels {
  // member pool
  const matchedGroups = groups.filter((g) => env.groups.includes(g.id))
  const pool: CatalogProduct[] = []
  const seen = new Set<string>()
  for (const g of matchedGroups) {
    for (const p of catalog.products) {
      if (seen.has(p.id)) continue
      if (p.need && g.needs.includes(p.need)) { seen.add(p.id); pool.push(p); continue }
      if (g.categories.includes(p.category)) { seen.add(p.id); pool.push(p); continue }
      if (g.keywords.length) {
        const hay = `${p.nameAr} ${p.nameEn} ${p.brand ?? ''}`.toLowerCase()
        if (g.keywords.some((kw) => hay.includes(kw))) { seen.add(p.id); pool.push(p); continue }
      }
    }
  }
  // filters: dietary/audience
  const filtered = pool.filter((p) => {
    if (p.available !== true || p.medianFils <= 0) return false
    if (household.prefs.blockedProducts.includes(p.id)) return false
    if (p.brandNorm && household.prefs.blockedBrands.some((b) => p.brandNorm!.includes(b))) return false
    if (env.preferences?.avoidTags?.some((t) => p.tags.includes(t))) return false
    if (household.dietary.nutFree) {
      const hay = `${p.nameEn} ${p.nameAr}`.toLowerCase()
      if (/nut|مكسر|بندق|فستق|كاجو|peanut|almond|hazelnut|walnut/.test(hay)) return false
    }
    if (env.audience?.includes('kids') && !env.audience.includes('adults')) {
      const hay = `${p.nameEn} ${p.nameAr}`.toLowerCase()
      if (/coffee|قهوة|energy|طاقة|فيب|vape/.test(hay)) return false
    }
    return true
  })

  // spend range
  let minFils = env.minFils ?? env.fixedFils ?? 0
  let maxFils = env.maxFils ?? env.fixedFils ?? minFils
  if (env.mode === 'fixed') { minFils = env.fixedFils ?? 0; maxFils = minFils }
  if (env.mode === 'quantity') {
    // estimate spend from cheapest satisfying products
    minFils = 0; maxFils = Math.round((env.quantity?.value ?? 1) * (median(filtered.map((p) => p.medianFils)) || 1000))
  }
  maxFils = Math.max(minFils, maxFils)

  // consumption ceiling (sensible limit) — per adult per month
  let ceilingFils = Infinity
  const groupCeilings = matchedGroups.map((g) => g.ceilingPerAdultMonthly ?? 0)
  if (groupCeilings.some((c) => c > 0)) {
    const adults = Math.max(1, adultCount(household))
    const kids = childCount(household)
    const ceilingUnits = Math.max(...groupCeilings) * (adults + kids * 0.5) * (H / 30)
    const unitMed = median(filtered.map((p) => p.unitPriceFils ?? p.medianFils * 10)) || 500
    ceilingFils = Math.round(ceilingUnits * Math.max(100, unitMed))
  }

  // sort pool by target-fit score
  const scored = filtered.map((p) => {
    const u = p.unitPriceFils ?? p.medianFils
    const pi = percentileInPool(filtered, p)
    const tierBias = env.preferences?.tierBias
    let target = 0.5
    if (tierBias === 'econ') target = 0.3
    if (tierBias === 'premium') target = 0.75
    const gauss = Math.exp(-((pi - target) ** 2) / (2 * 0.25 ** 2))
    const pop = clamp(1 - p.rank / 400, 0, 1)
    return { p, s: gauss * 0.5 + pop * 0.3 + clamp(p.storesCount / 10, 0, 1) * 0.2, pi }
  }).sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id))

  const step = Math.max(250, config.envStepFils)
  const levels: { spendFils: number; items: PlanItem[]; utility: number }[] = []
  const maxLevels = 12
  const cap = env.fillToMax ? maxFils : Math.min(maxFils, Number.isFinite(ceilingFils) ? ceilingFils : maxFils, maxFils)
  for (let s = minFils; s <= maxFils && levels.length < maxLevels; s += step) {
    const { items, utility } = assortmentFor(s, scored, env, household, config)
    if (!items.length && s === minFils) { levels.push({ spendFils: 0, items: [], utility: 0 }); break }
    levels.push({ spendFils: s, items, utility })
    if (s >= cap) break
  }
  if (!levels.length) levels.push({ spendFils: 0, items: [], utility: 0 })

  return { env, levels }
}

function percentileInPool(pool: CatalogProduct[], p: CatalogProduct): number {
  const list = pool.map((x) => x.unitPriceFils ?? x.medianFils).sort((a, b) => a - b)
  const v = p.unitPriceFils ?? p.medianFils
  let below = 0
  for (const x of list) { if (x < v) below++; else if (x === v) below += 0.5 }
  return list.length ? clamp(below / list.length, 0, 1) : 0.5
}

function assortmentFor(
  spendFils: number,
  scored: { p: CatalogProduct; s: number; pi: number }[],
  env: BudgetEnvelope,
  household: Household,
  config: AlgorithmConfig
): { items: PlanItem[]; utility: number } {
  const items: PlanItem[] = []
  let spent = 0
  const brandCount = new Map<string, number>()
  const sizeBias = env.preferences?.sizeBias
  const variety = env.preferences?.variety ?? 'normal'
  const maxItems = variety === 'high' ? 14 : variety === 'low' ? 5 : 9
  const pool = [...scored]
  // deterministic small shuffle within equal scores for variety across regenerations
  const cheapest = pool.length ? Math.min(...pool.map((x) => x.p.medianFils)) : 0

  while (pool.length && items.length < maxItems) {
    // pick best-scoring affordable item respecting brand cap and variety
    let pickIdx = -1
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i]!
      const brand = cand.p.brand ?? cand.p.id
      const bc = brandCount.get(brand) ?? 0
      if (bc >= Math.max(1, Math.ceil(maxItems * config.varietyBrandCapPct))) continue
      if (spent + cand.p.medianFils > spendFils + cheapest) continue // tolerance ≤ cheapest item
      // size bias
      if (sizeBias === 'small' && cand.p.size && cand.p.size.baseQuantity > 2500) continue
      if (sizeBias === 'large' && cand.p.size && cand.p.size.baseQuantity < 300) continue
      pickIdx = i
      break
    }
    if (pickIdx < 0) break
    const pick = pool.splice(pickIdx, 1)[0]!
    const qty = sizeBias === 'large' && pick.p.size && pick.p.size.baseQuantity >= 400 ? 2 : 1
    const cost = pick.p.medianFils * qty
    if (spent + cost > spendFils + cheapest && items.length > 0) break
    spent += cost
    brandCount.set(pick.p.brand ?? pick.p.id, (brandCount.get(pick.p.brand ?? pick.p.id) ?? 0) + 1)
    items.push({
      key: `env-${env.id}-${pick.p.id}`,
      productId: pick.p.id,
      needId: pick.p.need ?? '',
      productName: displayName(pick.p),
      brand: pick.p.brand,
      sizeText: pick.p.sizeText,
      packQty: qty,
      unitQtyBase: (pick.p.size?.baseQuantity ?? 1) * qty,
      costFils: cost,
      unitCostFils: pick.p.unitPriceFils,
      storeId: null,
      wastePct: 0,
      coverage: 1,
      score: Math.round(pick.s * 100) / 100,
      percentile: Math.round(pick.pi * 100) / 100,
      locked: false,
      reasons: [],
      alternatives: [],
      envelopeId: env.id,
      trip: 1,
    })
  }

  // utility (spec 6.20-γ)
  const brands = new Set(items.map((i) => i.brand ?? i.productName))
  const varScore = items.length ? Math.sqrt(brands.size / items.length) : 0
  const avgPi = items.length ? items.reduce((s, i) => s + i.percentile, 0) / items.length : 0.5
  const targetFit = 1 - Math.abs(avgPi - 0.5) * 2
  const audienceFit = env.audience?.includes('kids') && childCount(household) > 0 ? 1 : 0.9
  const overbuy = Math.max(0, items.length - 10) * 0.08
  const wSum = items.reduce((s, i) => s + i.score, 0)
  const priorityW = env.priority === 'must' ? 1 : env.priority === 'high' ? 0.8 : env.priority === 'normal' ? 0.55 : 0.3
  const utility = priorityW * (
    wSum / Math.max(1, items.length) +
    config.lambdaVariety * varScore +
    config.lambdaTarget * targetFit +
    config.lambdaAudience * audienceFit -
    config.lambdaOverbuy * overbuy
  ) * (1 + Math.min(0.5, spent / Math.max(1, spendFils) * 0.2))

  return { items, utility }
}

function explainEnvelope(er: EnvelopeResult, eo: EnvelopeLevels | undefined, household: Household, H: number): string[] {
  const notes: string[] = []
  const eoFinal = eo as unknown as { finalLevel?: { spendFils: number; items: PlanItem[] } } | undefined
  const items = eoFinal?.finalLevel?.items ?? er.items
  if (!items.length) {
    notes.push('لم نجد تشكيلة مناسبة ضمن المبلغ والمجموعات المحددة — جرّب توسيع النطاق أو المجموعات')
    return notes
  }
  const brands = [...new Set(items.map((i) => i.brand).filter(Boolean))]
  notes.push(`اخترنا ${items.length} أصنافاً${brands.length > 1 ? ` من ${brands.length} علامات متنوعة (${brands.slice(0, 4).join('، ')}${brands.length > 4 ? ' وغيرها' : ''})` : ''} بقيمة ${(er.spentFils / 1000).toFixed(3)} د.ب`)
  if (er.maxFils && er.spentFils < er.maxFils * 0.75) {
    notes.push(`أنفقنا أقل من الحد الأعلى لأن هذا يغطي استهلاك أسرتكم المتوقع؛ يمكنكم رفعه يدوياً أو تفعيل «أنفق الحد الأقصى»`)
  }
  if (er.minFils && er.spentFils < er.minFils) notes.push('الميزانية لم تسمح ببلوغ الحد الأدنى المحجوز لهذا الظرف — راجع الأولويات')
  const kinds = items.map((i) => i.sizeText).filter(Boolean).slice(0, 3)
  if (kinds.length) notes.push(`أحجام مقترحة: ${kinds.join('، ')}`)
  return notes
}
