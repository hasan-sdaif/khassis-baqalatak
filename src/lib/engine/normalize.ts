/**
 * Arabic text normalization for search & matching (spec 5.4 / 5.3).
 * Keeps original text for display; normalization is for matching only.
 */
import type { Catalog } from './types'

const AR_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640]/g // harakat + tatweel
const ZW = /[\u200B-\u200D\uFEFF\u2060]/g // zero-width chars
const NBSP = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

/** Map common Arabic ligatures / presentations to base letters */
const LIGATURES: Record<string, string> = {
  '\u0622': '\u0627\u0627', // آ -> اا
  '\u0623': '\u0627', // أ -> ا
  '\u0625': '\u0627', // إ -> ا
  '\u0629': '\u0647', // ة -> ه
  '\u0649': '\u064A', // ى -> ي
  '\u06CC': '\u064A', // ی farsi yeh
  '\u0624': '\u0648', // ؤ -> و
  '\u0626': '\u064A', // ئ -> ي
}

const INDIC_DIGITS: Record<string, string> = {
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
  '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
}

export function normalizeArabic(input: string): string {
  if (!input) return ''
  let s = input
  s = s.replace(AR_DIACRITICS, '')
  s = s.replace(ZW, '')
  s = s.replace(NBSP, ' ')
  s = s.replace(/[\u0622\u0623\u0625\u0629\u0649\u06CC\u0624\u0626]/g, (ch) => LIGATURES[ch] ?? ch)
  s = s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => INDIC_DIGITS[ch] ?? ch)
  // unify punctuation / symbols used decoratively in product names
  s = s.replace(/[.,،؛:;!؟?"'`´()\[\]{}<>«»/\\|_\-–—~*@#^&+=]/g, ' ')
  // Arabic-Indic percent etc.
  s = s.replace(/\u066A/g, '%')
  // collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()
  return s.toLowerCase()
}

/** strip definite article for token matching (الكلم -> كلم) */
export function stripAl(s: string): string {
  return s.replace(/(^|\s)ال(?=\S)/g, '$1')
}

/** remove emojis & pictographic symbols (spec 10.5-7: ETL strips them from names) */
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu

export function stripEmoji(input: string): string {
  return input.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim()
}

/** token-set for fuzzy compare */
export function tokens(s: string): string[] {
  return stripAl(normalizeArabic(s)).split(' ').filter(Boolean)
}

/** trigram similarity 0..1 (cheap spell-tolerance for Arabic search) */
export function trigramSim(a: string, b: string): number {
  const na = normalizeArabic(a)
  const nb = normalizeArabic(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const tri = (s: string) => {
    const set = new Set<string>()
    const padded = `  ${s} `
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3))
    return set
  }
  const sa = tri(na)
  const sb = tri(nb)
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / Math.min(sa.size, sb.size)
}

/** token-set containment score: how much of query tokens appear in target */
export function tokenScore(queryTokens: string[], target: string): number {
  if (!queryTokens.length) return 0
  const tt = new Set(stripAl(normalizeArabic(target)).split(' ').filter(Boolean))
  let hit = 0
  for (const q of queryTokens) {
    // exact or prefix containment
    let found = tt.has(q)
    if (!found) for (const t of tt) if (t.startsWith(q) || q.startsWith(t)) { found = true; break }
    if (found) hit++
  }
  return hit / queryTokens.length
}

/** stable deterministic id from parts (FNV-1a 32-bit, hex) */
export function stableId(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => String(p ?? '')).join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}


/** Wider deterministic fingerprint (two independent 32-bit rolling hashes).
 * It is a change detector, not a cryptographic signature or security primitive.
 */
export function stableFingerprint(parts: (string | number | null | undefined)[]): string {
  let h1 = 0x811c9dc5
  let h2 = 0x9747b28c
  const feed = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      h1 = Math.imul(h1 ^ code, 0x01000193)
      h2 = Math.imul(h2 ^ code, 0x5bd1e995)
      h2 ^= h2 >>> 13
    }
  }
  for (const part of parts) {
    feed(String(part ?? ''))
    feed('\u001f')
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/** Content fingerprint for product/price mutations, including database overlays. */
export function catalogFingerprint(catalog: Pick<Catalog, 'version' | 'generatedAt' | 'currency' | 'stores' | 'categories' | 'products'>): string {
  const parts: (string | number | null | undefined)[] = [
    `version:${catalog.version}`, `generatedAt:${catalog.generatedAt}`, `currency:${catalog.currency}`,
  ]
  for (const store of [...catalog.stores].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(JSON.stringify(['store', store.id, store.nameAr, store.nameEn, store.active, store.deliveryFeeFils, store.minOrderFils, store.freeDeliveryThresholdFils]))
  }
  for (const category of [...catalog.categories].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(JSON.stringify(['category', category.id, category.nameAr, category.nameEn, category.priority]))
  }
  for (const product of [...catalog.products].sort((a, b) => a.id.localeCompare(b.id))) {
    const prices = Object.keys(product.prices).sort().map((storeId) => {
      const price = product.prices[storeId]
      return [storeId, price?.fils ?? null, price?.origFils ?? null, price?.available ?? null]
    })
    parts.push(JSON.stringify([
      product.id, product.category, product.nameAr, product.nameEn, product.brand,
      product.sizeText, product.size ? [product.size.baseQuantity, product.size.unit, product.size.packCount, product.size.unitSize] : null,
      product.need, product.available, product.medianFils, product.minFils, product.maxFils,
      product.unitPriceFils, product.rank, product.storesCount, product.dataConfidence,
      [...product.tags].sort(), [...product.flavors].sort(), prices,
    ]))
  }
  return stableFingerprint(parts)
}
