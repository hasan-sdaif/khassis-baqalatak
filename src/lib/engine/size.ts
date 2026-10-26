/**
 * Size parser (spec 5.3) — extracts base quantity from Arabic/English size text.
 * Handles: 200 مل, 1.5 لتر, 900 جم, 2.5 كجم, 6 × 200 مل, 2×1.5 لتر, 24 × 330مل,
 * 12 حبة, دزينة, كرتون 24 × 330مل, 64 حفاضة, 100 منديل, 3 طبقات 12 رول,
 * Arabic-Indic digits, "1+1 مجانا", oz/lb/gal conversions.
 */
import type { ParsedSize, UnitKind } from './types'

const DIG = '0-9٠-٩۰-۹'

function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.codePointAt(0)!
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660)
    return String(c - 0x06f0)
  })
}

const ML_RE = /^(مل|مليلتر|ملي|ml|milliliter|millilitre|mls)$/i
const L_RE = /^(لتر|لترات|ltr|liter|litre|l|lt)$/i
const G_RE = /^(جم|جرام|غرام|جرم|غ|g|gram|grams|gm|gr)$/i
const KG_RE = /^(كجم|كيلو|كيلوجرام|كيلوغرام|kg|kgs|kilo|kilogram)$/i
const PCS_RE = /^(حبة|حبه|حبات|قطعة|قطع|وحدة|pcs?|pieces?|قطعة\/قطع)$/i
const SHEETS_RE = /^(منديل|مناديل|sheet|sheets|tissue|tissues)$/i
const ROLL_RE = /^(رول|رولات|rolls?|roll)$/i
const BAG_RE = /^(كيس|أكياس|اكياس|bags?|sachets?)$/i
const DOZEN_RE = /^(دزينة|دزينه|dozen|dz)$/i
const CARTON_RE = /^(كرتون|كراتين|cartons?)$/i
const PACK_RE = /^(علبة|علب|عبوة|عبوات|باك|باكت|packs?|pack|packs)$/i
const BOX_RE = /^(صندوق|صناديق|box|boxes)$/i
const BOTTLE_RE = /^(زجاجة|زجاجات|bottles?)$/i
const CAN_RE = /^(كانة|علبة معدنية|cans?)$/i
const TRAY_RE = /^(طبق|صينية|tray|trays)$/i
const CASE_RE = /^(قضية|case)$/i

function unitKindOf(u: string): UnitKind | null {
  const t = u.trim().replace(/[.,]/g, '')
  if (ML_RE.test(t)) return 'ml'
  if (L_RE.test(t)) return 'ml' // liters convert to ml
  if (G_RE.test(t)) return 'g'
  if (KG_RE.test(t)) return 'g' // kg converts to g
  if (PCS_RE.test(t)) return 'pcs'
  if (SHEETS_RE.test(t)) return 'sheets'
  if (ROLL_RE.test(t)) return 'rolls'
  if (BAG_RE.test(t)) return 'bags'
  return null
}

/** multiplier words */
const NUM_WORDS: Record<string, number> = {
  'واحد': 1, 'واحدة': 1, 'اثنان': 2, 'اثنتان': 2, 'ثلاثة': 3, 'اربعة': 4, 'أربعة': 4,
  'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10, 'عشرين': 20,
  'ثلاثة في واحد': 3, 'ثلاثة_في_واحد': 3,
}

const OZ_G = 28.3495
const LB_G = 453.592
const GAL_ML = 3785.41

/**
 * Parse size text like "6 × 200 مل" or "1.75 لتر" or "24 × 330مل".
 * Returns baseQuantity in canonical units: ml, g, pcs, sheets, rolls, bags.
 */
export function parseSize(rawInput: string | null | undefined): ParsedSize | null {
  if (!rawInput) return null
  let s = toLatinDigits(String(rawInput)).replace(/[()]/g, ' ')
  s = s.replace(/[×✕✖xX*]/g, '×').replace(/\s+/g, ' ').trim()
  if (!s || s === '—' || s === '-') return null

  // pattern: [count] × [amount] [unit]  (e.g. 6 × 200 مل, 2×1.5 لتر)
  // pattern: [amount] [unit]
  // pattern: [count] [unit-word] (e.g. 12 حبة)
  const num = `\\d+(?:[.,]\\d+)?`
  const unitWord = '[A-Za-z\\u0600-\\u06FF]+\\.?'

  // Try pack pattern first: N × M unit
  const packRe = new RegExp(`(${num})\\s*×\\s*(${num})\\s*(${unitWord})?`)
  const packMatch = s.match(packRe)
  if (packMatch) {
    const count = parseFloat(packMatch[1].replace(',', '.'))
    const amount = parseFloat(packMatch[2].replace(',', '.'))
    const unitTok = packMatch[3] ?? guessUnitFromContext(s)
    const res = buildResult(count * amount, unitTok, count, amount, s, 0.95)
    if (res) return res
  }

  // unit-first pack pattern: "200 مل × 6" / "1.5 Ltr X 6 Pcs" (unit belongs to 1st number)
  const unitFirstRe = new RegExp(`(${num})\\s*(${unitWord})\\s*×\\s*(${num})`)
  const uf = s.match(unitFirstRe)
  if (uf) {
    const amount = parseFloat(uf[1].replace(',', '.'))
    const unitTok = uf[2]
    const count = parseFloat(uf[3].replace(',', '.'))
    // only when the first unit is a real volume/mass unit and the count is sane
    const kind = unitKindOf(unitTok)
    if ((kind === 'ml' || kind === 'g') && count >= 2 && count <= 48) {
      const res = buildResult(amount * count, unitTok, count, amount, s, 0.9)
      if (res) return res
    }
  }

  // "كرتون 24 × 330مل" — leading container word
  const cartonRe = new RegExp(`(?:كرتون|كراتين|carton|صندوق|box|قضية|case)\\s*(${num})?\\s*(?:×|x|X)?\\s*(${num})?\\s*(${unitWord})?`)
  const cartonMatch = s.match(cartonRe)
  if (cartonMatch && (cartonMatch[1] || cartonMatch[2])) {
    const count = cartonMatch[1] ? parseFloat(cartonMatch[1].replace(',', '.')) : 1
    const amount = cartonMatch[2] ? parseFloat(cartonMatch[2].replace(',', '.')) : 1
    const unitTok = cartonMatch[3] ?? guessUnitFromContext(s)
    const res = buildResult(count * amount, unitTok, count, amount, s, 0.9)
    if (res) return res
  }

  // dozen pattern: N دزينة
  const dozenRe = new RegExp(`(${num})?\\s*(دزينة|دزينه|dozen|dz)`, 'i')
  const dz = s.match(dozenRe)
  if (dz) {
    const n = dz[1] ? parseFloat(dz[1].replace(',', '.')) : 1
    return mk(n * 12, 'pcs', n, 12, `دزينة × 12`, 0.95)
  }

  // simple: N unit  (e.g. 12 حبة, 64 حفاضة, 100 منديل, 6 رول)
  const simpleRe = new RegExp(`(${num})\\s*(${unitWord})`)
  const sm = s.match(simpleRe)
  if (sm) {
    const amount = parseFloat(sm[1].replace(',', '.'))
    const unitTok = sm[2]
    const res = buildResult(amount, unitTok, 1, amount, s, 0.9)
    if (res) return res
  }

  // bare number + implicit pcs (e.g. "64" or "10 pods")
  const bare = s.match(new RegExp(`^(${num})\\s*(${unitWord})?$`))
  if (bare) {
    const amount = parseFloat(bare[1].replace(',', '.'))
    const unitTok = bare[2] ?? guessUnitFromContext(s)
    const res = buildResult(amount, unitTok || 'pcs', 1, amount, s, 0.55)
    if (res) return res
  }

  // number words: "ثلاثة في واحد"
  const lw = s.replace(/\s+/g, '_')
  for (const [w, v] of Object.entries(NUM_WORDS)) {
    if (lw.includes(w)) {
      return mk(v, 'pcs', v, 1, `رقم نصي: ${w}`, 0.6)
    }
  }

  // "1+1" promo style => single pack
  const promo = s.match(new RegExp(`(${num})\\s*\\+\\s*(${num})`))
  if (promo) {
    const a = parseFloat(promo[1].replace(',', '.'))
    const b = parseFloat(promo[2].replace(',', '.'))
    const unitTok = s.replace(promo[0], '').trim()
    const res = buildResult(a + b, unitTok || 'pcs', 1, a + b, s, 0.7)
    if (res) return res
  }

  // imperial units
  const imperial = s.match(new RegExp(`(${num})\\s*(oz|ounce|lb|lbs|pound|gal|gallon)`, 'i'))
  if (imperial) {
    const amount = parseFloat(imperial[1].replace(',', '.'))
    const u = imperial[2].toLowerCase()
    if (u.startsWith('oz')) return mk(amount * OZ_G, 'g', 1, amount, `${amount} oz`, 0.95)
    if (u === 'lb' || u === 'lbs' || u.startsWith('pound')) return mk(amount * LB_G, 'g', 1, amount, `${amount} lb`, 0.95)
    return mk(amount * GAL_ML, 'ml', 1, amount, `${amount} gal`, 0.95)
  }

  return null
}

function guessUnitFromContext(s: string): string {
  if (/حفاض|diaper|pants|pull/i.test(s)) return 'pcs'
  if (/منديل|tissue|wipe/i.test(s)) return 'sheets'
  if (/رول|roll/i.test(s)) return 'rolls'
  if (/بيض|egg/i.test(s)) return 'pcs'
  return 'pcs'
}

function buildResult(
  totalAmount: number,
  unitTok: string,
  packCount: number,
  unitSize: number,
  raw: string,
  baseConf: number
): ParsedSize | null {
  const kind = unitKindOf(unitTok)
  if (!kind) return null
  let qty = totalAmount
  let conf = baseConf
  let unit = kind
  if (kind === 'ml' && ML_RE.test(unitTok.trim())) { /* stay ml */ }
  if (kind === 'ml' && L_RE.test(unitTok.trim())) { qty = totalAmount * 1000; unit = 'ml' }
  if (kind === 'g' && G_RE.test(unitTok.trim())) { /* stay g */ }
  if (kind === 'g' && KG_RE.test(unitTok.trim())) { qty = totalAmount * 1000; unit = 'g' }
  // sanity: absurd sizes are flagged (milk 300 L!)
  if (unit === 'ml' && qty > 50_000) conf *= 0.4
  if (unit === 'g' && qty > 100_000) conf *= 0.4
  return mk(qty, unit, packCount, unitSize, raw, conf)
}

function mk(
  baseQuantity: number,
  unit: UnitKind,
  packCount: number,
  unitSize: number,
  trace: string,
  confidence: number
): ParsedSize {
  const q = Math.round(baseQuantity * 1000) / 1000
  return {
    baseQuantity: q,
    unit,
    packCount: Math.max(1, Math.round(packCount)),
    unitSize: Math.max(0, Math.round(unitSize * 1000) / 1000),
    confidence: Math.max(0, Math.min(1, confidence)),
    trace,
  }
}

/** display helper: "1.5 لتر" for 1500ml etc. */
export function formatSize(size: ParsedSize | null): string | null {
  if (!size) return null
  const { baseQuantity: q, unit, packCount } = size
  if (unit === 'ml') {
    if (q >= 1000 && q % 1000 === 0) return `${fmtNum(q / 1000)} لتر${packCount > 1 ? ` × ${packCount}` : ''}`
    return `${fmtNum(q)} مل${packCount > 1 ? ` × ${packCount}` : ''}`
  }
  if (unit === 'g') {
    if (q >= 1000 && q % 1000 === 0) return `${fmtNum(q / 1000)} كجم${packCount > 1 ? ` × ${packCount}` : ''}`
    return `${fmtNum(q)} جم${packCount > 1 ? ` × ${packCount}` : ''}`
  }
  const unitAr: Record<string, string> = { pcs: 'حبة', sheets: 'منديل', rolls: 'رول', bags: 'كيس' }
  return `${fmtNum(q)} ${unitAr[unit] ?? 'وحدة'}${packCount > 1 ? ` × ${packCount}` : ''}`
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/** unit price text: fils per base unit -> "د.ب/لتر" */
export function unitPriceLabel(unit: UnitKind): string {
  switch (unit) {
    case 'ml': return 'د.ب/لتر'
    case 'g': return 'د.ب/كجم'
    default: return 'د.ب/وحدة'
  }
}
