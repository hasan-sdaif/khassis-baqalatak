'use client'
/**
 * Admin panel (spec 8.2–8.9) — one view, five sections behind a segmented
 * control, deep-linkable via #/admin/{tab}:
 *  1) لوحة المؤشرات — catalog stats, pending contributions, import history,
 *     category distribution bars.
 *  2) المنتجات — search/filter/sort + inline median editing + full overlay
 *     editor (with live size-parse preview) + create + soft delete.
 *  3) طابور المراجعة — community contributions: vote (optimistic) + moderate.
 *  4) الاستيراد — markdown/JSON import center: dry-run diff → apply.
 *  5) سجل التدقيق — audit log with selective rollback.
 * Demo build: local-only access; self-hosted deploys are guarded by
 * owner/editor RBAC roles through the admin token.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta, fetchContributions, voteContribution, type CatalogMeta } from '@/lib/api-client'
import { formatBHD, formatNumberAr, formatDateAr, parseBHDToFils, formatQty } from '@/lib/money'
import { parseSize, normalizeArabic } from '@/lib/engine'
import {
  GlassCard, GlassRow, GlassButton, Pill, StatTile, EmptyState, Spinner, SkeletonRows, SectionTitle,
} from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import type { CatalogProduct } from '@/lib/engine/types'
import { cn } from '@/lib/utils'
import {
  ArrowRight, Check, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardPaste, FileInput, FileText,
  History as HistoryIcon, Inbox, LayoutDashboard, Package, Pencil, Plus, RefreshCw, ScrollText,
  Search, ShieldCheck, ThumbsDown, ThumbsUp, Trash2, TriangleAlert, Undo2, Upload, X,
} from 'lucide-react'

// ---------------------------------------------------------------- constants

const PAGE_LIMIT = 25
const RAW_DIR = 'data/raw/grocery-db-bahrain/grocery-db-bahrain'
const QUICK_FILES = ['eggs.md', 'milk.md', 'water.md', 'rice-pasta-grains.md', 'baby-products.md', 'personal-care.md']

const TAB_DEFS = [
  { key: 'stats', label: 'لوحة المؤشرات', icon: LayoutDashboard },
  { key: 'products', label: 'المنتجات', icon: Package },
  { key: 'review', label: 'طابور المراجعة', icon: ClipboardCheck },
  { key: 'import', label: 'الاستيراد', icon: FileInput },
  { key: 'audit', label: 'سجل التدقيق', icon: ScrollText },
] as const
type TabKey = (typeof TAB_DEFS)[number]['key']

const SORTS = [
  { id: 'relevance', label: 'الأكثر صلة' },
  { id: 'price-asc', label: 'السعر: الأقل أولاً' },
  { id: 'price-desc', label: 'السعر: الأعلى أولاً' },
  { id: 'unit-asc', label: 'سعر الوحدة: الأقل أولاً' },
  { id: 'popularity', label: 'الأكثر انتشاراً' },
]

const KIND_LABELS: Record<string, string> = {
  'price-update': 'تحديث سعر',
  'name-fix': 'تصحيح اسم',
  'size-fix': 'تصحيح حجم',
  'category-fix': 'تصحيح تصنيف',
  'new-product': 'منتج جديد',
  availability: 'توفّر',
  barcode: 'باركود',
  generic: 'إبلاغ',
}

const PAYLOAD_KEY_LABELS: Record<string, string> = {
  nameAr: 'الاسم بالعربية',
  nameEn: 'الاسم بالإنجليزية',
  brand: 'العلامة التجارية',
  sizeText: 'نص الحجم',
  category: 'التصنيف',
  need: 'الاحتياج',
  medianFils: 'السعر الوسيط',
  prices: 'الأسعار',
  available: 'التوفّر',
  note: 'ملاحظة',
  productId: 'معرّف المنتج',
  storeId: 'المتجر',
  fils: 'السعر',
}

const ACTION_META: Record<string, { label: string; tone: 'default' | 'primary' | 'accent' | 'warn' | 'danger' }> = {
  create: { label: 'إنشاء', tone: 'primary' },
  update: { label: 'تحديث', tone: 'default' },
  delete: { label: 'حذف', tone: 'danger' },
  moderate: { label: 'تطبيق مساهمة', tone: 'accent' },
  import: { label: 'استيراد', tone: 'warn' },
  rollback: { label: 'تراجع', tone: 'warn' },
}

const TARGET_LABELS: Record<string, string> = {
  product: 'منتج',
  contribution: 'مساهمة',
  plan: 'خطة',
  store: 'متجر',
}

const API_ERRORS: Record<string, string> = {
  file_unreadable: 'تعذّر قراءة الملف من المسار المحدد على الخادم',
  invalid_json: 'محتوى غير صالح',
  invalid_json_body: 'المحتوى الملصق ليس JSON صالحاً للصيغة المختارة',
  inline_or_path_required: 'حدّد مسار ملف أو الصق محتوى أولاً',
  not_found: 'العنصر غير موجود',
  already_reviewed: 'تمت مراجعة هذه المساهمة مسبقاً',
  already_reverted: 'تم التراجع عن هذا السجل مسبقاً',
  unsupported_target: 'التراجع مدعوم لعمليات المنتجات فقط',
  name_required: 'الاسم مطلوب (عربي أو إنجليزي)',
  price_required: 'أدخل سعراً وسيطاً أو سعر متجر واحد على الأقل',
  unknown_action: 'إجراء غير معروف',
  rate_limited: 'تم تجاوز الحد المسموح من العمليات مؤقتاً',
  patch_required: 'بيانات التعديل مفقودة',
}

const inputCls = 'glass-thin rounded-xl min-h-11 px-3 text-sm w-full'
const PROD_COLS = 'md:grid md:grid-cols-[minmax(0,1fr)_125px_115px_145px_75px_175px] md:items-center md:gap-3'

// -------------------------------------------------------------------- types

interface ImportStatsLite { read?: number; added?: number; changed?: number; missing?: number; warnings?: string[] }

interface ImportBatchItem {
  id: string; source: string; format: string; mode: string
  stats: ImportStatsLite; createdAt: string; appliedAt: string | null
}

interface AdminStats {
  catalog: { version: string; productCount: number; withSize: number; withNeed: number; fallbackNeeds: number; stores: number; categories: number }
  contributions: { pending: number; total: number }
  imports: ImportBatchItem[]
  sharedPlans: number
  auditEntries: number
  byCategory: { id: string; nameAr: string; priority: number; count: number }[]
}

interface ContributionItem {
  id: string; kind: string; productId?: string
  payload: Record<string, unknown>; votes: number; createdAt: string
  status?: string; note?: string
}

interface DryRunResult {
  stats: ImportStatsLite
  preview: {
    added: { id: string; nameAr: string; category?: string; medianFils?: number }[]
    changed: { id: string; nameAr: string; field: string; from: number; to: number }[]
    missing: { id: string; nameAr: string }[]
  }
}

interface ApplyResult { ok?: boolean; mode?: string; stats: ImportStatsLite; applied: number }

interface AuditItem {
  id: string; actor: string; action: string; targetType: string; targetId: string
  before: Record<string, unknown> | null; after: Record<string, unknown> | null
  createdAt: string; revertedAt: string | null
}

interface FormState {
  nameAr: string; nameEn: string; brand: string; sizeText: string
  category: string; need: string; medianBHD: string
  prices: Record<string, string> // storeId -> BHD string
}

// ------------------------------------------------------------------ helpers

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `فشل الطلب (${res.status})`)
  }
  return (await res.json()) as T
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function patchJson<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return API_ERRORS[raw] ?? raw
}

function fmtBHD(fils: number): string {
  return formatBHD(fils, { withUnit: false })
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id
}

function tabKeyOf(tab?: string): TabKey {
  const t = (tab ?? '').trim().toLowerCase()
  return (TAB_DEFS.some((x) => x.key === t) ? t : 'stats') as TabKey
}

/** transient success message (toast-ish pill, auto-dismiss) */
function useFlash(): readonly [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 4500)
    return () => clearTimeout(t)
  }, [msg])
  return [msg, setMsg] as const
}

function collectPrices(form: FormState): Record<string, { fils: number }> {
  const out: Record<string, { fils: number }> = {}
  for (const [sid, v] of Object.entries(form.prices)) {
    const fils = parseBHDToFils(v)
    if (fils > 0) out[sid] = { fils }
  }
  return out
}

/** overlay patch for PATCH /api/admin/product/[id] (server merges over base) */
function overlayPatch(form: FormState): Record<string, unknown> {
  const nameAr = form.nameAr.trim()
  const nameEn = form.nameEn.trim()
  const brand = form.brand.trim()
  const sizeText = form.sizeText.trim()
  const size = parseSize(sizeText || null)
  const medianFils = parseBHDToFils(form.medianBHD)
  const patch: Record<string, unknown> = {
    nameAr, nameEn,
    nameNorm: normalizeArabic(`${nameAr} ${nameEn} ${brand}`),
    brand: brand || null,
    brandNorm: brand ? normalizeArabic(brand) : null,
    category: form.category || 'pantry-other',
    sizeText: sizeText || null,
    size,
    need: form.need.trim() || null,
    medianFils,
  }
  if (medianFils > 0 && size && size.baseQuantity > 0 && size.unit !== 'pcs') {
    const per = size.unit === 'ml' || size.unit === 'g' ? 1000 : 1
    patch.unitPriceFils = Math.round((medianFils * per) / size.baseQuantity)
  } else {
    patch.unitPriceFils = null
  }
  const prices = collectPrices(form)
  if (Object.keys(prices).length > 0) {
    const vals = Object.values(prices).map((x) => x.fils)
    patch.prices = prices
    patch.storesCount = vals.length
    patch.minFils = Math.min(medianFils, ...vals)
    patch.maxFils = Math.max(medianFils, ...vals)
  }
  return patch
}

/** body for POST /api/admin/products (server computes id/size/need) */
function createBody(form: FormState): Record<string, unknown> {
  return {
    nameAr: form.nameAr.trim(),
    nameEn: form.nameEn.trim(),
    brand: form.brand.trim() || null,
    category: form.category || 'pantry-other',
    sizeText: form.sizeText.trim() || null,
    need: form.need.trim() || undefined,
    medianFils: parseBHDToFils(form.medianBHD),
    prices: collectPrices(form),
  }
}

/** local draft of the created product so it can be prepended immediately */
function localProduct(id: string, form: FormState): CatalogProduct {
  const nameAr = form.nameAr.trim()
  const nameEn = form.nameEn.trim()
  const brand = form.brand.trim()
  const sizeText = form.sizeText.trim()
  const size = parseSize(sizeText || null)
  const medianFils = parseBHDToFils(form.medianBHD)
  const prices = collectPrices(form)
  const vals = Object.values(prices).map((x) => x.fils)
  let unitPriceFils: number | null = null
  if (size && size.baseQuantity > 0 && size.unit !== 'pcs') {
    const per = size.unit === 'ml' || size.unit === 'g' ? 1000 : 1
    unitPriceFils = Math.round((medianFils * per) / size.baseQuantity)
  }
  return {
    id, category: form.category || 'pantry-other',
    nameAr, nameEn,
    nameNorm: normalizeArabic(`${nameAr} ${nameEn} ${brand}`),
    brand: brand || null, brandNorm: brand ? normalizeArabic(brand) : null,
    sizeText: sizeText || null, size,
    flavors: [], tags: [], rank: 500,
    storesCount: vals.length || 1, available: true,
    medianFils,
    minFils: vals.length ? Math.min(medianFils, ...vals) : medianFils,
    maxFils: vals.length ? Math.max(medianFils, ...vals) : medianFils,
    prices, unitPriceFils,
    need: form.need.trim() || null, dataConfidence: 0.95,
  }
}

function formFromProduct(p: CatalogProduct): FormState {
  const prices: Record<string, string> = {}
  for (const [sid, sp] of Object.entries(p.prices ?? {})) {
    if (sp && sp.fils > 0) prices[sid] = fmtBHD(sp.fils)
  }
  return {
    nameAr: p.nameAr ?? '', nameEn: p.nameEn ?? '', brand: p.brand ?? '',
    sizeText: p.sizeText ?? '', category: p.category, need: p.need ?? '',
    medianBHD: fmtBHD(p.medianFils), prices,
  }
}

const ADD_INITIAL: FormState = {
  nameAr: '', nameEn: '', brand: '', sizeText: '',
  category: 'pantry-other', need: '', medianBHD: '', prices: {},
}

// ------------------------------------------------------- shared UI widgets

function FlashPill({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div aria-live="polite" className="mb-1">
      <Pill tone="primary" className="text-sm py-1.5 px-3.5 leading-relaxed">
        <Check size={14} strokeWidth={1.75} aria-hidden /> {msg}
      </Pill>
    </div>
  )
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="glass-thin rounded-xl p-4 flex flex-wrap items-center gap-3 text-sm">
      <TriangleAlert size={18} strokeWidth={1.75} className="text-destructive shrink-0" aria-hidden />
      <span className="text-destructive flex-1 min-w-[12rem]">{message}</span>
      {onRetry ? (
        <GlassButton size="md" className="px-4" onClick={onRetry}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> إعادة المحاولة
        </GlassButton>
      ) : null}
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-start">
      <span className="block text-xs font-semibold text-muted-foreground mb-1.5">{label}</span>
      {children}
      {hint ? <span className="block mt-1 text-[11px] text-muted-foreground leading-relaxed">{hint}</span> : null}
    </label>
  )
}

/** live preview of what the server size parser would understand (spec 5.3) */
function SizeParsePreview({ text, arabicNumerals }: { text: string; arabicNumerals: boolean }) {
  const parsed = useMemo(() => parseSize(text), [text])
  if (!text.trim()) return <span>اتركه فارغاً إذا لم يوجد حجم</span>
  if (!parsed) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <TriangleAlert size={12} strokeWidth={1.75} aria-hidden /> لم يُفهم النص — سيُحفظ كنص خام دون تحويل
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1', parsed.confidence < 0.5 && 'text-amber-600 dark:text-amber-400')}>
      <Check size={12} strokeWidth={1.75} aria-hidden />
      سيفهمه الخادم كـ {formatQty(parsed.unit, parsed.baseQuantity)} — ثقة {formatNumberAr(Math.round(parsed.confidence * 100), arabicNumerals)}٪
    </span>
  )
}

function ImportRow({ imp, arabicNumerals }: { imp: ImportBatchItem; arabicNumerals: boolean }) {
  return (
    <GlassRow className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="flex items-center gap-2 text-sm font-semibold min-w-0 flex-1">
        <FileText size={16} strokeWidth={1.75} aria-hidden className="text-primary shrink-0" />
        <span className="truncate" dir="auto" title={imp.source}>{imp.source}</span>
      </span>
      <Pill tone={imp.mode === 'apply' ? 'primary' : 'default'}>{imp.mode === 'apply' ? 'تطبيق' : 'تجريبي'}</Pill>
      <Pill>{imp.format === 'markdown' ? 'ماركداون' : 'JSON'}</Pill>
      <span className="text-xs text-muted-foreground tabular-nums">
        قرأ {formatNumberAr(imp.stats.read ?? 0, arabicNumerals)}
        {' · '}أضاف {formatNumberAr(imp.stats.added ?? 0, arabicNumerals)}
        {' · '}غيّر {formatNumberAr(imp.stats.changed ?? 0, arabicNumerals)}
      </span>
      <span className="text-xs text-muted-foreground">{formatDateAr(imp.createdAt)}</span>
    </GlassRow>
  )
}

// ================================================================== main

export function AdminView({ tab }: { tab?: string }) {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const userKey = useApp((s) => s.settings.userKey)
  const [active, setActive] = useState<TabKey>(() => tabKeyOf(tab))

  const { stats, loading: statsLoading, error: statsError, reload: reloadStats } = useAdminStats()

  useEffect(() => {
    setActive(tabKeyOf(tab))
  }, [tab])

  const selectTab = (k: TabKey) => {
    setActive(k)
    navigate({ name: 'admin', tab: k })
  }

  return (
    <div className="space-y-5 pb-6">
      {/* RBAC notice */}
      <GlassCard className="p-4 flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center text-primary shrink-0">
          <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="text-sm text-muted-foreground leading-relaxed">
          <span className="font-bold text-foreground block mb-0.5">الصلاحيات</span>
          هذه اللوحة متاحة محلياً في هذه النسخة التجريبية — في النشر الذاتي تُحمى بواسطة أدوار المالك/المحرر (RBAC) عبر توكن الإدارة.
        </div>
      </GlassCard>

      {/* segmented tabs */}
      <div className="glass rounded-2xl p-1.5 flex gap-1 overflow-x-auto nice-scroll" role="tablist" aria-label="أقسام لوحة الإدارة">
        {TAB_DEFS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={active === key}
            onClick={() => selectTab(key)}
            className={cn(
              'flex-none sm:flex-1 min-h-11 px-3.5 rounded-xl text-sm font-semibold whitespace-nowrap inline-flex items-center justify-center gap-1.5 transition-all',
              active === key ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'hover:bg-secondary/60 text-foreground/80',
            )}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {active === 'stats' ? (
        <StatsTab
          stats={stats}
          loading={statsLoading}
          error={statsError}
          retry={reloadStats}
          arabicNumerals={arabicNumerals}
          onOpenReview={() => selectTab('review')}
        />
      ) : null}
      {active === 'products' ? (
        <ProductsTab arabicNumerals={arabicNumerals} stats={stats} onStatsReload={reloadStats} />
      ) : null}
      {active === 'review' ? (
        <ReviewTab arabicNumerals={arabicNumerals} userKey={userKey} onModerated={reloadStats} />
      ) : null}
      {active === 'import' ? (
        <ImportTab arabicNumerals={arabicNumerals} stats={stats} onStatsReload={reloadStats} />
      ) : null}
      {active === 'audit' ? <AuditTab arabicNumerals={arabicNumerals} /> : null}
    </div>
  )
}

function useAdminStats() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rev, setRev] = useState(0)

  // fetch on mount and whenever `rev` is bumped by reload()
  useEffect(() => {
    let cancelled = false
    api<AdminStats>('/api/admin/stats')
      .then((r) => { if (!cancelled) { setStats(r); setError(null) } })
      .catch((e) => { if (!cancelled) setError(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rev])

  const reload = useCallback(() => {
    setLoading(true)
    setRev((k) => k + 1)
  }, [])

  return { stats, loading, error, reload }
}

// ============================================================ TAB 1: stats

function StatsTab({ stats, loading, error, retry, arabicNumerals, onOpenReview }: {
  stats: AdminStats | null
  loading: boolean
  error: string | null
  retry: () => void
  arabicNumerals: boolean
  onOpenReview: () => void
}) {
  if (loading && !stats) return <SkeletonRows rows={6} />
  if (error && !stats) return <ErrorNote message={error} onRetry={retry} />
  if (!stats) return null
  const c = stats.catalog
  const top = stats.byCategory.slice(0, 12)
  const rest = stats.byCategory.slice(12)
  const maxCount = top[0]?.count ?? 1

  return (
    <div className="space-y-6">
      <section aria-label="إحصاءات الكتالوج">
        <SectionTitle>نظرة عامة على الكتالوج</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <StatTile label="إجمالي المنتجات" value={formatNumberAr(c.productCount, arabicNumerals)} hint={`إصدار ${c.version}`} />
          <StatTile label="بحجم مفهوم" value={formatNumberAr(c.withSize, arabicNumerals)} hint={`من أصل ${formatNumberAr(c.productCount, arabicNumerals)}`} />
          <StatTile label="مصنّفة باحتياج" value={formatNumberAr(c.withNeed, arabicNumerals)} hint={`منها ${formatNumberAr(c.fallbackNeeds, arabicNumerals)} باحتياج فئة عام`} />
          <StatTile label="متاجر" value={formatNumberAr(c.stores, arabicNumerals)} />
          <StatTile label="تصنيفات" value={formatNumberAr(c.categories, arabicNumerals)} />
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-3" aria-label="المساهمات والمجتمع">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-2">
            <ClipboardCheck size={16} strokeWidth={1.75} aria-hidden /> المساهمات المعلقة
          </div>
          <div className={cn('text-4xl font-extrabold tabular-nums', stats.contributions.pending > 0 ? 'text-destructive' : 'text-foreground')}>
            {formatNumberAr(stats.contributions.pending, arabicNumerals)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            من إجمالي {formatNumberAr(stats.contributions.total, arabicNumerals)} مساهمة
          </div>
          {stats.contributions.pending > 0 ? (
            <GlassButton size="md" className="mt-3 px-4" onClick={onOpenReview}>
              فتح طابور المراجعة
              <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
            </GlassButton>
          ) : (
            <div className="mt-3 text-xs text-muted-foreground">لا شيء بانتظار المراجعة حالياً</div>
          )}
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-3">
            <HistoryIcon size={16} strokeWidth={1.75} aria-hidden /> نشاط المجتمع والسجلات
          </div>
          <div className="flex flex-wrap gap-2">
            <StatTile label="خطط مشارَكة" value={formatNumberAr(stats.sharedPlans, arabicNumerals)} />
            <StatTile label="سجلات التدقيق" value={formatNumberAr(stats.auditEntries, arabicNumerals)} />
          </div>
        </GlassCard>
      </section>

      <section aria-label="آخر دفعات الاستيراد">
        <SectionTitle>آخر دفعات الاستيراد</SectionTitle>
        {stats.imports.length === 0 ? (
          <EmptyState
            icon={<FileInput size={22} strokeWidth={1.75} aria-hidden />}
            title="لا توجد دفعات استيراد بعد"
            subtitle="ابدأ من تبويب الاستيراد بتشغيل تجريبي (dry-run) ثم طبّق"
          />
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto nice-scroll p-0.5">
            {stats.imports.map((imp) => (
              <ImportRow key={imp.id} imp={imp} arabicNumerals={arabicNumerals} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="توزيع الفئات">
        <SectionTitle>توزيع الفئات</SectionTitle>
        <GlassCard className="p-4 space-y-2.5">
          {top.map((cat) => (
            <div key={cat.id} className="flex items-center gap-2 sm:gap-3">
              <span className="w-7 h-7 rounded-lg glass-ultrathin grid place-items-center text-primary shrink-0">
                <CategoryIcon category={cat.id} size={15} />
              </span>
              <span className="text-sm font-medium w-32 sm:w-44 truncate">{cat.nameAr}</span>
              <div className="flex-1 min-w-8 h-6 rounded-lg glass-ultrathin overflow-hidden" role="img" aria-label={`${cat.nameAr}: ${cat.count} منتجاً`}>
                <div className="h-full bg-primary/70 dark:bg-primary/60 rounded-lg" style={{ width: `${Math.max(3, Math.round((cat.count / maxCount) * 100))}%` }} />
              </div>
              <span className="text-sm font-bold tabular-nums w-14 text-end">{formatNumberAr(cat.count, arabicNumerals)}</span>
            </div>
          ))}
        </GlassCard>
        {rest.length > 0 ? (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-2">
              بقية التصنيفات ({formatNumberAr(rest.length, arabicNumerals)})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rest.map((cat) => (
                <Pill key={cat.id}>
                  <CategoryIcon category={cat.id} size={12} />
                  {cat.nameAr}
                  <span className="tabular-nums opacity-70">{formatNumberAr(cat.count, arabicNumerals)}</span>
                </Pill>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

// ========================================================= TAB 2: products

function ProductsTab({ arabicNumerals, stats, onStatsReload }: {
  arabicNumerals: boolean
  stats: AdminStats | null
  onStatsReload: () => void
}) {
  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('relevance')
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<CatalogProduct[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useFlash()

  // catalog meta (categories + stores) — fetched once
  useEffect(() => {
    let cancelled = false
    fetchCatalogMeta()
      .then((m) => { if (!cancelled) setMeta(m) })
      .catch((e) => { if (!cancelled) setMetaError(errText(e)) })
    return () => { cancelled = true }
  }, [])

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput)
      setOffset(0)
    }, 350)
    return () => clearTimeout(t)
  }, [qInput])

  // fetch products list
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (category) sp.set('category', category)
    sp.set('sort', sort)
    sp.set('limit', String(PAGE_LIMIT))
    sp.set('offset', String(offset))
    api<{ total: number; items: CatalogProduct[] }>(`/api/admin/products?${sp.toString()}`)
      .then((r) => { if (!cancelled) { setItems(r.items); setTotal(r.total) } })
      .catch((e) => { if (!cancelled) setError(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [q, category, sort, offset, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const deleteProduct = async (p: CatalogProduct) => {
    setBusyId(p.id)
    try {
      await api(`/api/admin/product/${encodeURIComponent(p.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'admin' }),
      })
      setItems((xs) => xs.filter((x) => x.id !== p.id))
      setTotal((t) => Math.max(0, t - 1))
      setConfirmDeleteId(null)
      setFlash('حُذف المنتج — قابل للاستعادة من سجل التدقيق')
      onStatsReload()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusyId(null)
    }
  }

  const onCreated = (draft: CatalogProduct) => {
    setItems((xs) => [draft, ...xs])
    setTotal((t) => t + 1)
    setShowAdd(false)
    setFlash('أُضيف المنتج إلى الكتالوج')
    onStatsReload()
  }

  const from = total > 0 ? offset + 1 : 0
  const to = Math.min(offset + PAGE_LIMIT, total)
  const filterCats = stats?.byCategory?.map((c) => ({ id: c.id, nameAr: c.nameAr }))
    ?? meta?.categories.map((c) => ({ id: c.id, nameAr: c.nameAr }))
    ?? []

  return (
    <div className="space-y-4">
      <FlashPill msg={flash} />
      {metaError ? <ErrorNote message={`تعذّر تحميل بيانات الكتالوج (التصنيفات/المتاجر): ${metaError}`} /> : null}

      {/* controls */}
      <GlassCard className="p-4">
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
          <div className="relative">
            <Search size={16} strokeWidth={1.75} aria-hidden className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="ابحث بالاسم أو العلامة التجارية…"
              aria-label="البحث في المنتجات"
              className={`${inputCls} ps-10`}
            />
          </div>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setOffset(0) }}
            aria-label="تصفية حسب التصنيف"
            className={`${inputCls} sm:w-56`}
          >
            <option value="">كل التصنيفات</option>
            {filterCats.map((c) => (
              <option key={c.id} value={c.id}>{c.nameAr}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setOffset(0) }}
            aria-label="الترتيب"
            className={`${inputCls} sm:w-52`}
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3">
          <span className="text-xs text-muted-foreground tabular-nums inline-flex items-center gap-2">
            {formatNumberAr(total, arabicNumerals)} نتيجة
            {loading ? <Spinner className="w-3.5 h-3.5 text-primary" /> : null}
          </span>
          <GlassButton size="md" variant="primary" className="px-4" onClick={() => setShowAdd((v) => !v)} aria-expanded={showAdd}>
            {showAdd ? <X size={15} strokeWidth={1.75} aria-hidden /> : <Plus size={15} strokeWidth={1.75} aria-hidden />}
            إضافة منتج
          </GlassButton>
        </div>
      </GlassCard>

      {showAdd ? (
        <AddProductPanel
          meta={meta}
          arabicNumerals={arabicNumerals}
          onCreated={onCreated}
          onCancel={() => setShowAdd(false)}
          onError={setError}
        />
      ) : null}

      {error ? <ErrorNote message={error} onRetry={reload} /> : null}

      {/* results */}
      {loading && items.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Package size={22} strokeWidth={1.75} aria-hidden />}
          title="لا نتائج مطابقة"
          subtitle="جرّب تعديل البحث أو التصفية، أو أضف منتجاً جديداً"
        />
      ) : (
        <div className={cn(loading && 'opacity-60 pointer-events-none transition-opacity')}>
          <div className={cn('hidden md:grid grid-cols-[minmax(0,1fr)_125px_115px_145px_75px_175px] gap-3 px-3 pb-1 text-[11px] font-semibold text-muted-foreground')} aria-hidden>
            <span>المنتج والعلامة</span>
            <span>التصنيف</span>
            <span>الحجم</span>
            <span>السعر الوسيط</span>
            <span className="text-center">المتاجر</span>
            <span className="text-end">إجراءات</span>
          </div>
          <ul className="space-y-2">
            {items.map((p) => (
              <li key={p.id}>
                <ProductListItem
                  p={p}
                  meta={meta}
                  arabicNumerals={arabicNumerals}
                  expanded={editingId === p.id}
                  confirming={confirmDeleteId === p.id}
                  busy={busyId === p.id}
                  onToggleEdit={() => setEditingId((cur) => (cur === p.id ? null : p.id))}
                  onAskDelete={() => setConfirmDeleteId(p.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onDelete={() => deleteProduct(p)}
                  onMedianSaved={reload}
                  onError={setError}
                />
                {editingId === p.id ? (
                  <ProductEditor
                    product={p}
                    meta={meta}
                    arabicNumerals={arabicNumerals}
                    onSaved={() => {
                      setEditingId(null)
                      setFlash('حُفظت التعديلات على المنتج')
                      reload()
                    }}
                    onCancel={() => setEditingId(null)}
                    onError={setError}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* pagination */}
      {total > 0 ? (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            عرض {formatNumberAr(from, arabicNumerals)}–{formatNumberAr(to, arabicNumerals)} من {formatNumberAr(total, arabicNumerals)}
          </span>
          <div className="flex gap-2">
            <GlassButton
              size="md" className="px-4"
              disabled={offset === 0 || loading}
              onClick={() => { setOffset(Math.max(0, offset - PAGE_LIMIT)); setConfirmDeleteId(null) }}
            >
              <ChevronRight size={15} strokeWidth={1.75} aria-hidden /> السابق
            </GlassButton>
            <GlassButton
              size="md" className="px-4"
              disabled={offset + PAGE_LIMIT >= total || loading}
              onClick={() => { setOffset(offset + PAGE_LIMIT); setConfirmDeleteId(null) }}
            >
              التالي <ChevronLeft size={15} strokeWidth={1.75} aria-hidden />
            </GlassButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** one product row — responsive: grid table on desktop, stacked card on mobile */
function ProductListItem({ p, meta, arabicNumerals, expanded, confirming, busy, onToggleEdit, onAskDelete, onCancelDelete, onDelete, onMedianSaved, onError }: {
  p: CatalogProduct
  meta: CatalogMeta | null
  arabicNumerals: boolean
  expanded: boolean
  confirming: boolean
  busy: boolean
  onToggleEdit: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onMedianSaved: () => void
  onError: (m: string) => void
}) {
  const catName = meta?.categories.find((c) => c.id === p.category)?.nameAr
  const name = p.nameAr || p.nameEn || '—'
  return (
    <GlassRow className={cn('flex flex-col gap-2', PROD_COLS)}>
      {/* name + brand */}
      <div className="min-w-0">
        <div className="font-semibold text-sm truncate" dir="auto" title={name}>{name}</div>
        <div className="text-[11px] text-muted-foreground truncate" dir="auto">{p.brand ?? '—'}</div>
      </div>

      {/* category + size (one wrapped line on mobile, two grid cells on desktop) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
        <div className="flex items-center gap-1.5 min-w-0 text-xs">
          <span className="text-primary shrink-0"><CategoryIcon category={p.category} size={15} /></span>
          <span className="text-muted-foreground shrink-0 md:hidden">التصنيف:</span>
          <span className="truncate">{catName ?? p.category}</span>
        </div>
        <div className="min-w-0 text-xs">
          <span className="text-muted-foreground shrink-0 md:hidden">الحجم: </span>
          {p.sizeText ? <span dir="auto">{p.sizeText}</span> : <span className="text-muted-foreground">—</span>}
          {p.size ? <span className="text-muted-foreground"> · {formatQty(p.size.unit, p.size.baseQuantity)}</span> : null}
        </div>
      </div>

      {/* median (inline editable) + stores count */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0 md:hidden">الوسيط:</span>
          <MedianInline key={`${p.id}:${p.medianFils}`} product={p} onSaved={onMedianSaved} onError={onError} />
        </div>
        <div className="text-sm font-semibold tabular-nums md:text-center">
          <span className="md:hidden text-xs font-normal text-muted-foreground">المتاجر: </span>
          {formatNumberAr(p.storesCount, arabicNumerals)}
        </div>
      </div>

      {/* actions */}
      <div className="flex items-center gap-1.5 md:justify-end">
        {confirming ? (
          <>
            <span className="text-xs text-destructive font-semibold hidden sm:inline">تأكيد الحذف؟</span>
            <GlassButton size="md" variant="danger" className="px-0 w-11" onClick={onDelete} disabled={busy} aria-label="تأكيد الحذف">
              {busy ? <Spinner className="w-4 h-4" /> : <Trash2 size={15} strokeWidth={1.75} aria-hidden />}
            </GlassButton>
            <GlassButton size="md" className="px-0 w-11" onClick={onCancelDelete} aria-label="إلغاء الحذف">
              <X size={15} strokeWidth={1.75} aria-hidden />
            </GlassButton>
          </>
        ) : (
          <>
            <GlassButton size="md" className="px-3" onClick={onToggleEdit} aria-expanded={expanded} aria-label={`تعديل ${name}`}>
              <Pencil size={14} strokeWidth={1.75} aria-hidden />
              <span className="hidden sm:inline">تعديل</span>
            </GlassButton>
            <GlassButton size="md" className="px-0 w-11" onClick={onAskDelete} aria-label={`حذف ${name}`}>
              <Trash2 size={14} strokeWidth={1.75} aria-hidden />
            </GlassButton>
          </>
        )}
      </div>
    </GlassRow>
  )
}

/** inline editable median price (BHD) — commits on blur/Enter via overlay PATCH */
function MedianInline({ product, onSaved, onError }: {
  product: CatalogProduct
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [val, setVal] = useState(() => fmtBHD(product.medianFils))
  const [saving, setSaving] = useState(false)
  // remounted via key={`${product.id}:${product.medianFils}`} when the row data refreshes

  const commit = async () => {
    const fils = parseBHDToFils(val)
    if (!Number.isFinite(fils) || fils <= 0 || fils === product.medianFils) {
      setVal(fmtBHD(product.medianFils))
      return
    }
    setSaving(true)
    try {
      await patchJson(`/api/admin/product/${encodeURIComponent(product.id)}`, {
        actor: 'admin',
        patch: {
          medianFils: fils,
          minFils: Math.min(product.minFils, fils),
          maxFils: Math.max(product.maxFils, fils),
        },
      })
      onSaved()
    } catch (e) {
      setVal(fmtBHD(product.medianFils))
      onError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        inputMode="decimal"
        dir="ltr"
        aria-label={`السعر الوسيط لـ ${product.nameAr || product.nameEn} بالدينار`}
        className="glass-thin rounded-lg h-11 w-24 px-2 text-sm tabular-nums text-center"
        disabled={saving}
      />
      <span className="text-[11px] text-muted-foreground">د.ب</span>
      {saving ? <Spinner className="w-3.5 h-3.5 text-primary" /> : null}
    </span>
  )
}

/** shared create/edit form (name, brand, size + live parse, category, need, median, store prices) */
function ProductForm({ initial, meta, arabicNumerals, submitLabel, busy, onSubmit, onCancel, onError }: {
  initial: FormState
  meta: CatalogMeta | null
  arabicNumerals: boolean
  submitLabel: string
  busy: boolean
  onSubmit: (form: FormState) => void
  onCancel: () => void
  onError: (m: string) => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const setPrice = (sid: string, v: string) => setForm((f) => ({ ...f, prices: { ...f.prices, [sid]: v } }))

  const categories = meta?.categories ?? []
  const trySubmit = () => {
    if (!form.nameAr.trim() && !form.nameEn.trim()) {
      onError('أدخل اسماً بالعربية أو الإنجليزية على الأقل')
      return
    }
    const medianFils = parseBHDToFils(form.medianBHD)
    if (!medianFils || medianFils <= 0) {
      onError('أدخل سعراً وسيطاً صالحاً بالدينار (مثال: 1.250)')
      return
    }
    onSubmit(form)
  }

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="الاسم بالعربية">
          <input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} dir="auto" className={inputCls} aria-label="الاسم بالعربية" />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={inputCls} aria-label="الاسم بالإنجليزية" />
        </Field>
        <Field label="العلامة التجارية">
          <input value={form.brand} onChange={(e) => set('brand', e.target.value)} dir="auto" className={inputCls} aria-label="العلامة التجارية" />
        </Field>
        <Field label="الحجم (نص حر)" hint={<SizeParsePreview text={form.sizeText} arabicNumerals={arabicNumerals} />}>
          <input value={form.sizeText} onChange={(e) => set('sizeText', e.target.value)} dir="auto" placeholder="مثال: 6 × 200 مل" className={inputCls} aria-label="نص الحجم" />
        </Field>
        <Field label="التصنيف">
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls} aria-label="التصنيف">
            {categories.length > 0 ? (
              categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)
            ) : (
              <option value={form.category}>{form.category}</option>
            )}
          </select>
        </Field>
        <Field label="الاحتياج (need id)" hint="اتركه فارغاً ليصنّفه الخادم تلقائياً">
          <input value={form.need} onChange={(e) => set('need', e.target.value)} dir="ltr" placeholder="مثال: milk" className={`${inputCls} font-mono text-xs`} aria-label="معرّف الاحتياج" />
        </Field>
        <Field label="السعر الوسيط (د.ب)">
          <input value={form.medianBHD} onChange={(e) => set('medianBHD', e.target.value)} inputMode="decimal" dir="ltr" placeholder="1.250" className={`${inputCls} tabular-nums`} aria-label="السعر الوسيط بالدينار" />
        </Field>
      </div>

      {/* store prices editor */}
      <div className="mt-4">
        <div className="text-xs font-semibold text-muted-foreground mb-1.5">
          أسعار المتاجر (د.ب) — <span className="font-normal">اترك الحقل فارغاً لاستثناء المتجر</span>
        </div>
        {meta ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto nice-scroll p-1">
            {meta.stores.map((s) => (
              <label key={s.id} className="block text-start">
                <span className="block text-[11px] text-muted-foreground truncate mb-0.5" title={s.nameAr}>{s.nameAr}</span>
                <input
                  value={form.prices[s.id] ?? ''}
                  onChange={(e) => setPrice(s.id, e.target.value)}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="—"
                  aria-label={`سعر ${s.nameAr} بالدينار`}
                  className="glass-thin rounded-lg h-10 w-full px-2 text-sm tabular-nums"
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">تعذّر تحميل قائمة المتاجر — يمكن حفظ الاسم والسعر الوسيط فقط.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border/60">
        <GlassButton variant="primary" className="px-5" onClick={trySubmit} disabled={busy}>
          {busy ? <Spinner className="w-4 h-4" /> : <Check size={15} strokeWidth={1.75} aria-hidden />}
          {submitLabel}
        </GlassButton>
        <GlassButton className="px-5" onClick={onCancel}>
          <X size={15} strokeWidth={1.75} aria-hidden /> إلغاء
        </GlassButton>
      </div>
    </div>
  )
}

function ProductEditor({ product, meta, arabicNumerals, onSaved, onCancel, onError }: {
  product: CatalogProduct
  meta: CatalogMeta | null
  arabicNumerals: boolean
  onSaved: () => void
  onCancel: () => void
  onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const save = async (form: FormState) => {
    setSaving(true)
    try {
      await patchJson(`/api/admin/product/${encodeURIComponent(product.id)}`, {
        actor: 'admin',
        patch: overlayPatch(form),
      })
      onSaved()
    } catch (e) {
      onError(errText(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <GlassCard className="mt-2 p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-primary shrink-0"><CategoryIcon category={product.category} size={16} /></span>
        <span className="font-bold text-sm">تعديل المنتج</span>
        <span className="text-[11px] text-muted-foreground font-mono truncate" dir="ltr" title={product.id}>{shortId(product.id)}</span>
      </div>
      <ProductForm
        key={product.id}
        initial={formFromProduct(product)}
        meta={meta}
        arabicNumerals={arabicNumerals}
        submitLabel="حفظ التعديلات"
        busy={saving}
        onSubmit={save}
        onCancel={onCancel}
        onError={onError}
      />
    </GlassCard>
  )
}

function AddProductPanel({ meta, arabicNumerals, onCreated, onCancel, onError }: {
  meta: CatalogMeta | null
  arabicNumerals: boolean
  onCreated: (draft: CatalogProduct) => void
  onCancel: () => void
  onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const create = async (form: FormState) => {
    setSaving(true)
    try {
      const r = await postJson<{ ok: boolean; id: string }>('/api/admin/products', createBody(form))
      onCreated(localProduct(r.id, form))
    } catch (e) {
      onError(errText(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-9 h-9 rounded-xl glass-thin grid place-items-center text-primary shrink-0">
          <Plus size={17} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">إضافة منتج جديد</div>
          <div className="text-[11px] text-muted-foreground">سيحسب الخادم المعرّف والحجم المفهوم والاحتياج تلقائياً عند الحاجة</div>
        </div>
        <GlassButton size="md" className="px-0 w-11" onClick={onCancel} aria-label="إغلاق نموذج الإضافة">
          <X size={15} strokeWidth={1.75} aria-hidden />
        </GlassButton>
      </div>
      <ProductForm
        initial={ADD_INITIAL}
        meta={meta}
        arabicNumerals={arabicNumerals}
        submitLabel="إضافة المنتج"
        busy={saving}
        onSubmit={create}
        onCancel={onCancel}
        onError={onError}
      />
    </GlassCard>
  )
}

// ========================================================== TAB 3: review

function prettyValue(key: string, v: unknown, arabicNumerals: boolean): ReactNode {
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا'
  if (typeof v === 'number') {
    if (/fils$/i.test(key)) return formatBHD(v, { arabicNumerals })
    return formatNumberAr(v, arabicNumerals)
  }
  if (v == null) return '—'
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '—'
    return (
      <span className="flex flex-wrap gap-1.5">
        {entries.map(([sk, sv]) => {
          const fils = typeof sv === 'object' && sv !== null ? (sv as { fils?: number }).fils : typeof sv === 'number' ? sv : undefined
          return (
            <Pill key={sk}>
              <span dir="ltr">{sk}</span>
              {fils != null ? <span className="tabular-nums">: {formatBHD(fils, { arabicNumerals })}</span> : <span dir="auto">: {String(sv)}</span>}
            </Pill>
          )
        })}
      </span>
    )
  }
  return String(v)
}

function ReviewTab({ arabicNumerals, userKey, onModerated }: {
  arabicNumerals: boolean
  userKey: string
  onModerated: () => void
}) {
  const [items, setItems] = useState<ContributionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [myVotes, setMyVotes] = useState<Record<string, 1 | -1>>({})
  const [voteDelta, setVoteDelta] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useFlash()

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchContributions('pending')
      .then((r) => { if (!cancelled) setItems(r.items) })
      .catch((e) => { if (!cancelled) setError(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const vote = async (c: ContributionItem, value: 1 | -1) => {
    const cur = myVotes[c.id]
    if (cur === value) return
    const delta = cur === undefined ? value : value * 2
    setVoteDelta((d) => ({ ...d, [c.id]: (d[c.id] ?? 0) + delta }))
    setMyVotes((v) => ({ ...v, [c.id]: value }))
    try {
      await voteContribution(c.id, userKey, value)
    } catch {
      setVoteDelta((d) => ({ ...d, [c.id]: (d[c.id] ?? 0) - delta }))
      setMyVotes((v) => (cur === undefined ? v : { ...v, [c.id]: cur }))
      setError('تعذر إرسال التصويت — أُعيد العدّاد إلى حالته السابقة')
    }
  }

  const moderate = async (c: ContributionItem, action: 'approve' | 'reject') => {
    setBusyId(c.id)
    try {
      await postJson('/api/admin/moderate', {
        id: c.id,
        action,
        actor: 'admin',
        note: notes[c.id]?.trim() || undefined,
      })
      setItems((xs) => xs.filter((x) => x.id !== c.id))
      setFlash(action === 'approve' ? 'قُبلت المساهمة وطُبّقت على الكتالوج' : 'رُفضت المساهمة')
      onModerated()
    } catch (e) {
      setError(errText(e))
      reload()
    } finally {
      setBusyId(null)
    }
  }

  if (loading && items.length === 0) return <SkeletonRows rows={4} />

  return (
    <div className="space-y-4">
      <FlashPill msg={flash} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionTitle className="mb-0">
          طابور المراجعة ({formatNumberAr(items.length, arabicNumerals)})
        </SectionTitle>
        <GlassButton size="md" className="px-4" onClick={reload} disabled={loading}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> تحديث
        </GlassButton>
      </div>

      {error ? <ErrorNote message={error} onRetry={reload} /> : null}

      {items.length === 0 && !error ? (
        <EmptyState
          icon={<Inbox size={22} strokeWidth={1.75} aria-hidden />}
          title="الطابور فارغ"
          subtitle="لا مساهمات معلقة حالياً — تظهر هنا تصحيحات الأسعار والأسماء والمنتجات الجديدة من المجتمع"
        />
      ) : (
        <div className="space-y-3 max-h-[75vh] overflow-y-auto nice-scroll p-0.5">
          {items.map((c) => {
            const votes = c.votes + (voteDelta[c.id] ?? 0)
            const busy = busyId === c.id
            const payloadEntries = Object.entries(c.payload ?? {})
            return (
              <GlassCard key={c.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Pill tone={c.kind === 'new-product' ? 'primary' : c.kind === 'generic' ? 'warn' : 'accent'}>
                    {KIND_LABELS[c.kind] ?? c.kind}
                  </Pill>
                  {c.productId ? (
                    <span className="text-[11px] text-muted-foreground font-mono truncate" dir="ltr" title={c.productId}>
                      {shortId(c.productId)}
                    </span>
                  ) : null}
                  <span className="text-[11px] text-muted-foreground">{formatDateAr(c.createdAt)}</span>
                  <span className="ms-auto inline-flex items-center gap-1.5 text-sm font-bold tabular-nums">
                    <ThumbsUp size={14} strokeWidth={1.75} aria-hidden className="text-primary" />
                    {formatNumberAr(votes, arabicNumerals)}
                    <span className="text-xs font-normal text-muted-foreground">تصويت</span>
                  </span>
                </div>

                {/* payload rows */}
                {payloadEntries.length > 0 ? (
                  <div className="glass-ultrathin rounded-xl divide-y divide-border/40 mb-3">
                    {payloadEntries.map(([k, v]) => (
                      <div key={k} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <span className="text-xs text-muted-foreground w-36 shrink-0 pt-0.5">{PAYLOAD_KEY_LABELS[k] ?? k}</span>
                        <span className="flex-1 min-w-0 break-words leading-relaxed" dir="auto">{prettyValue(k, v, arabicNumerals)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mb-3">لا تفاصيل مرفقة</div>
                )}

                {/* votes + moderation */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => vote(c, 1)}
                      className={cn(
                        'min-h-11 min-w-11 grid place-items-center rounded-xl transition-all',
                        myVotes[c.id] === 1 ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60',
                      )}
                      aria-label="تصويت مؤيد"
                      aria-pressed={myVotes[c.id] === 1}
                    >
                      <ThumbsUp size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                    <button
                      onClick={() => vote(c, -1)}
                      className={cn(
                        'min-h-11 min-w-11 grid place-items-center rounded-xl transition-all',
                        myVotes[c.id] === -1 ? 'bg-destructive/15 text-destructive' : 'glass-thin hover:bg-secondary/60',
                      )}
                      aria-label="تصويت معارض"
                      aria-pressed={myVotes[c.id] === -1}
                    >
                      <ThumbsDown size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                  <input
                    value={notes[c.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                    placeholder="ملاحظة المراجع (اختياري)"
                    aria-label="ملاحظة المراجع"
                    className="glass-thin rounded-xl min-h-11 px-3 text-sm flex-1 min-w-[10rem]"
                  />
                  <GlassButton
                    variant="primary"
                    className="px-4"
                    onClick={() => moderate(c, 'approve')}
                    disabled={busy}
                  >
                    {busy ? <Spinner className="w-4 h-4" /> : <Check size={15} strokeWidth={1.75} aria-hidden />}
                    قبول
                  </GlassButton>
                  <GlassButton
                    variant="danger"
                    className="px-4"
                    onClick={() => moderate(c, 'reject')}
                    disabled={busy}
                  >
                    <X size={15} strokeWidth={1.75} aria-hidden />
                    رفض
                  </GlassButton>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ========================================================== TAB 4: import

function ImportTab({ arabicNumerals, stats, onStatsReload }: {
  arabicNumerals: boolean
  stats: AdminStats | null
  onStatsReload: () => void
}) {
  const [srcMode, setSrcMode] = useState<'path' | 'inline'>('path')
  const [path, setPath] = useState(`${RAW_DIR}/eggs.md`)
  const [inlineText, setInlineText] = useState('')
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown')
  const [dryState, setDryState] = useState<{ key: string; result: DryRunResult } | null>(null)
  const [appliedState, setAppliedState] = useState<{ key: string; result: ApplyResult } | null>(null)
  const [errState, setErrState] = useState<{ key: string; msg: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useFlash()

  // source fingerprint — any input/format change invalidates the previous dry-run/apply
  const srcKey = `${srcMode}|${format}|${srcMode === 'path' ? path.trim() : inlineText}`
  const dry = dryState?.key === srcKey ? dryState.result : null
  const applied = appliedState?.key === srcKey ? appliedState.result : null
  const error = errState?.key === srcKey ? errState.msg : null

  const canRun = srcMode === 'path' ? path.trim().length > 0 : inlineText.trim().length > 0

  const requestBody = (mode: 'dry' | 'apply'): Record<string, unknown> => ({
    mode,
    format,
    ...(srcMode === 'path'
      ? { path: path.trim(), source: path.trim() }
      : { inline: inlineText, source: 'محتوى ملصق' }),
  })

  const runDry = async () => {
    const key = srcKey
    setRunning(true)
    setErrState(null)
    setAppliedState(null)
    try {
      const r = await postJson<DryRunResult>('/api/admin/import', requestBody('dry'))
      setDryState({ key, result: r })
    } catch (e) {
      setErrState({ key, msg: errText(e) })
    } finally {
      setRunning(false)
    }
  }

  const runApply = async () => {
    const key = srcKey
    setRunning(true)
    setErrState(null)
    try {
      const r = await postJson<ApplyResult>('/api/admin/import', requestBody('apply'))
      setAppliedState({ key, result: r })
      setFlash(`طُبقت الدفعة: ${formatNumberAr(r.applied, arabicNumerals)} سجلاً`)
      onStatsReload()
    } catch (e) {
      setErrState({ key, msg: errText(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <FlashPill msg={flash} />

      <GlassCard className="p-4">
        <SectionTitle className="mb-3">مركز الاستيراد — معاينة قبل التطبيق</SectionTitle>

        {/* source mode picker */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSrcMode('path')}
            className={cn(
              'min-h-11 px-4 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2',
              srcMode === 'path' ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60',
            )}
            aria-pressed={srcMode === 'path'}
          >
            <FileText size={15} strokeWidth={1.75} aria-hidden /> مسار ملف محلي
          </button>
          <button
            onClick={() => setSrcMode('inline')}
            className={cn(
              'min-h-11 px-4 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2',
              srcMode === 'inline' ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60',
            )}
            aria-pressed={srcMode === 'inline'}
          >
            <ClipboardPaste size={15} strokeWidth={1.75} aria-hidden /> لصق محتوى
          </button>
        </div>

        {srcMode === 'path' ? (
          <>
            <Field label="مسار الملف على الخادم" hint="ملفات أرشيف قاعدة بيانات البحرين (43 ملف ماركداون في نفس المجلد)">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                dir="ltr"
                className={`${inputCls} font-mono text-xs`}
                aria-label="مسار الملف على الخادم"
              />
            </Field>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {QUICK_FILES.map((f) => {
                const full = `${RAW_DIR}/${f}`
                return (
                  <button
                    key={f}
                    onClick={() => setPath(full)}
                    className={cn(
                      'min-h-11 px-3 rounded-xl text-xs font-semibold transition-all',
                      path === full ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60',
                    )}
                    aria-pressed={path === full}
                  >
                    <span dir="ltr">{f}</span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <Field label="المحتوى (ماركداون أو JSON)">
            <textarea
              value={inlineText}
              onChange={(e) => setInlineText(e.target.value)}
              rows={8}
              dir="auto"
              placeholder="الصق جدول ماركداون أو كتالوج JSON هنا…"
              aria-label="المحتوى الملصق"
              className="glass-thin rounded-xl w-full p-3 text-xs font-mono min-h-32"
            />
          </Field>
        )}

        {/* format + run */}
        <div className="flex flex-wrap items-end gap-2 mt-4">
          <div className="w-44">
            <Field label="الصيغة">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'markdown' | 'json')}
                className={inputCls}
                aria-label="صيغة الاستيراد"
              >
                <option value="markdown">ماركداون (أرشيف)</option>
                <option value="json">JSON (كتالوج مُعد)</option>
              </select>
            </Field>
          </div>
          <GlassButton variant="primary" className="px-5" onClick={runDry} disabled={running || !canRun}>
            {running ? <Spinner className="w-4 h-4" /> : <Search size={15} strokeWidth={1.75} aria-hidden />}
            تشغيل تجريبي (dry-run)
          </GlassButton>
          <GlassButton
            className="px-5"
            onClick={runApply}
            disabled={running || !dry || !!applied}
            title={!dry ? 'شغّل التجربة أولاً لمعاينة الفروقات' : applied ? 'تم تطبيق هذه الدفعة' : undefined}
          >
            <Upload size={15} strokeWidth={1.75} aria-hidden /> تطبيق
          </GlassButton>
        </div>
        {!dry && !applied ? (
          <p className="text-[11px] text-muted-foreground mt-2">
            شغّل التشغيل التجريبي أولاً — يعرض الصفوف المقروءة والإضافات وتغيّرات الأسعار قبل كتابة أي شيء.
          </p>
        ) : null}
      </GlassCard>

      {error ? <ErrorNote message={error} onRetry={runDry} /> : null}

      {applied ? (
        <GlassCard className="p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Pill tone="primary" className="text-sm py-1 px-3">
              <Check size={14} strokeWidth={1.75} aria-hidden /> طُبقت الدفعة
            </Pill>
            <span className="text-sm font-bold tabular-nums">
              {formatNumberAr(applied.applied, arabicNumerals)} سجلاً كُتب في طبقة التعديلات
            </span>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed">
            <ShieldCheck size={13} strokeWidth={1.75} aria-hidden className="shrink-0 mt-0.5 text-primary" />
            التعديلات اليدوية محفوظة (لا تُكتب فوقها) — الصفوف المعلّمة كتعديل بشري تُتخطى عند الاستيراد.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <StatTile label="صفوف مقروءة" value={formatNumberAr(applied.stats.read ?? 0, arabicNumerals)} />
            <StatTile label="إضافات" value={formatNumberAr(applied.stats.added ?? 0, arabicNumerals)} tone="primary" />
            <StatTile label="تغيّرات" value={formatNumberAr(applied.stats.changed ?? 0, arabicNumerals)} tone="accent" />
            <StatTile label="غير موجودة" value={formatNumberAr(applied.stats.missing ?? 0, arabicNumerals)} />
          </div>
        </GlassCard>
      ) : null}

      {dry ? <DryRunPanel dry={dry} arabicNumerals={arabicNumerals} /> : null}

      {/* history (same data as tab 1, small) */}
      <section aria-label="سجل الاستيراد">
        <div className="flex items-center gap-2 mb-2">
          <HistoryIcon size={16} strokeWidth={1.75} aria-hidden className="text-muted-foreground" />
          <span className="text-sm font-bold">آخر دفعات الاستيراد</span>
        </div>
        {stats && stats.imports.length > 0 ? (
          <div className="space-y-2 max-h-60 overflow-y-auto nice-scroll p-0.5">
            {stats.imports.map((imp) => (
              <ImportRow key={imp.id} imp={imp} arabicNumerals={arabicNumerals} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">لا سجل استيراد بعد</p>
        )}
      </section>
    </div>
  )
}

function DryRunPanel({ dry, arabicNumerals }: { dry: DryRunResult; arabicNumerals: boolean }) {
  const s = dry.stats
  const added = dry.preview.added
  const changed = dry.preview.changed
  const missing = dry.preview.missing
  const truncated = (count: number, list: unknown[]) => count > list.length

  return (
    <GlassCard className="p-4">
      <SectionTitle className="mb-2">نتيجة التشغيل التجريبي</SectionTitle>
      <div className="flex flex-wrap gap-2 mb-4">
        <StatTile label="صفوف مقروءة" value={formatNumberAr(s.read ?? 0, arabicNumerals)} />
        <StatTile label="إضافات جديدة" value={formatNumberAr(s.added ?? 0, arabicNumerals)} tone="primary" />
        <StatTile label="تغيّرات أسعار" value={formatNumberAr(s.changed ?? 0, arabicNumerals)} tone="accent" />
        <StatTile label="غير موجودة بالمصدر" value={formatNumberAr(s.missing ?? 0, arabicNumerals)} />
      </div>

      {(s.warnings ?? []).length > 0 ? (
        <div className="mb-4">
          <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1.5">
            <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
            تحذيرات ({formatNumberAr((s.warnings ?? []).length, arabicNumerals)})
          </div>
          <ul className="max-h-40 overflow-y-auto nice-scroll glass-ultrathin rounded-xl p-2.5 text-[11px] text-muted-foreground space-y-1">
            {(s.warnings ?? []).map((w, i) => (
              <li key={i} className="break-words leading-relaxed" dir="auto">{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-4">
        <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
          منتجات ستُضاف ({formatNumberAr(added.length, arabicNumerals)})
        </h4>
        {added.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا إضافات جديدة — كل الصفوف موجودة مسبقاً</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto nice-scroll space-y-1">
            {added.map((a) => (
              <li key={a.id} className="glass-row rounded-lg px-2.5 py-2 flex items-center gap-2 text-sm">
                <span className="text-primary shrink-0"><CategoryIcon category={a.category ?? ''} size={14} /></span>
                <span className="flex-1 min-w-0 truncate" dir="auto" title={a.nameAr}>{a.nameAr}</span>
                {a.medianFils ? (
                  <span className="text-xs font-bold tabular-nums shrink-0">{formatBHD(a.medianFils, { arabicNumerals })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {truncated(s.added ?? 0, added) ? (
          <p className="text-[11px] text-muted-foreground mt-1.5">تُعرض أول {formatNumberAr(added.length, arabicNumerals)} فقط</p>
        ) : null}
      </div>

      <div className="mb-4">
        <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
          تغيّرات الأسعار ({formatNumberAr(changed.length, arabicNumerals)})
        </h4>
        {changed.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا تغيّرات أسعار</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto nice-scroll space-y-1">
            {changed.map((ch) => {
              const up = ch.to > ch.from
              return (
                <li key={ch.id} className="glass-row rounded-lg px-2.5 py-2 flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate" dir="auto" title={ch.nameAr}>{ch.nameAr}</span>
                  <span className="flex items-center gap-1 text-xs tabular-nums shrink-0" dir="ltr">
                    <span className="text-muted-foreground">{fmtBHD(ch.from)}</span>
                    <ArrowRight size={12} strokeWidth={1.75} aria-hidden className="text-muted-foreground" />
                    <span className="font-bold">{fmtBHD(ch.to)}</span>
                  </span>
                  <Pill tone={up ? 'danger' : 'primary'} className="shrink-0">
                    {up ? 'زيادة +' : 'توفير −'}{formatBHD(Math.abs(ch.to - ch.from), { arabicNumerals, withUnit: false })}
                  </Pill>
                </li>
              )
            })}
          </ul>
        )}
        {truncated(s.changed ?? 0, changed) ? (
          <p className="text-[11px] text-muted-foreground mt-1.5">تُعرض أول {formatNumberAr(changed.length, arabicNumerals)} فقط</p>
        ) : null}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
          موجودة بالكتالوج وغير موجودة في المصدر ({formatNumberAr(missing.length, arabicNumerals)})
        </h4>
        {missing.length === 0 ? (
          <p className="text-xs text-muted-foreground">كل منتجات الكتالوج موجودة في المصدر</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {missing.map((m) => <Pill key={m.id}>{m.nameAr}</Pill>)}
          </div>
        )}
        {truncated(s.missing ?? 0, missing) ? (
          <p className="text-[11px] text-muted-foreground mt-1.5">تُعرض أول {formatNumberAr(missing.length, arabicNumerals)} فقط — لا تُحذف عند التطبيق</p>
        ) : null}
      </div>
    </GlassCard>
  )
}

// ============================================================ TAB 5: audit

function AuditChangeSummary({ before, after, arabicNumerals }: {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  arabicNumerals: boolean
}) {
  const rows: { label: string; from: ReactNode; to: ReactNode }[] = []
  const nameOf = (d: Record<string, unknown> | null) => {
    const n = typeof d?.nameAr === 'string' && d.nameAr ? d.nameAr : typeof d?.nameEn === 'string' && d.nameEn ? d.nameEn : null
    return n
  }
  const bName = nameOf(before)
  const aName = nameOf(after)
  if (aName && aName !== bName) {
    rows.push({ label: 'الاسم', from: bName ?? '—', to: aName })
  }
  const bMed = typeof before?.medianFils === 'number' ? before.medianFils : null
  const aMed = typeof after?.medianFils === 'number' ? after.medianFils : null
  if (aMed != null && aMed !== bMed) {
    rows.push({
      label: 'السعر الوسيط',
      from: bMed != null ? formatBHD(bMed, { arabicNumerals }) : '—',
      to: formatBHD(aMed, { arabicNumerals }),
    })
  }
  if (after?.deleted && !before?.deleted) {
    rows.push({ label: 'الحالة', from: 'فعّال', to: 'محذوف (قابل للاستعادة)' })
  }

  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        {after
          ? `${formatNumberAr(Object.keys(after).length, arabicNumerals)} حقلاً في طبقة التعديل`
          : 'لا تفاصيل مسجّلة'}
      </div>
    )
  }

  return (
    <div className="grid sm:grid-cols-2 gap-1.5 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="glass-ultrathin rounded-lg px-2.5 py-1.5 flex items-center gap-2 min-w-0">
          <span className="text-muted-foreground shrink-0">{r.label}:</span>
          <span className="truncate" dir="auto">{r.from}</span>
          <ChevronLeft size={12} strokeWidth={1.75} aria-hidden className="text-muted-foreground shrink-0" />
          <span className="font-semibold truncate" dir="auto">{r.to}</span>
        </div>
      ))}
    </div>
  )
}

function AuditTab({ arabicNumerals }: { arabicNumerals: boolean }) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useFlash()

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api<{ items: AuditItem[] }>('/api/admin/audit?limit=50')
      .then((r) => { if (!cancelled) setItems(r.items) })
      .catch((e) => { if (!cancelled) setError(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const rollback = async (e: AuditItem) => {
    setBusyId(e.id)
    try {
      await postJson('/api/admin/audit', { id: e.id })
      setFlash('تم التراجع عن العملية واستعادة الحالة السابقة')
      reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusyId(null)
    }
  }

  if (loading && items.length === 0) return <SkeletonRows rows={6} />

  return (
    <div className="space-y-4">
      <FlashPill msg={flash} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionTitle className="mb-0">
          أحدث {formatNumberAr(items.length, arabicNumerals)} عملية
        </SectionTitle>
        <GlassButton size="md" className="px-4" onClick={reload} disabled={loading}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> تحديث
        </GlassButton>
      </div>

      {error ? <ErrorNote message={error} onRetry={reload} /> : null}

      {items.length === 0 && !error ? (
        <EmptyState
          icon={<ScrollText size={22} strokeWidth={1.75} aria-hidden />}
          title="لا سجلات بعد"
          subtitle="تُسجّل هنا كل عمليات الإنشاء والتعديل والحذف والمراجعة مع إمكانية التراجع"
        />
      ) : (
        <div className="space-y-2 max-h-[75vh] overflow-y-auto nice-scroll p-0.5">
          {items.map((e) => {
            const meta = ACTION_META[e.action] ?? { label: e.action, tone: 'default' as const }
            const busy = busyId === e.id
            const canRollback = !e.revertedAt && e.targetType === 'product'
            return (
              <GlassRow key={e.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                  <span className="text-xs text-muted-foreground" dir="auto" title={e.actor}>{e.actor}</span>
                  <span className="text-[11px] text-muted-foreground font-mono truncate" dir="ltr" title={e.targetId}>
                    {TARGET_LABELS[e.targetType] ?? e.targetType} · {shortId(e.targetId)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{formatDateAr(e.createdAt)}</span>
                  {e.revertedAt ? <Pill tone="warn">تم التراجع</Pill> : null}
                  {!e.revertedAt ? (
                    <span className="ms-auto">
                      <GlassButton
                        size="md"
                        className="px-3 text-xs"
                        onClick={() => rollback(e)}
                        disabled={busy || !canRollback}
                        title={!canRollback ? 'التراجع مدعوم لعمليات المنتجات فقط' : undefined}
                      >
                        {busy ? <Spinner className="w-4 h-4" /> : <Undo2 size={14} strokeWidth={1.75} aria-hidden />}
                        تراجع
                      </GlassButton>
                    </span>
                  ) : null}
                </div>
                <AuditChangeSummary before={e.before} after={e.after} arabicNumerals={arabicNumerals} />
              </GlassRow>
            )
          })}
        </div>
      )}
    </div>
  )
}
