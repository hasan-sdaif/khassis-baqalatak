'use client'
/**
 * Plan dashboard (spec 7.2): summary, 5 modes (crisis/economy/balanced/
 * comfortable/custom) with explicit offset percentages, grouped items with
 * why/swap/pin + score-composition percentage bars, what-if live
 * regeneration, animated budget distribution, trips, envelopes, share,
 * and a diagnostics transparency panel (allocation %, reserve, refinement).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { generatePlanApi, sharePlan } from '@/lib/api-client'
import { formatBHD, formatNumberAr, formatDateAr } from '@/lib/money'
import { GlassCard, GlassButton, GlassRow, Pill, StatTile, Spinner, EmptyState, SectionTitle } from '@/components/glass/glass'
import { FadeIn, StaggerList, StaggerItem, CountUp, AnimatedBar, AnimatedDonut } from '@/components/glass/motion'
import { CategoryIcon } from '@/components/icons/category-icons'
import { Lock, Pin, TriangleAlert, ArrowLeftRight, Trash2, Plus, Minus, ChevronDown, ChevronUp, Share2, FileText, HelpCircle, CalendarDays, Sparkles, Gauge, SlidersHorizontal } from 'lucide-react'
import type { PlanItem, PlanMode, PlanResult } from '@/lib/engine/types'
import { NEEDS_MAP, categoryFallbackNeed, MODE_LABELS, ALLOC_GROUPS, getAllPlanItems } from '@/lib/engine'
import type { AllocGroupId } from '@/lib/engine'

const MODE_IDS: PlanMode[] = ['crisis', 'economy', 'balanced', 'comfortable', 'custom']

/** mode tabs built from the engine's MODE_LABELS (labels + descriptions + offset %) */
const MODES: { id: PlanMode; label: string; hint: string; offsetPct: number }[] = MODE_IDS.map((id) => {
  const m = MODE_LABELS[id] ?? { nameAr: id, descAr: '', offsetPct: 0 }
  return { id, label: m.nameAr, hint: m.descAr, offsetPct: m.offsetPct }
})

const CLASS_LABEL: Record<string, string> = {
  mandatory: 'بنود ثابتة (عادات/رضّع)',
  essential: 'الأساسيات',
  regular: 'الاعتيادية',
  comfort: 'الرفاهية',
  treat: 'التحلية والكماليات',
}

/** score-composition buckets → Arabic labels + bar tones (penalty is a deduction share) */
const SCORE_PARTS: { key: string; label: string; tone: 'primary' | 'accent' | 'warn' | 'danger' }[] = [
  { key: 'target', label: 'الملاءمة السعرية', tone: 'primary' },
  { key: 'quality', label: 'جودة العبوة', tone: 'accent' },
  { key: 'value', label: 'القيمة السعرية', tone: 'primary' },
  { key: 'brand', label: 'العلامة والتفضيل', tone: 'accent' },
  { key: 'local', label: 'التوفر والشهرة', tone: 'warn' },
  { key: 'penalty', label: 'خصومات: الهدر/الثقة بالبيانات', tone: 'danger' },
]

function needLabel(needId: string): string {
  const base = needId.split('@')[0]!
  if (base === 'formula') return `حليب أطفال — مرحلة ${needId.split('@')[1]}`
  if (base === 'diapers') return `حفاضات — مقاس ${needId.split('@')[1]}`
  return NEEDS_MAP.get(base)?.nameAr ?? categoryFallbackNeed(base)?.nameAr ?? base
}

function needClass(needId: string): string {
  const base = needId.split('@')[0]!
  return NEEDS_MAP.get(base)?.clazz ?? 'regular'
}

/** signed percentage label, e.g. −32٪ / 0٪ / +15٪ */
function pctLabel(pct: number, ar: boolean): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${formatNumberAr(Math.abs(pct), ar)}٪`
}

export function PlanView() {
  const store = useApp()
  const plan = store.plan
  const mode = store.planMode
  const ar = store.settings.arabicNumerals
  const customOffset = store.advanced.lifestyle.customModeOffsetPct
  const [whatIfBudget, setWhatIfBudget] = useState<number | null>(null)
  const [whatIfPlan, setWhatIfPlan] = useState<PlanResult | null>(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [whyItem, setWhyItem] = useState<PlanItem | null>(null)
  const [swapItem, setSwapItem] = useState<PlanItem | null>(null)
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [modeCompare, setModeCompare] = useState<Record<string, PlanResult> | null>(null)
  const [showDiag, setShowDiag] = useState(false)
  const whatIfTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const customTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activePlan = whatIfPlan ?? plan

  const regen = useCallback(async (overrides: { mode?: PlanMode; budgetFils?: number }) => {
    if (!store.household || !store.budget) return null
    setWhatIfLoading(true)
    try {
      const { plan: p } = await generatePlanApi({
        household: store.household,
        budget: { ...store.budget, fils: overrides.budgetFils ?? store.budget.fils },
        mode: overrides.mode ?? store.planMode,
        ...store.planContext,
        envelopes: store.envelopes,
        locks: store.locks,
        pantry: store.pantry,
        advanced: store.advanced,
      })
      return p
    } finally {
      setWhatIfLoading(false)
    }
  }, [store.household, store.budget, store.planMode, store.planContext, store.envelopes, store.locks, store.pantry, store.advanced])

  // mode switch
  const switchMode = async (m: PlanMode) => {
    store.setPlanMode(m)
    if (!store.household || !store.budget) return
    const p = await regen({ mode: m })
    if (p) store.setPlan(p)
  }

  // custom-mode offset slider: live store update + debounced regeneration
  const setCustomOffset = (v: number) => {
    store.setAdvanced({ lifestyle: { ...store.advanced.lifestyle, customModeOffsetPct: v } })
    // the comparison card for 'custom' is now stale — drop it so it refetches
    setModeCompare((prev) => {
      if (!prev || !prev.custom) return prev
      const next = { ...prev }
      delete next.custom
      return next
    })
    if (mode !== 'custom') return
    if (customTimer.current) clearTimeout(customTimer.current)
    customTimer.current = setTimeout(() => {
      regen({ mode: 'custom' }).then((p) => p && store.setPlan(p))
    }, 400)
  }

  // what-if budget slider (debounced)
  useEffect(() => {
    if (whatIfBudget == null || !store.household || !store.budget) return
    if (whatIfTimer.current) clearTimeout(whatIfTimer.current)
    whatIfTimer.current = setTimeout(() => {
      regen({ budgetFils: whatIfBudget }).then((p) => setWhatIfPlan(p))
    }, 400)
  }, [whatIfBudget, regen])

  // mode comparison — fetch whatever modes are still missing (once each per session)
  useEffect(() => {
    if (!plan || !store.household || !store.budget) return
    const missing = MODE_IDS.filter((id) => !modeCompare?.[id])
    if (!missing.length) return
    let cancelled = false
    Promise.all(missing.map(async (id) => [id, await regen({ mode: id })] as const))
      .then((entries) => {
        if (cancelled) return
        setModeCompare((prev) => {
          const next = { ...(prev ?? {}) }
          for (const [id, p] of entries) if (p) next[id] = p
          return next
        })
      })
      .catch(() => { /* comparison is best-effort */ })
    return () => { cancelled = true }
  }, [plan, modeCompare, regen])

  const share = async () => {
    if (!store.household || !store.budget || !plan) return
    if (typeof window !== 'undefined' && !window.confirm('ستُنشر بيانات الأسرة والعادات والقيود الغذائية والميزانية والمخزون والتفضيلات على رابط عام. لن يُنشر اسم الأسرة أو أسماء الأفراد في هذه المشاركة، لكن تفاصيل الخطة ستبقى مرئية لمن يملك الرابط. هل توافق صراحةً على النشر؟')) return
    setSharing(true)
    try {
      const names = store.planNames
      const { slug } = await sharePlan({
        title: names.reportName || 'خطة بقالة',
        // This one-click path is always anonymous; use the explicit community
        // form when the user wants to publish a family/preparer name.
        familyName: undefined,
        authorName: undefined,
        household: store.household,
        budget: store.budget,
        envelopes: store.envelopes,
        mode,
        ...store.planContext,
        locks: store.locks,
        pantry: store.pantry,
        // advanced profile travels with the share so community regeneration
        // reproduces the exact same plan (modes, diets, weights, offsets)
        advanced: store.advanced,
        isAnonymous: true,
        consentToPublishHousehold: true,
      })
      setShareUrl(`${window.location.origin}/#/community/${slug}`)
    } catch {
      setShareUrl(null)
    } finally {
      setSharing(false)
    }
  }

  const items = activePlan?.items ?? []
  const fixedItems = activePlan?.fixedItems ?? []
  const envelopes = activePlan?.envelopes ?? []
  const surplus = (activePlan?.diagnostics.targetFils ?? 0) - (activePlan?.totals.costFils ?? 0)
  const grouped = useMemo(() => {
    const groups = new Map<string, PlanItem[]>()
    for (const it of items) {
      const cls = needClass(it.needId)
      if (!groups.has(cls)) groups.set(cls, [])
      groups.get(cls)!.push(it)
    }
    return [...groups.entries()].sort((a, b) => {
      const order = ['mandatory', 'essential', 'regular', 'comfort', 'treat']
      return order.indexOf(a[0]) - order.indexOf(b[0])
    })
  }, [items])
  const dist = activePlan?.diagnostics.distributionByClass ?? []
  const distTotal = dist.reduce((s, d) => s + d.fils, 0) || 1
  const diag = activePlan?.diagnostics
  const alloc = diag?.allocation ?? []
  const nutrition = activePlan?.nutrition
  const activeModeLabel = MODES.find((m) => m.id === mode)

  if (!plan || !store.household) {
    return (
      <EmptyState
        icon={<Sparkles size={24} strokeWidth={1.75} aria-hidden />}
        title="لم تولّد خطة بعد"
        subtitle="أكمل معالج البدء (أقل من دقيقتين) وستظهر خطتك هنا كاملة بالبدائل والتقارير"
        action={<GlassButton variant="primary" size="lg" onClick={() => navigate({ name: 'start' })}>ابدأ الآن</GlassButton>}
      />
    )
  }

  return (
    <div className="space-y-6 pb-8 pt-2">
      {/* header summary */}
      <FadeIn>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight">{store.planNames.reportName}</h1>
            <div className="flex gap-2 no-print">
              <GlassButton size="sm" onClick={share} disabled={sharing}>
                {sharing ? <Spinner className="w-4 h-4" /> : <Share2 size={14} strokeWidth={1.75} aria-hidden />} مشاركة
              </GlassButton>
              <GlassButton size="sm" onClick={() => navigate({ name: 'reports' })}>
                <FileText size={14} strokeWidth={1.75} aria-hidden /> التقارير
              </GlassButton>
              <GlassButton size="sm" onClick={() => navigate({ name: 'shopping' })}>
                قائمة التسوق
              </GlassButton>
            </div>
          </div>
          {shareUrl ? (
            <div className="glass-thin rounded-xl p-3 text-sm flex items-center gap-2">
              <Share2 size={16} strokeWidth={1.75} aria-hidden />
              <span className="flex-1 truncate" dir="ltr">{shareUrl}</span>
              <GlassButton size="sm" onClick={() => navigator.clipboard?.writeText(shareUrl)}>انسخ</GlassButton>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <StatTile label="الميزانية" value={<CountUp value={store.budget?.fils ?? 0} format={(n) => formatBHD(n, { arabicNumerals: ar })} announce />} />
            <StatTile
              label="المتوقع صرفه"
              value={<CountUp value={activePlan?.totals.costFils ?? 0} format={(n) => formatBHD(n, { arabicNumerals: ar })} announce />}
              tone="primary"
              hint={`نطاق ${formatBHD(activePlan?.totals.optimisticFils ?? 0, { arabicNumerals: true, withUnit: false })} – ${formatBHD(activePlan?.totals.pessimisticFils ?? 0, { arabicNumerals: true, withUnit: false })}`}
            />
            <StatTile
              label={surplus >= 0 ? 'الوفر' : 'العجز'}
              value={formatBHD(Math.abs(surplus), { arabicNumerals: ar })}
              tone={surplus >= 0 ? 'default' : 'danger'}
            />
            <StatTile label="البنود" value={formatNumberAr(getAllPlanItems(activePlan).length, ar)} />
            <StatTile label="الهدر المتوقع" value={`${formatNumberAr(activePlan?.totals.wastePct ?? 0, ar)}٪`} />
            <StatTile label="تغطية الأساسيات" value={`${formatNumberAr(Math.round((activePlan?.totals.coverageEssentials ?? 0) * 100), ar)}٪`} tone={(activePlan?.totals.coverageEssentials ?? 1) < 0.9 ? 'danger' : 'default'} />
          </div>

          {/* diagnostics notes */}
          {(activePlan?.diagnostics.warnings.length ?? 0) > 0 || (activePlan?.diagnostics.notes.length ?? 0) > 0 ? (
            <div className="space-y-1.5">
              {(activePlan?.diagnostics.notes ?? []).map((n, i) => (
                <div key={`n${i}`} className="glass-thin rounded-xl p-3 text-sm flex gap-2 items-start border-accent/40">
                  <TriangleAlert size={16} strokeWidth={1.75} className="text-accent shrink-0 mt-0.5" aria-hidden />
                  <span>{n}</span>
                </div>
              ))}
              {(activePlan?.diagnostics.warnings ?? []).slice(0, 4).map((w, i) => (
                <div key={`w${i}`} className="glass-thin rounded-xl p-3 text-sm flex gap-2 items-start">
                  <TriangleAlert size={16} strokeWidth={1.75} className="text-amber-600 shrink-0 mt-0.5" aria-hidden />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </FadeIn>

      {/* mode tabs (5) */}
      <FadeIn delay={0.06}>
        <section>
          <div className="flex flex-wrap gap-2 mb-2" role="tablist" aria-label="أنماط الخطة">
            {MODES.map((m) => {
              const active = mode === m.id
              const off = m.id === 'custom' ? customOffset : m.offsetPct
              return (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchMode(m.id)}
                  className={`flex-1 min-w-[104px] min-h-[52px] rounded-2xl px-3 pt-2 pb-1.5 text-sm font-semibold transition-all ${active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25' : 'glass-thin hover:bg-secondary/50'}`}
                >
                  <span className="flex items-center justify-center gap-1.5 flex-wrap">
                    {m.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${active ? 'bg-primary-foreground/20' : 'bg-secondary text-secondary-foreground'}`}>
                      {pctLabel(off, ar)}
                    </span>
                  </span>
                  {m.id === 'balanced' ? <span className="block text-[10px] font-normal opacity-80">الموصى بها</span> : null}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {activeModeLabel?.hint ?? ''}
            {mode === 'custom' ? ` (حالياً ${pctLabel(customOffset, ar)})` : ''}
          </p>

          {/* custom offset slider — bound to advanced.lifestyle.customModeOffsetPct */}
          {mode === 'custom' ? (
            <div className="glass-thin rounded-xl p-3 mb-2 no-print">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold flex items-center gap-1.5">
                  <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden /> إزاحة الوضع المخصص
                </span>
                <span className="font-bold tabular-nums text-primary">{pctLabel(customOffset, ar)}</span>
              </div>
              <input
                type="range"
                min={-35}
                max={25}
                step={1}
                value={customOffset}
                onChange={(e) => setCustomOffset(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
                aria-label="إزاحة الوضع المخصص بالمئة"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>{pctLabel(-35, ar)} أوفر</span>
                <span>{pctLabel(25, ar)} أرقى</span>
              </div>
            </div>
          ) : null}

          {modeCompare ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
              {MODES.map((m) => {
                const mp = modeCompare[m.id]
                if (!mp) return null
                const bal = modeCompare.balanced
                const deltaPct = bal && bal.totals.costFils > 0 ? Math.round(((mp.totals.costFils - bal.totals.costFils) / bal.totals.costFils) * 100) : null
                return (
                  <button key={m.id} onClick={() => switchMode(m.id)} className="glass-row rounded-xl p-2.5 text-start">
                    <div className="font-bold tabular-nums text-sm">{formatBHD(mp.totals.costFils, { arabicNumerals: true, withUnit: false })} د.ب</div>
                    <div className="text-muted-foreground">{getAllPlanItems(mp).length} بند · هدر {formatNumberAr(mp.totals.wastePct, true)}٪</div>
                    {m.id === 'balanced' || deltaPct == null ? (
                      <div className="text-[11px] text-primary font-semibold">المرجع للمقارنة</div>
                    ) : (
                      <div className={`text-[11px] font-semibold tabular-nums ${deltaPct < 0 ? 'text-primary' : deltaPct > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                        {deltaPct < 0
                          ? `أوفر بـ ${formatNumberAr(-deltaPct, true)}٪ من المتوازن`
                          : deltaPct > 0
                            ? `أغلى بـ ${formatNumberAr(deltaPct, true)}٪ من المتوازن`
                            : 'مطابق للمتوازن'}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ) : null}
        </section>
      </FadeIn>

      {/* what-if */}
      <FadeIn delay={0.12}>
        <section className="no-print">
          <GlassCard className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm flex items-center gap-2"><Sparkles size={16} strokeWidth={1.75} aria-hidden /> ماذا لو؟ — حرّك الميزانية وشاهد الأثر فوراً</span>
              {whatIfLoading ? <Spinner className="w-4 h-4 text-primary" /> : null}
            </div>
            <input
              type="range"
              min={Math.round((store.budget?.fils ?? 0) * 0.4)}
              max={Math.round((store.budget?.fils ?? 0) * 2)}
              step={1000}
              value={whatIfBudget ?? store.budget?.fils ?? 0}
              onChange={(e) => setWhatIfBudget(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
              aria-label="محاكاة الميزانية"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatBHD(Math.round((store.budget?.fils ?? 0) * 0.4), { arabicNumerals: true })}</span>
              <span className="font-bold text-foreground tabular-nums">{formatBHD(whatIfBudget ?? store.budget?.fils ?? 0, { arabicNumerals: ar })}</span>
              <span>{formatBHD(Math.round((store.budget?.fils ?? 0) * 2), { arabicNumerals: true })}</span>
            </div>
            {whatIfPlan ? (
              <div className="mt-2 text-xs text-muted-foreground">
                المعاينة: {getAllPlanItems(whatIfPlan).length} بند بتكلفة {formatBHD(whatIfPlan.totals.costFils)} وتغطية أساسيات {Math.round(whatIfPlan.totals.coverageEssentials * 100)}٪
                <button className="underline text-primary ms-2" onClick={() => { store.setBudget({ ...store.budget!, fils: whatIfBudget! }); store.setPlan(whatIfPlan); setWhatIfBudget(null); setWhatIfPlan(null) }}>
                  اعتمد هذه الميزانية
                </button>
                <button className="underline text-muted-foreground ms-2" onClick={() => { setWhatIfBudget(null); setWhatIfPlan(null) }}>إلغاء</button>
              </div>
            ) : null}
          </GlassCard>
        </section>
      </FadeIn>

      {/* envelopes */}
      {envelopes.length ? (
        <FadeIn>
          <section>
            <SectionTitle>العناصر العامة وأظرف الميزانية</SectionTitle>
            <div className="space-y-2">
              {envelopes.map((env) => (
                <GlassCard key={env.envelopeId} className="p-4">
                  <button className="w-full flex items-center gap-3 text-start" onClick={() => setExpandedEnv(expandedEnv === env.envelopeId ? null : env.envelopeId)} aria-expanded={expandedEnv === env.envelopeId}>
                    <span className="w-10 h-10 rounded-xl bg-accent/15 text-accent grid place-items-center shrink-0"><CategoryIcon category="chocolate-sweets" size={20} /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold">{env.name}</span>
                      <span className="block text-xs text-muted-foreground">{env.items.length} أصناف · تنويع {env.variety}٪ {env.minFils != null ? `· النطاق ${formatBHD(env.minFils, { withUnit: false, arabicNumerals: true })}–${formatBHD(env.maxFils ?? 0, { withUnit: false, arabicNumerals: true })}` : ''}</span>
                    </span>
                    <span className="font-extrabold text-accent tabular-nums">{formatBHD(env.spentFils, { arabicNumerals: ar })}</span>
                    {expandedEnv === env.envelopeId ? <ChevronUp size={18} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={18} strokeWidth={1.75} aria-hidden />}
                  </button>
                  {expandedEnv === env.envelopeId ? (
                    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                      {env.explanation.map((e, i) => <div key={i} className="text-xs text-muted-foreground leading-relaxed">{e}</div>)}
                      <div className="grid gap-1.5">
                        {env.items.map((it) => (
                          <div key={it.key} className="glass-row rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
                            <span className="flex-1 truncate">{it.productName} <span className="text-muted-foreground text-xs">{it.sizeText}</span></span>
                            <span className="tabular-nums font-semibold">{formatBHD(it.costFils, { arabicNumerals: ar })}</span>
                            <button
                              onClick={() => { store.addLock({ productId: it.productId, fromEnvelopeId: env.envelopeId }); regen({}).then((p) => p && store.setPlan(p)) }}
                              className="min-h-9 min-w-9 grid place-items-center text-primary" title="ثبّت هذا المنتج" aria-label={`ثبّت ${it.productName}`}
                            >
                              <Pin size={15} strokeWidth={1.75} aria-hidden />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </GlassCard>
              ))}
            </div>
          </section>
        </FadeIn>
      ) : null}

      {/* items by class */}
      <FadeIn>
        <section>
          <SectionTitle>بنود الخطة</SectionTitle>
          <div className="space-y-5">
            {grouped.map(([cls, clsItems]) => (
              <div key={cls}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-muted-foreground">{CLASS_LABEL[cls] ?? cls}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatBHD(clsItems.reduce((s, i) => s + i.costFils, 0), { arabicNumerals: true })}</span>
                </div>
                <StaggerList className="space-y-2">
                  {clsItems.map((it) => (
                    <StaggerItem key={it.key}>
                      <PlanItemCard
                        item={it}
                        arabicNumerals={ar}
                        onWhy={() => setWhyItem(it)}
                        onSwap={() => setSwapItem(it)}
                        onPin={() => { store.addLock({ productId: it.productId }); regen({}).then((p) => p && store.setPlan(p)) }}
                        onUnpin={() => { store.removeLock(it.productId); regen({}).then((p) => p && store.setPlan(p)) }}
                        pinned={store.locks.some((l) => l.productId === it.productId)}
                        onQty={(d) => { store.addLock({ productId: it.productId, qty: Math.max(1, it.packQty + d) }); regen({}).then((p) => p && store.setPlan(p)) }}
                      />
                    </StaggerItem>
                  ))}
                </StaggerList>
              </div>
            ))}
            {fixedItems.length ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-muted-foreground flex items-center gap-1"><Lock size={14} strokeWidth={1.75} aria-hidden /> بنود محجوزة (ثابتة)</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatBHD(fixedItems.reduce((s, i) => s + i.costFils, 0), { arabicNumerals: true })}</span>
                </div>
                <StaggerList className="space-y-2">
                  {fixedItems.map((it) => (
                    <StaggerItem key={it.key}>
                      <PlanItemCard item={it} arabicNumerals={ar} onWhy={() => setWhyItem(it)} onSwap={() => setSwapItem(it)} onPin={() => {}} onUnpin={() => {}} pinned onQty={() => {}} locked />
                    </StaggerItem>
                  ))}
                </StaggerList>
              </div>
            ) : null}
          </div>
        </section>
      </FadeIn>

      {/* budget distribution */}
      <FadeIn>
        <section>
          <SectionTitle>توزيع الميزانية</SectionTitle>
          <GlassCard className="p-4">
            <AnimatedDonut
              segments={dist.map((d) => ({ pct: d.pct, color: DIST_COLORS[d.clazz] ?? 'var(--muted)' }))}
              centerLabel={`${formatNumberAr(Math.round(distTotal / 100) / 10, ar)} د.ب`}
              centerSub="الإجمالي"
              ariaLabel={`توزيع الميزانية: ${dist.map((d) => `${CLASS_LABEL[d.clazz] ?? d.clazz} ${d.pct}%`).join(', ')}`}
            />
            <div className="mt-3 space-y-1">
              {dist.map((d) => (
                <div key={d.clazz} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm" style={{ background: DIST_COLORS[d.clazz] ?? 'var(--muted)' }} aria-hidden />
                    {CLASS_LABEL[d.clazz] ?? d.clazz}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatBHD(d.fils, { arabicNumerals: true })} · {formatNumberAr(d.pct, true)}٪</span>
                </div>
              ))}
            </div>

            {/* nutrition: energy estimate + calorie-density economics */}
            {nutrition && (nutrition.approxCaloriesPerDay > 0 || nutrition.costPer1000kcalFils != null) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {nutrition.approxCaloriesPerDay > 0 ? (
                  <StatTile label="الطاقة التقديرية" value={`≈${formatNumberAr(nutrition.approxCaloriesPerDay, ar)} سعرة/يوم`} hint="لكل مكافئ بالغ" />
                ) : null}
                {nutrition.costPer1000kcalFils != null ? (
                  <StatTile label="كلفة الطاقة" value={formatBHD(nutrition.costPer1000kcalFils, { arabicNumerals: ar })} hint="لكل ١٠٠٠ سعرة" tone="accent" />
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 text-xs text-muted-foreground">
              الهدف الإرشادي: الأساسيات والمواد الغذائية 55-70٪، والتحلية أقل من 8٪.
              الأسعار تقديرية على السعر المرجعي (الوسيط) بين المتاجر بتاريخ الكتالوج {formatDateAr(plan.generatedAt.slice(0, 10))} — المتاجر هنا مراجع أسعار للتوثيق، لا وجهة شراء مفروضة.
            </div>
          </GlassCard>
        </section>
      </FadeIn>

      {/* diagnostics transparency panel */}
      <FadeIn>
        <section>
          <GlassCard className="p-0 overflow-hidden print-avoid-break">
            <button
              className="w-full min-h-[52px] px-4 flex items-center gap-3 text-start"
              onClick={() => setShowDiag((v) => !v)}
              aria-expanded={showDiag}
              aria-controls="plan-diagnostics"
            >
              <span className="w-10 h-10 rounded-xl bg-accent/15 text-accent grid place-items-center shrink-0"><Gauge size={20} strokeWidth={1.75} aria-hidden /></span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">شفافية الخطة بالأرقام</span>
                <span className="block text-xs text-muted-foreground">المستهدف مقابل المحقق، الاحتياطي، وجولات التحسين — كلها على السعر المرجعي (الوسيط)</span>
              </span>
              {showDiag ? <ChevronUp size={18} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={18} strokeWidth={1.75} aria-hidden />}
            </button>
            {showDiag ? (
              <FadeIn y={4}>
                <div id="plan-diagnostics" className="px-4 pb-4 pt-2 border-t border-border/50 space-y-4">
                  {/* allocation: target vs achieved with twin bars + delta pill */}
                  {alloc.length ? (
                    <div>
                      <div className="text-xs font-bold mb-2">توزيع الميزانية: المستهدف مقابل المحقق (٪)</div>
                      <div className="space-y-2.5">
                        {alloc.map((a) => {
                          const delta = a.achievedPct - a.targetPct
                          const name = a.nameAr ?? ALLOC_GROUPS[a.group as AllocGroupId]?.nameAr ?? a.group
                          return (
                            <div key={a.group}>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="font-semibold">{name}</span>
                                <span className="flex items-center gap-1.5">
                                  <span className="text-muted-foreground tabular-nums">هدف {formatNumberAr(a.targetPct, true)}٪ · محقق {formatNumberAr(a.achievedPct, true)}٪</span>
                                  <Pill tone={Math.abs(delta) <= 3 ? 'primary' : 'warn'} className="tabular-nums">
                                    {pctLabel(Math.round(delta * 10) / 10, true)}
                                  </Pill>
                                </span>
                              </div>
                              <div className="space-y-1">
                                <AnimatedBar pct={a.targetPct} tone="accent" className="h-1.5 opacity-50" />
                                <AnimatedBar pct={a.achievedPct} tone="primary" />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* engine transparency stats */}
                  <div className="flex flex-wrap gap-2">
                    <StatTile label="إزاحة الوضع" value={pctLabel(diag?.modeOffsetPct ?? 0, ar)} tone="primary" hint="انزياح المستوى السعري" />
                    <StatTile label="احتياطي المرونة" value={formatBHD(diag?.reserveFils ?? 0, { arabicNumerals: ar })} hint="محجوز للطوارئ" />
                    <StatTile label="حصة الترفيه" value={`${formatNumberAr(diag?.treatSharePct ?? 0, ar)}٪`} hint="من الميزانية" />
                    <StatTile
                      label="جولات التحسين الذكي"
                      value={formatNumberAr(diag?.refinementPasses ?? 0, ar)}
                      hint={(diag?.refinementGains ?? 0) > 0 ? `مكاسب إضافية ${formatNumberAr(Math.round((diag?.refinementGains ?? 0) * 10) / 10, ar)} نقطة منفعة` : undefined}
                    />
                  </div>

                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    النسب من إجمالي الميزانية المخطط له. «جولات التحسين الذكي» تبديلات محلية بعد التوزيع الأولي ترفع المنفعة دون تجاوز الهدف، و«نقطة المنفعة» وحدة التقييم الداخلية للمحرك.
                  </div>
                </div>
              </FadeIn>
            ) : null}
          </GlassCard>
        </section>
      </FadeIn>

      {/* trips */}
      <FadeIn>
        <section>
          <SectionTitle>تقويم رحلات الشراء</SectionTitle>
          <div className="space-y-2">
            {activePlan?.trips.map((trip) => (
              <GlassRow key={trip.trip} className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center text-primary shrink-0"><CalendarDays size={18} strokeWidth={1.75} aria-hidden /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{trip.label}</div>
                  <div className="text-xs text-muted-foreground">{trip.dateISO ? formatDateAr(trip.dateISO) : 'حسب يوم الراتب'} · {trip.itemKeys.length} بند</div>
                </div>
                <div className="font-bold tabular-nums text-sm">{formatBHD(trip.fils, { arabicNumerals: true })}</div>
              </GlassRow>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-2">المواد سريعة التلف (حليب طازج، خبز، خضار) تُشترى في رحلات أسبوعية لتقليل الهدر — انظر أعمار الصلاحية في شرح كل بند.</div>
        </section>
      </FadeIn>

      {/* why modal */}
      {whyItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="شرح البند">
          <div className="glass-chrome rounded-3xl max-w-lg w-full max-h-[85dvh] overflow-y-auto nice-scroll p-5 pop-in">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <div className="font-bold text-lg leading-tight">{whyItem.productName}</div>
                <div className="text-xs text-muted-foreground">{needLabel(whyItem.needId)} · {whyItem.brand ?? 'بدون علامة'}</div>
              </div>
              <button onClick={() => setWhyItem(null)} className="min-h-11 min-w-11 grid place-items-center rounded-full hover:bg-secondary/60" aria-label="إغلاق">✕</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <Pill>الكمية: {formatNumberAr(whyItem.packQty, ar)} عبوة</Pill>
              <Pill tone="primary">{formatBHD(whyItem.costFils, { arabicNumerals: ar })}</Pill>
              {whyItem.unitCostFils ? <Pill tone="accent">{formatBHD(Math.round(whyItem.unitCostFils), { arabicNumerals: true })}/وحدة أساس</Pill> : null}
              <Pill>تغطية {formatNumberAr(Math.round(whyItem.coverage * 100), true)}٪</Pill>
              <Pill tone={whyItem.wastePct > 10 ? 'warn' : 'default'}>هدر {formatNumberAr(whyItem.wastePct, true)}٪</Pill>
              <Pill>المستوى المئيلي {formatNumberAr(Math.round(whyItem.percentile * 100), true)}٪</Pill>
            </div>
            <div className="space-y-2">
              {whyItem.reasons.map((r, i) => (
                <div key={i} className="glass-row rounded-xl p-3 text-sm leading-relaxed flex gap-2">
                  <HelpCircle size={16} strokeWidth={1.75} className="text-primary shrink-0 mt-0.5" aria-hidden />
                  <span>{r.ar}</span>
                </div>
              ))}
            </div>

            {/* score composition — transparent percentages per bucket */}
            {whyItem.scoreParts ? (
              <div className="mt-4">
                <div className="text-sm font-bold mb-2">تركيبة التقييم (النسب المئوية)</div>
                <div className="space-y-2">
                  {SCORE_PARTS.map((sp) => {
                    const v = whyItem.scoreParts?.[sp.key]
                    if (v == null) return null
                    return (
                      <div key={sp.key}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{sp.label}</span>
                          <span className="tabular-nums font-semibold">{formatNumberAr(Math.round(v * 10) / 10, true)}٪</span>
                        </div>
                        <AnimatedBar pct={Math.min(100, Math.abs(v))} tone={sp.tone} />
                      </div>
                    )
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1.5">النسب من مجموع عناصر التقييم وتتغير بحسب أوزانك في الخيارات المتقدمة.</div>
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <GlassButton className="flex-1" onClick={() => { setSwapItem(whyItem); setWhyItem(null) }}>
                <ArrowLeftRight size={15} strokeWidth={1.75} aria-hidden /> بدّل المنتج
              </GlassButton>
              <GlassButton className="flex-1" variant="primary" onClick={() => setWhyItem(null)}>فهمت</GlassButton>
            </div>
          </div>
        </div>
      ) : null}

      {/* swap modal */}
      {swapItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="تبديل البند">
          <div className="glass-chrome rounded-3xl max-w-lg w-full max-h-[85dvh] overflow-y-auto nice-scroll p-5 pop-in">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="font-bold text-lg">بدائل «{swapItem.productName.slice(0, 40)}»</div>
              <button onClick={() => setSwapItem(null)} className="min-h-11 min-w-11 grid place-items-center rounded-full hover:bg-secondary/60" aria-label="إغلاق">✕</button>
            </div>
            <div className="space-y-2">
              {swapItem.alternatives.map((alt) => (
                <button
                  key={alt.productId}
                  onClick={() => { store.addLock({ productId: alt.productId, qty: alt.packQty }); regen({}).then((p) => { if (p) store.setPlan(p); setSwapItem(null) }) }}
                  className="w-full glass-row rounded-xl p-3 text-start hover:bg-secondary/70 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{alt.productName}</div>
                      <div className="text-xs text-muted-foreground">{alt.brand ?? ''} {alt.sizeText ?? ''} · ×{alt.packQty}</div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="font-bold tabular-nums text-sm">{formatBHD(alt.costFils, { arabicNumerals: true })}</div>
                      <div className={`text-[11px] tabular-nums ${alt.deltaFils < 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                        {alt.deltaFils < 0 ? `أوفر ${formatBHD(-alt.deltaFils, { arabicNumerals: true, withUnit: false })}` : `+${formatBHD(alt.deltaFils, { arabicNumerals: true, withUnit: false })}`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    <Pill tone={alt.kind === 'cheaper' ? 'primary' : alt.kind === 'better' ? 'accent' : 'default'}>
                      {alt.kind === 'cheaper' ? 'أوفر' : alt.kind === 'equivalent' ? 'مكافئ' : 'أفضل'}
                    </Pill>
                    <span className="text-[11px] text-muted-foreground">{alt.note}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <GlassButton className="flex-1" onClick={() => { store.removeLock(swapItem.productId); regen({}).then((p) => { if (p) store.setPlan(p); setSwapItem(null) }) }}>
                <Trash2 size={15} strokeWidth={1.75} aria-hidden /> احذف البند
              </GlassButton>
              <GlassButton className="flex-1" onClick={() => setSwapItem(null)}>إلغاء</GlassButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const DIST_COLORS: Record<string, string> = {
  mandatory: '#8a6d3b',
  essential: '#1e6b4f',
  regular: '#5b8c5a',
  comfort: '#d97706',
  treat: '#c2571c',
}

function PlanItemCard({ item, arabicNumerals, onWhy, onSwap, onPin, onUnpin, onQty, pinned, locked }: {
  item: PlanItem
  arabicNumerals: boolean
  onWhy: () => void
  onSwap: () => void
  onPin: () => void
  onUnpin: () => void
  onQty: (delta: number) => void
  pinned: boolean
  locked?: boolean
}) {
  return (
    <GlassRow className="p-3 flex items-center gap-3">
      <span className="w-11 h-11 rounded-xl glass-ultrathin grid place-items-center text-primary shrink-0">
        <CategoryIcon category={item.needId.split('@')[0] === 'diapers' || item.needId.split('@')[0] === 'formula' ? 'baby-products' : 'milk'} size={20} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate" dir="auto">{item.productName}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {needLabel(item.needId)} · {item.sizeText ?? ''} {item.brand ? `· ${item.brand}` : ''}
        </div>
        <div className="flex items-center gap-1 mt-1">
          {locked || pinned ? <Pill tone="primary"><Lock size={11} strokeWidth={2} aria-hidden /> ثابت</Pill> : null}
          {item.wastePct > 15 ? <Pill tone="warn"><TriangleAlert size={11} strokeWidth={2} aria-hidden /> هدر {formatNumberAr(item.wastePct, true)}٪</Pill> : null}
          {item.trip >= 2 ? <Pill>رحلة أسبوعية</Pill> : null}
        </div>
      </div>
      <div className="text-end shrink-0">
        <div className="font-extrabold tabular-nums">{formatBHD(item.costFils, { arabicNumerals })}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">×{formatNumberAr(item.packQty, arabicNumerals)} عبوة</div>
      </div>
      <div className="flex flex-col gap-1 shrink-0 no-print">
        <div className="flex gap-1">
          <button onClick={onWhy} className="min-h-9 min-w-9 grid place-items-center rounded-lg hover:bg-secondary/70" title="لماذا هذا الاختيار؟" aria-label={`لماذا ${item.productName}`}>
            <HelpCircle size={15} strokeWidth={1.75} aria-hidden />
          </button>
          <button onClick={onSwap} className="min-h-9 min-w-9 grid place-items-center rounded-lg hover:bg-secondary/70" title="بدّل" aria-label={`بدّل ${item.productName}`}>
            <ArrowLeftRight size={15} strokeWidth={1.75} aria-hidden />
          </button>
          <button onClick={pinned ? onUnpin : onPin} className={`min-h-9 min-w-9 grid place-items-center rounded-lg ${pinned ? 'text-primary' : 'hover:bg-secondary/70'}`} title={pinned ? 'أزل التثبيت' : 'ثبّت'} aria-label={pinned ? `أزل تثبيت ${item.productName}` : `ثبّت ${item.productName}`}>
            {pinned ? <Pin size={15} strokeWidth={1.75} aria-hidden /> : <Lock size={15} strokeWidth={1.75} aria-hidden />}
          </button>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onQty(-1)} className="min-h-8 min-w-8 grid place-items-center rounded-lg text-xs font-bold hover:bg-secondary/70" aria-label="عبوة أقل"><Minus size={13} strokeWidth={2} aria-hidden /></button>
          <button onClick={() => onQty(1)} className="min-h-8 min-w-8 grid place-items-center rounded-lg text-xs font-bold hover:bg-secondary/70" aria-label="عبوة أكثر"><Plus size={13} strokeWidth={2} aria-hidden /></button>
        </div>
      </div>
    </GlassRow>
  )
}
