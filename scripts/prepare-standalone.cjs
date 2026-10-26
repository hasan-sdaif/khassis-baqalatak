const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const standalone = path.join(root, '.next', 'standalone')
const required = [
  path.join(root, '.next', 'static'),
  path.join(root, 'public'),
]

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  console.error('Standalone Next.js output was not found. Ensure next.config.ts has output: "standalone" and next build succeeded.')
  process.exit(1)
}

for (const source of required) {
  if (!fs.existsSync(source)) {
    console.error(`Required build output is missing: ${path.relative(root, source)}`)
    process.exit(1)
  }
}

fs.cpSync(required[0], path.join(standalone, '.next', 'static'), { recursive: true, force: true })
fs.cpSync(required[1], path.join(standalone, 'public'), { recursive: true, force: true })
console.log('Standalone output prepared: static assets and public files copied.')
