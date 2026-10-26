import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCatalog, bumpCatalogRev, stableId } from '@/lib/server/catalog'
import { parseMarkdownCatalog } from '@/lib/etl/markdown'
import { normalizeArabic } from '@/lib/engine/normalize'
import { parseSize } from '@/lib/engine/size'
import { classifyNeed, extractTags } from '@/lib/engine/needs'
import { readFileSync } from 'node:fs'
import type { CatalogProduct } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Import center (spec 8.5): dry-run shows the diff (new/changed/missing vs
 * catalog), apply writes overlays for changed/new rows while PRESERVING
 * manual overrides. Formats: markdown (archive) or JSON (curated dump).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  const mode = body.mode === 'apply' ? 'apply' : 'dry'
  const format = body.format === 'markdown' ? 'markdown' : 'json'
  const source = String(body.source ?? 'upload')
  let md = ''
  if (body.inline) {
    md = String(body.inline)
  } else if (body.path) {
    try { md = readFileSync(String(body.path), 'utf-8') } catch { return NextResponse.json({ error: 'file_unreadable' }, { status: 400 }) }
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
    const products = Array.isArray(parsedJson)
      ? (parsedJson as CatalogProduct[])
      : ((parsedJson as { products?: CatalogProduct[]; cats?: { products?: CatalogProduct[] }[] }).products
        ?? (parsedJson as { cats?: { products?: CatalogProduct[] }[] }).cats?.flatMap((c) => c.products ?? [])
        ?? [])
    newRows = products.map((p) => ({
      ...p,
      nameNorm: p.nameNorm ?? normalizeArabic(`${p.nameAr ?? ''} ${p.nameEn ?? ''} ${p.brand ?? ''}`),
      brandNorm: p.brand ? normalizeArabic(p.brand) : null,
      size: p.size ?? (p.sizeText ? parseSize(p.sizeText) : null),
      need: p.need ?? classifyNeed(p.nameEn ?? '', p.nameAr ?? '', p.brand ?? null, p.category, p.flavors ?? []),
      tags: p.tags ?? extractTags(p.nameEn ?? '', p.nameAr ?? '', p.flavors ?? [], p.sizeText ?? null),
      available: p.available ?? true,
      minFils: p.minFils ?? p.medianFils, maxFils: p.maxFils ?? p.medianFils,
      storesCount: p.storesCount ?? Object.keys(p.prices ?? {}).length,
      dataConfidence: p.dataConfidence ?? 0.8,
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
