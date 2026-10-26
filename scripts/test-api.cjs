const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'

// Load DATABASE_URL from .env when not exported, so prisma-backed assertions work.
if (!process.env.DATABASE_URL && fs.existsSync(path.join(root, '.env'))) {
  const line = fs.readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('DATABASE_URL='))
  if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim()
}

const env = { ...process.env, API_BASE }
const tests = spawnSync(process.execPath, ['--test', path.join(root, 'tests', 'api.test.cjs')], {
  cwd: root, stdio: 'inherit', env,
})
process.exit(tests.status || 0)
