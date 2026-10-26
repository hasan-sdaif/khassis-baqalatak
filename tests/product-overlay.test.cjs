const test = require('node:test')
const assert = require('node:assert/strict')
const { deriveProductOverride } = require('../.test-build/server/product-overlay.js')

function product(overrides = {}) {
  return {
    id: 'test-product',
    category: 'milk',
    nameEn: 'Full Fat Milk',
    nameAr: 'حليب كامل الدسم',
    nameNorm: 'حليب كامل الدسم',
    brand: 'Test Brand',
    brandNorm: 'test brand',
    sizeText: '1 L',
    size: { value: 1, unit: 'l', baseQuantity: 1, confidence: 1 },
    flavors: [], tags: [], rank: 10, storesCount: 2, available: true,
    medianFils: 1000, minFils: 900, maxFils: 1100,
    prices: { storeA: { fils: 900, available: true }, storeB: { fils: 1100, available: true } },
    unitPriceFils: 1000, need: 'milk.fresh.full-fat', dataConfidence: 1,
    ...overrides,
  }
}

test('product overlay recalculates median and unit price when store prices change', () => {
  const before = { prices: { storeA: { fils: 900, available: true }, storeB: { fils: 1100, available: true } }, medianFils: 1000 }
  const after = deriveProductOverride(product(), before, {
    prices: { storeA: { fils: 1500, available: true }, storeB: { fils: 1700, available: true } },
  })
  assert.equal(after.medianFils, 1600)
  assert.equal(after.minFils, 1500)
  assert.equal(after.maxFils, 1700)
  assert.equal(after.unitPriceFils, 1600)
})

test('product overlay recomputes need and tags when classification inputs change', () => {
  const after = deriveProductOverride(product(), {}, { nameAr: 'بيض دجاج طازج', nameEn: 'Fresh Chicken Eggs', category: 'eggs' })
  assert.match(String(after.need), /egg/i)
  assert.ok(Array.isArray(after.tags))
  assert.equal(after.category, 'eggs')
})

test('product overlay rejects zero/invalid derived median instead of persisting a broken price', () => {
  assert.throws(() => deriveProductOverride(product(), {}, { medianFils: 0 }), /invalid_median_price/)
})

test('product overlay keeps store metadata when a price is edited', () => {
  const original = product({ prices: {
    storeA: { fils: 900, available: false, url: 'https://example.test/a', origFils: 1000 },
    storeB: { fils: 1100, available: true, url: 'https://example.test/b' },
  } })
  const after = deriveProductOverride(original, {}, { prices: { storeB: { fils: 1200 } } })
  assert.equal(after.prices.storeA.available, false)
  assert.equal(after.prices.storeA.url, 'https://example.test/a')
  assert.equal(after.prices.storeA.origFils, 1000)
  assert.equal(after.prices.storeB.fils, 1200)
  assert.equal(after.prices.storeB.url, 'https://example.test/b')
  assert.equal(after.prices.storeB.available, true)
  assert.equal(after.medianFils, 1200)
})

test('product overlay marks a product unavailable when all store offers are unavailable', () => {
  const after = deriveProductOverride(product(), {}, {
    prices: { storeA: { fils: 900, available: false }, storeB: { fils: 1100, available: false } },
  })
  assert.equal(after.available, false)
  assert.equal(after.storesCount, 0)
  assert.equal(after.medianFils, 1000, 'retain last known median for audit while unavailable')
})
