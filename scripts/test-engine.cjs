const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const engineDir = path.join(root, 'src', 'lib', 'engine')
const outDir = path.join(root, '.test-build')
const serverDir = path.join(root, 'src', 'lib', 'server')
fs.rmSync(path.join(root, '.test-build'), { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const sources = [
  ...fs.readdirSync(engineDir).filter((f) => f.endsWith('.ts')).map((f) => path.join(engineDir, f)),
  path.join(serverDir, 'product-overlay.ts'),
  path.join(serverDir, 'request-body.ts'),
]
const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
const compile = spawnSync(tsc, [
  '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--esModuleInterop', '--rootDir', path.join(root, 'src', 'lib'), '--outDir', outDir, ...sources,
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (compile.status !== 0) process.exit(compile.status || 1)
const tests = spawnSync(process.execPath, ['--test', path.join(root, 'tests', 'engine.test.cjs'), path.join(root, 'tests', 'product-overlay.test.cjs'), path.join(root, 'tests', 'request-body.test.cjs'), path.join(root, 'tests', 'property.test.cjs'), path.join(root, 'tests', 'optimality.test.cjs')], { cwd: root, stdio: 'inherit' })
process.exit(tests.status || 0)
