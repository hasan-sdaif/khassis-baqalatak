/**
 * Greedy-vs-exact optimality measurement (continuation spec § 7.3).
 *
 * The engine allocates the discretionary budget with a greedy MCKP pass plus
 * local-search refinement (generate.ts stage 6 / 6.5). These tests reconstruct,
 * from the plan OUTPUT only (no engine internals are exported), the option set
 * each need actually considered and solve it exactly with a 0/1 knapsack DP
 * over integer fils.
 *
 * Option set per need (harvested from the result, not from internals):
 *   - the chosen line: costFils + its plan score (utility)
 *   - plan.items[i].alternatives[] — typed Alternative (types.ts):
 *     { productId, productName, brand, sizeText, packQty, costFils,
 *       deltaFils, kind: 'cheaper'|'equivalent'|'better', note }
 *
 * ADAPTATION (documented per spec): alternatives DO carry costFils (and
 * packQty/deltaFils/kind) but NO score field, so the reference DP values them
 * with the fallback utility 1.0 while the chosen line uses its own plan score.
 * Utility comparability caveat: the two numbers come from different scales
 * (engine composite score vs constant fallback), so any measured gap is an
 * UPPER bound on the true greedy suboptimality — the exact solver can "win"
 * simply by crediting alternatives with utility the engine never assigned
 * them. Needs whose alternatives lacked a usable costFils would be skipped in
 * the DP (none occur on this catalog: costFils is always present).
 *
 * DP budget: diagnostics.targetFils minus the protected spend the allocator
 * cannot touch (fixedItems = mandatory habits + locked lines, plus envelope
 * spend). That is exactly the headroom the greedy stage had for the needs
 * under consideration; granting the DP the full target would let the reference
 * solver spend budget the engine never had.
 *
 * Measured on this snapshot (2026-10-25 catalog, seeds fixed): average gap
 * ≈ 1.24%, worst case 7.14% (infant household). Most cases sit at 0.00%
 * because the engine's upgrade loop spends to within a few fils of target,
 * leaving the exact solver no affordable improvement. The assertions below
 * keep the spec's 15% bound for both the average and the worst case.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'curated', 'catalog.json'), 'utf8'))
const { generatePlan } = require('../.test-build/engine/generate.js')
const { DEFAULT_CONFIG } = require('../.test-build/engine/config.js')
const { catalogFingerprint } = require('../.test-build/engine/normalize.js')

catalog.fingerprint = catalogFingerprint(catalog)

function household(members, habits = {}) {
  return {
    members,
    habits,
    dietary: { halalOnly: true },
    prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
    eatingOutPerWeek: 3,
    guestsPerMonth: 2,
    hasWaterDispenser: false,
    storage: 'medium',
  }
}

function engineInput(house, budgetFils) {
  return {
    catalog,
    household: house,
    budget: { fils: budgetFils, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    context: { dateISO: '2026-10-26', season: 'normal', storeMode: 'median', availableStores: [], delivery: true },
    config: DEFAULT_CONFIG,
    locks: [],
    envelopes: [],
    mode: 'balanced',
    seed: 42,
  }
}

// 15 deterministic cases on the real catalog: singles, couples, families,
// infants, teens, elders — budgets 25k..260k fils.
const CASES = [
  ['single-adult-25k', [{ id: 'a1', ageMonths: 360, gender: 'm', specials: [] }], 25000, {}],
  ['single-adult-60k', [{ id: 'a1', ageMonths: 360, gender: 'm', specials: [] }], 60000, {}],
  ['single-elder-45k', [{ id: 'e1', ageMonths: 780, gender: 'f', specials: [] }], 45000, {}],
  ['bachelor-40k', [{ id: 'a1', ageMonths: 276, gender: 'm', specials: [] }], 40000, {}],
  ['couple-70k', [
    { id: 'a1', ageMonths: 360, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 336, gender: 'f', specials: [] },
  ], 70000, {}],
  ['couple-90k', [
    { id: 'a1', ageMonths: 360, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 336, gender: 'f', specials: [] },
  ], 90000, {}],
  ['family4-95k', [
    { id: 'a1', ageMonths: 384, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 360, gender: 'f', specials: [] },
    { id: 'c1', ageMonths: 96, gender: 'm', specials: [] },
    { id: 'c2', ageMonths: 60, gender: 'f', specials: [] },
  ], 95000, {}],
  ['family4-120k', [
    { id: 'a1', ageMonths: 384, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 360, gender: 'f', specials: [] },
    { id: 'c1', ageMonths: 96, gender: 'm', specials: [] },
    { id: 'c2', ageMonths: 60, gender: 'f', specials: [] },
  ], 120000, {}],
  ['family6-180k', [
    { id: 'a1', ageMonths: 420, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 396, gender: 'f', specials: [] },
    { id: 't1', ageMonths: 180, gender: 'm', specials: [] },
    { id: 'c1', ageMonths: 84, gender: 'f', specials: [] },
    { id: 'c2', ageMonths: 48, gender: 'm', specials: [] },
    { id: 'c3', ageMonths: 24, gender: 'f', specials: [] },
  ], 180000, {}],
  ['family8-260k', [
    { id: 'a1', ageMonths: 456, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 432, gender: 'f', specials: [] },
    { id: 't1', ageMonths: 192, gender: 'm', specials: [] },
    { id: 't2', ageMonths: 168, gender: 'f', specials: [] },
    { id: 'c1', ageMonths: 108, gender: 'm', specials: [] },
    { id: 'c2', ageMonths: 72, gender: 'f', specials: [] },
    { id: 'c3', ageMonths: 36, gender: 'm', specials: [] },
    { id: 'c4', ageMonths: 12, gender: 'f', specials: [] },
  ], 260000, {}],
  ['infant-100k', [
    { id: 'a1', ageMonths: 360, gender: 'f', specials: [] },
    { id: 'b1', ageMonths: 8, gender: 'm', specials: ['formula'] },
  ], 100000, { formula: { dep_b1: 100 } }],
  ['infant-160k', [
    { id: 'a1', ageMonths: 360, gender: 'f', specials: [] },
    { id: 'b1', ageMonths: 8, gender: 'm', specials: ['formula'] },
  ], 160000, { formula: { dep_b1: 100 } }],
  ['coffee-tea-110k', [
    { id: 'a1', ageMonths: 360, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 336, gender: 'f', specials: [] },
    { id: 'a3', ageMonths: 300, gender: 'm', specials: [] },
  ], 110000, { coffee: { cupsPerDay: 3 }, tea: { cupsPerDay: 4 } }],
  ['teens-150k', [
    { id: 'a1', ageMonths: 480, gender: 'm', specials: [] },
    { id: 'a2', ageMonths: 456, gender: 'f', specials: [] },
    { id: 't1', ageMonths: 200, gender: 'm', specials: [] },
    { id: 't2', ageMonths: 174, gender: 'f', specials: [] },
  ], 150000, {}],
  ['retired-2-80k', [
    { id: 'e1', ageMonths: 816, gender: 'm', specials: [] },
    { id: 'e2', ageMonths: 792, gender: 'f', specials: [] },
  ], 80000, {}],
]

/**
 * Exact multiple-choice 0/1 knapsack over integer fils.
 * needs: array of { needId, options: [{ productId, cost, util }] } — exactly
 * one option must be picked per need; returns the max total utility within cap.
 */
function exactMaxUtility(needs, cap) {
  let reachableBound = 0
  for (const need of needs) {
    let maxCost = 0
    for (const option of need.options) if (option.cost > maxCost) maxCost = option.cost
    reachableBound += maxCost
  }
  const bound = Math.min(cap, reachableBound)
  if (bound < 0 || needs.length === 0) return { best: 0, bound: Math.max(0, bound) }
  let dp = new Float64Array(bound + 1).fill(-1)
  dp[0] = 0
  for (const need of needs) {
    const next = new Float64Array(bound + 1).fill(-1)
    for (let spent = 0; spent <= bound; spent++) {
      if (dp[spent] < 0) continue
      for (const option of need.options) {
        const nextSpent = spent + option.cost
        if (nextSpent > bound) continue
        const candidate = dp[spent] + option.util
        if (candidate > next[nextSpent]) next[nextSpent] = candidate
      }
    }
    dp = next
  }
  let best = -1
  for (let spent = 0; spent <= bound; spent++) if (dp[spent] > best) best = dp[spent]
  return { best, bound }
}

// Run all 15 cases once at module scope; the tests assert over the same results.
const MEASUREMENTS = CASES.map(([label, members, budgetFils, habits]) => {
  const plan = generatePlan(engineInput(household(members, habits), budgetFils))
  const fixedCost = plan.fixedItems.reduce((sum, item) => sum + item.costFils, 0)
  const envelopeSpend = plan.envelopes.reduce((sum, envelope) => sum + envelope.spentFils, 0)
  // Discretionary headroom the greedy allocator actually had for these needs.
  const cap = plan.diagnostics.targetFils - fixedCost - envelopeSpend

  const needs = []
  let skippedNeeds = 0
  for (const item of plan.items) {
    const options = [{ productId: item.productId, cost: item.costFils, util: item.score }]
    const seenProductIds = new Set([item.productId])
    let usable = true
    for (const alternative of item.alternatives || []) {
      // ADAPTATION: alternatives lack a score field → fallback utility 1.0
      // (spec). costFils is always present on this catalog; if an alternative
      // ever lacked a finite costFils the whole need is skipped in the DP
      // (spec fallback) rather than priced from an unknown value.
      if (!Number.isFinite(alternative.costFils)) { usable = false; break }
      if (seenProductIds.has(alternative.productId)) continue // cheaper/equivalent/better may repeat one product
      seenProductIds.add(alternative.productId)
      options.push({
        productId: alternative.productId,
        cost: alternative.costFils,
        util: typeof alternative.score === 'number' ? alternative.score : 1.0,
      })
    }
    if (!usable) { skippedNeeds++; continue }
    needs.push({ needId: item.needId, options })
  }

  const greedyCost = plan.items.reduce((sum, item) => sum + item.costFils, 0)
  const greedyUtility = plan.items.reduce((sum, item) => sum + item.score, 0)
  const feasible = greedyCost <= cap
  const { best: exactUtility } = exactMaxUtility(needs, cap)
  const gapPct = exactUtility > 0 ? ((exactUtility - greedyUtility) / exactUtility) * 100 : 0
  return {
    label, plan, cap, needs, skippedNeeds, fixedCost, envelopeSpend,
    greedyCost, greedyUtility, exactUtility, feasible, gapPct,
  }
})

test('optimality: the exact reference solver never scores below the greedy plan on feasible budgets', () => {
  const feasible = MEASUREMENTS.filter((m) => m.feasible)
  const infeasible = MEASUREMENTS.filter((m) => !m.feasible)
  // The mathematical guarantee (DP contains the all-chosen assignment) only
  // holds when the greedy allocation itself is within the DP budget. Plans
  // that honestly declare a shortfall (protected spend above target) are
  // reported instead of asserted against — their greedy allocation is
  // infeasible for the reference solver by construction.
  for (const m of infeasible) {
    console.log(`[optimality] ${m.label}: plan declares shortfall ${m.plan.diagnostics.shortfallFils} fils — greedy allocation is outside the DP budget; excluded from gap statistics`)
  }
  assert.ok(feasible.length >= 10,
    `at least 10 of the 15 cases must land within their target for the gap statistics to be meaningful (found ${feasible.length})`)
  for (const m of feasible) {
    assert.ok(m.exactUtility >= m.greedyUtility - 1e-9,
      `${m.label}: exact utility ${m.exactUtility} must be >= greedy utility ${m.greedyUtility}`)
    assert.ok(m.gapPct >= -1e-9, `${m.label}: gap must be non-negative`)
    assert.ok(m.needs.length > 0, `${m.label}: the DP covered at least one need`)
    assert.equal(m.skippedNeeds, 0, `${m.label}: no need was skipped for missing alternative costs`)
  }
})

test('optimality: greedy stays within the spec 15% bound of the exact reference (average and worst case)', () => {
  const feasible = MEASUREMENTS.filter((m) => m.feasible)
  const gaps = feasible.map((m) => m.gapPct)
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  const worstGap = Math.max(...gaps)

  for (const m of feasible) {
    console.log(`[optimality] ${m.label.padEnd(18)} items=${String(m.plan.items.length).padStart(2)} `
      + `cap=${m.cap} greedyU=${m.greedyUtility.toFixed(2)} exactU=${m.exactUtility.toFixed(2)} gap=${m.gapPct.toFixed(2)}%`)
  }
  console.log(`[optimality] cases=${MEASUREMENTS.length} feasible=${feasible.length} `
    + `average gap=${averageGap.toFixed(3)}% worst gap=${worstGap.toFixed(3)}%`)
  // Spec § 7.3 bound. Measured on this snapshot: average ≈ 1.24%, worst ≈ 7.14%
  // (infant-100k). The worst-case assertion is kept under the same 15% bound as
  // a canary: if a catalog/engine change pushes it above, re-measure and update
  // this number honestly rather than deleting the assertion.
  assert.ok(averageGap < 15, `average greedy-vs-exact gap ${averageGap.toFixed(3)}% must stay under 15%`)
  assert.ok(worstGap < 15, `worst greedy-vs-exact gap ${worstGap.toFixed(3)}% must stay under 15%`)
})

test('optimality: every option offered to the reference solver is a real catalog product at a real price', () => {
  const catalogById = new Map(catalog.products.map((p) => [p.id, p]))
  for (const m of MEASUREMENTS) {
    for (const need of m.needs) {
      assert.ok(need.options.length >= 1, `${m.label}/${need.needId}: at least the chosen option exists`)
      for (const option of need.options) {
        const product = catalogById.get(option.productId)
        assert.ok(product, `${m.label}/${need.needId}: option ${option.productId} exists in the catalog`)
        assert.ok(product.medianFils > 0, `${m.label}/${need.needId}: option ${option.productId} has a positive median`)
        assert.ok(Number.isInteger(option.cost) && option.cost >= 0,
          `${m.label}/${need.needId}: option ${option.productId} costs integer fils >= 0`)
        assert.ok(option.util > 0, `${m.label}/${need.needId}: option ${option.productId} has positive utility`)
      }
    }
  }
})
