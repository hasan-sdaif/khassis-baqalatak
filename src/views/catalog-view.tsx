'use client'
/**
 * Catalog view (spec: browse/search experience): sticky server-side search
 * (Arabic + English, normalized on the server), category chips strip, filter
 * row (sort / store / price range), and a paginated responsive results grid.
 * Long lists use solid glass rows for performance (spec 10.2-2).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta, searchProducts, type CatalogMeta } from '@/lib/api-client'
import { formatBHD, formatNumberAr, parseBHDToFils, unitLabelAr } from '@/lib/money'
import type { CatalogProduct } from '@/lib/engine/types'
import { EmptyState, GlassButton, GlassCard, Pill, SkeletonRows, Spinner } from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import {
  ArrowUpDown, ChevronDown, CloudOff, PackageSearch, RotateCcw, Search,
  SlidersHorizontal, Store as StoreIcon, X,
} from 'lucide-react'

const PAGE = 30

/** GlassButton has no `disabled` prop — use this for visual + a11y disabled state */
const BTN_DISABLED = 'opacity-50 pointer-events-none'

type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'unit-asc' | 'popularity'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'الأنسب' },
  { value: 'price-asc', label: 'الأرخص' },
  { value: 'price-desc', label: 'الأغلى' },
  { value: 'unit-asc', label: 'الأوفر للوحدة' },
  { value: 'popularity', label: 'الأشهر' },
]

/** unit price text like "0.550 د.ب/لتر" — unitPriceFils is fils per liter (ml) / kg (g) / piece */
function unitPriceText(p: CatalogProduct, arabicNumerals: boolean): string | null {
  if (p.unitPriceFils == null || p.unitPriceFils <= 0) return null
  const per = p.size?.unit === 'ml' ? 'لتر' : p.size?.unit === 'g' ? 'كجم' : unitLabelAr(p.size?.unit ?? 'pcs')
  return `${formatBHD(p.unitPriceFils, { arabicNumerals, withUnit: false })} د.ب/${per}`
}

function productWord(n: number): string {
  if (n === 1) return 'منتج واحد'
  if (n === 2) return 'منتجان'
  if (n >= 3 && n <= 10) return 'منتجات'
  return 'منتجاً'
}

function storesCountText(n: number, arabicNumerals: boolean): string {
  if (n === 1) return 'متوفر في متجر واحد'
  if (n === 2) return 'متوفر في متجرين'
  const num = formatNumberAr(n, arabicNumerals)
  return n <= 10 ? `متوفر في ${num} متاجر` : `متوفر في ${num} متجراً`
}

/** one result card — solid glass row, keyboard-focusable button */
function ProductCard({ p, arabicNumerals }: { p: CatalogProduct; arabicNumerals: boolean }) {
  const name = p.nameAr || p.nameEn
  const unitText = unitPriceText(p, arabicNumerals)
  return (
    <button
      type="button"
      onClick={() => navigate({ name: 'product', id: p.id })}
      className="glass-row rounded-xl p-3 flex items-start gap-3 text-start transition-colors hover:bg-secondary/50"
      aria-label={`${name} — ${formatBHD(p.medianFils, { arabicNumerals })}`}
    >
      <span className="w-11 h-11 rounded-xl glass-ultrathin grid place-items-center shrink-0 text-primary" aria-hidden>
        <CategoryIcon category={p.category} size={20} />
      </span>
      <span className="flex-1 min-w-0 block">
        <span className="block text-sm font-semibold leading-snug line-clamp-2" dir="auto">{name}</span>
        {(p.brand || p.sizeText) && (
          <span className="block text-xs text-muted-foreground mt-0.5 truncate" dir="auto">
            {[p.brand, p.sizeText].filter(Boolean).join(' · ')}
          </span>
        )}
        <span className="block text-base font-bold tabular-nums mt-1.5">{formatBHD(p.medianFils, { arabicNumerals })}</span>
        {unitText && (
          <span className="block text-[11px] text-muted-foreground tabular-nums mt-0.5">{unitText}</span>
        )}
        {p.minFils > 0 && p.maxFils > p.minFils && (
          <span className="block text-[11px] text-muted-foreground tabular-nums mt-0.5">
            {formatBHD(p.minFils, { arabicNumerals, withUnit: false })} – {formatBHD(p.maxFils, { arabicNumerals, withUnit: false })}
          </span>
        )}
        <span className="block mt-1.5">
          <Pill>{storesCountText(p.storesCount, arabicNumerals)}</Pill>
        </span>
      </span>
    </button>
  )
}

export function CatalogView({ category }: { category?: string }) {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)

  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [qInput, setQInput] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | undefined>(category)
  const [sort, setSort] = useState<SortKey>('relevance')
  const [store, setStore] = useState<string | undefined>(undefined)
  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')

  const [items, setItems] = useState<CatalogProduct[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const seq = useRef(0)

  // sync route-provided category (e.g. #/catalog/milk)
  useEffect(() => { setActiveCategory(category) }, [category])

  // catalog meta once (categories, stores)
  useEffect(() => {
    let cancelled = false
    fetchCatalogMeta().then((m) => { if (!cancelled) setMeta(m) }).catch(() => { /* chips stay hidden */ })
    return () => { cancelled = true }
  }, [])

  const filterParams = useMemo(() => {
    const minF = minInput.trim() ? parseBHDToFils(minInput) : 0
    const maxF = maxInput.trim() ? parseBHDToFils(maxInput) : 0
    return {
      q: qInput.trim() || undefined,
      category: activeCategory,
      sort,
      store,
      minFils: minF > 0 ? minF : undefined,
      maxFils: maxF > 0 ? maxF : undefined,
    }
  }, [qInput, activeCategory, sort, store, minInput, maxInput])

  // debounced server search (covers query typing + filter changes)
  useEffect(() => {
    const mySeq = ++seq.current
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      setMoreError(null)
      searchProducts({ ...filterParams, limit: PAGE, offset: 0 })
        .then((r) => {
          if (!cancelled && seq.current === mySeq) {
            setItems(r.items)
            setTotal(r.total)
          }
        })
        .catch((e) => {
          if (!cancelled && seq.current === mySeq) setError(String((e as Error).message ?? e))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [filterParams, retry])

  const hasMore = items.length < total

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return
    const mySeq = ++seq.current
    setLoadingMore(true)
    setMoreError(null)
    searchProducts({ ...filterParams, limit: PAGE, offset: items.length })
      .then((r) => {
        if (seq.current === mySeq) {
          setItems((prev) => [...prev, ...r.items])
          setTotal(r.total)
        }
      })
      .catch((e) => {
        if (seq.current === mySeq) setMoreError(String((e as Error).message ?? e))
      })
      .finally(() => { setLoadingMore(false) })
  }

  const clearFilters = () => {
    setQInput('')
    setStore(undefined)
    setMinInput('')
    setMaxInput('')
    setSort('relevance')
    setActiveCategory(undefined)
  }

  const filtersActive = Boolean(
    qInput.trim() || store || minInput.trim() || maxInput.trim() || activeCategory || sort !== 'relevance',
  )

  const trimmedQ = qInput.trim()
  const countText = trimmedQ
    ? `نتائج «${trimmedQ}»: ${formatNumberAr(total, arabicNumerals)} ${productWord(total)}`
    : `${formatNumberAr(total, arabicNumerals)} ${productWord(total)}`

  const catMeta = useMemo(
    () => (activeCategory ? meta?.categories.find((c) => c.id === activeCategory) : undefined),
    [meta, activeCategory],
  )

  const storeChips = useMemo(() => {
    const all = meta?.stores ?? []
    const active = all.filter((s) => s.active)
    return (active.length >= 4 ? active : all).slice(0, 8)
  }, [meta])

  return (
    <div className="space-y-4 pb-8">
      {/* sticky search + live result count */}
      <div className="sticky top-[60px] md:top-[48px] z-10 -mx-2 px-2 pt-2 pb-2 bg-background/85 backdrop-blur-md rounded-b-2xl no-print">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
          <Search size={17} strokeWidth={1.75} aria-hidden className="absolute start-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            dir="auto"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="ابحث عن منتج… حليب، أرز، حفاضات"
            aria-label="البحث في الكتالوج"
            className="glass-thin w-full min-h-12 rounded-2xl ps-10 pe-12 py-3 text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {qInput !== '' && (
            <button
              type="button"
              onClick={() => setQInput('')}
              aria-label="مسح نص البحث"
              className="absolute end-1.5 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground"
            >
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </form>
        <p className="text-[11px] text-muted-foreground mt-1.5 px-1 tabular-nums" aria-live="polite">
          {loading ? (items.length === 0 ? 'جارٍ البحث…' : 'جارٍ التحديث…') : countText}
        </p>
      </div>

      {/* category chips strip */}
      <nav aria-label="فئات الكتالوج" className="flex gap-2 overflow-x-auto nice-scroll pb-1.5 -mx-1 px-1">
        <button
          type="button"
          onClick={() => setActiveCategory(undefined)}
          aria-pressed={!activeCategory}
          className={`min-h-11 shrink-0 inline-flex items-center gap-1.5 px-4 rounded-full text-sm font-medium transition-all ${
            !activeCategory ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60'
          }`}
        >
          الكل
        </button>
        {meta
          ? meta.categories.map((c) => {
              const active = activeCategory === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(active ? undefined : c.id)}
                  aria-pressed={active}
                  className={`min-h-11 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-full text-sm font-medium transition-all ${
                    active ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60'
                  }`}
                >
                  <CategoryIcon category={c.id} size={15} />
                  {c.nameAr}
                </button>
              )
            })
          : Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className="glass-thin h-11 w-24 shrink-0 rounded-full animate-pulse opacity-60" aria-hidden />
            ))}
      </nav>

      {/* filter row */}
      <GlassCard className="p-3.5" role="group" aria-label="مرشحات البحث">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[170px]">
            <label htmlFor="catalog-sort" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
              <ArrowUpDown size={13} strokeWidth={1.75} aria-hidden /> الترتيب
            </label>
            <div className="relative">
              <select
                id="catalog-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="glass-thin w-full min-h-11 rounded-xl ps-3 pe-9 text-sm font-medium appearance-none cursor-pointer"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
            </div>
          </div>
          <div>
            <label htmlFor="catalog-price-min" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
              <SlidersHorizontal size={13} strokeWidth={1.75} aria-hidden /> نطاق السعر (د.ب)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="catalog-price-min"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                placeholder="من"
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                className="glass-thin min-h-11 rounded-xl px-3 w-24 text-sm tabular-nums"
              />
              <span className="text-muted-foreground text-sm" aria-hidden>—</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                placeholder="إلى"
                aria-label="الحد الأعلى للسعر بالدينار"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                className="glass-thin min-h-11 rounded-xl px-3 w-24 text-sm tabular-nums"
              />
            </div>
          </div>
          {filtersActive && (
            <GlassButton onClick={clearFilters} className="min-h-11">
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> مسح المرشحات
            </GlassButton>
          )}
        </div>
        {storeChips.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
              <StoreIcon size={13} strokeWidth={1.75} aria-hidden /> فلتر المتجر
            </div>
            <div className="flex gap-2 overflow-x-auto nice-scroll pb-1 -mx-1 px-1">
              {storeChips.map((s) => {
                const active = store === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStore(active ? undefined : s.id)}
                    aria-pressed={active}
                    className={`min-h-11 shrink-0 inline-flex items-center px-3.5 rounded-full text-sm font-medium transition-all ${
                      active ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60'
                    }`}
                  >
                    {s.nameAr}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </GlassCard>

      {/* category heading (when a category is selected) */}
      {activeCategory && (
        <div className="flex items-center gap-2.5 pt-1">
          <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0" aria-hidden>
            <CategoryIcon category={activeCategory} size={20} />
          </span>
          <h1 className="text-xl font-extrabold tracking-tight leading-tight">
            {catMeta?.nameAr ?? 'الفئة'}
          </h1>
        </div>
      )}

      {/* results */}
      <section aria-label="النتائج" aria-busy={loading || loadingMore}>
        {loading && items.length === 0 ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <EmptyState
            icon={<CloudOff size={22} strokeWidth={1.75} aria-hidden />}
            title="تعذر تحميل النتائج"
            subtitle={`حدث خطأ أثناء البحث: ${error}`}
            action={<GlassButton variant="primary" onClick={() => setRetry((r) => r + 1)}>إعادة المحاولة</GlassButton>}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PackageSearch size={22} strokeWidth={1.75} aria-hidden />}
            title="لا توجد نتائج مطابقة"
            subtitle="جرّب كلمة بحث أخرى، أو وسّع نطاق السعر، أو أمسح المرشحات وابدأ من جديد."
            action={filtersActive ? (
              <GlassButton variant="primary" onClick={clearFilters}>
                <RotateCcw size={15} strokeWidth={1.75} aria-hidden /> أمسح المرشحات
              </GlassButton>
            ) : undefined}
          />
        ) : (
          <>
            <div className={`grid gap-3 grid-cols-1 min-[700px]:grid-cols-2 min-[1180px]:grid-cols-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {items.map((p) => (
                <ProductCard key={p.id} p={p} arabicNumerals={arabicNumerals} />
              ))}
            </div>
            {moreError && (
              <p className="text-sm text-destructive text-center mt-3" role="alert">تعذر تحميل المزيد: {moreError}</p>
            )}
            {hasMore ? (
              <div className="flex flex-col items-center gap-2 pt-2">
                <GlassButton
                  onClick={loadMore}
                  className={`min-w-44 ${loadingMore || loading ? BTN_DISABLED : ''}`}
                  aria-disabled={loadingMore || loading || undefined}
                >
                  {loadingMore ? <Spinner className="w-4 h-4" /> : <ChevronDown size={16} strokeWidth={1.75} aria-hidden />}
                  {loadingMore ? 'جارٍ التحميل…' : 'عرض المزيد'}
                </GlassButton>
                <p className="text-xs text-muted-foreground tabular-nums">
                  عرض {formatNumberAr(items.length, arabicNumerals)} من أصل {formatNumberAr(total, arabicNumerals)} {productWord(total)}
                </p>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground tabular-nums pt-2">
                عرضت كل النتائج ({formatNumberAr(total, arabicNumerals)} {productWord(total)})
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
