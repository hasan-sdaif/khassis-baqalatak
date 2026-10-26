'use client'
/** typed API client for the frontend */

import type { CatalogProduct, PlanResult } from '@/lib/engine/types'

const API_ERROR_LABELS: Record<string, string> = {
  unknown_or_inactive_store: 'أحد المتاجر المختارة لم يعد متاحاً. حدّث قائمة المتاجر ثم أعد المحاولة.',
  unknown_locked_product: 'أحد المنتجات المثبّتة لم يعد موجوداً في الكتالوج. أزل البند القديم ثم أعد توليد الخطة.',
  invalid_input: 'بعض المدخلات غير صالحة. راجع الحقول ثم أعد المحاولة.',
  request_too_large: 'حجم الطلب أكبر من المسموح به.',
  rate_limited: 'وصلت إلى حدّ المساهمات المؤقت. حاول مرة أخرى لاحقاً.',
  already_reviewed: 'هذه المساهمة سبق أن تمت مراجعتها.',
  possible_duplicate_product: 'يبدو أن المنتج موجود بالفعل في الكتالوج. تحقق من المنتج الموجود قبل إعادة الإرسال.',
}

async function responseError(res: Response, fallback: string): Promise<Error> {
  const data: unknown = await res.json().catch(() => ({}))
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) return new Error(record.message)
    if (typeof record.error === 'string' && API_ERROR_LABELS[record.error]) return new Error(API_ERROR_LABELS[record.error])
  }
  return new Error(fallback)
}

export interface CatalogMeta {
  version: string
  generatedAt: string
  currency: string
  productCount: number
  categories: { id: string; nameAr: string; nameEn: string; priority: number; icon: string }[]
  stores: { id: string; nameAr: string; nameEn: string; kind: string; deliveryFeeFils: number; freeDeliveryThresholdFils: number | null; minOrderFils: number; deliveryTimeText: string; active: boolean }[]
  groups: { id: string; nameAr: string; nameEn: string; icon: string; parent: string | null; clazz: string }[]
  needs: { id: string; nameAr: string; nameEn: string; baseUnit: string; clazz: string; visibleInWizard: boolean }[]
  brands: { brand: string; count: number; topCategoryId: string }[]
}

export async function fetchCatalogMeta(): Promise<CatalogMeta> {
  const res = await fetch('/api/catalog')
  if (!res.ok) throw new Error('catalog meta failed')
  return res.json()
}

export interface SearchResponse {
  total: number
  items: CatalogProduct[]
}

export async function searchProducts(params: Record<string, string | number | undefined>): Promise<SearchResponse> {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, String(v))
  }
  const res = await fetch(`/api/search?${sp.toString()}`)
  if (!res.ok) throw new Error('search failed')
  return res.json()
}

export interface ProductDetails {
  product: CatalogProduct
  prices: { storeId: string; storeNameAr: string; storeNameEn: string; fils: number; origFils?: number; url?: string }[]
  similar: CatalogProduct[]
}

export async function fetchProduct(id: string): Promise<ProductDetails> {
  const res = await fetch(`/api/product/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error('product failed')
  return res.json()
}

export interface PlanRequest {
  household: unknown
  budget: unknown
  mode?: string
  season?: string
  storeMode?: string
  availableStores?: string[]
  delivery?: boolean
  locks?: unknown[]
  envelopes?: unknown[]
  pantry?: unknown[]
  seed?: number
  dateISO?: string
  /** advanced preferences profile (hundreds-of-options layer) */
  advanced?: unknown
}

export async function generatePlanApi(req: PlanRequest): Promise<{ plan: PlanResult; engineMs: number }> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw await responseError(res, 'تعذر توليد الخطة. تحقق من اتصالك ومدخلاتك ثم أعد المحاولة.')
  return res.json()
}

export interface SharedPlanListItem {
  id: string
  slug: string
  title: string
  familyName?: string | null
  authorName?: string | null
  likes: number
  forks: number
  createdAt: string
  stats: { costFils?: number; items?: number; members?: number; mode?: string; coverage?: number }
}

export async function fetchSharedPlans(sort: 'recent' | 'likes' = 'recent'): Promise<{ items: SharedPlanListItem[] }> {
  const res = await fetch(`/api/plans?sort=${sort}`)
  if (!res.ok) throw new Error('plans failed')
  return res.json()
}

export async function fetchSharedPlan(slug: string): Promise<unknown> {
  const res = await fetch(`/api/plans/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error('plan not found')
  return res.json()
}

export async function sharePlan(body: Record<string, unknown>): Promise<{ id: string; slug: string }> {
  const res = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await responseError(res, 'تعذر نشر الخطة. راجع الموافقة والبيانات ثم أعد المحاولة.')
  return res.json()
}

export async function submitContribution(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch('/api/contribute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await responseError(res, 'تعذر إرسال المساهمة. راجع البيانات ثم أعد المحاولة.')
  return res.json()
}

export async function fetchContributions(status = 'pending'): Promise<{ items: { id: string; kind: string; productId?: string; payload: Record<string, unknown>; votes: number; createdAt: string }[] }> {
  const query = new URLSearchParams({ status })
  const res = await fetch(`/api/contribute?${query.toString()}`)
  if (!res.ok) throw await responseError(res, 'تعذر تحميل قائمة المساهمات.')
  return res.json()
}

export async function voteContribution(id: string, voterKey: string, value: 1 | -1): Promise<void> {
  const res = await fetch(`/api/contribute/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voterKey, value }),
  })
  if (!res.ok) throw await responseError(res, 'تعذر تسجيل التصويت.')
}

export interface IndexResponse {
  currency: string
  version: string
  baskets: { id: string; nameAr: string; stores: { storeId: string; storeNameAr: string; totalFils: number; covered: number; itemCount: number }[] }[]
  categoryStats: { category: string; nameAr: string; count: number; medianFils: number }[]
}

export async function fetchIndex(): Promise<IndexResponse> {
  const res = await fetch('/api/index')
  if (!res.ok) throw new Error('index failed')
  return res.json()
}
