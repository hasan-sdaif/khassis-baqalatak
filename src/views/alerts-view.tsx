'use client'
/**
 * Price alerts (spec 7.6): client-side watch list of products or needs with a
 * price threshold. Checking is manual from this page (honest note about the
 * scheduled auto-check being worked on).
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp, type PriceAlert } from '@/store/app-store'
import { fetchProduct, searchProducts } from '@/lib/api-client'
import { formatBHD, formatDateAr, formatNumberAr, parseBHDToFils, unitLabelAr } from '@/lib/money'
import { GlassCard, GlassButton, GlassRow, Pill, EmptyState, SectionTitle, Spinner } from '@/components/glass/glass'
import { NEEDS, NEEDS_MAP } from '@/lib/engine'
import type { CatalogProduct } from '@/lib/engine/types'
import { Bell, Search, Plus, Trash2, RefreshCw, Info, X, CircleCheck, TriangleAlert } from 'lucide-react'

interface CheckResult {
  status: 'triggered' | 'ok' | 'error'
  minFils?: number
  storeName?: string
  productName?: string
  unitLabel?: string
}

export function AlertsView() {
  const store = useApp()
  const alerts = store.alerts
  const arabicNumerals = store.settings.arabicNumerals

  const [mode, setMode] = useState<'product' | 'need'>('product')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [needId, setNeedId] = useState('')
  const [thresholdRaw, setThresholdRaw] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [checking, setChecking] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<string, CheckResult>>({})

  const wizardNeeds = useMemo(() => NEEDS.filter((n) => n.visibleInWizard), [])

  // debounced product search
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setSearching(true)
      searchProducts({ q: query, limit: 8 })
        .then((r) => { if (!cancelled) setResults(r.items) })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q])

  // ---------- check now ----------
  const check = async (a: PriceAlert) => {
    setChecking(a.id)
    try {
      if (a.productId) {
        const det = await fetchProduct(a.productId)
        const prices = det.prices.filter((p) => p.fils > 0)
        if (!prices.length) {
          setChecked((c) => ({ ...c, [a.id]: { status: 'error' } }))
          return
        }
        let min = prices[0]!
        for (const p of prices) if (p.fils < min.fils) min = p
        setChecked((c) => ({
          ...c,
          [a.id]: {
            status: min.fils <= a.thresholdFils ? 'triggered' : 'ok',
            minFils: min.fils,
            storeName: min.storeNameAr,
          },
        }))
      } else if (a.needId) {
        const res = await searchProducts({ need: a.needId, sort: 'unit-asc', limit: 1 })
        const best = res.items[0]
        const unitFils = best?.unitPriceFils
        if (!best || unitFils == null) {
          setChecked((c) => ({ ...c, [a.id]: { status: 'error' } }))
          return
        }
        const unit = NEEDS_MAP.get(a.needId.split('@')[0]!)?.baseUnit
        setChecked((c) => ({
          ...c,
          [a.id]: {
            status: unitFils <= a.thresholdFils ? 'triggered' : 'ok',
            minFils: unitFils,
            productName: best.nameAr || best.nameEn,
            unitLabel: unit ? unitLabelAr(unit) : undefined,
          },
        }))
      } else {
        setChecked((c) => ({ ...c, [a.id]: { status: 'error' } }))
      }
    } catch {
      setChecked((c) => ({ ...c, [a.id]: { status: 'error' } }))
    } finally {
      setChecking(null)
    }
  }

  // ---------- add alert ----------
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const thresholdFils = parseBHDToFils(thresholdRaw)
    if (thresholdFils <= 0) {
      setFormError('أدخل حداً صحيحاً بالدينار أكبر من صفر')
      return
    }
    if (mode === 'product') {
      if (!picked) {
        setFormError('ابحث واختر منتجاً من النتائج أولاً')
        return
      }
      store.addAlert({
        id: `a${Date.now()}`,
        productId: picked.id,
        name: picked.name,
        thresholdFils,
        createdAtISO: new Date().toISOString(),
      })
    } else {
      if (!needId) {
        setFormError('اختر احتياجاً للمتابعة')
        return
      }
      const need = NEEDS_MAP.get(needId)
      store.addAlert({
        id: `a${Date.now()}`,
        needId,
        name: need?.nameAr ?? needId,
        thresholdFils,
        createdAtISO: new Date().toISOString(),
      })
    }
    setPicked(null)
    setQ('')
    setResults([])
    setNeedId('')
    setThresholdRaw('')
    setFormError(null)
  }

  const inputCls = 'w-full h-11 rounded-xl glass-thin px-3 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40'

  const renderStatus = (a: PriceAlert) => {
    const res = checked[a.id]
    if (!res) return null
    if (res.status === 'error') {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden className="text-amber-600 dark:text-amber-400 shrink-0" />
          تعذّر جلب السعر الآن — أعد المحاولة
        </div>
      )
    }
    if (res.status === 'triggered') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="danger">
            <CircleCheck size={13} strokeWidth={1.75} aria-hidden />
            {res.unitLabel
              ? `سعر الوحدة الآن ${formatBHD(res.minFils ?? 0, { arabicNumerals })} — تحت حدك ${formatBHD(a.thresholdFils, { arabicNumerals })}`
              : `السعر الآن ${formatBHD(res.minFils ?? 0, { arabicNumerals })} — تحت حدك ${formatBHD(a.thresholdFils, { arabicNumerals })}`}
          </Pill>
          {res.productName ? (
            <span className="text-[11px] text-muted-foreground truncate">{`أرخص خيار حالياً: ${res.productName}${res.unitLabel ? ` (لكل ${res.unitLabel})` : ''}`}</span>
          ) : res.storeName ? (
            <span className="text-[11px] text-muted-foreground">{`أرخص سعر عند: ${res.storeName}`}</span>
          ) : null}
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="default">
          {res.unitLabel
            ? `أرخص وحدة الآن ${formatBHD(res.minFils ?? 0, { arabicNumerals })}`
            : `السعر الآن ${formatBHD(res.minFils ?? 0, { arabicNumerals })}`}
        </Pill>
        {res.productName ? (
          <span className="text-[11px] text-muted-foreground truncate">{`أرخص خيار حالياً: ${res.productName}${res.unitLabel ? ` (لكل ${res.unitLabel})` : ''}`}</span>
        ) : res.storeName ? (
          <span className="text-[11px] text-muted-foreground">{`أرخص سعر عند: ${res.storeName}`}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8 pt-2">
      {/* honest note */}
      <section aria-label="ملاحظة عن الفحص">
        <GlassCard className="p-4 border-accent/30 flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-accent/15 grid place-items-center shrink-0 text-accent" aria-hidden>
            <Info size={20} strokeWidth={1.75} />
          </span>
          <div className="flex-1 text-sm leading-relaxed">
            <span className="font-bold block mb-1">افتح هذه الصفحة لفحص تنبيهاتك — نعمل على جدولة الفحص التلقائي</span>
            <span className="text-muted-foreground">
              اضغط «تحقق الآن» بجوار أي تنبيه لمقارنة أرخص سعر حالي بحدّك، لمنتج معيّن أو لاحتياج كامل.
            </span>
          </div>
        </GlassCard>
      </section>

      {/* add form */}
      <section aria-label="إضافة تنبيه">
        <SectionTitle>تنبيه جديد</SectionTitle>
        <GlassCard>
          <div className="flex gap-2 mb-4" role="tablist" aria-label="نوع التنبيه">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'product'}
              onClick={() => setMode('product')}
              className={`flex-1 min-h-11 rounded-xl px-3 text-sm font-semibold transition-all ${mode === 'product' ? 'bg-primary text-primary-foreground' : 'glass-thin hover:bg-secondary/50'}`}
            >
              على منتج
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'need'}
              onClick={() => setMode('need')}
              className={`flex-1 min-h-11 rounded-xl px-3 text-sm font-semibold transition-all ${mode === 'need' ? 'bg-primary text-primary-foreground' : 'glass-thin hover:bg-secondary/50'}`}
            >
              على احتياج
            </button>
          </div>
          <form onSubmit={submit} className="space-y-3" noValidate>
            {mode === 'product' ? (
              <div className="relative">
                <label htmlFor="alert-search" className="block text-sm font-semibold mb-1.5">ابحث عن منتج</label>
                <div className="relative">
                  <Search size={16} strokeWidth={1.75} aria-hidden className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
                  <input
                    id="alert-search"
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="مثال: حليب طويل الأجل، أرز، شامبو…"
                    className={`${inputCls} ps-10`}
                    autoComplete="off"
                  />
                  {searching ? (
                    <span className="absolute top-1/2 -translate-y-1/2 end-3">
                      <Spinner className="w-4 h-4 text-primary" />
                    </span>
                  ) : null}
                </div>
                {picked ? (
                  <div className="mt-2 flex items-center gap-2 glass-thin rounded-xl px-3 py-2">
                    <CircleCheck size={14} strokeWidth={1.75} aria-hidden className="text-primary shrink-0" />
                    <span className="text-sm truncate flex-1">{picked.name}</span>
                    <button
                      type="button"
                      onClick={() => setPicked(null)}
                      aria-label="إلغاء اختيار المنتج"
                      className="shrink-0 w-11 h-11 -m-2 grid place-items-center rounded-xl hover:bg-secondary/60 text-muted-foreground"
                    >
                      <X size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                ) : results.length > 0 ? (
                  <div className="absolute top-full mt-1 inset-x-0 z-20 glass-chrome rounded-xl max-h-72 overflow-y-auto nice-scroll shadow-xl" role="listbox" aria-label="نتائج البحث">
                    {results.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => { setPicked({ id: p.id, name: p.nameAr || p.nameEn }); setResults([]); setQ('') }}
                        className="w-full text-start px-3 py-2.5 hover:bg-secondary/60 transition-colors border-b border-border/40 last:border-0"
                      >
                        <span className="block text-sm font-medium truncate">{p.nameAr || p.nameEn}</span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums truncate">
                          {[p.brand, p.sizeText, formatBHD(p.medianFils, { arabicNumerals })].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <label htmlFor="alert-need" className="block text-sm font-semibold mb-1.5">اختر الاحتياج</label>
                <select
                  id="alert-need"
                  value={needId}
                  onChange={(e) => setNeedId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">اختر احتياجاً…</option>
                  {wizardNeeds.map((n) => (
                    <option key={n.id} value={n.id}>{n.nameAr}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  يقارن الفحص أرخص سعر وحدة (لكل لتر/كجم/حبة…) ضمن هذا الاحتياج بحدّك.
                </p>
              </div>
            )}
            <div>
              <label htmlFor="alert-threshold" className="block text-sm font-semibold mb-1.5">
                {mode === 'product' ? 'أدنى سعر منتظر للمنتج (د.ب)' : 'أدنى سعر وحدة منتظر (د.ب)'}
              </label>
              <input
                id="alert-threshold"
                type="number"
                inputMode="decimal"
                dir="ltr"
                min={0}
                step={0.001}
                value={thresholdRaw}
                onChange={(e) => setThresholdRaw(e.target.value)}
                placeholder="0.000"
                className={`${inputCls} text-end tabular-nums`}
              />
            </div>
            {formError ? <div className="text-destructive text-sm" role="alert">{formError}</div> : null}
            <GlassButton variant="primary" className="w-full">
              <Plus size={16} strokeWidth={1.75} aria-hidden />
              أضف التنبيه
            </GlassButton>
          </form>
        </GlassCard>
      </section>

      {/* alerts list */}
      <section aria-label="تنبيهاتك">
        <SectionTitle className="flex items-center gap-2">
          <Bell size={18} strokeWidth={1.75} aria-hidden className="text-primary" />
          {`تنبيهاتك (${formatNumberAr(alerts.length, arabicNumerals)})`}
        </SectionTitle>
        {alerts.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} strokeWidth={1.75} aria-hidden />}
            title="لا تنبيهات بعد"
            subtitle="أضف منتجاً أو احتياجاً وحدّد السعر الذي تنتظره — ثم تحقق من هذه الصفحة لترى هل تحقق"
          />
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <GlassRow key={a.id} className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg glass-ultrathin grid place-items-center shrink-0 text-primary" aria-hidden>
                    <Bell size={16} strokeWidth={1.75} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <Pill tone={a.productId ? 'primary' : 'accent'}>{a.productId ? 'منتج' : 'احتياج'}</Pill>
                      <span className="tabular-nums">{`الحد: ${formatBHD(a.thresholdFils, { arabicNumerals })}${a.needId ? ' / للوحدة' : ''}`}</span>
                      <span>{`· أُضيف ${formatDateAr(a.createdAtISO)}`}</span>
                    </div>
                  </div>
                  <GlassButton
                    size="sm"
                    onClick={() => check(a)}
                    aria-busy={checking === a.id}
                    className={checking === a.id ? 'pointer-events-none opacity-50' : ''}
                  >
                    {checking === a.id ? <Spinner className="w-4 h-4" /> : <RefreshCw size={14} strokeWidth={1.75} aria-hidden />}
                    تحقق الآن
                  </GlassButton>
                  <button
                    type="button"
                    onClick={() => store.removeAlert(a.id)}
                    aria-label={`حذف تنبيه ${a.name}`}
                    className="shrink-0 w-11 h-11 rounded-xl glass-thin hover:bg-destructive/15 hover:text-destructive grid place-items-center transition-colors"
                  >
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
                {renderStatus(a)}
              </GlassRow>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
