/**
 * Deterministic seeded property tests for the planning engine
 * (continuation spec § 12.2) — no external fuzzing dependency.
 *
 * Every case is generated from an in-file mulberry32 PRNG, so the whole suite
 * is byte-reproducible on any machine: seeds 1..40 produce households of 1-8
 * members with ages 0-1440 months, occasional infant ['formula'] specials,
 * occasional tobacco/coffee habits, budgets 5,000-400,000 fils, one pinned
 * rice product (qty 2) and — on even seeds — one dates/tea envelope
 * (1,000-4,000 fils).
 *
 * Invariants asserted over the generated plans (one test each):
 *  1. items + fixedItems + envelope lines reconcile exactly to
 *     totals.costFils AND diagnostics.totalCostFils (integer fils, counted once).
 *  2. totals.costFils <= diagnostics.targetFils OR diagnostics.shortfallFils > 0
 *     — an over-target plan is never silent.
 *  3. every planned productId exists in the catalog snapshot with medianFils > 0.
 *  4. the locked product appears exactly once with packQty 2 and locked=true.
 *  5. identical inputs regenerate byte-identical plans (5 re-run cases).
 *  6. envelopes reconcile spentFils to their line items and never exceed maxFils.
 *
 * The size-parser table at the bottom records expectations taken FROM the
 * parser's real grammar (src/lib/engine/size.ts), including its documented
 * vocabulary limits — nothing here is aspirational.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'curated', 'catalog.json'), 'utf8'))
const { generatePlan } = require('../.test-build/engine/generate.js')
const { DEFAULT_CONFIG } = require('../.test-build/engine/config.js')
const { getAllPlanItems, sumPlanItemsFils } = require('../.test-build/engine/plan-utils.js')
const { parseSize } = require('../.test-build/engine/size.js')
const { normalizeArabic, catalogFingerprint } = require('../.test-build/engine/normalize.js')

// Compute the snapshot fingerprint once: generatePlan would otherwise
// recompute it (~0.3s) on every one of the ~45 calls below.
catalog.fingerprint = catalogFingerprint(catalog)

// ---------------------------------------------------------------------------
// tiny seeded PRNG (mulberry32) — deterministic across Node versions,
// no fast-check dependency.
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The pinned product must survive the engine's per-need name filter
// (productMatchesNeed 'rice'): the product name must mention rice/أرز/رز and
// must not be a rice-flour/cracker/cake product, otherwise the lock is
// un-honorable and would only produce a warning. This local predicate mirrors
// that rule so the lock is guaranteed to enter the rice candidate pool.
function matchesRiceNeed(product) {
  const name = normalizeArabic(`${product.nameAr ?? ''} ${product.nameEn ?? ''} ${product.brand ?? ''}`)
  const mentionsRice = /\brice\b/i.test(name) || /رز/.test(name)
  const excluded = /\brice\s*(?:flour|crackers?|cakes?)\b/i.test(name) || /دقيق\s*الارز|كعك\s*الارز/.test(name)
  return mentionsRice && !excluded
}

const RICE_LOCK_POOL = catalog.products.filter((p) =>
  p.need === 'rice' &&
  p.available === true &&
  p.medianFils > 0 &&
  (p.size == null || p.size.unit === 'g') && // g-need structural guard: ml/bags sizes cannot serve rice
  matchesRiceNeed(p))
assert.ok(RICE_LOCK_POOL.length >= 40, `expected a deep rice lock pool, found ${RICE_LOCK_POOL.length}`)

const STORAGE_OPTIONS = ['small', 'medium', 'large']

function makeCase(seed) {
  const rand = mulberry32(seed)
  const memberCount = 1 + Math.floor(rand() * 8) // 1..8 members
  const members = []
  for (let i = 0; i < memberCount; i++) {
    // Member 0 is always an adult (240-720 months): every case keeps the staple
    // needs (rice, eggs, bread, …) in demand so the pinned rice lock is
    // honorable even when all other members are infants. Ages elsewhere span
    // the full 0-1440 month range.
    const ageMonths = i === 0 ? 240 + Math.floor(rand() * 481) : Math.floor(rand() * 1441)
    // Infants occasionally carry the ['formula'] special (engine-test fixture
    // pattern). The engine derives formula demand from ageMonths + habits; the
    // specials array rides along in the household fingerprint.
    const specials = ageMonths < 36 && rand() < 0.6 ? ['formula'] : []
    members.push({ id: `member-${i}`, ageMonths, gender: rand() < 0.5 ? 'm' : 'f', specials })
  }
  const habits = {}
  if (rand() < 0.3) habits.smoking = { active: true, cigsPerDay: 5 + Math.floor(rand() * 16) }
  if (rand() < 0.4) habits.coffee = { cupsPerDay: 1 + Math.floor(rand() * 4) }
  const budgetFils = 5000 + Math.floor(rand() * 395001) // 5,000..400,000 fils
  const lockProduct = RICE_LOCK_POOL[(seed * 7) % RICE_LOCK_POOL.length]
  const envelopes = seed % 2 === 0
    ? [{
        id: `prop-env-${seed}`,
        name: 'ظرف الاختبار',
        groups: [seed % 4 === 0 ? 'dates' : 'tea'],
        mode: 'range',
        minFils: 1000,
        maxFils: 4000,
        priority: 'normal',
        fillToMax: seed % 8 !== 0,
      }]
    : []
  return {
    seed,
    budgetFils,
    lockProduct,
    envelopes,
    input: {
      catalog,
      household: {
        members,
        habits,
        dietary: { halalOnly: true },
        prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
        eatingOutPerWeek: Math.floor(rand() * 8),
        guestsPerMonth: Math.floor(rand() * 8),
        hasWaterDispenser: rand() < 0.3,
        storage: STORAGE_OPTIONS[Math.floor(rand() * 3)],
      },
      budget: { fils: budgetFils, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
      context: { dateISO: '2026-10-26', season: 'normal', storeMode: 'median', availableStores: [], delivery: true },
      config: DEFAULT_CONFIG,
      locks: [{ productId: lockProduct.id, qty: 2 }],
      envelopes,
      mode: 'balanced',
      seed,
    },
  }
}

const CASES = []
for (let seed = 1; seed <= 40; seed++) CASES.push(makeCase(seed))

// Run the engine once per case at module scope; every test below asserts a
// different invariant over the SAME plans (plus 5 extra re-runs for
// determinism inside that test).
const PLANS = CASES.map((testCase) => ({ testCase, plan: generatePlan(testCase.input) }))

function allLines(plan) {
  // Raw concatenation in the engine's own accounting order — no key
  // de-duplication, so a double-counted line cannot hide here.
  return [...plan.items, ...plan.fixedItems, ...plan.envelopes.flatMap((envelope) => envelope.items)]
}

// ---------------------------------------------------------------------------
// Invariant 1 + 2: money reconciliation and budget honesty.

test('property: 40 seeded households reconcile every visible line to the plan total and never silently exceed the budget', () => {
  for (const { testCase, plan } of PLANS) {
    const label = `seed ${testCase.seed} (budget ${testCase.budgetFils} fils)`
    const lineSum = allLines(plan).reduce((sum, item) => sum + item.costFils, 0)
    assert.ok(Number.isInteger(plan.totals.costFils), `${label}: totals.costFils stays integer fils`)
    assert.equal(lineSum, plan.totals.costFils, `${label}: items+fixedItems+envelope lines must equal totals.costFils`)
    assert.equal(plan.totals.costFils, plan.diagnostics.totalCostFils, `${label}: totals.costFils === diagnostics.totalCostFils`)

    // unified view used by reports/shopping/spend screens reconciles too
    const unified = getAllPlanItems(plan)
    assert.equal(new Set(unified.map((item) => item.key)).size, unified.length, `${label}: each shopping line appears once`)
    assert.equal(sumPlanItemsFils(unified), plan.totals.costFils, `${label}: unified line sum equals the engine total`)

    // invariant 2: over-target plans must declare the shortfall numerically
    if (plan.totals.costFils > plan.diagnostics.targetFils) {
      assert.ok(plan.diagnostics.shortfallFils > 0, `${label}: over-target plan must declare shortfallFils > 0`)
    }
    assert.equal(
      plan.diagnostics.shortfallFils,
      Math.max(0, plan.totals.costFils - plan.diagnostics.targetFils),
      `${label}: shortfallFils is exactly max(0, cost - target)`,
    )
  }
})

// ---------------------------------------------------------------------------
// Invariant 3: catalog grounding.

test('property: every planned line references a real catalog product with a positive median price', () => {
  const catalogById = new Map(catalog.products.map((p) => [p.id, p]))
  for (const { testCase, plan } of PLANS) {
    const label = `seed ${testCase.seed}`
    const lines = allLines(plan)
    assert.ok(lines.length > 0, `${label}: the plan contains at least one line (the pinned rice lock is always present)`)
    for (const item of lines) {
      // Guard for catalog-free manual lines (tobacco manual price entry). This
      // generator never sets smoking.manualPriceFils, so the skip is defensive
      // documentation rather than an expected path.
      if (String(item.productId).startsWith('manual:')) continue
      const product = catalogById.get(item.productId)
      assert.ok(product, `${label}: productId ${item.productId} exists in the catalog snapshot`)
      assert.ok(Number.isFinite(product.medianFils) && product.medianFils > 0,
        `${label}: product ${item.productId} has medianFils > 0`)
      assert.ok(Number.isInteger(item.costFils) && item.costFils >= 0,
        `${label}: line ${item.key} costs integer fils >= 0`)
    }
  }
})

// ---------------------------------------------------------------------------
// Invariant 4: locks.

test('property: the pinned rice product is honored exactly once with packQty 2 and locked=true on every seeded case', () => {
  for (const { testCase, plan } of PLANS) {
    const label = `seed ${testCase.seed} (lock ${testCase.lockProduct.id})`
    const lines = allLines(plan).filter((item) => item.productId === testCase.lockProduct.id)
    assert.equal(lines.length, 1, `${label}: the locked product appears exactly once`)
    assert.equal(lines[0].packQty, 2, `${label}: the locked quantity is respected`)
    assert.equal(lines[0].locked, true, `${label}: the locked line is marked as pinned`)
    assert.ok(plan.fixedItems.some((item) => item.productId === testCase.lockProduct.id),
      `${label}: locked lines are accounted in fixedItems`)
    assert.ok(!(plan.diagnostics.warnings || []).some((w) => w.includes('تعذّر تثبيت')),
      `${label}: an honored lock must not raise a lock warning`)
  }
})

// ---------------------------------------------------------------------------
// Invariant 5: determinism (re-run 5 of the 40 cases with the identical input object).

test('property: identical inputs regenerate byte-identical plans', () => {
  const reRunSeeds = [1, 9, 17, 25, 33]
  for (const seed of reRunSeeds) {
    const entry = PLANS[seed - 1]
    assert.ok(entry, `seed ${seed} exists`)
    const again = generatePlan(entry.testCase.input)
    assert.equal(JSON.stringify(again), JSON.stringify(entry.plan),
      `seed ${seed}: the same input must produce identical JSON on re-run`)
  }
})

// ---------------------------------------------------------------------------
// Invariant 6: envelopes.

test('property: envelopes reconcile spentFils to their line items and never exceed maxFils', () => {
  const envelopeEntries = PLANS.filter((entry) => entry.testCase.envelopes.length > 0)
  assert.ok(envelopeEntries.length >= 15, `at least 15 of the 40 cases carry an envelope (found ${envelopeEntries.length})`)
  for (const { testCase, plan } of envelopeEntries) {
    const label = `seed ${testCase.seed}`
    assert.equal(plan.envelopes.length, testCase.envelopes.length,
      `${label}: every requested envelope appears exactly once in the result`)
    for (const envelope of plan.envelopes) {
      assert.equal(envelope.spentFils, envelope.items.reduce((sum, item) => sum + item.costFils, 0),
        `${label}: envelope ${envelope.envelopeId} spentFils equals its visible line prices`)
      if (Number.isFinite(envelope.maxFils)) {
        assert.ok(envelope.spentFils <= envelope.maxFils,
          `${label}: envelope ${envelope.envelopeId} spend ${envelope.spentFils} must not exceed max ${envelope.maxFils}`)
      }
      assert.ok(envelope.spentFils >= 0, `${label}: envelope spend is non-negative`)
    }
  }
})

// ---------------------------------------------------------------------------
// Size parser table (src/lib/engine/size.ts real grammar).
// Expectations below were recorded from the parser's actual behavior; only
// deterministic properties are asserted (baseQuantity / unit / packCount /
// unitSize). Confidence is intentionally NOT asserted.

function assertParsed(raw, expected) {
  const parsed = parseSize(raw)
  if (expected === null) {
    assert.equal(parsed, null, `parseSize(${JSON.stringify(raw)}) must be null`)
    return
  }
  assert.ok(parsed, `parseSize(${JSON.stringify(raw)}) must parse`)
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(parsed[field], value, `parseSize(${JSON.stringify(raw)}).${field}`)
  }
}

test('size parser: multi-pack patterns collapse to a base quantity with pack count and unit size', () => {
  const table = [
    ['6 × 200 مل', { baseQuantity: 1200, unit: 'ml', packCount: 6, unitSize: 200 }],
    ['2×1.5L', { baseQuantity: 3000, unit: 'ml', packCount: 2, unitSize: 1.5 }],
    ['2 × 1.5 لتر', { baseQuantity: 3000, unit: 'ml', packCount: 2, unitSize: 1.5 }],
    ['24 × 330مل', { baseQuantity: 7920, unit: 'ml', packCount: 24, unitSize: 330 }],
    ['12 × 500 مل', { baseQuantity: 6000, unit: 'ml', packCount: 12, unitSize: 500 }],
    ['4 x 250 ml', { baseQuantity: 1000, unit: 'ml', packCount: 4, unitSize: 250 }],
    // leading container word: the × pattern inside still drives the result
    ['كرتون 24 × 330مل', { baseQuantity: 7920, unit: 'ml', packCount: 24, unitSize: 330 }],
    // unit-first packs ("200 مل × 6"): unit belongs to the first number
    ['200 مل × 6', { baseQuantity: 1200, unit: 'ml', packCount: 6, unitSize: 200 }],
    ['1.5 Ltr X 6 Pcs', { baseQuantity: 9000, unit: 'ml', packCount: 6, unitSize: 1.5 }],
  ]
  for (const [raw, expected] of table) assertParsed(raw, expected)
})

test('size parser: single volume and mass sizes convert liters/kilograms to base units', () => {
  const table = [
    ['750ml', { baseQuantity: 750, unit: 'ml', packCount: 1, unitSize: 750 }],
    ['330 مل', { baseQuantity: 330, unit: 'ml', packCount: 1, unitSize: 330 }],
    ['250 مل', { baseQuantity: 250, unit: 'ml', packCount: 1, unitSize: 250 }],
    ['1 لتر', { baseQuantity: 1000, unit: 'ml', packCount: 1, unitSize: 1 }],
    ['1.5 لتر', { baseQuantity: 1500, unit: 'ml', packCount: 1, unitSize: 1.5 }],
    ['1.75 لتر', { baseQuantity: 1750, unit: 'ml', packCount: 1, unitSize: 1.75 }],
    ['500g', { baseQuantity: 500, unit: 'g', packCount: 1, unitSize: 500 }],
    ['100 جم', { baseQuantity: 100, unit: 'g', packCount: 1, unitSize: 100 }],
    ['900 جم', { baseQuantity: 900, unit: 'g', packCount: 1, unitSize: 900 }],
    ['1 كجم', { baseQuantity: 1000, unit: 'g', packCount: 1, unitSize: 1 }],
    ['2.5 كجم', { baseQuantity: 2500, unit: 'g', packCount: 1, unitSize: 2.5 }],
    ['5 كجم', { baseQuantity: 5000, unit: 'g', packCount: 1, unitSize: 5 }],
  ]
  for (const [raw, expected] of table) assertParsed(raw, expected)
})

test('size parser: counted units (rolls/sheets/bags/pieces) keep their canonical unit', () => {
  const table = [
    ['6 رول', { baseQuantity: 6, unit: 'rolls', packCount: 1, unitSize: 6 }],
    ['12 رول', { baseQuantity: 12, unit: 'rolls', packCount: 1, unitSize: 12 }],
    ['24 منديل', { baseQuantity: 24, unit: 'sheets', packCount: 1, unitSize: 24 }],
    ['100 منديل', { baseQuantity: 100, unit: 'sheets', packCount: 1, unitSize: 100 }],
    ['2 كيس', { baseQuantity: 2, unit: 'bags', packCount: 1, unitSize: 2 }],
    ['5 أكياس', { baseQuantity: 5, unit: 'bags', packCount: 1, unitSize: 5 }],
    ['12 حبة', { baseQuantity: 12, unit: 'pcs', packCount: 1, unitSize: 12 }],
    ['30 حبة', { baseQuantity: 30, unit: 'pcs', packCount: 1, unitSize: 30 }],
    ['48 قطعة', { baseQuantity: 48, unit: 'pcs', packCount: 1, unitSize: 48 }],
  ]
  for (const [raw, expected] of table) assertParsed(raw, expected)
})

test('size parser: dozens expand to 12 pieces per dozen', () => {
  const table = [
    ['دزينة', { baseQuantity: 12, unit: 'pcs', packCount: 1, unitSize: 12 }],
    ['2 دزينة', { baseQuantity: 24, unit: 'pcs', packCount: 2, unitSize: 12 }],
    ['dozen', { baseQuantity: 12, unit: 'pcs', packCount: 1, unitSize: 12 }],
    ['3 dozen', { baseQuantity: 36, unit: 'pcs', packCount: 3, unitSize: 12 }],
    ['2 dz', { baseQuantity: 24, unit: 'pcs', packCount: 2, unitSize: 12 }],
  ]
  for (const [raw, expected] of table) assertParsed(raw, expected)
})

test('size parser: promo packs, bare numbers, Arabic-Indic digits and imperial units', () => {
  const table = [
    // promo "1+1" => one pack containing both units
    ['1+1', { baseQuantity: 2, unit: 'pcs', packCount: 1, unitSize: 2 }],
    // bare number => implicit pcs (low confidence, not asserted)
    ['64', { baseQuantity: 64, unit: 'pcs', packCount: 1, unitSize: 64 }],
    // Arabic-Indic digits are normalized before parsing
    ['٦ × ٢٠٠ مل', { baseQuantity: 1200, unit: 'ml', packCount: 6, unitSize: 200 }],
    ['٥٠٠ جم', { baseQuantity: 500, unit: 'g', packCount: 1, unitSize: 500 }],
    ['١٢ رول', { baseQuantity: 12, unit: 'rolls', packCount: 1, unitSize: 12 }],
    // imperial conversions
    ['16 oz', { baseQuantity: 453.592, unit: 'g', packCount: 1, unitSize: 16 }],
    ['1 lb', { baseQuantity: 453.592, unit: 'g', packCount: 1, unitSize: 1 }],
    ['2 lbs', { baseQuantity: 907.184, unit: 'g', packCount: 1, unitSize: 2 }],
    ['1 gal', { baseQuantity: 3785.41, unit: 'ml', packCount: 1, unitSize: 1 }],
  ]
  for (const [raw, expected] of table) assertParsed(raw, expected)
})

test('size parser: documented vocabulary limits and quirks (current deterministic behavior)', () => {
  // These entries record real current behavior that a reader might expect to
  // differ. They are asserted so any intentional grammar change must confront
  // them explicitly — not because they are ideal.
  const table = [
    // promo with a trailing non-unit word: 'مجانا' is kept as the unit token,
    // is not a recognized unit, and the whole parse fails
    ['1+1 مجانا', null],
    // NUM_WORDS scan order hits the shorter 'واحد' before the full phrase
    // 'ثلاثة في واحد', so the value is 1 — not 3
    ['ثلاثة في واحد', { baseQuantity: 1, unit: 'pcs', packCount: 1, unitSize: 1 }],
    // carton without ×: the number is treated as the pack count with an
    // implicit per-pack amount of 1
    ['كرتون 12', { baseQuantity: 12, unit: 'pcs', packCount: 12, unitSize: 1 }],
    // container prefixes are ignored; the number+unit inside wins
    ['عبوة 500 مل', { baseQuantity: 500, unit: 'ml', packCount: 1, unitSize: 500 }],
    // unit vocabulary limits: context guessing (حفاض→pcs, بيض→pcs) only fires
    // for BARE numbers, so these counted forms fail to parse
    ['64 حفاضة', null],
    ['30 بيضة', null],
    ['10 pods', null],
  ]
  for (const [raw, expected] of table) assertParsed(raw, expected)
})

test('size parser: garbage and unit-only inputs return null', () => {
  const table = [
    'A4',
    'NEW',
    'xyz',
    '—',
    '-',
    '',
    '   ',
    'حبة', // unit word without a number
    'علبة', // container word without a number
  ]
  for (const raw of table) assertParsed(raw, null)
})
