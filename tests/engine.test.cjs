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
catalog.fingerprint = catalogFingerprint(catalog)

function household(members = [
  { id: 'adult-a', ageMonths: 360, gender: 'm', specials: [] },
  { id: 'adult-b', ageMonths: 336, gender: 'f', specials: [] },
], habits = {}) {
  return {
    members, habits,
    dietary: { halalOnly: true },
    prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
    eatingOutPerWeek: 3, guestsPerMonth: 2, hasWaterDispenser: false, storage: 'medium',
  }
}

function input(overrides = {}) {
  return {
    catalog,
    household: household(),
    budget: { fils: 90000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    context: { dateISO: '2026-10-26', season: 'normal', storeMode: 'median', availableStores: [], delivery: true },
    config: DEFAULT_CONFIG,
    locks: [], envelopes: [], mode: 'balanced', seed: 42,
    ...overrides,
  }
}

test('catalog snapshot matches the checked-in product corpus and has valid prices', () => {
  assert.equal(catalog.version, '2026-10-25')
  assert.equal(catalog.products.length, 39831)
  assert.equal(catalog.stores.length, 37)
  assert.equal(catalog.categories.length, 43)
  const storeIds = new Set(catalog.stores.map((store) => store.id))
  const productIds = new Set()
  for (const product of catalog.products) {
    assert.ok(product.id, 'product id is present')
    assert.ok(!productIds.has(product.id), `duplicate product id: ${product.id}`)
    productIds.add(product.id)
    assert.ok((product.nameAr || product.nameEn || '').trim(), `product name is present: ${product.id}`)
    assert.ok(Number.isFinite(product.medianFils) && product.medianFils > 0, `valid median price: ${product.id}`)
    assert.ok(Object.keys(product.prices || {}).length > 0, `at least one store price: ${product.id}`)
    for (const [storeId, price] of Object.entries(product.prices || {})) {
      assert.ok(storeIds.has(storeId), `known store ${storeId}: ${product.id}`)
      assert.ok(Number.isFinite(price.fils) && price.fils > 0, `positive price: ${product.id}/${storeId}`)
    }
  }
})

test('Arabic normalization is stable and pack size parser handles multi-packs', () => {
  assert.equal(normalizeArabic('إِذَا الأَرُزّ'), normalizeArabic('اذا الارز'))
  const parsed = parseSize('6 × 200 مل')
  assert.ok(parsed)
  assert.equal(parsed.baseQuantity, 1200)
  assert.equal(parsed.unit, 'ml')
  assert.equal(parsed.packCount, 6)
  assert.equal(parsed.unitSize, 200)
})

test('plan generation is deterministic and anchored to catalog snapshot date', () => {
  const args = input()
  const first = generatePlan(args)
  const second = generatePlan(args)
  assert.equal(first.generatedAt, catalog.generatedAt)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  const changedPreferences = household()
  changedPreferences.prefs.blockedBrands = ['Farm Fresh']
  const different = generatePlan(input({ household: changedPreferences }))
  assert.notEqual(first.fingerprint, different.fingerprint, 'a preference change must change the plan fingerprint')
  assert.equal(first.diagnostics.totalCostFils, first.totals.costFils)
})

test('ordinary household plan stays within budget target when protected costs are feasible', () => {
  const plan = generatePlan(input())
  assert.ok(plan.totals.costFils <= plan.diagnostics.targetFils,
    `plan ${plan.totals.costFils} exceeds target ${plan.diagnostics.targetFils}`)
  assert.equal(plan.diagnostics.shortfallFils, 0)
})

test('egg need cannot select custard or dessert products', () => {
  const plan = generatePlan(input())
  const eggItems = [...plan.items, ...plan.fixedItems].filter((item) => item.needId === 'eggs')
  assert.ok(eggItems.length > 0, 'the fixture household should have a planned egg need')
  for (const item of eggItems) {
    assert.match(`${item.productName} ${item.needId}`, /egg|بيض/i)
    assert.doesNotMatch(item.productName, /custard|dessert|caramel|كيك|كاسترد/i)
  }
})

test('infant formula stays in the matching stage and never substitutes adult nutrition drinks', () => {
  const babyHousehold = household([
    { id: 'parent', ageMonths: 360, gender: 'f', specials: [] },
    { id: 'baby', ageMonths: 8, gender: 'm', specials: [] },
  ], { formula: { dep_baby: 100 } })
  const plan = generatePlan(input({ household: babyHousehold, budget: { fils: 100000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 } }))
  const formulaItems = [...plan.items, ...plan.fixedItems].filter((item) => item.needId.startsWith('formula@'))
  assert.ok(formulaItems.length > 0, 'formula need generated for the example infant')
  for (const item of formulaItems) {
    assert.match(item.needId, /^formula@2$/)
    assert.doesNotMatch(item.productName, /pediasure|pedia\s*sure|ensure|إنشور|بيدياشور/i)
    assert.match(item.productName, /formula|milk|حليب|نان|نستله|أبتاميل|سيميلاك/i)
  }
})

test('envelope spending is counted exactly once in diagnostics', () => {
  const plan = generatePlan(input({
    budget: { fils: 100000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    envelopes: [{ id: 'test-chocolate', name: 'حلويات الاختبار', groups: ['chocolate'], mode: 'range', minFils: 1000, maxFils: 5000, priority: 'normal', fillToMax: true }],
  }))
  assert.equal(plan.diagnostics.totalCostFils, plan.totals.costFils)
  assert.ok(plan.totals.costFils <= plan.diagnostics.targetFils,
    `envelope-backed plan ${plan.totals.costFils} must respect target ${plan.diagnostics.targetFils} when feasible`)
  assert.ok(plan.envelopes.length > 0, 'the envelope scenario must be present to exercise envelope constraints')
  assert.ok(plan.envelopes.every((envelope) => envelope.items.length > 0), 'selected envelope must contain concrete products')
  if (plan.envelopes.length) {
    const envelopeCost = plan.envelopes.reduce((sum, envelope) => sum + envelope.spentFils, 0)
    assert.ok(envelopeCost >= 0)
    for (const envelope of plan.envelopes) {
      assert.equal(envelope.spentFils, envelope.items.reduce((sum, item) => sum + item.costFils, 0),
        `envelope ${envelope.envelopeId} spend must reconcile to the visible item prices`)
      if (Number.isFinite(envelope.maxFils)) assert.ok(envelope.spentFils <= envelope.maxFils,
        `envelope ${envelope.envelopeId} spend ${envelope.spentFils} must not exceed max ${envelope.maxFils}`)
    }
    assert.equal(plan.diagnostics.totalCostFils,
      plan.items.reduce((sum, item) => sum + item.costFils, 0) +
      plan.fixedItems.reduce((sum, item) => sum + item.costFils, 0) + envelopeCost)
  }
})


test('unified plan items include envelope selections exactly once and reconcile to engine total', () => {
  const plan = generatePlan(input({
    budget: { fils: 100000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    envelopes: [{ id: 'report-envelope', name: 'حلويات التقرير', groups: ['chocolate'], mode: 'range', minFils: 1000, maxFils: 5000, priority: 'normal', fillToMax: true }],
  }))
  const items = getAllPlanItems(plan)
  assert.equal(new Set(items.map((item) => item.key)).size, items.length, 'each shopping line should appear once')
  assert.equal(sumPlanItemsFils(items), plan.totals.costFils, 'report, home, shopping list, and spend tracking should share the engine total')
  for (const envelope of plan.envelopes) {
    for (const item of envelope.items) assert.ok(items.some((candidate) => candidate.key === item.key), `envelope item included: ${item.key}`)
  }
})


test('a locked product is honored exactly once with its requested quantity', () => {
  const riceProduct = catalog.products.find((p) => p.need === 'rice' && p.available === true && (p.medianFils ?? 0) > 0)
  assert.ok(riceProduct, 'fixture catalog must contain an available rice product')
  const plan = generatePlan(input({ locks: [{ productId: riceProduct.id, qty: 2 }] }))
  const lines = getAllPlanItems(plan).filter((item) => item.productId === riceProduct.id)
  assert.equal(lines.length, 1, 'the locked product must appear exactly once')
  assert.equal(lines[0].packQty, 2, 'the locked quantity must be respected')
  assert.equal(lines[0].locked, true, 'the locked line is marked as fixed/pinned')
  assert.ok(plan.fixedItems.some((item) => item.productId === riceProduct.id), 'locked lines are accounted in fixedItems')
  assert.ok(!(plan.diagnostics.warnings || []).some((w) => w.includes('تعذّر تثبيت')), 'an honored lock must not raise a warning')
})


test('locks survive a tight budget: the shortfall is declared instead of silently dropping pinned lines', () => {
  const riceProduct = catalog.products.find((p) => p.need === 'rice' && p.available === true && (p.medianFils ?? 0) > 0)
  const plan = generatePlan(input({
    budget: { fils: 12000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    locks: [{ productId: riceProduct.id, qty: 2 }],
  }))
  const lines = getAllPlanItems(plan).filter((item) => item.productId === riceProduct.id)
  assert.equal(lines.length, 1, 'the pinned line is still present under an impossible budget')
  assert.equal(lines[0].packQty, 2, 'the pinned quantity is not reduced by the shortfall ladder')
  assert.ok(plan.totals.costFils > plan.diagnostics.targetFils, 'the plan is honestly over budget')
  assert.ok(plan.diagnostics.shortfallFils > 0, 'the shortfall is declared numerically')
})


test('an un-honorable lock is surfaced with a reason, never dropped silently', () => {
  const plan = generatePlan(input({ locks: [{ productId: 'does-not-exist-123' }] }))
  assert.ok((plan.diagnostics.warnings || []).some((w) => w.includes('تعذّر تثبيت') && w.includes('غير موجود في الكتالوج')),
    'unknown lock ids must produce an explicit warning')
})


test('must-priority envelope under a tight budget declares shortfall and never exceeds its ceiling', () => {
  const infantHousehold = household([
    { id: 'parent', ageMonths: 384, gender: 'f', specials: [] },
    { id: 'baby', ageMonths: 8, gender: 'm', specials: ['formula'] },
  ], { formula: { dep_baby: 100 } })
  const plan = generatePlan(input({
    household: infantHousehold,
    budget: { fils: 60000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    envelopes: [{ id: 'must-env', name: 'ضيافة ضرورية', groups: ['dates', 'coffee', 'tea'], mode: 'range', minFils: 3000, maxFils: 6000, priority: 'must', fillToMax: false }],
  }))
  for (const envelope of plan.envelopes) {
    assert.ok(envelope.spentFils <= envelope.maxFils, `envelope ${envelope.envelopeId} spend ${envelope.spentFils} must not exceed max ${envelope.maxFils}`)
    assert.equal(envelope.spentFils, envelope.items.reduce((sum, item) => sum + item.costFils, 0), 'spentFils equals visible line prices')
  }
  assert.ok(plan.diagnostics.shortfallFils > 0, 'an infeasible must-envelope budget must declare a shortfall, not hide it')
})
