'use client'
/**
 * Product detail view (spec: product page): per-store live prices with
 * delivery meta, price stats, household sufficiency estimate ("كم يكفي
 * أسرتك؟"), similar products, plan lock, and community contribution dialogs
 * (name fix + price update).
 *
 * ProductView remounts its body per product id (key) so state resets cleanly;
 * dialogs mount only while open (fresh state each time, no reset effects).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta, fetchProduct, submitContribution, type CatalogMeta, type ProductDetails } from '@/lib/api-client'
import { formatBHD, formatNumberAr, formatQty, parseBHDToFils, toArabicDigits, unitLabelAr } from '@/lib/money'
import { NEEDS_MAP, adultEquivalent } from '@/lib/engine'
import type { CatalogProduct, ParsedSize } from '@/lib/engine/types'
import {
  EmptyState, GlassButton, GlassCard, GlassRow, Pill, SectionTitle, SkeletonRows, Spinner, StatTile,
} from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import {
  BadgePercent, Check, ChevronDown, ChevronLeft, ExternalLink, Info, PackageX, PenLine, Plus,
  Store as StoreIcon, Users, X,
} from 'lucide-react'

/** unit price text like "0.550 د.ب/لتر" — unitPriceFils is fils per liter (ml) / kg (g) / piece */
function unitPriceText(p: CatalogProduct, arabicNumerals: boolean): string | null {
  if (p.unitPriceFils == null || p.unitPriceFils <= 0) return null
  const per = p.size?.unit === 'ml' ? 'لتر' : p.size?.unit === 'g' ? 'كجم' : unitLabelAr(p.size?.unit ?? 'pcs')
  return `${formatBHD(p.unitPriceFils, { arabicNumerals, withUnit: false })} د.ب/${per}`
}

/** GlassButton has no `disabled` prop — use this for visual + a11y disabled state */
const BTN_DISABLED = 'opacity-50 pointer-events-none'

/** parsed size explanation: "1.5 لتر (6 × 250 مل)" */
function sizeExplanation(size: ParsedSize, arabicNumerals: boolean): string {
  let text = formatQty(size.unit, size.baseQuantity)
  if (size.packCount > 1) text = `${text} (${size.packCount} × ${formatQty(size.unit, size.unitSize)})`
  return arabicNumerals ? toArabicDigits(text) : text
}

function daysWord(n: number): string {
  if (n === 1) return 'يوم'
  if (n === 2) return 'يومان'
  if (n <= 10) return 'أيام'
  return 'يوماً'
}

function storeWord(n: number): string {
  if (n === 1) return 'متجر واحد'
  if (n === 2) return 'متجرين'
  if (n <= 10) return 'متاجر'
  return 'متجراً'
}

/** lightweight accessible glass modal (esc to close, backdrop click) — mount only while open */
function GlassModal({ onClose, title, children }: { onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 no-print" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative glass rounded-2xl p-5 w-full max-w-md pop-in">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="w-11 h-11 grid place-items-center rounded-full hover:bg-secondary/60 transition-colors shrink-0"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SuccessBody({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="text-center py-2">
      <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/15 text-primary grid place-items-center" aria-hidden>
        <Check size={22} strokeWidth={1.75} />
      </span>
      <p className="font-bold mb-1">تم الإرسال بنجاح</p>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{text}</p>
      <GlassButton variant="primary" onClick={onClose}>تم</GlassButton>
    </div>
  )
}

/** "اقترح تعديلاً" dialog — free-text note contribution */
function SuggestDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const sendingRef = useRef(false)

  const submit = async () => {
    if (!note.trim() || sendingRef.current) return
    sendingRef.current = true
    setState('sending')
    try {
      await submitContribution({ kind: 'name-fix', productId, payload: { note: note.trim() } })
      setState('done')
    } catch {
      setState('error')
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <GlassModal onClose={onClose} title="اقترح تعديلاً على بيانات المنتج">
      {state === 'done' ? (
        <SuccessBody
          text="شكراً لك! وصلت ملاحظتك، وستُراجع مع مساهمات المجتمع قبل اعتمادها في قاعدة البيانات المفتوحة."
          onClose={onClose}
        />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            لاحظت خطأً في الاسم أو الحجم أو التصنيف؟ صف التعديل الصحيح بكلماتك.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: الاسم الصحيح «حليب طويل الأجل قليل الدسم»، والحجم 1 لتر لا 1.5 لتر…"
            rows={4}
            maxLength={500}
            dir="auto"
            aria-label="نص الاقتراح"
            className="glass-thin w-full min-h-24 rounded-xl p-3 text-sm leading-relaxed resize-y"
          />
          {state === 'error' && (
            <p className="text-sm text-destructive" role="alert">تعذر إرسال الاقتراح — حاول مرة أخرى.</p>
          )}
          <div className="flex justify-end gap-2">
            <GlassButton onClick={(e) => { e.preventDefault(); onClose() }}>إلغاء</GlassButton>
            <GlassButton
              variant="primary"
              className={!note.trim() || state === 'sending' ? BTN_DISABLED : ''}
              aria-disabled={!note.trim() || state === 'sending' || undefined}
            >
              {state === 'sending' ? <Spinner className="w-4 h-4" /> : <PenLine size={15} strokeWidth={1.75} aria-hidden />}
              إرسال الاقتراح
            </GlassButton>
          </div>
        </form>
      )}
    </GlassModal>
  )
}

interface ReportStoreOption {
  storeId: string
  storeNameAr: string
}

/** "بلّغ عن سعر" dialog — store select + price input contribution */
function PriceReportDialog({ productId, stores, arabicNumerals, onClose }: {
  productId: string
  stores: ReportStoreOption[]
  arabicNumerals: boolean
  onClose: () => void
}) {
  const [storeId, setStoreId] = useState(() => stores[0]?.storeId ?? '')
  const [priceInput, setPriceInput] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const sendingRef = useRef(false)

  const fils = parseBHDToFils(priceInput)
  const valid = Boolean(storeId) && fils > 0

  const submit = async () => {
    if (!valid || sendingRef.current) return
    sendingRef.current = true
    setState('sending')
    try {
      await submitContribution({ kind: 'price-update', productId, payload: { store: storeId, fils } })
      setState('done')
    } catch {
      setState('error')
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <GlassModal onClose={onClose} title="بلّغ عن سعر مختلف">
      {state === 'done' ? (
        <SuccessBody
          text="شكراً لك! وصل بلاغك بالسعر، وسيُقارن بالسعر المسجل ويُحدَّث عند التصديق من المجتمع."
          onClose={onClose}
        />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            شاهدت سعراً مختلفاً عن المسجل؟ حدد المتجر والسعر الذي رأيته.
          </p>
          <div>
            <label htmlFor="report-store" className="block text-xs font-semibold text-muted-foreground mb-1.5">المتجر</label>
            <div className="relative">
              <select
                id="report-store"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="glass-thin w-full min-h-11 rounded-xl ps-3 pe-9 text-sm font-medium appearance-none cursor-pointer"
              >
                {stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>{s.storeNameAr}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
            </div>
          </div>
          <div>
            <label htmlFor="report-price" className="block text-xs font-semibold text-muted-foreground mb-1.5">
              السعر الذي رأيته (دينار بحريني)
            </label>
            <input
              id="report-price"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.001}
              placeholder="0.000"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="glass-thin w-full min-h-11 rounded-xl px-3 text-sm tabular-nums"
            />
            {priceInput.trim() !== '' && fils > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                سيُبلَّغ عن سعر {formatBHD(fils, { arabicNumerals })} في المتجر المحدد.
              </p>
            )}
          </div>
          {state === 'error' && (
            <p className="text-sm text-destructive" role="alert">تعذر إرسال البلاغ — حاول مرة أخرى.</p>
          )}
          <div className="flex justify-end gap-2">
            <GlassButton onClick={(e) => { e.preventDefault(); onClose() }}>إلغاء</GlassButton>
            <GlassButton
              variant="primary"
              className={!valid || state === 'sending' ? BTN_DISABLED : ''}
              aria-disabled={!valid || state === 'sending' || undefined}
            >
              {state === 'sending' ? <Spinner className="w-4 h-4" /> : <BadgePercent size={15} strokeWidth={1.75} aria-hidden />}
              إرسال البلاغ
            </GlassButton>
          </div>
        </form>
      )}
    </GlassModal>
  )
}

/** similar-product mini card for the horizontal rail */
function SimilarCard({ p, arabicNumerals }: { p: CatalogProduct; arabicNumerals: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate({ name: 'product', id: p.id })}
      className="glass-row rounded-xl p-3 w-[176px] shrink-0 text-start transition-colors hover:bg-secondary/50 snap-start"
      aria-label={`${p.nameAr || p.nameEn} — ${formatBHD(p.medianFils, { arabicNumerals })}`}
    >
      <span className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg glass-ultrathin grid place-items-center text-primary shrink-0" aria-hidden>
          <CategoryIcon category={p.category} size={15} />
        </span>
        {p.brand && <span className="text-[11px] text-muted-foreground truncate" dir="auto">{p.brand}</span>}
      </span>
      <span className="block text-sm font-medium leading-snug line-clamp-2 min-h-10" dir="auto">{p.nameAr || p.nameEn}</span>
      {p.sizeText && <span className="block text-[11px] text-muted-foreground mt-1 truncate" dir="auto">{p.sizeText}</span>}
      <span className="block text-sm font-bold tabular-nums mt-1.5">{formatBHD(p.medianFils, { arabicNumerals })}</span>
    </button>
  )
}

export function ProductView({ id }: { id: string }) {
  // remount per product: fresh state, closed dialogs, reset scroll position
  return <ProductBody key={id} id={id} />
}

function ProductBody({ id }: { id: string }) {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const household = useApp((s) => s.household)
  const locks = useApp((s) => s.locks)
  const addLock = useApp((s) => s.addLock)

  const [data, setData] = useState<ProductDetails | null>(null)
  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchProduct(id)
      .then((r) => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, retry])

  // catalog meta once (category names + store delivery meta)
  useEffect(() => {
    let cancelled = false
    fetchCatalogMeta().then((m) => { if (!cancelled) setMeta(m) }).catch(() => { /* meta is optional garnish */ })
    return () => { cancelled = true }
  }, [])

  const retryFetch = () => {
    setFailed(false)
    setLoading(true)
    setRetry((r) => r + 1)
  }

  const p = data?.product ?? null
  const storeRows = useMemo(() => data?.prices ?? [], [data])
  const locked = useMemo(() => locks.some((l) => l.productId === id), [locks, id])
  const categoryName = useMemo(
    () => (p && meta ? meta.categories.find((c) => c.id === p.category)?.nameAr : undefined),
    [meta, p],
  )
  const storeMetaMap = useMemo(() => new Map((meta?.stores ?? []).map((s) => [s.id, s])), [meta])
  // store options for the price-report dialog: all catalog meta stores, with the
  // stores that actually carry this product sorted first (most likely sighting)
  const reportStoreOptions = useMemo<ReportStoreOption[]>(() => {
    if (meta && meta.stores.length > 0) {
      const active = meta.stores.filter((s) => s.active)
      const own = new Set(storeRows.map((r) => r.storeId))
      return (active.length > 0 ? active : meta.stores)
        .map((s) => ({ storeId: s.id, storeNameAr: s.nameAr }))
        .sort((a, b) => Number(own.has(b.storeId)) - Number(own.has(a.storeId)))
    }
    return storeRows.map((r) => ({ storeId: r.storeId, storeNameAr: r.storeNameAr }))
  }, [meta, storeRows])

  const deliveryLine = (storeId: string): string | null => {
    const s = storeMetaMap.get(storeId)
    if (!s) return null
    const parts: string[] = []
    if (s.deliveryFeeFils > 0) {
      let t = `توصيل ${formatBHD(s.deliveryFeeFils, { arabicNumerals })}`
      if (s.freeDeliveryThresholdFils) t += ` — مجاني فوق ${formatBHD(s.freeDeliveryThresholdFils, { arabicNumerals })}`
      parts.push(t)
    } else {
      parts.push('توصيل مجاني')
    }
    if (s.minOrderFils > 0) parts.push(`حد أدنى ${formatBHD(s.minOrderFils, { arabicNumerals })}`)
    if (s.deliveryTimeText) parts.push(s.deliveryTimeText)
    return parts.join(' · ')
  }

  // household sufficiency estimate ("كم يكفي أسرتك؟")
  const sufficiency = useMemo(() => {
    if (!p || !household || household.members.length === 0) return null
    if (!p.size || !p.need) return null
    const need = NEEDS_MAP.get(p.need)
    if (!need) return null
    const adultEq = household.members.reduce((sum, m) => sum + adultEquivalent(m), 0)
    if (need.adultMonthly <= 0 || adultEq <= 0) return { kind: 'habit' as const, needName: need.nameAr }
    const daily = (need.adultMonthly / 30) * adultEq
    const days = p.size.baseQuantity / daily
    return { kind: 'days' as const, need, adultEq, daily, days }
  }, [p, household])

  if (loading) {
    return (
      <div className="space-y-4 py-4" aria-busy="true">
        <div className="glass-row h-8 w-40 rounded-lg animate-pulse opacity-60" aria-hidden />
        <div className="glass-row h-10 w-3/4 rounded-xl animate-pulse opacity-60" aria-hidden />
        <div className="glass-row h-5 w-1/2 rounded-lg animate-pulse opacity-60" aria-hidden />
        <div className="flex gap-2">
          <div className="glass-row h-20 rounded-xl flex-1 animate-pulse opacity-60" aria-hidden />
          <div className="glass-row h-20 rounded-xl flex-1 animate-pulse opacity-60" aria-hidden />
        </div>
        <SkeletonRows rows={5} />
      </div>
    )
  }

  if (failed || !data || !p) {
    return (
      <EmptyState
        icon={<PackageX size={22} strokeWidth={1.75} aria-hidden />}
        title="لم نجد هذا المنتج"
        subtitle="قد يكون الرابط قديماً أو المنتج محذوفاً من الكتالوج. يمكنك تصفح الكتالوج أو إعادة المحاولة."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <GlassButton variant="primary" onClick={() => navigate({ name: 'catalog' })}>
              <StoreIcon size={15} strokeWidth={1.75} aria-hidden /> تصفح الكتالوج
            </GlassButton>
            <GlassButton onClick={retryFetch}>إعادة المحاولة</GlassButton>
          </div>
        }
      />
    )
  }

  const unitText = unitPriceText(p, arabicNumerals)
  const sizeExpl = p.size ? sizeExplanation(p.size, arabicNumerals) : null
  const name = p.nameAr || p.nameEn
  const cheapest = storeRows[0]
  const priciest = storeRows.length > 1 ? storeRows[storeRows.length - 1] : undefined

  const daysText = sufficiency?.kind === 'days'
    ? (sufficiency.days < 1
        ? 'أقل من يوم واحد'
        : `≈ ${formatNumberAr(Math.max(1, Math.round(sufficiency.days)), arabicNumerals)} ${daysWord(Math.round(sufficiency.days))}`)
    : null
  const dailyText = sufficiency?.kind === 'days'
    ? `${arabicNumerals ? toArabicDigits(formatQty(sufficiency.need.baseUnit, sufficiency.daily)) : formatQty(sufficiency.need.baseUnit, sufficiency.daily)}/يوم`
    : null

  return (
    <div className="space-y-7 pb-8">
      {/* 1. header */}
      <section className="pt-2">
        <button
          type="button"
          onClick={() => navigate({ name: 'catalog', category: p.category })}
          className="inline-flex items-center gap-1.5 min-h-11 px-3 -mx-2 rounded-full text-xs font-semibold text-muted-foreground hover:bg-secondary/50 transition-colors"
        >
          <CategoryIcon category={p.category} size={14} />
          {categoryName ?? 'الكتالوج'}
          <ChevronLeft size={13} strokeWidth={1.75} className="flip-x" aria-hidden />
        </button>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug mt-1.5" dir="auto">{name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-sm text-muted-foreground">
          {p.brand && <span dir="auto" className="font-medium text-foreground/80">{p.brand}</span>}
          {p.sizeText && <span dir="auto">{p.sizeText}</span>}
        </div>
        {sizeExpl && (
          <p className="text-sm mt-2 flex items-center gap-1.5 text-muted-foreground">
            <Info size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-primary" />
            <span>
              الحجم المفهوم: <span className="font-semibold text-foreground tabular-nums">{sizeExpl}</span>
            </span>
          </p>
        )}
        {p.flavors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {p.flavors.slice(0, 6).map((f) => (
              <Pill key={f}><span dir="auto">{f}</span></Pill>
            ))}
          </div>
        )}
      </section>

      {/* 2. store prices table */}
      <section aria-label="أسعار المتاجر">
        <SectionTitle>
          الأسعار في {formatNumberAr(storeRows.length, arabicNumerals)} {storeWord(storeRows.length)}
        </SectionTitle>
        {storeRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد أسعار مسجلة لهذا المنتج بعد — يمكنك المساهمة ببلاغ سعر.</p>
        ) : (
          <div className="space-y-2">
            {storeRows.map((row, i) => {
              const isCheapest = i === 0 && storeRows.length > 1
              const hasPromo = row.origFils != null && row.origFils > row.fils
              const dLine = deliveryLine(row.storeId)
              return (
                <GlassRow key={row.storeId} className={`p-3 flex items-center gap-3 ${isCheapest ? 'bg-primary/10 border-primary/30' : ''}`}>
                  <span
                    className={`w-10 h-10 rounded-lg glass-ultrathin grid place-items-center shrink-0 ${isCheapest ? 'text-primary' : 'text-muted-foreground'}`}
                    aria-hidden
                  >
                    <StoreIcon size={18} strokeWidth={1.75} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate" dir="auto">{row.storeNameAr}</span>
                      {isCheapest && <Pill tone="primary">الأرخص</Pill>}
                      {hasPromo && <Pill tone="accent">عرض</Pill>}
                    </div>
                    {dLine && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{dLine}</div>}
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-base font-bold tabular-nums">{formatBHD(row.fils, { arabicNumerals })}</div>
                    {hasPromo && (
                      <div className="text-xs text-muted-foreground line-through tabular-nums">
                        {formatBHD(row.origFils!, { arabicNumerals })}
                      </div>
                    )}
                  </div>
                  {row.url && (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-thin hover:bg-secondary/60 transition-colors min-h-11 inline-flex items-center gap-1.5 px-3 rounded-xl text-sm font-semibold shrink-0"
                      aria-label={`فتح ${row.storeNameAr} في تبويب جديد — السعر ${formatBHD(row.fils, { arabicNumerals })}`}
                    >
                      <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
                      زر المتجر
                    </a>
                  )}
                </GlassRow>
              )
            })}
          </div>
        )}
      </section>

      {/* 3. price stats */}
      <section aria-label="إحصاءات السعر">
        <div className="flex flex-wrap gap-2">
          <StatTile label="السعر الوسيط" value={formatBHD(p.medianFils, { arabicNumerals })} tone="primary" />
          <StatTile
            label="الأدنى"
            value={formatBHD(p.minFils, { arabicNumerals })}
            hint={cheapest ? `في ${cheapest.storeNameAr}` : undefined}
          />
          <StatTile
            label="الأعلى"
            value={formatBHD(p.maxFils, { arabicNumerals })}
            hint={priciest ? `في ${priciest.storeNameAr}` : undefined}
          />
          {unitText && <StatTile label="سعر الوحدة" value={unitText} />}
        </div>
      </section>

      {/* 4. household sufficiency */}
      <section aria-label="كم يكفي أسرتك">
        <SectionTitle>كم يكفي أسرتك؟</SectionTitle>
        {!household || household.members.length === 0 ? (
          <GlassCard className="p-4 flex items-center gap-3 flex-wrap">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center text-primary shrink-0" aria-hidden>
              <Users size={20} strokeWidth={1.75} />
            </span>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold">أضف بيانات أسرتك أولاً</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                بمجرد معرفة أعمار أفراد أسرتك نقدّر كم تكفي هذه العبوة أسرك تحديداً — يستغرق أقل من دقيقة.
              </p>
            </div>
            <GlassButton variant="primary" onClick={() => navigate({ name: 'start' })}>أضف أسرتك</GlassButton>
          </GlassCard>
        ) : sufficiency?.kind === 'days' ? (
          <GlassCard className="p-4">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">هذه العبوة تكفي أسرتك</span>
              <span className="text-2xl font-extrabold tabular-nums text-primary">{daysText}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed tabular-nums">
              {sufficiency.need.nameAr}: استهلاك مرجعي تقديري ≈ {dailyText} لأسرة مكافئها البالغ{' '}
              {formatNumberAr(Math.round(sufficiency.adultEq * 10) / 10, arabicNumerals)}.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 flex items-start gap-1.5 leading-relaxed">
              <Info size={13} strokeWidth={1.75} aria-hidden className="shrink-0 mt-0.5" />
              تقدير تقريبي من قواعد استهلاك موثقة؛ الخطة الكاملة تحسب عاداتك الفعلية والموسم والهدر بدقة أعلى.
            </p>
          </GlassCard>
        ) : sufficiency?.kind === 'habit' ? (
          <GlassCard className="p-4 flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center text-primary shrink-0" aria-hidden>
              <Users size={20} strokeWidth={1.75} />
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              هذا الصنف (<span className="font-semibold text-foreground">{sufficiency.needName}</span>) مرتبط
              بعادات أسرتك الخاصة — كالقهوة أو الحفاضات أو المياه — فيُحسب بدقة داخل خطتك من إجاباتك،
              ولا يمكن تلخيصه برقم واحد هنا. أضفها لخطتك لنعرف مدى كفايتها.
            </p>
          </GlassCard>
        ) : (
          <GlassCard className="p-4 flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center text-primary shrink-0" aria-hidden>
              <Info size={20} strokeWidth={1.75} />
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              لا نعرف الاستهلاك المرجعي لهذا الصنف بدقة بعد، أضفها لخطتك لنعرف مدى كفايتها. إن كنت تعرف
              استهلاك أسرتك منه، شاركنا ملاحظتك من «اقترح تعديلاً» أدناه لتحسين البيانات المفتوحة.
            </p>
          </GlassCard>
        )}
      </section>

      {/* 5. similar products */}
      {data.similar.length > 0 && (
        <section aria-label="منتجات مشابهة">
          <SectionTitle>منتجات مشابهة</SectionTitle>
          <div className="flex gap-3 overflow-x-auto nice-scroll pb-2 -mx-1 px-1 snap-x">
            {data.similar.map((sp) => (
              <SimilarCard key={sp.id} p={sp} arabicNumerals={arabicNumerals} />
            ))}
          </div>
        </section>
      )}

      {/* 6. actions */}
      <section aria-label="إجراءات المنتج">
        <div className="grid sm:grid-cols-3 gap-2">
          {locked ? (
            <GlassButton variant="primary" className="min-h-12" onClick={() => navigate({ name: 'plan' })}>
              <Check size={16} strokeWidth={1.75} aria-hidden /> في خطتك — اعرضها
            </GlassButton>
          ) : (
            <GlassButton
              variant="primary"
              className="min-h-12"
              onClick={() => { addLock({ productId: id }); navigate({ name: 'plan' }) }}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden /> أضف لخطتي
            </GlassButton>
          )}
          <GlassButton className="min-h-12" onClick={() => setSuggestOpen(true)}>
            <PenLine size={16} strokeWidth={1.75} aria-hidden /> اقترح تعديلاً
          </GlassButton>
          <GlassButton
            className={`min-h-12 ${reportStoreOptions.length === 0 ? BTN_DISABLED : ''}`}
            aria-disabled={reportStoreOptions.length === 0 || undefined}
            onClick={() => setPriceOpen(true)}
          >
            <BadgePercent size={16} strokeWidth={1.75} aria-hidden /> بلّغ عن سعر
          </GlassButton>
        </div>
      </section>

      {/* contribution dialogs (mounted only while open — fresh state each time) */}
      {suggestOpen && <SuggestDialog productId={id} onClose={() => setSuggestOpen(false)} />}
      {priceOpen && (
        <PriceReportDialog
          productId={id}
          stores={reportStoreOptions}
          arabicNumerals={arabicNumerals}
          onClose={() => setPriceOpen(false)}
        />
      )}
    </div>
  )
}
