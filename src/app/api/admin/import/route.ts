import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCatalog, bumpCatalogRev, stableId } from '@/lib/server/catalog'
import { parseMarkdownCatalog } from '@/lib/etl/markdown'
import { normalizeArabic } from '@/lib/engine/normalize'
import { parseSize } from '@/lib/engine/size'
import { classifyNeed, extractTags } from '@/lib/engine/needs'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CatalogProduct } from '@/lib/engine/types'
import { requireAdmin } from '@/lib/server/admin-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_IMPORT_BYTES = 25 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_IMPORT_BYTES + 64 * 1024

const ImportedPriceSchema = z.object({
  fils: z.number().int().positive().max(1_000_000_000),
  origFils: z.number().int().positive().max(1_000_000_000).optional(),
  url: z.string().max(2_048).optional(),
  available: z.boolean().optional(),
})
const ImportedSizeSchema = z.object({
  baseQuantity: z.number().positive().max(1_000_000_000),
  unit: z.enum(['ml', 'g', 'pcs', 'sheets', 'rolls', 'bags']),
  packCount: z.number().int().positive().max(1_000_000),
  unitSize: z.number().positive().max(1_000_000_000),
  confidence: z.number().min(0).max(1),
  trace: z.string().max(500),
})
const ImportedProductSchema = z.object({
  id: z.string().min(1).max(200),
  category: z.string().min(1).max(200),
  nameEn: z.string().max(1_000).optional().default(''),
  nameAr: z.string().max(1_000).optional().default(''),
  nameNorm: z.string().max(2_000).optional(),
  brand: z.string().max(250).nullable().optional().default(null),
  brandNorm: z.string().max(500).nullable().optional(),
  sizeText: z.string().max(500).nullable().optional().default(null),
  size: ImportedSizeSchema.nullable().optional().default(null),
  flavors: z.array(z.string().max(120)).max(100).optional().default([]),
  tags: z.array(z.string().max(120)).max(250).optional().default([]),
  rank: z.number().int().min(-100_000).max(1_000_000).optional().default(500),
  storesCount: z.number().int().min(0).max(10_000).optional().default(0),
  available: z.boolean().optional().default(true),
  medianFils: z.number().int().positive().max(1_000_000_000),
  minFils: z.number().int().positive().max(1_000_000_000).optional(),
  maxFils: z.number().int().positive().max(1_000_000_000).optional(),
  prices: z.record(z.string().min(1).max(100), ImportedPriceSchema).optional().default({}),
  unitPriceFils: z.number().int().positive().max(1_000_000_000).nullable().optional().default(null),
  need: z.string().max(250).nullable().optional().default(null),
  dataConfidence: z.number().min(0).max(1).optional().default(0.8),
}).strip()

async function readRequestTextLimited(req: NextRequest, limit: number): Promise<{ text?: string; tooLarge?: boolean; invalidEncoding?: boolean }> {
  const rawLength = req.headers.get('content-length')
  const contentLength = rawLength == null ? null : Number(rawLength)
  if (contentLength != null && Number.isFinite(contentLength) && contentLength > limit) return { tooLarge: true }
  const reader = req.body?.getReader()
  if (!reader) return { text: '' }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => undefined)
        return { tooLarge: true }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } }
    catch { return { invalidEncoding: true } }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Import center (spec 8.5): dry-run shows the diff (new/changed/missing vs
 * catalog), apply writes overlays for changed/new rows while PRESERVING
 * manual overrides. Formats: markdown (archive) or JSON (curated dump).
 */
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError
  // Enforce a byte cap before JSON.parse to avoid allocating arbitrarily large request bodies.
  const requestBody = await readRequestTextLimited(req, MAX_REQUEST_BYTES)
  if (requestBody.tooLarge) return NextResponse.json({ error: 'import_too_large' }, { status: 413 })
  if (requestBody.invalidEncoding || requestBody.text == null) return NextResponse.json({ error: 'invalid_encoding' }, { status: 400 })
  let untrusted: unknown
  try { untrusted = JSON.parse(requestBody.text) } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (!untrusted || typeof untrusted !== 'object' || Array.isArray(untrusted)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const body = untrusted as Record<string, unknown>
  const mode = body.mode === 'apply' ? 'apply' : body.mode === 'dry' || body.mode == null ? 'dry' : null
  const format = body.format === 'markdown' ? 'markdown' : body.format === 'json' || body.format == null ? 'json' : null
  if (!mode || !format) return NextResponse.json({ error: 'invalid_mode_or_format' }, { status: 400 })
  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 160) || 'upload' : 'upload'
  let md = ''
  if (typeof body.inline === 'string') {
    md = body.inline
    if (Buffer.byteLength(md, 'utf8') > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'import_too_large' }, { status: 413 })
  } else if (typeof body.path === 'string' && body.path.trim()) {
    try {
      const rawRoot = realpathSync(resolve(process.cwd(), 'data', 'raw'))
      const requested = resolve(process.cwd(), body.path)
      const actual = realpathSync(requested)
      const rel = relative(rawRoot, actual)
      if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
        return NextResponse.json({ error: 'import_path_forbidden' }, { status: 403 })
      }
      const stat = statSync(actual)
      if (!stat.isFile()) return NextResponse.json({ error: 'file_unreadable' }, { status: 400 })
      if (stat.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'import_too_large' }, { status: 413 })
      md = readFileSync(actual, 'utf-8')
    } catch { return NextResponse.json({ error: 'file_unreadable' }, { status: 400 }) }
  } else {
    return NextResponse.json({ error: 'inline_or_path_required' }, { status: 400 })
  }

  const catalog = await getCatalog()
  const byId = new Map(catalog.products.map((p) => [p.id, p]))

  let newRows: CatalogProduct[] = []
  const warnings: string[] = []

  if (format === 'markdown') {
    const storeMap: Record<string, string> = {}
    for (const s of catalog.stores) { storeMap[s.nameAr] = s.id; storeMap[s.nameEn] = s.id }
    const parsed = parseMarkdownCatalog(md, undefined, storeMap)
    warnings.push(...parsed.warnings)
    newRows = parsed.rows.map((r) => ({
      id: r.id, category: r.category, nameEn: r.nameEn, nameAr: r.nameAr,
      nameNorm: normalizeArabic(`${r.nameAr} ${r.nameEn} ${r.brand ?? ''}`),
      brand: r.brand, brandNorm: r.brand ? normalizeArabic(r.brand) : null,
      sizeText: r.sizeText, size: r.size, flavors: [], tags: r.tags,
      rank: r.rank, storesCount: r.storesCount, available: true,
      medianFils: r.medianFils, minFils: r.minFils, maxFils: r.maxFils,
      prices: r.prices, unitPriceFils: r.unitPriceFils, need: r.need,
      dataConfidence: 0.8,
    }))
  } else {
    // JSON: accept either the full catalog dump or { products: [...] }
    let parsedJson: unknown
    try { parsedJson = JSON.parse(md) } catch { return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 }) }
    let rawProducts: unknown[] | null = null
    if (Array.isArray(parsedJson)) rawProducts = parsedJson
    else if (parsedJson && typeof parsedJson === 'object') {
      const object = parsedJson as { products?: unknown; cats?: unknown }
      if (Array.isArray(object.products)) rawProducts = object.products
      else if (Array.isArray(object.cats) && object.cats.every((cat) => !!cat && typeof cat === 'object')) {
        rawProducts = object.cats.flatMap((cat) => {
          const group = cat as { products?: unknown }
          return Array.isArray(group.products) ? group.products : []
        })
      }
    }
    if (!rawProducts || rawProducts.length > 200_000) return NextResponse.json({ error: 'invalid_catalog_shape' }, { status: 400 })
    const checked = z.array(ImportedProductSchema).safeParse(rawProducts)
    if (!checked.success) {
      return NextResponse.json({
        error: 'invalid_catalog_rows',
        issues: checked.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
      }, { status: 400 })
    }
    newRows = checked.data.map((p) => ({
      ...p,
      nameNorm: p.nameNorm ?? normalizeArabic(`${p.nameAr} ${p.nameEn} ${p.brand ?? ''}`),
      brandNorm: p.brand ? normalizeArabic(p.brand) : null,
      size: p.size ?? (p.sizeText ? parseSize(p.sizeText) : null),
      need: p.need ?? classifyNeed(p.nameEn, p.nameAr, p.brand, p.category, p.flavors),
      tags: p.tags.length ? p.tags : extractTags(p.nameEn, p.nameAr, p.flavors, p.sizeText),
      available: p.available,
      minFils: p.minFils ?? p.medianFils, maxFils: p.maxFils ?? p.medianFils,
      storesCount: p.storesCount || Object.keys(p.prices).length,
      dataConfidence: p.dataConfidence,
    }))
  }

  // diff vs current catalog
  const added: CatalogProduct[] = []
  const changed: { id: string; nameAr: string; field: string; from: number; to: number }[] = []
  for (const r of newRows) {
    const cur = byId.get(r.id)
    if (!cur) { added.push(r); continue }
    if (r.medianFils !== cur.medianFils) changed.push({ id: r.id, nameAr: cur.nameAr || cur.nameEn, field: 'medianFils', from: cur.medianFils, to: r.medianFils })
  }
  const newIds = new Set(newRows.map((r) => r.id))
  const missing = catalog.products.filter((p) => !newIds.has(p.id) && !p.id.startsWith('manual')).slice(0, 50).map((p) => ({ id: p.id, nameAr: p.nameAr || p.nameEn }))

  const stats = { read: newRows.length, added: added.length, changed: changed.length, missing: missing.length, warnings: warnings.slice(0, 20) }

  if (mode === 'apply') {
    let applied = 0
    for (const r of [...added, ...newRows.filter((r) => byId.get(r.id) && r.medianFils !== byId.get(r.id)!.medianFils)]) {
      // preserve manual overrides: only write fields that carry new values
      const existing = await db.productOverride.findUnique({ where: { id: r.id } })
      if (existing) {
        const cur = JSON.parse(existing.data) as Record<string, unknown>
        if (cur.__manual) continue // human-edited rows are never overwritten (spec 3.3-4)
      }
      const data = added.includes(r) ? { ...r, added: true } : { medianFils: r.medianFils, minFils: r.minFils, maxFils: r.maxFils, prices: r.prices }
      await db.productOverride.upsert({ where: { id: r.id }, create: { id: r.id, data: JSON.stringify(data) }, update: { data: JSON.stringify(data) } })
      applied++
    }
    await bumpCatalogRev()
    await db.importBatch.create({ data: { source, format, mode: 'apply', stats: JSON.stringify(stats), appliedAt: new Date() } })
    return NextResponse.json({ ok: true, mode, stats, applied })
  }

  await db.importBatch.create({ data: { source, format, mode: 'dry', stats: JSON.stringify(stats) } })
  return NextResponse.json({
    ok: true, mode, stats,
    preview: {
      added: added.slice(0, 25).map((p) => ({ id: p.id, nameAr: p.nameAr || p.nameEn, category: p.category, medianFils: p.medianFils })),
      changed: changed.slice(0, 25),
      missing: missing.slice(0, 25),
    },
  })
}
