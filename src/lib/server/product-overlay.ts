import type { CatalogProduct, StorePrice } from '../engine/types'
import { normalizeArabic } from '../engine/normalize'
import { parseSize } from '../engine/size'
import { classifyNeed, extractTags } from '../engine/needs'

/** Validated edit fields; runtime validation belongs at API boundaries. */
export interface ProductPatch {
  nameAr?: string
  nameEn?: string
  brand?: string | null
  category?: string
  sizeText?: string | null
  need?: string | null
  medianFils?: number
  prices?: Record<string, { fils: number; available?: boolean }>
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000
}

/** Merge a validated human patch and recompute all derived catalog fields consistently. */
export function deriveProductOverride(
  product: CatalogProduct,
  before: Record<string, unknown>,
  patch: ProductPatch,
): Record<string, unknown> {
  const merged = { ...product, ...before, ...patch } as Record<string, unknown>
  const nameAr = String(merged.nameAr ?? '')
  const nameEn = String(merged.nameEn ?? '')
  const brand = typeof merged.brand === 'string' && merged.brand ? merged.brand : null
  const category = String(merged.category ?? 'pantry-other')
  const sizeText = typeof merged.sizeText === 'string' ? merged.sizeText : null
  const size = parseSize(sizeText)
  const flavors = Array.isArray(merged.flavors)
    ? merged.flavors.filter((value): value is string => typeof value === 'string').slice(0, 100)
    : product.flavors.slice(0, 100)

  const productPrices = product.prices && typeof product.prices === 'object' && !Array.isArray(product.prices)
    ? product.prices as Record<string, unknown>
    : {}
  const overridePrices = before.prices && typeof before.prices === 'object' && !Array.isArray(before.prices)
    ? before.prices as Record<string, unknown>
    : {}
  const previousPriceSource: Record<string, unknown> = { ...productPrices, ...overridePrices }
  // Price patches are partial per store. Preserve original URL/compare-at-price and
  // availability metadata when a form updates only the numeric price.
  if (Object.prototype.hasOwnProperty.call(patch, 'prices') && patch.prices) {
    for (const [storeId, patchPrice] of Object.entries(patch.prices)) {
      const previous = previousPriceSource[storeId]
      const previousRecord = previous && typeof previous === 'object' && !Array.isArray(previous)
        ? previous as Record<string, unknown>
        : {}
      previousPriceSource[storeId] = {
        ...previousRecord,
        ...patchPrice,
        ...(typeof patchPrice.available === 'boolean'
          ? { available: patchPrice.available }
          : typeof previousRecord.available === 'boolean' ? { available: previousRecord.available } : {}),
      }
    }
  }
  const rawPrices = previousPriceSource
  const prices: Record<string, StorePrice> = {}
  for (const [storeId, rawPrice] of Object.entries(rawPrices)) {
    if (!rawPrice || typeof rawPrice !== 'object' || Array.isArray(rawPrice)) continue
    const value = rawPrice as Record<string, unknown>
    if (!isSafePositiveInteger(value.fils)) continue
    prices[storeId] = {
      fils: value.fils,
      ...(isSafePositiveInteger(value.origFils) ? { origFils: value.origFils } : {}),
      ...(typeof value.url === 'string' && value.url.length <= 2_048 ? { url: value.url } : {}),
      ...(typeof value.available === 'boolean' ? { available: value.available } : {}),
    }
  }
  const availablePrices = Object.values(prices)
    .filter((price) => price.available !== false)
    .map((price) => price.fils)
  const existingMedianFils = Number(merged.medianFils)
  const shouldRecomputePrice = Object.prototype.hasOwnProperty.call(patch, 'prices')
  const sortedPrices = [...availablePrices].sort((a, b) => a - b)
  const middle = Math.floor(sortedPrices.length / 2)
  const derivedMedian = sortedPrices.length
    ? (sortedPrices.length % 2 ? sortedPrices[middle] ?? 0 : Math.round(((sortedPrices[middle - 1] ?? 0) + (sortedPrices[middle] ?? 0)) / 2))
    : existingMedianFils
  // When individual store prices are supplied, they are authoritative. A standalone
  // median edit remains supported for products without a store-price patch.
  const medianFils = shouldRecomputePrice
    ? derivedMedian
    : Object.prototype.hasOwnProperty.call(patch, 'medianFils') ? Number(patch.medianFils) : existingMedianFils
  if (!isSafePositiveInteger(medianFils)) throw new Error('invalid_median_price')
  const unitFactor = size?.unit === 'ml' || size?.unit === 'g' ? 1000 : 1
  const unitPriceFils = size && size.unit !== 'pcs' && size.baseQuantity > 0
    ? Math.round((medianFils * unitFactor) / size.baseQuantity)
    : null
  const suppliedNeed = typeof merged.need === 'string' ? merged.need.trim() : ''
  const classificationInputsChanged = ['nameAr', 'nameEn', 'brand', 'category', 'sizeText'].some((key) =>
    Object.prototype.hasOwnProperty.call(patch, key),
  )
  const explicitNeedPatch = Object.prototype.hasOwnProperty.call(patch, 'need')
  const need = explicitNeedPatch
    ? (typeof patch.need === 'string' && patch.need.trim() ? patch.need.trim() : classifyNeed(nameEn, nameAr, brand, category, flavors))
    : classificationInputsChanged || !suppliedNeed
      ? classifyNeed(nameEn, nameAr, brand, category, flavors)
      : suppliedNeed

  const after: Record<string, unknown> = {
    ...before,
    ...patch,
    nameAr,
    nameEn,
    nameNorm: normalizeArabic(`${nameAr} ${nameEn} ${brand ?? ''}`),
    brand,
    brandNorm: brand ? normalizeArabic(brand) : null,
    category,
    sizeText,
    size,
    need,
    flavors,
    tags: extractTags(nameEn, nameAr, flavors, sizeText),
    medianFils,
    minFils: availablePrices.length ? Math.min(medianFils, ...availablePrices) : medianFils,
    maxFils: availablePrices.length ? Math.max(medianFils, ...availablePrices) : medianFils,
    prices,
    storesCount: availablePrices.length,
    unitPriceFils,
    available: availablePrices.length > 0 && merged.available !== false,
  }
  delete after.deleted
  return after
}
