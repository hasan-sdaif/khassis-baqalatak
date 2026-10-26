const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'openapi.json'), 'utf8'))
const apiDir = path.join(root, 'src', 'app', 'api')

// collect implemented routes (method -> path pattern) from route.ts files
const implemented = new Set()
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name === 'route.ts') {
      const rel = path.relative(apiDir, path.dirname(full)).replace(/\\/g, '/')
      const route = '/api' + (rel === '.' ? '' : '/' + rel).replace(/\[([^\]]+)\]/g, '{$1}')
      const src = fs.readFileSync(full, 'utf8')
      for (const m of src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)) {
        implemented.add(`${m[1]} ${route}`)
      }
    }
  }
}
walk(apiDir)

// every documented operation must exist in code; every implemented route must be documented
const documented = new Set()
for (const [p, ops] of Object.entries(spec.paths)) {
  for (const method of Object.keys(ops)) documented.add(`${method.toUpperCase()} ${p}`)
}
const missingInDoc = [...implemented].filter((k) => !documented.has(k))
const missingInCode = [...documented].filter((k) => !implemented.has(k))
if (missingInDoc.length || missingInCode.length) {
  console.error('openapi/implementation drift:')
  for (const k of missingInDoc) console.error('  implemented but NOT documented:', k)
  for (const k of missingInCode) console.error('  documented but NOT implemented:', k)
  process.exit(1)
}
console.log(`openapi.json consistent with implementation: ${implemented.size} operations`)
