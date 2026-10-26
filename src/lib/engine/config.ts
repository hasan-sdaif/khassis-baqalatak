/**
 * Algorithm config (spec 6.18): versioned, no magic numbers in code paths.
 * All values overridable from the admin playground; stored with each plan.
 */
import type { AlgorithmConfig } from './types'

export const ENGINE_VERSION = '2.0.0'

export const DEFAULT_CONFIG: AlgorithmConfig = {
  version: 'cfg-2.0.0',
  A: 0.30,
  kappa: 1.5,
  piMin: 0.12,
  piMax: 0.85,
  sigma: 0.22,
  wTarget: 0.40,
  wFit: 0.2,
  wValue: 0.08,
  wAvail: 0.06,
  wPop: 0.10,
  wBrand: 0.06,
  wPref: 0.06,
  wWaste: 0.10,
  wConf: 0.06,
  reservePct: 0.05,
  lambdaMin: 0.00002, // marginal utility per FILS floor (≈0.02 per dinar)
  treatCapPct: 0.08,
  varietyBrandCapPct: 0.6,
  minCoverageEssential: 0.92,
  tauW: 0.25,
  tauK: 0.7,
  kComfort: 3,
  allowShortfallPct: 0.08,
  envStepFils: 250,
  lambdaVariety: 0.22,
  lambdaTarget: 0.25,
  lambdaAudience: 0.1,
  lambdaWaste: 0.15,
  lambdaOverbuy: 0.2,
  maxMedianMultiple: 2.5,
  minMedianMultiple: 0.35,
}

/** Seasonal demand multipliers per need id (spec seasonal_profiles). */
export const SEASONAL_FACTORS: Record<string, Record<string, number>> = {
  ramadan: {
    dates: 3.0, juice: 1.8, water: 1.3, 'soft-drinks': 1.5, flour: 1.6, sugar: 1.5,
    oil: 1.3, 'olive-oil': 1.4, pasta: 1.2, rice: 1.2, 'cat.arabic-sweets': 2.0,
    'cat.frozen-food': 1.2, nuts: 1.5,
  },
  eid: {
    'cat.chocolate-sweets': 2.2, dates: 1.5, nuts: 1.8, 'cat.arabic-sweets': 2.5,
    'cat.biscuits-cookies': 1.6, coffee: 1.3, tea: 1.3,
  },
  'back-to-school': {
    'cat.stationery-toys': 3.0, milk: 1.1, 'breakfast-cereals': 1.3,
    'cat.biscuits-cookies': 1.3, juice: 1.2,
  },
  summer: { water: 1.6, 'cat.ice-cream': 2.0, juice: 1.4, 'soft-drinks': 1.3, energy: 1.2 },
  normal: {},
}

/** Mode offsets shift the target percentile (spec 6.10 plan styles).
 *  crisis = 30-BHD emergency protocol (inspiration file 09)
 *  custom = user-defined offset from the advanced page (percent → 0.01×) */
export const MODE_OFFSET: Record<string, number> = {
  crisis: -0.32,
  economy: -0.18,
  balanced: 0,
  comfortable: 0.15,
  custom: 0, // offset comes from advanced.lifestyle.customModeOffsetPct
}

/** Human-readable mode labels (Arabic) with the offset as an explicit percentage. */
export const MODE_LABELS: Record<string, { nameAr: string; descAr: string; offsetPct: number }> = {
  crisis: { nameAr: 'طوارئ', descAr: 'بروتوكول الشدة: نزول حاد للمستوى الأوفر مع حماية البروتين والوقود الحراري', offsetPct: -32 },
  economy: { nameAr: 'اقتصاد', descAr: 'أوفر خيار مقبول في كل فئة', offsetPct: -18 },
  balanced: { nameAr: 'توازن', descAr: 'الأنسب لمعظم الأسر', offsetPct: 0 },
  comfortable: { nameAr: 'راحة', descAr: 'تنويع وجودة أعلى قليلاً', offsetPct: 15 },
  custom: { nameAr: 'مخصص', descAr: 'أنت تحدد الإزاحة المئوية بنفسك', offsetPct: 0 },
}

/** Class adjustments: infant/mandatory items never pushed to cheapest. */
export const CLASS_DELTA: Record<string, number> = {
  mandatory: 0.15,
  essential: 0.05,
  regular: 0,
  comfort: -0.05,
  treat: -0.1,
}

/** Class weights for MCKP utility (spec 6.9). */
export const CLASS_WEIGHT: Record<string, number> = {
  mandatory: 99,
  essential: 1.0,
  regular: 0.6,
  comfort: 0.3,
  treat: 0.15,
}

/** Deterministic pseudo-random (mulberry32) for tie-breaks. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
