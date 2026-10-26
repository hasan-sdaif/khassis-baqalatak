'use client'
/**
 * Shopping list (spec 7.3): active plan items grouped by store, bought tracking
 * with actual-price logging into the spend log, envelope budget lines with a
 * live remaining counter, sticky running summary + print. Offline after load:
 * the only optional fetch is catalog meta (module-cached).
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta, type CatalogMeta } from '@/lib/api-client'
import { formatBHD, formatNumberAr, parseBHDToFils } from '@/lib/money'
import { GlassCard, GlassButton, GlassRow, Pill, StatTile, EmptyState, SectionTitle } from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import { NEEDS_MAP } from '@/lib/engine'
import type { PlanItem } from '@/lib/engine/types'
import { Check, Printer, Store, Truck, ShoppingCart, ChevronDown, ChevronUp, Wallet, Tag } from 'lucide-react'

/** module cache: after the first successful fetch the view is fully offline */
let metaCache: CatalogMeta | null = null

/** offline store-name/fee fallbacks (sensible Bahrain defaults) */
const STORES_FALLBACK: Record<string, { name: string; fee: number; free: number | null }> = {
  ninja: { name: 'نينجا', fee: 1000, free: 20000 },
  talabat: { name: 'طلبات مارت', fee: 900, free: 15000 },
  lulu: { name: 'لولو', fee: 1500, free: 25000 },
  aljazira: { name: 'الجزيرة', fee: 1500, free: 25000 },
  hypermax: { name: 'هايبر ماكس', fee: 1200, free: 20000 },
  tamimi: { name: 'أسواق تميمي', fee: 1200, free: 20000 },
  sultan: { name: 'ذا سلطان سنتر', fee: 1200, free: 20000 },
  alosra: { name: 'ألوسرا', fee: 1000, free: 20000 },
  danube: { name: 'دانوب', fee: 1000, free: 20000 },
  lulu2: { name: 'لولو (طلبات)', fee: 1000, free: 20000 },
  hypermax2: { name: 'هايبر ماكس (طلبات)', fee: 1000, free: 20000 },
  ansar: { name: 'أسواق أنصار', fee: 1000, free: 20000 },
  megamart: { name: 'ميقا مارت', fee: 1000, free: 20000 },
  foodworld: { name: 'فود وورلد', fee: 1000, free: 20000 },
  trolley: { name: 'تروللي ماركت', fee: 1000, free: 20000 },
  talal: { name: 'أسواق طلال', fee: 1000, free: 20000 },
  ruyan: { name: 'مركز ريان', fee: 1000, free: 20000 },
}
const DEFAULT_STORE = { name: '', fee: 1000, free: 20000 }

const MEDIAN_LABEL = 'سعر مرجعي (الوسيط)'

function needLabel(needId: string): string {
  const base = needId.split('@')[0]!
  if (base === 'formula') return `حليب أطفال — مرحلة ${needId.split('@')[1] ?? ''}`
  if (base === 'diapers') return `حفاضات — مقاس ${needId.split('@')[1] ?? ''}`
  return NEEDS_MAP.get(base)?.nameAr ?? base
}

function needCategory(needId: string): string {
  const base = needId.split('@')[0]!
  return NEEDS_MAP.get(base)?.category ?? 'pantry-other'
}

interface BoughtState { actualFils: number; spendId: string }

export function ShoppingView() {
  const store = useApp()
  const plan = store.plan
  const arabicNumerals = store.settings.arabicNumerals

  const [meta, setMeta] = useState<CatalogMeta | null>(metaCache)
  const [bought, setBought] = useState<Record<string, BoughtState>>({})
  const [actualInputs, setActualInputs] = useState<Record<string, string>>({})
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null)

  // optional one-time meta fetch (store names + delivery fees), cached module-level
  useEffect(() => {
    if (metaCache) return
    let cancelled = false
    fetchCatalogMeta()
      .then((m) => { metaCache = m; if (!cancelled) setMeta(m) })
      .catch(() => { /* offline-safe: fallback names are used */ })
    return () => { cancelled = true }
  }, [])

  const allItems = useMemo<PlanItem[]>(() => {
    if (!plan) return []
    return [...plan.items, ...plan.fixedItems, ...plan.envelopes.flatMap((e) => e.items)]
  }, [plan])

  const storeGroups = useMemo(() => {
    const groups = new Map<string, PlanItem[]>()
    for (const it of allItems) {
      const sid = it.storeId ?? 'median'
      if (!groups.has(sid)) groups.set(sid, [])
      groups.get(sid)!.push(it)
    }
    const out = [...groups.entries()].map(([sid, items]) => {
      const subtotalFils = items.reduce((s, i) => s + i.costFils, 0)
      const isMedian = sid === 'median'
      const metaStore = meta?.stores.find((s) => s.id === sid)
      const fallback = STORES_FALLBACK[sid] ?? DEFAULT_STORE
      const name = isMedian ? MEDIAN_LABEL : (metaStore?.nameAr ?? (fallback.name || sid))
      const deliveryFeeFils = isMedian ? 0 : (metaStore?.deliveryFeeFils ?? fallback.fee)
      const freeThresholdFils = isMedian ? null : (metaStore?.freeDeliveryThresholdFils ?? fallback.free)
      const free = freeThresholdFils != null && subtotalFils >= freeThresholdFils
      return { storeId: sid, name, items, subtotalFils, deliveryFeeFils: free ? 0 : deliveryFeeFils, freeThresholdFils, isMedian, free }
    })
    out.sort((a, b) => (a.isMedian === b.isMedian ? b.subtotalFils - a.subtotalFils : a.isMedian ? -1 : 1))
    return out
  }, [allItems, meta])

  // ---------- bought / spend-log plumbing ----------
  const defaultActual = (it: PlanItem): string => (it.costFils / 1000).toFixed(3)

  const toggleBought = (it: PlanItem) => {
    const cur = bought[it.key]
    if (cur) {
      // un-buy: remove the logged spend entry for this row
      useApp.setState((s) => ({ spendLog: s.spendLog.filter((e) => e.id !== cur.spendId) }))
      setBought((b) => { const nb = { ...b }; delete nb[it.key]; return nb })
    } else {
      const actualFils = parseBHDToFils(actualInputs[it.key] ?? defaultActual(it))
      const spendId = `sl-${it.key}-${Date.now()}`
      store.addSpend({
        id: spendId,
        dateISO: new Date().toISOString(),
        planItemKey: it.key,
        envelopeId: it.envelopeId,
        name: it.productName,
        plannedFils: it.costFils,
        actualFils,
        storeId: it.storeId ?? undefined,
      })
      setBought((b) => ({ ...b, [it.key]: { actualFils, spendId } }))
    }
  }

  const onActualChange = (it: PlanItem, val: string) => {
    setActualInputs((a) => ({ ...a, [it.key]: val }))
    const cur = bought[it.key]
    if (cur) {
      const actualFils = parseBHDToFils(val)
      setBought((b) => ({ ...b, [it.key]: { ...b[it.key]!, actualFils } }))
      useApp.setState((s) => ({ spendLog: s.spendLog.map((e) => (e.id === cur.spendId ? { ...e, actualFils } : e)) }))
    }
  }

  // ---------- live numbers ----------
  const boughtKeys = Object.keys(bought)
  const boughtCount = boughtKeys.length
  const totalCount = allItems.length
  const plannedTotal = allItems.reduce((s, i) => s + i.costFils, 0)
  const actualTotal = boughtKeys.reduce((s, k) => s + (bought[k]?.actualFils ?? 0), 0)
  const diff = actualTotal - plannedTotal
  const overBudget = diff > 0
  const deliveryTotal = storeGroups.reduce((s, g) => s + g.deliveryFeeFils, 0)

  // ---------- render helpers ----------
  const renderItemRow = (it: PlanItem) => {
    const isBought = it.key in bought
    const envName = it.envelopeId ? plan?.envelopes.find((e) => e.envelopeId === it.envelopeId)?.name : undefined
    const qtyText = it.packQty > 1 || it.sizeText ? `× ${formatNumberAr(it.packQty, arabicNumerals)} ${it.sizeText ?? ''}`.trim() : null
    return (
      <GlassRow key={it.key} className={`print-avoid-break transition-opacity ${isBought ? 'opacity-55' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={isBought}
            aria-label={isBought ? `إلغاء شراء ${it.productName}` : `تعليم ${it.productName} كمشترى`}
            onClick={() => toggleBought(it)}
            className={`shrink-0 w-11 h-11 rounded-xl grid place-items-center transition-all ${isBought ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25' : 'glass-thin hover:bg-secondary/60'}`}
          >
            {isBought ? <Check size={20} strokeWidth={1.75} aria-hidden /> : null}
          </button>
          <span className="w-9 h-9 rounded-lg glass-ultrathin grid place-items-center shrink-0 text-primary" aria-hidden>
            <CategoryIcon category={needCategory(it.needId)} size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-medium truncate ${isBought ? 'line-through' : ''}`}>{it.productName}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {needLabel(it.needId)}
              {qtyText ? ` · ${qtyText}` : ''}
              {envName ? ` · ${envName}` : ''}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className={`text-sm font-bold tabular-nums ${isBought ? 'line-through text-muted-foreground' : ''}`}>
              {formatBHD(it.costFils, { arabicNumerals })}
            </div>
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor={`actual-${it.key}`}>{`السعر الفعلي لـ ${it.productName} بالدينار`}</label>
              <input
                id={`actual-${it.key}`}
                type="number"
                inputMode="decimal"
                dir="ltr"
                min={0}
                step={0.001}
                value={actualInputs[it.key] ?? defaultActual(it)}
                onChange={(e) => onActualChange(it, e.target.value)}
                className="w-[84px] h-11 rounded-lg glass-thin px-2 text-xs tabular-nums text-end bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="text-[10px] text-muted-foreground" aria-hidden>د.ب</span>
            </div>
          </div>
        </div>
      </GlassRow>
    )
  }

  const renderStoreSection = (g: (typeof storeGroups)[number]) => (
    <section key={g.storeId} className="space-y-2 print-avoid-break" aria-label={`قائمة ${g.name}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap px-1">
        <h3 className="flex items-center gap-2 font-bold text-sm">
          <Store size={16} strokeWidth={1.75} aria-hidden className="text-primary" />
          {g.name}
          <Pill tone={g.isMedian ? 'default' : 'primary'}>{formatNumberAr(g.items.length, arabicNumerals)} بند</Pill>
        </h3>
        <div className="text-end">
          <div className="text-sm font-bold tabular-nums">{formatBHD(g.subtotalFils, { arabicNumerals })}</div>
          {!g.isMedian ? (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
              <Truck size={12} strokeWidth={1.75} aria-hidden />
              {g.free ? (
                <span className="text-primary font-semibold">توصيل مجاني</span>
              ) : (
                <span>توصيل {formatBHD(g.deliveryFeeFils, { arabicNumerals })}</span>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">بدون رسوم توصيل</div>
          )}
        </div>
      </div>
      {!g.isMedian && !g.free && g.freeThresholdFils != null ? (
        <div className="text-[11px] text-muted-foreground px-1 -mt-1">
          {`أضف ${formatBHD(Math.max(0, g.freeThresholdFils - g.subtotalFils), { arabicNumerals })} لتصل إلى حد التوصيل المجاني`}
        </div>
      ) : null}
      <div className="space-y-2">{g.items.map(renderItemRow)}</div>
    </section>
  )

  // ---------- empty state ----------
  if (!plan) {
    return (
      <EmptyState
        icon={<ShoppingCart size={24} strokeWidth={1.75} aria-hidden />}
        title="لا توجد خطة للتسوق بعد"
        subtitle="ولّد خطة أولاً من معالج البدء، ثم عُد هنا لتجد قائمة تسوقك جاهزة مقسّمة على المتاجر"
        action={<GlassButton variant="primary" size="lg" onClick={() => navigate({ name: 'start' })}>ابدأ الخطوة الأولى</GlassButton>}
      />
    )
  }

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart size={24} strokeWidth={1.75} aria-hidden />}
        title="خطتك بلا بنود"
        subtitle="لم يشمل التوليد الحالي أي بند قابل للشراء — جرّب رفع الميزانية أو أعد التوليد"
        action={<GlassButton variant="primary" size="lg" onClick={() => navigate({ name: 'plan' })}>افتح الخطة</GlassButton>}
      />
    )
  }

  return (
    <div className="space-y-6 pb-4 pt-2">
      {/* summary tiles */}
      <section className="flex flex-wrap gap-2" aria-label="ملخص قائمة التسوق">
        <StatTile label="إجمالي المخطط" value={formatBHD(plan.totals.costFils, { arabicNumerals })} tone="primary" />
        <StatTile label="عدد البنود" value={formatNumberAr(totalCount, arabicNumerals)} />
        <StatTile label="أظرف الميزانية" value={formatNumberAr(plan.envelopes.length, arabicNumerals)} />
        <StatTile label="التوصيل المقدر" value={formatBHD(deliveryTotal, { arabicNumerals })} hint="تقديري حسب المتاجر" />
      </section>

      {/* store groups */}
      <section className="space-y-6" aria-label="البنود مقسّمة على المتاجر">
        {storeGroups.map(renderStoreSection)}
      </section>

      {/* envelopes */}
      {plan.envelopes.length > 0 ? (
        <section aria-label="أظرف الميزانية">
          <SectionTitle className="flex items-center gap-2">
            <Wallet size={18} strokeWidth={1.75} aria-hidden className="text-accent" />
            أظرف الميزانية — تتبّع سقف كل ظرف
          </SectionTitle>
          <div className="space-y-3">
            {plan.envelopes.map((env) => {
              const actual = store.spendLog
                .filter((e) => e.envelopeId === env.envelopeId)
                .reduce((s, e) => s + e.actualFils, 0)
              const remaining = env.spentFils - actual
              const negative = remaining < 0
              const lowShare = env.spentFils > 0 && remaining < env.spentFils * 0.2
              const open = expandedEnv === env.envelopeId
              return (
                <GlassCard key={env.envelopeId} className="p-4 print-avoid-break">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedEnv(open ? null : env.envelopeId)}
                      aria-expanded={open}
                      aria-label={`${open ? 'إخفاء بنود' : 'عرض بنود'} ظرف ${env.name}`}
                      className="flex-1 min-w-0 flex items-center gap-3 text-start min-h-11"
                    >
                      <span className="w-9 h-9 rounded-lg bg-accent/15 grid place-items-center shrink-0 text-accent" aria-hidden>
                        <Tag size={16} strokeWidth={1.75} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold truncate">
                          {env.name}
                          <span className="text-muted-foreground font-normal"> — حتى {formatBHD(env.maxFils ?? env.spentFils, { arabicNumerals })}</span>
                        </span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums">
                          {'المتبقي '}
                          <span className={`font-bold ${negative ? 'text-destructive' : lowShare ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                            {formatBHD(remaining, { arabicNumerals })}
                          </span>
                          {` من المخصص ${formatBHD(env.spentFils, { arabicNumerals, withUnit: false })} د.ب`}
                        </span>
                      </span>
                      {negative ? (
                        <Pill tone="danger" className="shrink-0">تجاوزت الظرف بـ {formatBHD(-remaining, { arabicNumerals })}</Pill>
                      ) : lowShare ? (
                        <Pill tone="warn" className="shrink-0">قاربت على النهاية</Pill>
                      ) : null}
                      {open
                        ? <ChevronUp size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted-foreground" />
                        : <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted-foreground" />}
                    </button>
                  </div>
                  {open ? (
                    <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                      {env.items.length === 0 ? (
                        <div className="text-xs text-muted-foreground">لم يشمل هذا الظرف بنوداً في التوليد الحالي</div>
                      ) : env.items.map((it) => (
                        <div key={it.key} className="flex items-center gap-2 text-xs px-1 py-1.5 rounded-lg">
                          {it.key in bought ? (
                            <Check size={14} strokeWidth={1.75} aria-hidden className="text-primary shrink-0" />
                          ) : (
                            <span className="w-[14px] h-[14px] rounded-full border border-border shrink-0" aria-hidden />
                          )}
                          <span className={`flex-1 truncate ${it.key in bought ? 'line-through text-muted-foreground' : ''}`}>{it.productName}</span>
                          <span className="tabular-nums text-muted-foreground">{formatBHD(it.costFils, { arabicNumerals })}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </GlassCard>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* print hint + off we go */}
      <section className="no-print">
        <GlassCard className="p-4 flex items-center gap-3">
          <Printer size={18} strokeWidth={1.75} aria-hidden className="text-primary shrink-0" />
          <div className="flex-1 text-sm text-muted-foreground leading-relaxed">
            علّم ما تشتريه وعدّل السعر الفعلي إن اختلف — يُسجَّل تلقائياً في تتبع الإنفاق، ويمكنك طباعة القائمة كاملة لمن يذهب للتسوق.
          </div>
        </GlassCard>
      </section>

      {/* sticky summary bar */}
      <div className="sticky bottom-[calc(76px_+_env(safe-area-inset-bottom))] md:bottom-3 z-30 no-print">
        <div className="glass-chrome rounded-2xl p-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[190px]">
            <div className="text-xs text-muted-foreground tabular-nums">
              {`المشترى ${formatNumberAr(boughtCount, arabicNumerals)} من ${formatNumberAr(totalCount, arabicNumerals)} بند`}
            </div>
            <div className="text-base font-bold tabular-nums">
              <span className={overBudget ? 'text-destructive' : 'text-primary'}>{formatBHD(actualTotal, { arabicNumerals })}</span>
              <span className="text-muted-foreground text-sm font-normal">{` من ${formatBHD(plannedTotal, { arabicNumerals, withUnit: false })} د.ب`}</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1.5" aria-hidden>
              <div
                className={`h-full rounded-full transition-all ${overBudget ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${totalCount ? Math.min(100, (actualTotal / Math.max(1, plannedTotal)) * 100) : 0}%` }}
              />
            </div>
          </div>
          {overBudget ? (
            <Pill tone="danger">{`تجاوزت المخطط بـ ${formatBHD(diff, { arabicNumerals })}`}</Pill>
          ) : null}
          <div className="flex gap-2">
            <GlassButton onClick={() => window.print()} aria-label="اطبع قائمة التسوق" title="اطبع القائمة">
              <Printer size={16} strokeWidth={1.75} aria-hidden />
            </GlassButton>
            <GlassButton variant="primary" onClick={() => navigate({ name: 'spending' })}>
              إنهاء التسوق
            </GlassButton>
          </div>
        </div>
      </div>
    </div>
  )
}
