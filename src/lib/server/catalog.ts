import 'server-only'
import { readFileSync, statSync } from 'node:fs'
import { db } from '@/lib/db'
import { normalizeArabic, stableId } from '@/lib/engine/normalize'
import type { Catalog, CatalogProduct } from '@/lib/engine/types'

/**
 * Server-side catalog service: loads data/curated/catalog.json ONCE (global
 * cache keyed by file mtime + overlay revision), applies DB overlays
 * (admin/community edits), provides search + lookups. The catalog FILE is the
 * open source of truth; DB ProductOverride rows are diffs that survive
 * re-imports (spec 3.3-4).
 */

interface CatalogCache {
  catalog: Catalog
  byId: Map<string, CatalogProduct>
  loadedAt: number
  mtimeMs: number
  rev: string
}

const g = globalThis as unknown as { __khassisCatalog?: CatalogCache }

const CATALOG_PATH = 'data/curated/catalog.json'

async function loadCatalog(): Promise<CatalogCache> {
  const mtimeMs = statSync(CATALOG_PATH).mtimeMs
  let rev = '0'
  try {
    const revRow = await db.setting.findUnique({ where: { key: 'catalogRev' } })
    rev = revRow?.value ?? '0'
  } catch { /* db not migrated yet */ }
  if (g.__khassisCatalog && g.__khassisCatalog.mtimeMs === mtimeMs && g.__khassisCatalog.rev === rev) {
    return g.__khassisCatalog
  }
  const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8')) as Catalog
  const byId = new Map(raw.products.map((p) => [p.id, p]))

  // apply admin overlays (deleted => removed; added => appended; edits merged)
  try {
    const overrides = await db.productOverride.findMany()
    for (const o of overrides) {
      const data = JSON.parse(o.data) as Partial<CatalogProduct> & { added?: boolean; deleted?: boolean }
      const existing = byId.get(o.id)
      if (data.deleted) { byId.delete(o.id); continue }
      if (existing) {
        byId.set(o.id, { ...existing, ...data, id: o.id } as CatalogProduct)
      } else if (data.added) {
        const np: CatalogProduct = {
          id: o.id, category: data.category ?? 'pantry-other',
          nameEn: data.nameEn ?? '', nameAr: data.nameAr ?? data.nameEn ?? '',
          nameNorm: normalizeArabic(`${data.nameAr ?? ''} ${data.nameEn ?? ''} ${data.brand ?? ''}`),
          brand: data.brand ?? null, brandNorm: data.brand ? normalizeArabic(data.brand) : null,
          sizeText: data.sizeText ?? null, size: data.size ?? null,
          flavors: data.flavors ?? [], tags: data.tags ?? [],
          rank: data.rank ?? 500, storesCount: data.storesCount ?? 1,
          available: data.available ?? true,
          medianFils: data.medianFils ?? 0, minFils: data.minFils ?? data.medianFils ?? 0,
          maxFils: data.maxFils ?? data.medianFils ?? 0,
          prices: data.prices ?? {}, unitPriceFils: data.unitPriceFils ?? null,
          need: data.need ?? null, dataConfidence: data.dataConfidence ?? 0.6,
        }
        byId.set(o.id, np)
      }
    }
    raw.products = [...byId.values()]
  } catch { /* serve base catalog */ }

  const cache: CatalogCache = { catalog: raw, byId, loadedAt: Date.now(), mtimeMs, rev }
  g.__khassisCatalog = cache
  return cache
}

export async function getCatalog(): Promise<Catalog> {
  return (await loadCatalog()).catalog
}

export async function getProduct(id: string): Promise<CatalogProduct | null> {
  const c = await loadCatalog()
  return c.byId.get(id) ?? null
}

export interface SearchParams {
  q?: string
  category?: string
  brand?: string
  store?: string
  need?: string
  minFils?: number
  maxFils?: number
  sort?: 'relevance' | 'price-asc' | 'price-desc' | 'unit-asc' | 'popularity'
  limit?: number
  offset?: number
}

export interface SearchResult {
  total: number
  items: CatalogProduct[]
}

export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const c = await loadCatalog()
  const q = params.q?.trim() ?? ''
  const qNorm = normalizeArabic(q)
  const qTokens = qNorm ? qNorm.split(' ').filter(Boolean) : []

  let items = c.catalog.products
  if (params.category) items = items.filter((p) => p.category === params.category)
  if (params.need) items = items.filter((p) => p.need === params.need)
  if (params.brand) {
    const bNorm = normalizeArabic(params.brand)
    items = items.filter((p) => p.brandNorm?.includes(bNorm))
  }
  if (params.store) items = items.filter((p) => p.prices[params.store!]?.fils != null)
  if (params.minFils != null) items = items.filter((p) => p.medianFils >= params.minFils!)
  if (params.maxFils != null) items = items.filter((p) => p.medianFils <= params.maxFils!)

  let scored: { p: CatalogProduct; s: number }[]
  if (qTokens.length) {
    scored = []
    for (const p of items) {
      const hay = p.nameNorm
      let s = 0
      let all = true
      for (const tok of qTokens) {
        if (hay.includes(tok)) s += 3
        else {
          all = false
          if (hay.split(' ').some((w) => w.startsWith(tok.slice(0, Math.max(2, tok.length - 1))))) s += 1.5
        }
      }
      if (p.brandNorm?.includes(qNorm)) s += 2
      if (all) s += 2
      if (s > 0) scored.push({ p, s: s + Math.max(0, (300 - p.rank) / 150) })
    }
    scored.sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id))
  } else {
    scored = items.map((p) => ({ p, s: 0 }))
  }

  switch (params.sort) {
    case 'price-asc': scored.sort((a, b) => a.p.medianFils - b.p.medianFils); break
    case 'price-desc': scored.sort((a, b) => b.p.medianFils - a.p.medianFils); break
    case 'unit-asc': scored.sort((a, b) => (a.p.unitPriceFils ?? 9e9) - (b.p.unitPriceFils ?? 9e9)); break
    case 'popularity': scored.sort((a, b) => b.p.storesCount - a.p.storesCount || a.p.rank - b.p.rank); break
    default: break
  }

  const total = scored.length
  const offset = params.offset ?? 0
  const limit = Math.min(params.limit ?? 30, 100)
  return { total, items: scored.slice(offset, offset + limit).map((x) => x.p) }
}

/** bump catalog revision so overlays reload */
export async function bumpCatalogRev(): Promise<void> {
  const cur = await db.setting.findUnique({ where: { key: 'catalogRev' } })
  const next = String((cur ? Number(cur.value) : 0) + 1)
  await db.setting.upsert({ where: { key: 'catalogRev' }, create: { key: 'catalogRev', value: next }, update: { value: next } })
}

export { stableId }
