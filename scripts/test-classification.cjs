const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const engineDir = path.join(root, 'src', 'lib', 'engine')
const outDir = path.join(root, '.test-build')
const serverDir = path.join(root, 'src', 'lib', 'server')

// tests/classification.test.cjs imports the compiled engine from .test-build
// (same contract as scripts/test-engine.cjs), so compile the engine first —
// identical flags and shared output dir, then spawn node --test like
// scripts/test-api.cjs does.
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const sources = [
  ...fs.readdirSync(engineDir).filter((f) => f.endsWith('.ts')).map((f) => path.join(engineDir, f)),
  path.join(serverDir, 'product-overlay.ts'),
  path.join(serverDir, 'request-body.ts'),
]
const tscCandidates = [
  path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'),
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
]
const tsc = tscCandidates.find((c) => c !== 'tsc' && c !== 'tsc.cmd' && fs.existsSync(c)) ?? tscCandidates[1]
const compile = spawnSync(tsc, [
  '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--esModuleInterop', '--rootDir', path.join(root, 'src', 'lib'), '--outDir', outDir, ...sources,
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (compile.status !== 0) {
  console.error('test-classification: engine compilation failed')
  process.exit(compile.status || 1)
}

const tests = spawnSync(process.execPath, ['--test', path.join(root, 'tests', 'classification.test.cjs')], { cwd: root, stdio: 'inherit' })
process.exit(tests.status || 0)
