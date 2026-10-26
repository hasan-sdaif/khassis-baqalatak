/**
 * Engine public API (spec 6.1).
 */
export { generatePlan, displayName } from './generate'
export { ENGINE_VERSION, DEFAULT_CONFIG, SEASONAL_FACTORS, MODE_OFFSET, MODE_LABELS, seededRandom } from './config'
export { NEEDS, NEEDS_MAP, classifyNeed, extractTags, categoryFallbackNeed, categoryLabelAr } from './needs'
export { normalizeArabic, stripAl, trigramSim, tokenScore, stripEmoji, stableId, stableFingerprint, catalogFingerprint } from './normalize'
export { parseSize, formatSize, unitPriceLabel } from './size'
export {
  medianWeightKg, diaperChangesPerDay, diaperSizeForWeight, formulaStage,
  formulaMlPerDay, FORMULA_POWDER_RATIO, infantInfos, adultCount, childCount,
  adultEquivalent, ageClass,
} from './habits'
export { computeDemand, resolveNeed, memberFactor } from './demand'
export { GENERIC_GROUPS, ENVELOPE_TEMPLATES } from './groups'
export {
  ADVANCED_VERSION, DEFAULT_ADVANCED, DEFAULT_ALLOCATION, DEFAULT_WEIGHTS,
  ALLOC_GROUPS, LOCAL_BRAND_HINTS, TIER_OFFSET,
  defaultAdvanced, normalizeAdvanced, bannedNeedsFor, productBlockedByDiet,
  dietPrefBoost, normalizeWeights, applyWeightsToConfig, normalizeAllocation,
  lifestyleTauW, tripsPerMonth, suggestBudgetFils, levelLadderFils,
  treatDemandScale, countActiveOptions,
} from './advanced'
export type {
  AdvancedProfile, NeedOverride, NeedOverrideMode, DietFlags, CategoryTier,
  WeightPercents, AllocationPercents, AllocGroupId, LifestylePrefs, StorePrefs, SuggestMode,
} from './advanced'
export * from './types'

export { getAllPlanItems, sumPlanItemsFils } from './plan-utils'
