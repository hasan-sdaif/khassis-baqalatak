/**
 * Habit modules (spec 6.6): data-driven derivations for special consumption.
 * Diapers, infant formula, tobacco (fixed spend), coffee/tea cups, water.
 * WHO weight medians & feeding volumes per spec section 16.2 (estimates,
 * label & pediatrician override).
 */
import type { Household, HouseholdMember } from './types'

// ---------- WHO median weight by age (kg), linear interpolation
const WHO_WEIGHT: [number, number][] = [
  [0, 3.3], [1, 4.3], [2, 5.3], [3, 6.4], [4, 7.0], [5, 7.5], [6, 7.9],
  [9, 8.9], [12, 9.6], [18, 10.9], [24, 12.2], [36, 14.3], [48, 16.3],
  [60, 18.3], [72, 20.5], [96, 25.0], [120, 30.0], [144, 37.0], [168, 45.0], [216, 62.0],
]

export function medianWeightKg(ageMonths: number): number {
  if (ageMonths <= 0) return 3.3
  for (let i = 1; i < WHO_WEIGHT.length; i++) {
    const [m1, w1] = WHO_WEIGHT[i]!
    const [m0, w0] = WHO_WEIGHT[i - 1]!
    if (ageMonths <= m1) return w0 + ((w1 - w0) * (ageMonths - m0)) / (m1 - m0)
  }
  return 62
}

// ---------- Diapers
/** diaper changes per day by age in months (spec 16.2) */
export function diaperChangesPerDay(ageMonths: number): number {
  if (ageMonths <= 1) return 9
  if (ageMonths <= 3) return 8
  if (ageMonths <= 6) return 7
  if (ageMonths <= 9) return 6
  if (ageMonths <= 12) return 5.5
  if (ageMonths <= 24) return 5
  return 4.5 // up to 36 months (toilet training)
}

/** diaper size from baby weight; prefers larger size when near upper bound */
export function diaperSizeForWeight(kg: number): { size: number; nearBoundary: boolean } {
  // size ranges (approx. brand-consistent)
  const ranges: [number, number, number][] = [
    [1, 2, 5], [2, 4, 8], [3, 6, 11], [4, 9, 16], [5, 13, 25], [6, 16, 30],
  ]
  for (let i = 0; i < ranges.length; i++) {
    const [size, lo, hi] = ranges[i]!
    if (kg >= lo && kg <= hi) {
      // near upper bound (>85% of range) and a bigger size exists -> recommend bigger
      const pos = (kg - lo) / (hi - lo)
      if (pos > 0.85 && i + 1 < ranges.length) {
        return { size: ranges[i + 1]![0], nearBoundary: true }
      }
      return { size, nearBoundary: pos > 0.75 }
    }
  }
  return kg < 2 ? { size: 1, nearBoundary: false } : { size: 6, nearBoundary: false }
}

// ---------- Formula
export function formulaStage(ageMonths: number): { stage: 1 | 2 | 3 | 4; transitionInDays?: number } {
  // spec 16.2: 0-6 => 1, 6-12 => 2, 12-36 => 3 (4 = growing-up/junior, optional 24m+)
  const boundaries: [number, 1 | 2 | 3 | 4][] = [[0, 1], [6, 2], [12, 3]]
  let stage: 1 | 2 | 3 | 4 = 1
  let nextBoundaryMonths = 6
  for (const [m, s] of boundaries) {
    if (ageMonths >= m) { stage = s; nextBoundaryMonths = m === 0 ? 6 : m === 6 ? 12 : 36 }
  }
  if (ageMonths >= 24) stage = 3 // junior/growing-up fits 24-36 too
  const monthsToBoundary = nextBoundaryMonths - ageMonths
  const transitionInDays = monthsToBoundary <= 0.75 ? Math.round(monthsToBoundary * 30) : undefined
  return { stage, transitionInDays }
}

/** formula volume ml/day at full dependency (spec 16.2) */
export function formulaMlPerDay(ageMonths: number): number {
  if (ageMonths <= 1) return 500
  if (ageMonths <= 3) return 800
  if (ageMonths <= 6) return 900
  if (ageMonths <= 9) return 700
  if (ageMonths <= 12) return 600
  if (ageMonths <= 24) return 375
  return 325
}

/** powder grams = ml × ~0.135 (13.5g per 100ml, one scoop per 30ml) */
export const FORMULA_POWDER_RATIO = 0.135

/** formula stage parsed from product name (labels like "من 0 إلى 6 أشهر") */
export function formulaStageFromName(nameEn: string, nameAr: string): 1 | 2 | 3 | null {
  let hay = `${nameEn} ${nameAr}`
  // normalize Arabic-Indic digits
  hay = hay.replace(/[٠-٩]/g, (d) => String(d.codePointAt(0)! - 0x0660))
  if (/0\s*(?:إلى|الى|-|–)\s*6\s*(?:شهر|أشهر|شهرا|months?)|من\s*الولاد[هة]|from\s*birth|from\s*0\s*(?:to|-)?\s*6/i.test(hay)) return 1
  if (/6\s*(?:إلى|الى|-|–)\s*12\s*(?:شهر|أشهر|شهرا|months?)|from\s*6\s*(?:to|-)\s*12|6\+\s*months/i.test(hay)) return 2
  if (/1\s*(?:إلى|-|–)\s*3\s*(?:سنة|سنوات|years?)|من\s*سنة\s*(?:إلى|الى)\s*3|junior|جونيور|growing\s*up|3\s*years\s*(?:&|and)?\s*above|من\s*سنة|1\s*\+|\b3\+\b/i.test(hay)) return 3
  const m1 = hay.match(/stage\s*([1-4])/i) ?? hay.match(/مرحلة\s*([1-4])/)
  if (m1) return Number(m1[1]) as 1 | 2 | 3
  return null
}

// ---------- Household helpers

export function adultEquivalent(m: HouseholdMember): number {
  const a = m.ageMonths
  if (a < 6) return 0 // infants consume via habit modules (formula/diapers)
  if (a < 12) return 0.3
  if (a < 36) return 0.4
  if (a < 96) return 0.6
  if (a < 156) return 0.8
  if (a < 204) return 1.0 // teen
  if (a < 720) return 1.0
  return 0.85 // elder
}

export function ageClass(m: HouseholdMember): string {
  const a = m.ageMonths
  if (a < 12) return 'infant'
  if (a < 36) return 'toddler'
  if (a < 156) return 'child'
  if (a < 204) return 'teen'
  if (a < 720) return 'adult'
  return 'elder'
}

export interface InfantInfo {
  member: HouseholdMember
  weightKg: number
  diaperSize: number
  diaperNearBoundary: boolean
  diaperChangesPerDay: number
  formulaStage: 1 | 2 | 3 | 4
  formulaTransitionInDays?: number
  formulaGramsPerDay: number
}

export function infantInfos(household: Household): InfantInfo[] {
  return household.members
    .filter((m) => m.ageMonths < 36)
    .map((m) => {
      const weight = medianWeightKg(m.ageMonths)
      const ds = diaperSizeForWeight(weight)
      const fs = formulaStage(m.ageMonths)
      const depPct = Number(household.habits['formula']?.[`dep_${m.id}`] ?? 100) / 100
      const grams = formulaMlPerDay(m.ageMonths) * FORMULA_POWDER_RATIO * Math.max(0, Math.min(1, depPct))
      return {
        member: m,
        weightKg: weight,
        diaperSize: ds.size,
        diaperNearBoundary: ds.nearBoundary,
        diaperChangesPerDay: diaperChangesPerDay(m.ageMonths),
        formulaStage: fs.stage,
        formulaTransitionInDays: fs.transitionInDays,
        formulaGramsPerDay: grams,
      }
    })
}

/** adults & teens count (for coffee etc.) */
export function adultCount(household: Household): number {
  return household.members.filter((m) => m.ageMonths >= 144).length
}

/** children count (for audience fitting) */
export function childCount(household: Household): number {
  return household.members.filter((m) => m.ageMonths < 156).length
}
