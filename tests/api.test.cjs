const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/**
 * API integration tests. Run against a live server:
 *   node scripts/test-api.cjs            (defaults to http://localhost:3000)
 *   API_BASE=http://host node scripts/test-api.cjs
 * Skips transparently (exit 0, clear message) when no server is reachable, so
 * engine-only environments stay green without pretending API coverage.
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'
const root = path.resolve(__dirname, '..')

// synchronous reachability probe (top-level await is unavailable in CJS)
let serverUp = false
try {
  const { execSync } = require('node:child_process')
  const code = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${API_BASE}/api/health`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  serverUp = code === '200'
} catch {
  serverUp = false
}

if (!serverUp) {
  test('api suite requires a running server (skipped, not silently green)', { skip: true }, () => {
    assert.fail(`no server at ${API_BASE} — start it and re-run scripts/test-api.cjs`)
  })
} else {

  const household = (members = [{ id: 'm1', ageMonths: 420, specials: [] }]) => ({
    members,
    habits: {},
    dietary: { halalOnly: true },
    prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
    eatingOutPerWeek: 2, guestsPerMonth: 4, hasWaterDispenser: false, storage: 'medium',
  })
  const planBody = (extra = {}) => ({
    household: household(),
    budget: { fils: 90000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    mode: 'balanced', season: 'normal', storeMode: 'median', availableStores: [], delivery: true,
    locks: [], envelopes: [], pantry: [], seed: 42, ...extra,
  })
  const post = (url, body, headers = {}) => fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  // ---------- plan endpoint contract ----------
  test('POST /api/plan accepts a valid body and returns a consistent plan', async () => {
    const res = await post('/api/plan', planBody())
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.plan && typeof data.engineMs === 'number')
    const items = [...data.plan.items, ...data.plan.fixedItems, ...data.plan.envelopes.flatMap((e) => e.items)]
    const sum = items.reduce((s, i) => s + i.costFils, 0)
    assert.equal(sum, data.plan.totals.costFils, 'line items reconcile to the engine total')
  })

  test('POST /api/plan rejects an empty household with structured issues', async () => {
    const res = await post('/api/plan', planBody({ household: household([]) }))
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'invalid_input')
    assert.ok(Array.isArray(data.issues) && data.issues.length > 0)
  })

  test('POST /api/plan rejects malformed JSON without leaking internals', async () => {
    const res = await post('/api/plan', '{not-json')
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'invalid_json')
    assert.equal(Object.keys(data).length, 1, 'no stack traces or db messages in the error shape')
  })

  test('POST /api/plan rejects an oversized body before parsing (413)', async () => {
    const big = JSON.stringify({ pad: 'A'.repeat(600 * 1024) })
    const res = await post('/api/plan', big)
    assert.equal(res.status, 413)
    assert.equal((await res.json()).error, 'request_too_large')
  })

  // ---------- share privacy ----------
  test('POST /api/plans requires explicit household publish consent', async () => {
    const { consentToPublishHousehold, ...withoutConsent } = {
      title: 'اختبار خصوصية',
      household: household(),
      budget: { fils: 90000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
      envelopes: [], mode: 'balanced', season: 'normal', storeMode: 'median',
      availableStores: [], delivery: true, locks: [], pantry: [], isAnonymous: true,
      consentToPublishHousehold: true,
    }
    const res = await post('/api/plans', withoutConsent)
    assert.equal(res.status, 400)
  })

  test('published anonymous plans strip member names/ids and stay reachable only while public', async () => {
    const res = await post('/api/plans', {
      title: 'اختبار الخصوصية الآلي',
      household: household([
        { id: 'real-secret-id', name: 'اسم حقيقي حساس', ageMonths: 420, specials: [] },
      ]),
      budget: { fils: 90000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
      envelopes: [], mode: 'balanced', season: 'normal', storeMode: 'median',
      availableStores: [], delivery: true, locks: [], pantry: [],
      isAnonymous: true, consentToPublishHousehold: true,
    })
    assert.equal(res.status, 200)
    const { slug } = await res.json()

    const view = await fetch(`${API_BASE}/api/plans/${slug}`)
    assert.equal(view.status, 200)
    const data = await view.json()
    assert.equal(data.familyName, null, 'anonymous share exposes no family name')
    for (const member of data.input.household.members) {
      assert.match(member.id, /^shared-member-\d+$/, 'member ids are genericized before storage')
      assert.equal(member.name, undefined, 'member names never leave the browser for anonymous shares')
    }
    const raw = JSON.stringify(data)
    assert.ok(!raw.includes('real-secret-id') && !raw.includes('اسم حقيقي حساس'))

    // unknown / guessed slugs must not leak existence
    const missing = await fetch(`${API_BASE}/api/plans/${slug}x`)
    assert.equal(missing.status, 404)

    // a private row (isPublic=false) is invisible even with a known slug
    let prisma = null
    try { prisma = require(path.join(root, 'node_modules', '@prisma', 'client')) } catch { /* generated client optional */ }
    if (prisma) {
      const db = new prisma.PrismaClient()
      try {
        await db.sharedPlan.update({ where: { slug }, data: { isPublic: false } })
        const hidden = await fetch(`${API_BASE}/api/plans/${slug}`)
        assert.equal(hidden.status, 404, 'private plans return 404 even with the exact slug')
      } finally {
        await db.sharedPlan.deleteMany({ where: { slug } }).catch(() => undefined)
        await db.$disconnect().catch(() => undefined)
      }
    } else {
      assert.ok(true, 'prisma client not generated — DB-level privacy flip not tested here')
    }
  })

  // ---------- admin gate ----------
  test('admin endpoints refuse non-loopback hosts when no key is configured (dev)', async () => {
    const { request } = require('node:http')
    const status = await new Promise((resolve) => {
      const url = new URL(`${API_BASE}/api/admin/stats`)
      const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers: { host: 'external.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', () => resolve(0))
      req.end()
    })
    assert.equal(status, 403, 'a spoofed non-loopback Host must be refused in dev mode')
  })

  test('admin audit rejects a malformed body with a stable error code', async () => {
    const res = await post('/api/admin/audit', { id: '' })
    assert.equal(res.status, 400)
  })

  // ---------- contribution + vote integrity ----------
  test('voting is one-per-voterKey and toggling flips the count exactly', async () => {
    const created = await post('/api/contribute', { kind: 'generic', payload: { note: 'api-test' } })
    assert.equal(created.status, 200)
    const { id } = await created.json()

    try {
      const v1 = await post(`/api/contribute/${id}/vote`, { voterKey: 'test-voter-key-01', value: 1 })
      assert.equal(v1.status, 200)
      assert.equal((await v1.json()).votes, 1)

      const v1again = await post(`/api/contribute/${id}/vote`, { voterKey: 'test-voter-key-01', value: 1 })
      assert.equal((await v1again.json()).votes, 1, 'duplicate vote with the same key never double-counts')

      const v2 = await post(`/api/contribute/${id}/vote`, { voterKey: 'test-voter-key-02', value: 1 })
      assert.equal((await v2.json()).votes, 2)

      const flipped = await post(`/api/contribute/${id}/vote`, { voterKey: 'test-voter-key-02', value: -1 })
      assert.equal((await flipped.json()).votes, 0, 'changing a vote adjusts the count by ±2, not ±1')

      const bad = await post(`/api/contribute/${id}/vote`, { voterKey: 'short', value: 1 })
      assert.equal(bad.status, 400)

      const missing = await post(`/api/contribute/does-not-exist/vote`, { voterKey: 'test-voter-key-01', value: 1 })
      assert.equal(missing.status, 404)
    } finally {
      let prisma = null
      try { prisma = require(path.join(root, 'node_modules', '@prisma', 'client')) } catch { /* optional */ }
      if (prisma) {
        const db = new prisma.PrismaClient()
        try {
          await db.vote.deleteMany({ where: { contributionId: id } })
          await db.contribution.deleteMany({ where: { id } })
        } finally { await db.$disconnect().catch(() => undefined) }
      }
    }
  })

  // ---------- public queue hygiene ----------
  test('public contribution queue only exposes pending items without review data', async () => {
    const res = await fetch(`${API_BASE}/api/contribute?status=approved`)
    assert.equal(res.status, 400)
    const ok = await fetch(`${API_BASE}/api/contribute`)
    assert.equal(ok.status, 200)
    const text = JSON.stringify(await ok.json())
    assert.ok(!text.includes('reviewNote') && !text.includes('reviewedBy') && !text.includes('submittedBy'))
  })

  // ---------- rate limiting (last: consumes the share budget) ----------
  test('share endpoint throttles floods with 429 + Retry-After', async () => {
    let saw429 = null
    for (let i = 0; i < 8; i++) {
      const res = await post('/api/plans', {
        title: `اختبار الحد ${i}`,
        household: household(),
        budget: { fils: 50000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
        envelopes: [], mode: 'balanced', season: 'normal', storeMode: 'median',
        availableStores: [], delivery: true, locks: [], pantry: [],
        isAnonymous: true, consentToPublishHousehold: true,
      })
      if (res.status === 429) {
        saw429 = res
        // clean up whatever this flood created
        let prisma = null
        try { prisma = require(path.join(root, 'node_modules', '@prisma', 'client')) } catch { /* optional */ }
        if (prisma) {
          const db = new prisma.PrismaClient()
          try { await db.sharedPlan.deleteMany({ where: { title: { startsWith: 'اختبار الحد' } } }) }
          finally { await db.$disconnect().catch(() => undefined) }
        }
        break
      }
      // consume body to free the socket
      await res.arrayBuffer().catch(() => undefined)
    }
    assert.ok(saw429, 'a burst beyond the per-minute budget must hit 429')
    assert.ok(saw429.headers.get('retry-after'), '429 carries a Retry-After header')
    assert.equal((await saw429.json()).error, 'rate_limited')
  })
}
