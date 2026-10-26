/**
 * Khassis Baqalatak — reproducible performance benchmark (continuation spec §7.4).
 *
 * Compiles the engine exactly the way scripts/test-engine.cjs does (tsc from
 * node_modules into the shared .test-build dir), then measures against the REAL
 * catalog snapshot (data/curated/catalog.json — 39,831 products / 37 stores):
 *
 *   [a] cold catalog load + JSON.parse (read stage and parse stage separately)
 *   [b] generatePlan() p50/p95 over N=30 runs for three FIXED household fixtures
 *       (single adult @ 25,000 fils, family of 4 @ 90,000, family of 8 with an
 *       infant @ 180,000) — 3 untimed JIT warmup runs first
 *   [c] catalogFingerprint() single run (in production it is cached ONCE per
 *       snapshot load/edit, not per plan — see src/lib/server/catalog.ts)
 *   [d] search hot path: full-catalog normalized-name `includes` scan for 'أرز'
 *       (approximates /api/search which scans the same in-memory catalog)
 *   [e] memory: heapUsed + RSS after load, after fingerprint, after all plans
 *
 * Deterministic-friendly: fixed fixtures, fixed seed (42), no Math.random, no
 * network, no clock-dependent logic. The script only PRINTS the numbers —
 * docs/PERFORMANCE.md is written by hand from a real run of this script.
 *
 * Usage: node scripts/benchmark.cjs   (or: bun run benchmark)
 * Exit code 0 on success, 1 on any failure.
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const engineDir = path.join(root, 'src', 'lib', 'engine')
const outDir = path.join(root, '.test-build')
const catalogPath = path.join(root, 'data', 'curated', 'catalog.json')

// ---------------------------------------------------------------------------
// 1) compile the engine the same way scripts/test-engine.cjs does
// ---------------------------------------------------------------------------
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const sources = fs.readdirSync(engineDir).filter((f) => f.endsWith('.ts')).map((f) => path.join(engineDir, f))
const tscCandidates = [
  path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'),
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
]
const tsc = tscCandidates.find((c) => c !== 'tsc' && c !== 'tsc.cmd' && fs.existsSync(c)) ?? tscCandidates[1]
const compile = spawnSync(tsc, [
  '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--esModuleInterop',
  '--rootDir', path.join(root, 'src', 'lib'), '--outDir', outDir, ...sources,
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (compile.status !== 0) {
  console.error('benchmark: engine compilation failed')
  process.exit(compile.status || 1)
}
const { generatePlan } = require(path.join(outDir, 'engine', 'generate.js'))
const { DEFAULT_CONFIG } = require(path.join(outDir, 'engine', 'config.js'))
const { normalizeArabic, catalogFingerprint } = require(path.join(outDir, 'engine', 'normalize.js'))

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const ms = (bigintDelta) => Number(bigintDelta) / 1e6
const fmt = (x) => `${x.toFixed(1)} ms`
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** nearest-rank percentile over sorted samples (deterministic, no interpolation) */
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  const rank = (p) => sorted[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))]
  return { n, min: sorted[0], p50: rank(50), p95: rank(95), max: sorted[n - 1] }
}

/** household fixture builder — same shape as tests/engine.test.cjs household() */
function household(members, habits = {}) {
  return {
    members, habits,
    dietary: { halalOnly: true },
    prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
    eatingOutPerWeek: 3, guestsPerMonth: 2, hasWaterDispenser: false, storage: 'medium',
  }
}

// fixed fixtures — no randomness anywhere
const FIXTURES = [
  {
    id: 'single-adult',
    label: 'شخص واحد (بالغ) — 25.000 د.ب',
    budgetFils: 25000,
    household: household([{ id: 'adult-a', ageMonths: 360, gender: 'm', specials: [] }]),
  },
  {
    id: 'family-4',
    label: 'أسرة من 4 أفراد (بالغان + طفلان) — 90.000 د.ب',
    budgetFils: 90000,
    household: household([
      { id: 'adult-a', ageMonths: 360, gender: 'm', specials: [] },
      { id: 'adult-b', ageMonths: 336, gender: 'f', specials: [] },
      { id: 'child-a', ageMonths: 96, gender: 'm', specials: [] },
      { id: 'child-b', ageMonths: 48, gender: 'f', specials: [] },
    ]),
  },
  {
    id: 'family-8-infant',
    label: 'أسرة من 8 أفراد مع رضيع (حليب صناعي) — 180.000 د.ب',
    budgetFils: 180000,
    household: household([
      { id: 'adult-a', ageMonths: 372, gender: 'm', specials: [] },
      { id: 'adult-b', ageMonths: 348, gender: 'f', specials: [] },
      { id: 'child-a', ageMonths: 132, gender: 'm', specials: [] },
      { id: 'child-b', ageMonths: 96, gender: 'f', specials: [] },
      { id: 'child-c', ageMonths: 84, gender: 'm', specials: [] },
      { id: 'child-d', ageMonths: 30, gender: 'f', specials: [] },
      { id: 'child-e', ageMonths: 12, gender: 'm', specials: [] },
      { id: 'infant', ageMonths: 8, gender: 'f', specials: ['formula'] },
    ], { formula: { dep_infant: 100 } }),
  },
]

function planInput(fixture) {
  return {
    catalog: benchmarkCatalog,
    household: fixture.household,
    budget: { fils: fixture.budgetFils, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
    context: { dateISO: '2026-10-26', season: 'normal', storeMode: 'median', availableStores: [], delivery: true },
    config: DEFAULT_CONFIG,
    locks: [], envelopes: [], mode: 'balanced', seed: 42,
  }
}

const report = { environment: {}, measurements: {} }

// ---------------------------------------------------------------------------
// environment
// ---------------------------------------------------------------------------
const cpus = os.cpus()
report.environment = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${os.platform()} ${os.release()} (${os.arch()})`,
  cpuModel: cpus.length ? cpus[0].model : 'unknown',
  cpuCount: cpus.length,
  totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
  catalogFile: path.relative(root, catalogPath),
  catalogBytes: 0,
  products: 0,
  stores: 0,
  categories: 0,
  engineVersion: DEFAULT_CONFIG.version,
}

// ---------------------------------------------------------------------------
// [a] cold catalog load + parse
// ---------------------------------------------------------------------------
const statBefore = fs.statSync(catalogPath)
report.environment.catalogBytes = statBefore.size
const ta0 = process.hrtime.bigint()
const rawText = fs.readFileSync(catalogPath, 'utf8')
const ta1 = process.hrtime.bigint()
const benchmarkCatalog = JSON.parse(rawText)
const ta2 = process.hrtime.bigint()
const loadReadMs = ms(ta1 - ta0)
const loadParseMs = ms(ta2 - ta1)
report.environment.products = benchmarkCatalog.products.length
report.environment.stores = benchmarkCatalog.stores.length
report.environment.categories = benchmarkCatalog.categories.length
if (!benchmarkCatalog.products.length || !benchmarkCatalog.stores.length) {
  console.error('benchmark: malformed catalog (empty products/stores)')
  process.exit(1)
}
report.measurements.load = { readMs: loadReadMs, parseMs: loadParseMs, totalMs: loadReadMs + loadParseMs }
const memAfterLoad = process.memoryUsage()

// ---------------------------------------------------------------------------
// [c] catalogFingerprint — single run, then cached once per snapshot
//     (mirrors src/lib/server/catalog.ts: fingerprint computed at load, plans reuse it)
// ---------------------------------------------------------------------------
const tc0 = process.hrtime.bigint()
const fp = catalogFingerprint(benchmarkCatalog)
const tc1 = process.hrtime.bigint()
report.measurements.fingerprint = { ms: ms(tc1 - tc0), value: fp }
benchmarkCatalog.fingerprint = fp // cache it: every subsequent generatePlan reuses it
const memAfterFingerprint = process.memoryUsage()

// ---------------------------------------------------------------------------
// [b] generatePlan p50/p95 — 3 warmup runs + N=30 measured runs per fixture
// ---------------------------------------------------------------------------
const WARMUP = 3
const N = 30
report.measurements.plans = { warmup: WARMUP, runs: N, fixtures: [] }
for (const fixture of FIXTURES) {
  const input = planInput(fixture)
  // untimed JIT warmup + output determinism check (byte-identical plans)
  const warmupJson = []
  for (let i = 0; i < WARMUP; i++) warmupJson.push(JSON.stringify(generatePlan(input)))
  if (new Set(warmupJson).size !== 1) {
    console.error(`benchmark: NON-DETERMINISTIC output for fixture ${fixture.id}`)
    process.exit(1)
  }
  const samples = []
  const fingerprints = new Set()
  let lastPlan = null
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint()
    const plan = generatePlan(input)
    const t1 = process.hrtime.bigint()
    samples.push(ms(t1 - t0))
    fingerprints.add(plan.fingerprint)
    lastPlan = plan
  }
  if (fingerprints.size !== 1) {
    console.error(`benchmark: plan fingerprint drifted across runs for fixture ${fixture.id}`)
    process.exit(1)
  }
  const s = stats(samples)
  const entry = {
    id: fixture.id,
    label: fixture.label,
    budgetFils: fixture.budgetFils,
    members: fixture.household.members.length,
    items: lastPlan.items.length + lastPlan.fixedItems.length,
    costFils: lastPlan.totals.costFils,
    targetFils: lastPlan.diagnostics.targetFils,
    shortfallFils: lastPlan.diagnostics.shortfallFils,
    planFingerprint: lastPlan.fingerprint,
    minMs: s.min, p50Ms: s.p50, p95Ms: s.p95, maxMs: s.max,
    perProductUs: (s.p50 / benchmarkCatalog.products.length) * 1000,
  }
  report.measurements.plans.fixtures.push(entry)
}
const memAfterPlans = process.memoryUsage()

// ---------------------------------------------------------------------------
// [d] search hot path — full-catalog normalized-name includes scan ('أرز')
//     The server (/api/search) scans the same in-memory products array with
//     nameNorm token matching; this micro-benchmark times the scan core.
// ---------------------------------------------------------------------------
const SEARCH_QUERY = 'أرز'
const SEARCH_WARMUP = 5
const SEARCH_RUNS = 50
const qNorm = normalizeArabic(SEARCH_QUERY)
let searchHits = 0
for (let i = 0; i < SEARCH_WARMUP; i++) {
  searchHits = 0
  for (const p of benchmarkCatalog.products) if (p.nameNorm.includes(qNorm)) searchHits++
}
const searchSamples = []
for (let i = 0; i < SEARCH_RUNS; i++) {
  searchHits = 0
  const t0 = process.hrtime.bigint()
  for (const p of benchmarkCatalog.products) if (p.nameNorm.includes(qNorm)) searchHits++
  const t1 = process.hrtime.bigint()
  searchSamples.push(ms(t1 - t0))
}
const ss = stats(searchSamples)
report.measurements.searchScan = {
  query: SEARCH_QUERY, normalized: qNorm,
  runs: SEARCH_RUNS, hits: searchHits,
  minMs: ss.min, p50Ms: ss.p50, p95Ms: ss.p95, maxMs: ss.max,
  perProductUs: (ss.p50 / benchmarkCatalog.products.length) * 1000,
}

// ---------------------------------------------------------------------------
// [e] memory
// ---------------------------------------------------------------------------
report.measurements.memory = {
  afterLoad: { heapUsedMB: memAfterLoad.heapUsed / 1024 / 1024, rssMB: memAfterLoad.rss / 1024 / 1024 },
  afterFingerprint: { heapUsedMB: memAfterFingerprint.heapUsed / 1024 / 1024, rssMB: memAfterFingerprint.rss / 1024 / 1024 },
  afterPlans: { heapUsedMB: memAfterPlans.heapUsed / 1024 / 1024, rssMB: memAfterPlans.rss / 1024 / 1024 },
}

// ---------------------------------------------------------------------------
// structured report
// ---------------------------------------------------------------------------
const env = report.environment
const L = []
L.push('==================== Khassis Baqalatak — benchmark ====================')
L.push('[environment]')
L.push(`  date            : ${env.date}`)
L.push(`  node            : ${env.node}`)
L.push(`  platform        : ${env.platform}`)
L.push(`  cpu             : ${env.cpuCount} × ${env.cpuModel}`)
L.push(`  total memory    : ${env.totalMemMB} MB`)
L.push(`  catalog         : ${env.catalogFile} (${(env.catalogBytes / 1024 / 1024).toFixed(1)} MB)`)
L.push(`  catalog contents: ${env.products} products / ${env.stores} stores / ${env.categories} categories`)
L.push(`  engine version  : ${env.engineVersion}`)
L.push('')
L.push('[a] cold catalog load + parse')
L.push(`  readFileSync    : ${fmt(report.measurements.load.readMs)}`)
L.push(`  JSON.parse      : ${fmt(report.measurements.load.parseMs)}`)
L.push(`  total           : ${fmt(report.measurements.load.totalMs)}`)
L.push('')
L.push(`[c] catalogFingerprint (single run — cached once per snapshot)`)
L.push(`  time            : ${fmt(report.measurements.fingerprint.ms)}`)
L.push(`  value           : ${report.measurements.fingerprint.value}`)
L.push('')
L.push(`[b] generatePlan (${WARMUP} warmup + ${N} measured runs per fixture, balanced mode, seed 42)`)
for (const f of report.measurements.plans.fixtures) {
  L.push(`  --- ${f.id} (${f.label})`)
  L.push(`      members ${f.members} | items ${f.items} | cost ${(f.costFils / 1000).toFixed(3)} BHD of ${(f.targetFils / 1000).toFixed(3)} target | shortfall ${f.shortfallFils} fils`)
  L.push(`      p50 ${fmt(f.p50Ms)} | p95 ${fmt(f.p95Ms)} | min ${fmt(f.minMs)} | max ${fmt(f.maxMs)}`)
  L.push(`      amortized ${f.perProductUs.toFixed(3)} µs/product (p50 / ${env.products})`)
  L.push(`      plan fingerprint ${f.planFingerprint}`)
}
L.push('')
L.push(`[d] search-path scan — nameNorm.includes('${SEARCH_QUERY}' -> '${qNorm}') over all ${env.products} products (${SEARCH_RUNS} scans)`)
L.push(`    hits            : ${report.measurements.searchScan.hits}`)
L.push(`    p50 per scan    : ${fmt(report.measurements.searchScan.p50Ms)}`)
L.push(`    p95 per scan    : ${fmt(report.measurements.searchScan.p95Ms)}`)
L.push(`    min / max       : ${fmt(report.measurements.searchScan.minMs)} / ${fmt(report.measurements.searchScan.maxMs)}`)
L.push(`    amortized       : ${report.measurements.searchScan.perProductUs.toFixed(3)} µs/product (p50)`)
L.push('')
L.push('[e] memory (process.memoryUsage())')
L.push(`  after load      : heapUsed ${mb(memAfterLoad.heapUsed)} | RSS ${mb(memAfterLoad.rss)}`)
L.push(`  after fingerprint: heapUsed ${mb(memAfterFingerprint.heapUsed)} | RSS ${mb(memAfterFingerprint.rss)}`)
L.push(`  after all plans : heapUsed ${mb(memAfterPlans.heapUsed)} | RSS ${mb(memAfterPlans.rss)}`)
L.push('')
L.push('[determinism] every fixture produced byte-identical plans across warmup runs and a constant plan fingerprint across all measured runs')
L.push('=======================================================================')
console.log(L.join('\n'))
console.log('REPORT_JSON=' + JSON.stringify(report))
process.exit(0)
