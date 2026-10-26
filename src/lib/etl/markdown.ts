/**
 * Markdown archive parser (spec 5.2-2) for the grocery-db-bahrain format:
 * - H1 title + `>` meta (التصنيف، الترميز، عدد المنتجات)
 * - "منهجية الترتيب" section
 * - Summary table: | # | المنتج | الشركة المصنعة | الحجم | السعر الوسيط | الأدنى | الأعلى | عدد المتاجر | سعر الوحدة |
 * - "تفاصيل المنتجات" section: ### N. Product + store price bullets with URLs
 */
import { parseSize } from '@/lib/engine/size'
import { normalizeArabic, stripEmoji, stableId } from '@/lib/engine/normalize'
import { classifyNeed, extractTags } from '@/lib/engine/needs'
import type { CatalogProduct, StorePrice } from '@/lib/engine/types'

export interface ParsedMarkdownProduct {
  id: string
  category: string
  nameAr: string
  nameEn: string
  brand: string | null
  sizeText: string | null
  medianFils: number
  minFils: number
  maxFils: number
  prices: Record<string, StorePrice>
  storesCount: number
  rank: number
  need: string | null
  size: CatalogProduct['size']
  tags: string[]
  unitPriceFils: number | null
}

export interface ParseMarkdownResult {
  category: string
  categoryAr: string
  slug: string
  declaredCount: number
  rows: ParsedMarkdownProduct[]
  warnings: string[]
}

function parseMoneyFils(cell: string): number | null {
  const cleaned = cell
    .replace(/\*\*/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.codePointAt(0)! - 0x0660))
    .replace(/[^\d.]/g, '')
    .trim()
  if (!cleaned) return null
  const v = parseFloat(cleaned)
  if (Number.isNaN(v) || v <= 0 || v > 10000) return null
  return Math.round(v * 1000)
}

export function parseMarkdownCatalog(
  md: string,
  fallbackCategory?: string,
  storeNameMap?: Record<string, string>
): ParseMarkdownResult {
  const lines = md.split(/\r?\n/)
  const warnings: string[] = []
  let categoryAr = ''
  let slug = fallbackCategory ?? ''
  let declaredCount = 0

  for (const line of lines.slice(0, 40)) {
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1) categoryAr = h1[1]!.trim()
    if (line.startsWith('>')) {
      // prefer الترميز (the code/slug) over التصنيف (display name)
      const code = line.match(/الترميز\**\s*[:：]\s*\**\s*`?([^`|>\n]+)/)
      const m = code ?? line.match(/(?:التصنيف|slug|Slug|SLUG)\**\s*[:：]\s*\**\s*([^|>\n`]+)/)
      if (m) slug = m[1]!.trim().replace(/[`*]/g, '')
      const c = line.match(/عدد المنتجات[^:]*[:：]\s*\**(\d+)/)
      if (c) declaredCount = Number(c[1])
    }
  }
  const category = (slug || normalizeArabic(categoryAr).replace(/\s+/g, '-') || 'unknown').toLowerCase()

  // ---------- summary table ----------
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('|') && l.includes('#') && (l.includes('المنتج') || l.includes('Product')))
  const rows: ParsedMarkdownProduct[] = []
  if (headerIdx >= 0) {
    for (let i = headerIdx + 2; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.trim().startsWith('|')) continue
      if (line.startsWith('##')) break
      const cells = line.split('|').map((c) => c.trim())
      const cells2 = cells[0] === '' ? cells.slice(1) : cells
      if (cells2.length < 5) continue

      const rank = parseInt(stripEmoji(cells2[0] ?? '').replace(/[^\d]/g, ''), 10) || rows.length + 1
      const productCell = stripEmoji((cells2[1] ?? '').replace(/\*\*/g, ''))
      if (!productCell || productCell === '—' || productCell === '-') continue
      const brand = stripEmoji((cells2[2] ?? '').replace(/\*\*/g, '')) || null
      const sizeTextRaw = (cells2[3] ?? '').replace(/\*\*/g, '').trim()
      const sizeText = sizeTextRaw && sizeTextRaw !== '—' && sizeTextRaw !== '-' ? sizeTextRaw : null
      const medianFils = parseMoneyFils(cells2[4] ?? '')
      if (medianFils == null) { warnings.push(`row ${rank}: bad median price`); continue }
      // optional min/max columns
      const minFils = parseMoneyFils(cells2[5] ?? '') ?? medianFils
      const maxFils = parseMoneyFils(cells2[6] ?? '') ?? medianFils
      const storesCountCell = parseInt(stripEmoji(cells2[7] ?? '').replace(/[^\d]/g, ''), 10) || 0

      const size = sizeText ? parseSize(sizeText) : null
      const flavors: string[] = []
      const need = classifyNeed(productCell, productCell, brand, category, flavors)
      const tags = extractTags(productCell, productCell, flavors, sizeText)
      let unitPriceFils: number | null = null
      if (size && size.baseQuantity > 0 && size.unit !== 'pcs') {
        const per = size.unit === 'ml' ? 1000 : size.unit === 'g' ? 1000 : 1
        unitPriceFils = Math.round((medianFils * per) / size.baseQuantity)
      }

      rows.push({
        id: stableId([category, brand ?? '', normalizeArabic(productCell), sizeText ?? '', rank]),
        category,
        nameAr: productCell,
        nameEn: productCell,
        brand,
        sizeText,
        medianFils,
        minFils,
        maxFils,
        prices: {},
        storesCount: storesCountCell,
        rank,
        need,
        size,
        tags,
        unitPriceFils,
      })
    }
  }

  // ---------- details sections (per-store prices with URLs) ----------
  const byRank = new Map(rows.map((r) => [r.rank, r]))
  let currentRank = -1
  const storeLine = /^\s*[-*]\s*(?:\*\*)?(.+?)(?:\*\*)?\s*[:：]\s*([\d.]+)\s*(?:د\.?ب|BHD)?\s*(?:—|-)?\s*(?:\[رابط[^\]]*\]\(([^)]+)\))?/
  for (const line of lines) {
    const heading = line.match(/^###\s*(\d+)\.\s*(.+)/)
    if (heading) {
      currentRank = parseInt(heading[1]!, 10)
      continue
    }
    if (currentRank < 0) continue
    const row = byRank.get(currentRank)
    if (!row) continue
    const m = line.match(storeLine)
    if (!m) continue
    const storeName = m[1]!.trim()
    const fils = Math.round(parseFloat(m[2]!) * 1000)
    const url = m[3]
    if (!Number.isFinite(fils) || fils <= 0) continue
    const storeId = storeNameMap?.[storeName] ?? storeNameMap?.[normalizeArabic(storeName)]
    if (!storeId) continue // unknown store — skip cleanly
    row.prices[storeId] = { fils, url: url ?? undefined, available: true }
  }
  // refresh storesCount from actual parsed prices when available
  for (const r of rows) {
    const pc = Object.keys(r.prices).length
    if (pc > 0) r.storesCount = Math.max(r.storesCount, pc)
  }

  if (declaredCount && rows.length !== declaredCount) {
    warnings.push(`declared ${declaredCount} products, parsed ${rows.length}`)
  }
  if (!rows.length) warnings.push('no rows parsed')
  return { category, categoryAr, slug, declaredCount, rows, warnings }
}
