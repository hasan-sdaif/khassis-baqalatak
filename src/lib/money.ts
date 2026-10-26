/**
 * Money utilities — all amounts are integer FILS (1 BHD = 1000 fils).
 * Display: "1.100 د.ب" (3 decimals), Arabic-Indic numerals optional.
 */

export function formatBHD(fils: number, opts?: { arabicNumerals?: boolean; withUnit?: boolean }): string {
  const neg = fils < 0
  const abs = Math.abs(Math.round(fils))
  const whole = Math.floor(abs / 1000)
  const frac = abs % 1000
  let num: string
  if (opts?.arabicNumerals) {
    num = `${toArabicDigits(whole)}.${toArabicDigits(String(frac).padStart(3, '0'))}`
  } else {
    num = `${whole}.${String(frac).padStart(3, '0')}`
  }
  const withUnit = opts?.withUnit !== false
  return `${neg ? '−' : ''}${num}${withUnit ? ' د.ب' : ''}`
}

export function toArabicDigits(s: string | number): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
  return String(s).replace(/\d/g, (d) => map[Number(d)]!)
}

/** parse user input like "1.5" or "1500" (fils) into fils */
export function parseBHDToFils(input: string): number {
  const cleaned = input.replace(/[٠-٩]/g, (d) => String(d.codePointAt(0)! - 0x0660)).replace(/[^\d.]/g, '')
  if (!cleaned) return 0
  const v = parseFloat(cleaned)
  if (Number.isNaN(v)) return 0
  return Math.round(v * 1000)
}

export function formatPct(x: number, arabicNumerals = false): string {
  const v = Math.round(x * 10) / 10
  return arabicNumerals ? `${toArabicDigits(v)}٪` : `${v}%`
}

/** unit labels for base units */
export function unitLabelAr(unit: string): string {
  switch (unit) {
    case 'ml': return 'مل'
    case 'g': return 'جم'
    case 'pcs': return 'حبة'
    case 'sheets': return 'منديل'
    case 'rolls': return 'رول'
    case 'bags': return 'كيس'
    default: return 'وحدة'
  }
}

/** humanize base quantity (grams -> kg when large) */
export function formatQty(baseUnit: string, qty: number): string {
  if (baseUnit === 'g' && qty >= 1000) return `${round1(qty / 1000)} كجم`
  if (baseUnit === 'ml' && qty >= 1000) return `${round1(qty / 1000)} لتر`
  return `${round1(qty)} ${unitLabelAr(baseUnit)}`
}

function round1(x: number): string {
  const v = Math.round(x * 10) / 10
  return Number.isInteger(v) ? String(v) : String(v)
}

export function formatNumberAr(n: number, arabicNumerals = false): string {
  const v = n.toLocaleString('en-US')
  return arabicNumerals ? toArabicDigits(v) : v
}

/** Hijri date via Intl (optional display) */
export function hijriDateISO(dateISO: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateISO))
  } catch {
    return ''
  }
}

export function formatDateAr(dateISO: string): string {
  try {
    return new Intl.DateTimeFormat('ar-BH', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateISO))
  } catch {
    return dateISO
  }
}
