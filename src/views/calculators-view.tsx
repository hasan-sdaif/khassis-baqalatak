'use client'
/**
 * Calculators view (spec 7.8): smart instant calculators —
 * diapers, infant formula, smoking (18+ neutral, age-gated), "how long
 * will it last?", unit-price compare, hospitality portions, expense split.
 * All math is instant & client-side (product search is the only API call);
 * every calculator shows its equation and can pin results into the plan
 * where sensible (product lock).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '@/store/app-store'
import { searchProducts } from '@/lib/api-client'
import { formatBHD, parseBHDToFils, formatNumberAr, formatQty, unitLabelAr } from '@/lib/money'
import { GlassCard, GlassButton, Pill, StatTile, Spinner } from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import {
  NEEDS_MAP, diaperChangesPerDay, diaperSizeForWeight, formulaStage, formulaMlPerDay,
  FORMULA_POWDER_RATIO, medianWeightKg, adultEquivalent,
} from '@/lib/engine'
import type { CatalogProduct, UnitKind } from '@/lib/engine/types'
import type { LucideIcon } from 'lucide-react'
import {
  Baby, Milk, Cigarette, CalendarClock, Scale, Coffee, Users, ShieldCheck, Search, Pin,
  Info, TriangleAlert, Sigma, Plus, Minus, X,
} from 'lucide-react'

// ------------------------------ shared bits ------------------------------

const TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'diapers', label: 'الحفاضات', icon: Baby },
  { id: 'formula', label: 'حليب الأطفال', icon: Milk },
  { id: 'smoking', label: 'التدخين', icon: Cigarette },
  { id: 'lasts', label: 'كم يكفي؟', icon: CalendarClock },
  { id: 'unit', label: 'سعر الوحدة', icon: Scale },
  { id: 'hospitality', label: 'الضيافة', icon: Coffee },
  { id: 'split', label: 'تقسيم المصروف', icon: Users },
]

/** parse loose numeric input (Arabic-Indic digits tolerated) */
function parseNum(input: string): number {
  const cleaned = String(input).replace(/[٠-٩]/g, (d) => String(d.codePointAt(0)! - 0x0660)).replace(/[^\d.]/g, '')
  const v = parseFloat(cleaned)
  return Number.isNaN(v) ? 0 : v
}

const round1 = (x: number): number => Math.round(x * 10) / 10

/** equation / derivation line */
function Eq({ children }: { children: ReactNode }) {
  return (
    <div className="glass-ultrathin rounded-xl px-3 py-2 text-xs text-muted-foreground tabular-nums leading-relaxed flex items-start gap-2">
      <Sigma size={14} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

function Chip({ selected, onClick, children, ariaLabel }: { selected: boolean; onClick: () => void; children: ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={`min-h-11 px-4 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${selected ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : 'glass-thin hover:bg-secondary/60'}`}
    >
      {children}
    </button>
  )
}

function NumField({ label, value, onChange, ariaLabel, hint }: { label: string; value: string; onChange: (s: string) => void; ariaLabel: string; hint?: string }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground block mb-1">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="glass-thin rounded-xl min-h-11 px-3 w-full tabular-nums"
      />
      {hint ? <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{hint}</div> : null}
    </div>
  )
}

function SliderRow({ label, min, max, step, value, onChange, display, ariaLabel }: {
  label: string; min: number; max: number; step: number; value: number
  onChange: (v: number) => void; display: string; ariaLabel: string
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-sm font-semibold mb-2 gap-2">
        <span className="truncate">{label}</span>
        <span className="tabular-nums text-primary text-base font-bold shrink-0">{display}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
        aria-label={ariaLabel}
      />
    </div>
  )
}

function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
      <Info size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

// ------------------------------ 1) diapers ------------------------------

/** approximate age (months) whose WHO median weight is closest to kg */
function ageFromWeight(kg: number): number {
  let best = 0
  let bestDiff = Infinity
  for (let m = 0; m <= 36; m++) {
    const d = Math.abs(medianWeightKg(m) - kg)
    if (d < bestDiff) { bestDiff = d; best = m }
  }
  return best
}

function DiapersCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const addLock = useApp((s) => s.addLock)
  const locks = useApp((s) => s.locks)
  const [byAge, setByAge] = useState(true)
  const [ageMonths, setAgeMonths] = useState(6)
  const [weightKg, setWeightKg] = useState(7.5)
  const [costStr, setCostStr] = useState('2.500')
  const [piecesStr, setPiecesStr] = useState('60')
  const [fetching, setFetching] = useState(false)
  const [fetched, setFetched] = useState<{ productId: string; name: string } | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const age = byAge ? ageMonths : ageFromWeight(weightKg)
  const weight = byAge ? medianWeightKg(ageMonths) : weightKg
  const changes = diaperChangesPerDay(age)
  const monthlyCount = changes * 30
  const sizeInfo = diaperSizeForWeight(weight)
  const costFils = parseBHDToFils(costStr)
  const pieces = Math.max(0, parseNum(piecesStr))
  const perDiaperFils = pieces > 0 ? costFils / pieces : 0
  const monthlyCost = Math.round(monthlyCount * perDiaperFils)
  const yearlyCost = Math.round(changes * 365 * perDiaperFils)
  const packsNeeded = Math.max(1, Math.ceil(monthlyCount / Math.max(1, pieces)))
  const locked = fetched ? locks.some((l) => l.productId === fetched.productId) : false

  const fetchCheapest = async () => {
    setFetching(true)
    setFetchError(null)
    setFetched(null)
    try {
      const res = await searchProducts({ need: 'diapers', sort: 'unit-asc', limit: 1 })
      const p = res.items[0]
      if (!p) {
        setFetchError('لا توجد حفاضات في الكتالوج حالياً — أدخل السعر يدوياً')
        return
      }
      setCostStr((p.medianFils / 1000).toString())
      if (p.size && p.size.unit === 'pcs' && p.size.baseQuantity > 0) setPiecesStr(String(p.size.baseQuantity))
      setFetched({ productId: p.id, name: (p.nameAr && p.nameAr.trim()) || p.nameEn })
    } catch {
      setFetchError('تعذر جلب السعر — أدخله يدوياً')
    } finally {
      setFetching(false)
    }
  }

  return (
    <GlassCard className="p-4 sm:p-5 space-y-4">
      <div className="flex gap-2" role="group" aria-label="طريقة الإدخال">
        <Chip selected={byAge} onClick={() => setByAge(true)}>حسب العمر</Chip>
        <Chip selected={!byAge} onClick={() => setByAge(false)}>حسب الوزن</Chip>
      </div>

      {byAge ? (
        <SliderRow
          label="عمر الرضيع" min={0} max={36} step={1} value={ageMonths} onChange={setAgeMonths}
          display={`${formatNumberAr(ageMonths, arabicNumerals)} شهر · ≈ ${formatNumberAr(round1(weight), arabicNumerals)} كجم`}
          ariaLabel="عمر الرضيع بالأشهر"
        />
      ) : (
        <SliderRow
          label="وزن الرضيع" min={2} max={30} step={0.5} value={weightKg} onChange={setWeightKg}
          display={`${formatNumberAr(weightKg, arabicNumerals)} كجم · ≈ ${formatNumberAr(age, arabicNumerals)} شهر`}
          ariaLabel="وزن الرضيع بالكيلوجرام"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <StatTile label="تغييرات يومياً" value={formatNumberAr(changes, arabicNumerals)} tone="primary" />
        <StatTile label="حفاضات شهرياً" value={formatNumberAr(Math.round(monthlyCount), arabicNumerals)} />
        <StatTile label="المقاس المناسب" value={formatNumberAr(sizeInfo.size, arabicNumerals)} hint={byAge ? 'حسب الوزن الوسيط للعمر' : undefined} />
      </div>

      {sizeInfo.nearBoundary ? (
        <div className="glass-thin rounded-xl p-3 text-xs flex gap-2 items-start border border-amber-500/40">
          <TriangleAlert size={14} strokeWidth={1.75} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <span>
            الوزن قرب حدود المقاس {formatNumberAr(sizeInfo.size, arabicNumerals)} — جهّز للمقاس الأكبر قريباً لتجنب الضيق والتسريب.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <NumField label="سعر العبوة (د.ب)" value={costStr} onChange={setCostStr} ariaLabel="سعر عبوة الحفاضات بالدينار" hint={formatBHD(costFils, { arabicNumerals })} />
        <NumField label="حفاضات في العبوة" value={piecesStr} onChange={setPiecesStr} ariaLabel="عدد الحفاضات في العبوة" hint={`${formatNumberAr(pieces, arabicNumerals)} حبة`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <GlassButton size="sm" onClick={fetchCheapest} disabled={fetching}>
          {fetching ? <Spinner className="w-4 h-4" /> : <Search size={14} strokeWidth={1.75} aria-hidden />} استخدم أرخص حفاضة من الكتالوج
        </GlassButton>
        {fetched ? <span className="text-xs text-muted-foreground truncate">{fetched.name}</span> : null}
      </div>
      {fetchError ? <div className="text-xs text-destructive" role="alert">{fetchError}</div> : null}

      <div className="flex flex-wrap gap-2">
        <StatTile label="تكلفة الحفاضة الواحدة" value={formatBHD(Math.round(perDiaperFils), { arabicNumerals })} />
        <StatTile label="التكلفة الشهرية" value={formatBHD(monthlyCost, { arabicNumerals })} tone="primary" />
        <StatTile label="التكلفة السنوية" value={formatBHD(yearlyCost, { arabicNumerals })} tone="accent" />
      </div>

      <Eq>
        {formatNumberAr(changes, arabicNumerals)} حفاضات/يوم × 30 يوم × {formatBHD(Math.round(perDiaperFils), { arabicNumerals, withUnit: false })} د.ب = {formatBHD(monthlyCost, { arabicNumerals, withUnit: false })} د.ب/شهر
      </Eq>

      {fetched ? (
        locked ? (
          <div className="glass-thin rounded-xl p-3 text-sm flex items-center gap-2">
            <Pin size={15} strokeWidth={1.75} className="text-primary shrink-0" aria-hidden />
            مثبّت في الخطة ({formatNumberAr(packsNeeded, arabicNumerals)} عبوة شهرياً)
          </div>
        ) : (
          <GlassButton size="sm" variant="primary" onClick={() => addLock({ productId: fetched.productId, qty: packsNeeded })}>
            <Pin size={14} strokeWidth={1.75} aria-hidden /> أضف النتائج للخطة — {formatNumberAr(packsNeeded, arabicNumerals)} عبوة شهرياً
          </GlassButton>
        )
      ) : null}

      <InfoNote>أسعار الكتالوج وسيطة تقديرية — تحقّق من مطابقة المقاس {formatNumberAr(sizeInfo.size, arabicNumerals)} عند الشراء، فالأرخص قد يكون مقاساً مختلفاً.</InfoNote>
    </GlassCard>
  )
}

// ------------------------------ 2) formula ------------------------------

function FormulaCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const [ageMonths, setAgeMonths] = useState(4)
  const [depPct, setDepPct] = useState(100)
  const [costStr, setCostStr] = useState('5.000')
  const [gramsStr, setGramsStr] = useState('400')

  const stage = formulaStage(ageMonths)
  const ml = formulaMlPerDay(ageMonths)
  const gramsPerDay = ml * FORMULA_POWDER_RATIO * (depPct / 100)
  const gramsPerMonth = gramsPerDay * 30
  const tinFils = parseBHDToFils(costStr)
  const tinGrams = Math.max(1, parseNum(gramsStr))
  const tins = gramsPerMonth / tinGrams
  const tinsPractical = Math.max(0, Math.ceil(tins - 1e-9))
  const monthlyCost = tinsPractical * tinFils
  const nextStage = Math.min(3, stage.stage + 1)

  return (
    <GlassCard className="p-4 sm:p-5 space-y-4">
      <SliderRow
        label="عمر الرضيع" min={0} max={36} step={1} value={ageMonths} onChange={setAgeMonths}
        display={`${formatNumberAr(ageMonths, arabicNumerals)} شهر`}
        ariaLabel="عمر الرضيع بالأشهر"
      />
      <SliderRow
        label="الاعتماد على الحليب الصناعي" min={0} max={100} step={5} value={depPct} onChange={setDepPct}
        display={`${formatNumberAr(depPct, arabicNumerals)}٪`}
        ariaLabel="نسبة الاعتماد على الحليب الصناعي"
      />

      <div className="grid grid-cols-2 gap-3">
        <NumField label="سعر العلبة (د.ب)" value={costStr} onChange={setCostStr} ariaLabel="سعر علبة حليب الأطفال بالدينار" hint={formatBHD(tinFils, { arabicNumerals })} />
        <NumField label="وزن العلبة (جم)" value={gramsStr} onChange={setGramsStr} ariaLabel="وزن علبة الحليب بالجرام" hint={`${formatNumberAr(tinGrams, arabicNumerals)} جم`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <StatTile label="الجرام اليومي" value={`${formatNumberAr(round1(gramsPerDay), arabicNumerals)} جم`} />
        <StatTile label="الجرام الشهري" value={formatQty('g', Math.round(gramsPerMonth))} />
        <StatTile label="علب شهرياً" value={formatNumberAr(round1(tins), arabicNumerals)} hint={`عملياً ${formatNumberAr(tinsPractical, arabicNumerals)} علبة`} />
        <StatTile label="المرحلة" value={formatNumberAr(stage.stage, arabicNumerals)} tone="primary" />
      </div>

      <div className="flex flex-wrap gap-2">
        <StatTile label="التكلفة الشهرية" value={formatBHD(monthlyCost, { arabicNumerals })} tone="accent" />
        <StatTile label="التكلفة السنوية" value={formatBHD(monthlyCost * 12, { arabicNumerals })} />
      </div>

      <Eq>
        {formatNumberAr(ml, arabicNumerals)} مل/يوم × {formatNumberAr(FORMULA_POWDER_RATIO, arabicNumerals)} × {formatNumberAr(depPct, arabicNumerals)}٪ = {formatNumberAr(round1(gramsPerDay), arabicNumerals)} جم/يوم → × 30 يوم ÷ {formatNumberAr(tinGrams, arabicNumerals)} جم/علبة ≈ {formatNumberAr(round1(tins), arabicNumerals)} علب → {formatNumberAr(tinsPractical, arabicNumerals)} × {formatBHD(tinFils, { arabicNumerals, withUnit: false })} د.ب = {formatBHD(monthlyCost, { arabicNumerals, withUnit: false })} د.ب/شهر
      </Eq>

      {stage.transitionInDays != null ? (
        <div className="glass-thin rounded-xl p-3 text-xs flex gap-2 items-start border border-amber-500/40">
          <TriangleAlert size={14} strokeWidth={1.75} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <span>
            الانتقال من المرحلة {formatNumberAr(stage.stage, arabicNumerals)} خلال ≈ {formatNumberAr(stage.transitionInDays, arabicNumerals)} يوماً —
            خطّت الشراء القادم على المرحلة {formatNumberAr(nextStage, arabicNumerals)} لتقليل الفائض غير المستخدم.
          </span>
        </div>
      ) : null}

      <InfoNote>هذه تقديرات إرشادية بحسب جدول التغذية العام — يُقدَّم ملصق العلبة وتوجيه الطبيب على أي حساب.</InfoNote>
    </GlassCard>
  )
}

// ------------------------------ 3) smoking (18+) ------------------------------

function SmokingGate({ children }: { children: ReactNode }) {
  const ageGatePassed = useApp((s) => s.settings.ageGatePassed)
  const setSettings = useApp((s) => s.setSettings)
  if (ageGatePassed) return <>{children}</>
  return (
    <GlassCard className="p-6 max-w-md mx-auto text-center">
      <span className="mx-auto mb-3 w-12 h-12 rounded-full glass-thin grid place-items-center text-primary">
        <ShieldCheck size={22} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="font-bold text-lg mb-1">هذه الحاسبة للبالغين (18+)</div>
      <div className="text-sm text-muted-foreground leading-relaxed mb-4">
        حاسبة تكلفة التدخين تعرض أرقام تكلفة فقط، دون أي تقييم أو توصيات.
      </div>
      <GlassButton variant="primary" size="lg" onClick={() => setSettings({ ageGatePassed: true })}>
        أنا فوق 18
      </GlassButton>
    </GlassCard>
  )
}

function SmokingCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const [cigs, setCigs] = useState(20)
  const [priceStr, setPriceStr] = useState('1.500')
  const [reducePct, setReducePct] = useState(0)

  const packFils = parseBHDToFils(priceStr)
  const perCigFils = packFils / 20
  const daily = cigs * perCigFils
  const weekly = Math.round(daily * 7)
  const monthly = Math.round(daily * 30)
  const yearly = Math.round(daily * 365)
  const newYearly = Math.round(yearly * (1 - reducePct / 100))
  const saved = yearly - newYearly

  return (
    <GlassCard className="p-4 sm:p-5 space-y-4">
      <SliderRow
        label="عدد السجائر يومياً" min={0} max={40} step={1} value={cigs} onChange={setCigs}
        display={`${formatNumberAr(cigs, arabicNumerals)} سيجارة/يوم`}
        ariaLabel="عدد السجائر يومياً"
      />
      <NumField label="سعر العلبة (20 سيجارة، د.ب)" value={priceStr} onChange={setPriceStr} ariaLabel="سعر علبة السجائر بالدينار" hint={`${formatBHD(Math.round(perCigFils), { arabicNumerals })} للسيجارة الواحدة`} />

      <div className="flex flex-wrap gap-2">
        <StatTile label="أسبوعياً" value={formatBHD(weekly, { arabicNumerals })} />
        <StatTile label="شهرياً" value={formatBHD(monthly, { arabicNumerals })} tone="primary" />
        <StatTile label="سنوياً" value={formatBHD(yearly, { arabicNumerals })} tone="accent" />
      </div>

      <Eq>
        {formatNumberAr(cigs, arabicNumerals)} سيجارة/يوم × {formatBHD(Math.round(perCigFils), { arabicNumerals, withUnit: false })} د.ب × 365 يوم = {formatBHD(yearly, { arabicNumerals, withUnit: false })} د.ب/سنة
      </Eq>

      <div className="pt-3 border-t border-border/60 space-y-3">
        <SliderRow
          label="محاكي: لو خفّضت الاستهلاك" min={0} max={100} step={5} value={reducePct} onChange={setReducePct}
          display={`${formatNumberAr(reducePct, arabicNumerals)}٪`}
          ariaLabel="نسبة تخفيف الاستهلاك"
        />
        <div className="flex flex-wrap gap-2 items-center">
          <StatTile label="الكلفة السنوية الجديدة" value={formatBHD(newYearly, { arabicNumerals })} />
          {saved > 0 ? <Pill tone="accent">وفّر {formatBHD(saved, { arabicNumerals })} سنوياً</Pill> : null}
        </div>
        <Eq>
          {formatBHD(yearly, { arabicNumerals, withUnit: false })} د.ب × (1 − {formatNumberAr(reducePct, arabicNumerals)}٪) = {formatBHD(newYearly, { arabicNumerals, withUnit: false })} د.ب/سنة
        </Eq>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer underline decoration-dotted underline-offset-4 min-h-11 flex items-center">
          معلومات رسمية عن الإقلاع متاحة عند الطلب
        </summary>
        <div className="pt-1 pb-2 leading-relaxed break-all" dir="ltr">
          <a href="https://www.who.int/ar" target="_blank" rel="noopener noreferrer" className="underline">https://www.who.int/ar</a>
          <br />
          <a href="https://www.health.gov.bh" target="_blank" rel="noopener noreferrer" className="underline">https://www.health.gov.bh</a>
        </div>
      </details>
    </GlassCard>
  )
}

// ------------------------------ 4) how long will it last? ------------------------------

function LastsCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const household = useApp((s) => s.household)
  const addLock = useApp((s) => s.addLock)
  const locks = useApp((s) => s.locks)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<CatalogProduct | null>(null)
  const [qtyStr, setQtyStr] = useState('1500')
  const [unit, setUnit] = useState<UnitKind>('ml')
  const [membersStr, setMembersStr] = useState<string>(() => {
    if (!household || household.members.length === 0) return '4'
    const sum = household.members.reduce((s, m) => s + adultEquivalent(m), 0)
    return String(round1(Math.max(0.1, sum)))
  })
  const [needId, setNeedId] = useState('milk.uht.full')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const term = q.trim()
    if (timer.current) clearTimeout(timer.current)
    // all state updates happen inside the debounce callback (async), never
    // synchronously in the effect body — avoids cascading renders.
    timer.current = setTimeout(() => {
      if (term.length < 2) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      searchProducts({ q: term, limit: 8 })
        .then((r) => setResults(r.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q])

  const needOptions = useMemo(() => {
    const list = [...NEEDS_MAP.values()].filter((n) => n.visibleInWizard)
    if (needId && !list.some((n) => n.id === needId)) {
      const n = NEEDS_MAP.get(needId)
      if (n) list.unshift(n)
    }
    return list
  }, [needId])

  const selectProduct = (p: CatalogProduct) => {
    setSelected(p)
    setQ((p.nameAr && p.nameAr.trim()) || p.nameEn)
    setResults([])
    if (p.size) {
      setQtyStr(String(p.size.baseQuantity))
      setUnit(p.size.unit)
    }
    if (p.need) setNeedId(p.need)
  }

  const need = needId ? NEEDS_MAP.get(needId) ?? null : null
  const qty = parseNum(qtyStr)
  const members = Math.max(0.1, parseNum(membersStr))
  const perDaily = need ? need.adultMonthly / 30 : 0
  const unitMismatch = !!need && unit !== need.baseUnit
  const days = need && perDaily > 0 && qty > 0 && !unitMismatch ? qty / (perDaily * members) : null
  const daysRounded = days != null ? (days >= 20 ? Math.round(days) : round1(days)) : null
  const locked = selected ? locks.some((l) => l.productId === selected.id) : false

  return (
    <GlassCard className="p-4 sm:p-5 space-y-4">
      {/* product search */}
      <div className="relative">
        <Search size={16} strokeWidth={1.75} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" aria-hidden />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSelected(null) }}
          placeholder="ابحث عن منتج (حليب، أرز، شاي…)"
          aria-label="البحث عن منتج"
          className="glass-thin rounded-xl min-h-11 ps-10 pe-3 w-full"
        />
        {searching ? <Spinner className="absolute top-1/2 -translate-y-1/2 end-3 w-4 h-4 text-primary" /> : null}
      </div>

      {results.length > 0 ? (
        <div className="space-y-1.5 max-h-56 overflow-y-auto nice-scroll" role="listbox" aria-label="نتائج البحث">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => selectProduct(p)}
              className="glass-row rounded-xl w-full text-start p-3 flex items-center gap-2 hover:bg-secondary/60 transition-colors"
            >
              <CategoryIcon category={p.category} size={16} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{(p.nameAr && p.nameAr.trim()) || p.nameEn}</span>
                <span className="block text-[11px] text-muted-foreground tabular-nums">
                  {p.sizeText ?? 'بدون حجم'} · {formatBHD(p.medianFils, { arabicNumerals })}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <div className="glass-thin rounded-xl p-3 flex items-center gap-2 text-sm">
          <CategoryIcon category={selected.category} size={16} />
          <span className="flex-1 truncate font-medium">{(selected.nameAr && selected.nameAr.trim()) || selected.nameEn}</span>
          <button type="button" onClick={() => setSelected(null)} className="min-h-11 min-w-11 grid place-items-center rounded-full hover:bg-secondary/60" aria-label="إزالة المنتج المحدد">
            <X size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      ) : (
        <InfoNote>اختر منتجاً ليُستخدم حجمه ومعدل استهلاكه تلقائياً، أو أدخل الكمية يدوياً.</InfoNote>
      )}

      {/* quantity + members + need */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <NumField label="الكمية" value={qtyStr} onChange={setQtyStr} ariaLabel="الكمية المتوفرة" />
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="lasts-unit">الوحدة</label>
          <select
            id="lasts-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as UnitKind)}
            aria-label="وحدة الكمية"
            className="glass-thin rounded-xl min-h-11 px-3 w-full text-sm"
          >
            {(['ml', 'g', 'pcs', 'rolls', 'sheets', 'bags'] as const).map((u) => (
              <option key={u} value={u}>{unitLabelAr(u)}</option>
            ))}
          </select>
        </div>
        <NumField
          label="أفراد الأسرة (مكافئ بالغ)"
          value={membersStr}
          onChange={setMembersStr}
          ariaLabel="عدد أفراد الأسرة بمكافئ البالغ"
          hint={household ? 'من بيانات أسرتك' : '4 أفراد افتراضياً'}
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="lasts-need">نوع الاستهلاك</label>
        <select
          id="lasts-need"
          value={needId}
          onChange={(e) => setNeedId(e.target.value)}
          aria-label="نوع الاستهلاك"
          className="glass-thin rounded-xl min-h-11 px-3 w-full text-sm"
        >
          {needOptions.map((n) => (
            <option key={n.id} value={n.id}>{n.nameAr}</option>
          ))}
        </select>
      </div>

      {/* result */}
      {daysRounded != null && need ? (
        <>
          <div className="glass-thin rounded-2xl p-5 text-center">
            <div className="text-xs text-muted-foreground mb-1">تكفي</div>
            <div className="text-4xl font-extrabold tabular-nums text-primary" aria-live="polite">
              ≈ {formatNumberAr(daysRounded, arabicNumerals)} يوم
            </div>
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {daysRounded >= 7 ? `≈ ${formatNumberAr(round1(daysRounded / 7), arabicNumerals)} أسبوع` : ''}
              {daysRounded >= 60 ? ` · ≈ ${formatNumberAr(round1(daysRounded / 30), arabicNumerals)} شهر` : ''}
            </div>
          </div>
          <Eq>
            {formatNumberAr(qty, arabicNumerals)} {unitLabelAr(unit)} ÷ ({formatNumberAr(round1(perDaily), arabicNumerals)} {unitLabelAr(need.baseUnit)}/يوم للفرد × {formatNumberAr(round1(members), arabicNumerals)} فرد) ≈ {formatNumberAr(daysRounded, arabicNumerals)} يوم
          </Eq>
        </>
      ) : need && perDaily === 0 ? (
        <div className="glass-thin rounded-xl p-3 text-sm text-muted-foreground flex gap-2 items-start">
          <Info size={16} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
          <span>استهلاك «{need.nameAr}» يعتمد على عاداتكم المحددة في معالج البدء — لا يوجد معدل عام يمكن الحساب به.</span>
        </div>
      ) : unitMismatch && need ? (
        <div className="glass-thin rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400 flex gap-2 items-start" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
          <span>الوحدة المختارة ({unitLabelAr(unit)}) لا تطابق معدل استهلاك «{need.nameAr}» ({unitLabelAr(need.baseUnit)}) — وحّد الوحدة للحصول على نتيجة.</span>
        </div>
      ) : (
        <div className="glass-thin rounded-xl p-3 text-sm text-muted-foreground">اختر نوع الاستهلاك وأدخل الكمية لعرض النتيجة.</div>
      )}

      {/* pin into plan */}
      {selected ? (
        locked ? (
          <div className="glass-thin rounded-xl p-3 text-sm flex items-center gap-2">
            <Pin size={15} strokeWidth={1.75} className="text-primary shrink-0" aria-hidden />
            مثبّت في الخطة
          </div>
        ) : (
          <GlassButton size="sm" variant="primary" onClick={() => addLock({ productId: selected.id })}>
            <Pin size={14} strokeWidth={1.75} aria-hidden /> أضف النتائج للخطة — ثبّت هذا المنتج
          </GlassButton>
        )
      ) : null}
    </GlassCard>
  )
}

// ------------------------------ 5) unit price compare ------------------------------

interface UnitEntry { label: string; price: string; qty: string; unit: UnitKind }
const UNIT_OPTIONS: { id: UnitKind; label: string; per: string }[] = [
  { id: 'ml', label: 'مل', per: 'د.ب/لتر' },
  { id: 'g', label: 'جم', per: 'د.ب/كجم' },
  { id: 'pcs', label: 'حبة', per: 'د.ب/حبة' },
]

function entryUnitFils(e: UnitEntry): number {
  const fils = parseBHDToFils(e.price)
  const qty = parseNum(e.qty)
  if (qty <= 0) return 0
  const base = e.unit === 'ml' || e.unit === 'g' ? qty / 1000 : qty
  return base > 0 ? fils / base : 0
}

function unitPerLabel(u: UnitKind): string {
  return UNIT_OPTIONS.find((x) => x.id === u)?.per ?? 'د.ب/وحدة'
}

function UnitEntryForm({ entry, setEntry, title, arabicNumerals }: {
  entry: UnitEntry; setEntry: (e: UnitEntry) => void; title: string; arabicNumerals: boolean
}) {
  return (
    <GlassCard className="p-4 space-y-3">
      <div className="font-bold text-sm">{title}</div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">الاسم (اختياري)</label>
        <input
          type="text"
          value={entry.label}
          onChange={(ev) => setEntry({ ...entry, label: ev.target.value })}
          aria-label={`اسم ${title}`}
          className="glass-thin rounded-xl min-h-11 px-3 w-full text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="السعر (د.ب)" value={entry.price} onChange={(s) => setEntry({ ...entry, price: s })} ariaLabel={`سعر ${title} بالدينار`} />
        <NumField label="الحجم" value={entry.qty} onChange={(s) => setEntry({ ...entry, qty: s })} ariaLabel={`حجم ${title}`} />
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">الوحدة</label>
        <select
          value={entry.unit}
          onChange={(ev) => setEntry({ ...entry, unit: ev.target.value as UnitKind })}
          aria-label={`وحدة ${title}`}
          className="glass-thin rounded-xl min-h-11 px-3 w-full text-sm"
        >
          {UNIT_OPTIONS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      <div className="pt-2 border-t border-border/60 text-center">
        <div className="text-xs text-muted-foreground mb-0.5">{unitPerLabel(entry.unit)}</div>
        <div className="text-2xl font-extrabold tabular-nums">{formatBHD(Math.round(entryUnitFils(entry)), { arabicNumerals })}</div>
      </div>
    </GlassCard>
  )
}

function UnitPriceCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const [a, setA] = useState<UnitEntry>({ label: 'الخيار الأول', price: '0.900', qty: '330', unit: 'ml' })
  const [b, setB] = useState<UnitEntry>({ label: 'الخيار الثاني', price: '1.850', qty: '1500', unit: 'ml' })

  const aFils = entryUnitFils(a)
  const bFils = entryUnitFils(b)
  const hasBoth = aFils > 0 && bFils > 0
  const cheaperIsA = hasBoth && aFils <= bFils
  const savedPct = hasBoth ? (1 - Math.min(aFils, bFils) / Math.max(aFils, bFils)) * 100 : 0

  const unitLabel = unitPerLabel
  const baseQty = (e: UnitEntry) => (e.unit === 'ml' || e.unit === 'g' ? round1(parseNum(e.qty) / 1000) : parseNum(e.qty))
  const baseUnitName = (e: UnitEntry) => (e.unit === 'ml' ? 'لتر' : e.unit === 'g' ? 'كجم' : 'حبة')

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <UnitEntryForm entry={a} setEntry={setA} title="الخيار الأول" arabicNumerals={arabicNumerals} />
        <UnitEntryForm entry={b} setEntry={setB} title="الخيار الثاني" arabicNumerals={arabicNumerals} />
      </div>

      {hasBoth ? (
        <GlassCard className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <StatTile
              label="الأرخص"
              value={cheaperIsA ? (a.label || 'الخيار الأول') : (b.label || 'الخيار الثاني')}
              tone="primary"
              hint={`${formatBHD(Math.round(Math.min(aFils, bFils)), { arabicNumerals })} ${unitLabel((cheaperIsA ? a : b).unit)}`}
            />
            <StatTile label="الفرق النسبي" value={`وفّر حتى ${formatNumberAr(round1(savedPct), arabicNumerals)}٪`} tone="accent" />
          </div>
          <Eq>
            {formatBHD(parseBHDToFils(a.price), { arabicNumerals, withUnit: false })} د.ب ÷ {formatNumberAr(baseQty(a), arabicNumerals)} {baseUnitName(a)} = {formatBHD(Math.round(aFils), { arabicNumerals, withUnit: false })} د.ب/{baseUnitName(a)}
          </Eq>
          <Eq>
            {formatBHD(parseBHDToFils(b.price), { arabicNumerals, withUnit: false })} د.ب ÷ {formatNumberAr(baseQty(b), arabicNumerals)} {baseUnitName(b)} = {formatBHD(Math.round(bFils), { arabicNumerals, withUnit: false })} د.ب/{baseUnitName(b)}
          </Eq>
        </GlassCard>
      ) : (
        <div className="glass-thin rounded-xl p-3 text-sm text-muted-foreground">أدخل سعراً وحجماً صحيحين للخيارين لعرض المقارنة.</div>
      )}

      <InfoNote>قارن دائماً بالسعر لكل وحدة أساس (لتر/كجم/حبة) — العبوة الأكبر ليست دائماً الأرخص.</InfoNote>
    </div>
  )
}

// ------------------------------ 6) hospitality ------------------------------

const HOSP_ROWS: { key: string; icon: string; name: string; per: number; unit: 'g' | 'pcs' | 'l'; perLabel: string }[] = [
  { key: 'coffee', icon: 'coffee-tea', name: 'قهوة', per: 9, unit: 'g', perLabel: '9 جم' },
  { key: 'tea', icon: 'coffee-tea', name: 'شاي', per: 2, unit: 'pcs', perLabel: '2 كيس' },
  { key: 'dates', icon: 'dates-dried-fruits', name: 'تمر', per: 80, unit: 'g', perLabel: '80 جم' },
  { key: 'water', icon: 'water', name: 'مياه', per: 0.5, unit: 'l', perLabel: '0.5 لتر' },
  { key: 'sweets', icon: 'desserts-chilled', name: 'حلويات', per: 100, unit: 'g', perLabel: '100 جم' },
]

function HospitalityCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const [guests, setGuests] = useState(10)
  const [occasion, setOccasion] = useState<'normal' | 'ramadan' | 'eid'>('normal')
  const mult = occasion === 'ramadan' ? 1.8 : occasion === 'eid' ? 1.5 : 1
  const OCCASIONS: { id: 'normal' | 'ramadan' | 'eid'; label: string; mult: number }[] = [
    { id: 'normal', label: 'عادية', mult: 1 },
    { id: 'ramadan', label: 'رمضان', mult: 1.8 },
    { id: 'eid', label: 'عيد', mult: 1.5 },
  ]

  const rowTotal = (r: (typeof HOSP_ROWS)[number]) => guests * r.per * mult
  const rowText = (r: (typeof HOSP_ROWS)[number]) => {
    const t = rowTotal(r)
    if (r.unit === 'g') return formatQty('g', Math.round(t))
    if (r.unit === 'l') return `${formatNumberAr(round1(t), arabicNumerals)} لتر`
    return `${formatNumberAr(Math.round(t), arabicNumerals)} كيس`
  }

  return (
    <GlassCard className="p-4 sm:p-5 space-y-4">
      <SliderRow
        label="عدد الضيوف" min={2} max={50} step={1} value={guests} onChange={setGuests}
        display={`${formatNumberAr(guests, arabicNumerals)} ضيف`}
        ariaLabel="عدد الضيوف"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="نوع المناسبة">
        {OCCASIONS.map((o) => (
          <Chip key={o.id} selected={occasion === o.id} onClick={() => setOccasion(o.id)} ariaLabel={`مناسبة ${o.label}`}>
            {o.label} × {formatNumberAr(o.mult, arabicNumerals)}
          </Chip>
        ))}
      </div>

      <div className="glass-thin rounded-xl overflow-hidden" role="table" aria-label="كميات الضيافة">
        <div className="grid grid-cols-[1fr_auto_auto] text-xs font-semibold text-muted-foreground border-b border-border/50 p-2.5" role="row">
          <span role="columnheader">البند</span>
          <span role="columnheader" className="text-center w-20">لكل ضيف</span>
          <span role="columnheader" className="text-end w-24">الإجمالي</span>
        </div>
        {HOSP_ROWS.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_auto_auto] items-center p-2.5 border-b border-border/30 last:border-0" role="row">
            <span className="flex items-center gap-2 text-sm font-medium" role="cell">
              <CategoryIcon category={r.icon} size={16} />
              {r.name}
            </span>
            <span className="text-center text-xs text-muted-foreground tabular-nums w-20" role="cell">{r.perLabel}</span>
            <span className="text-end text-sm font-bold tabular-nums w-24" role="cell">{rowText(r)}</span>
          </div>
        ))}
      </div>

      <Eq>
        لكل ضيف: 9 جم قهوة · 2 كيس شاي · 80 جم تمر · 0.5 لتر مياه · 100 جم حلويات — × {formatNumberAr(guests, arabicNumerals)} ضيف × معامل المناسبة {formatNumberAr(mult, arabicNumerals)}
      </Eq>

      <InfoNote>معامل رمضان 1.8 (سهر وضيافة أكثر) والعيد 1.5. الكميات إرشادية وتُضبط حسب عادة بيتك.</InfoNote>
    </GlassCard>
  )
}

// ------------------------------ 7) split expense ------------------------------

function SplitCalc() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const [totalStr, setTotalStr] = useState('20.000')
  const [weights, setWeights] = useState<string[]>(['1', '1', '1'])

  const totalFils = parseBHDToFils(totalStr)
  const nums = weights.map((w) => Math.max(0, parseNum(w)))
  const sum = nums.reduce((s, n) => s + n, 0)
  const shares = nums.map((n) => (sum > 0 ? n / sum : 0))
  const amounts = shares.map((s) => Math.round(totalFils * s))
  const allEqual = nums.length > 0 && nums.every((n) => n === nums[0])
  const equalShare = Math.round(totalFils / Math.max(1, weights.length))

  const setWeight = (i: number, v: string) => setWeights(weights.map((w, j) => (j === i ? v : w)))
  const addPerson = () => { if (weights.length < 12) setWeights([...weights, '1']) }
  const removePerson = () => { if (weights.length > 2) setWeights(weights.slice(0, -1)) }

  return (
    <GlassCard className="p-4 sm:p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <NumField label="المبلغ الإجمالي (د.ب)" value={totalStr} onChange={setTotalStr} ariaLabel="المبلغ الإجمالي بالدينار" hint={formatBHD(totalFils, { arabicNumerals })} />
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">عدد الأفراد</label>
          <div className="flex gap-2">
            <GlassButton size="sm" onClick={removePerson} disabled={weights.length <= 2} aria-label="إزالة فرد"><Minus size={14} strokeWidth={1.75} aria-hidden /></GlassButton>
            <div className="flex-1 glass-thin rounded-xl grid place-items-center min-h-11 font-bold tabular-nums text-lg">{formatNumberAr(weights.length, arabicNumerals)}</div>
            <GlassButton size="sm" onClick={addPerson} disabled={weights.length >= 12} aria-label="إضافة فرد"><Plus size={14} strokeWidth={1.75} aria-hidden /></GlassButton>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {weights.map((w, i) => (
          <div key={i} className="glass-row rounded-xl p-3 flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg glass-thin grid place-items-center text-sm font-bold shrink-0 tabular-nums">{formatNumberAr(i + 1, arabicNumerals)}</span>
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground block">الوزن النسبي</label>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={w}
                onChange={(e) => setWeight(i, e.target.value)}
                aria-label={`الوزن النسبي للفرد ${formatNumberAr(i + 1, arabicNumerals)}`}
                className="glass-thin rounded-lg min-h-11 px-2 w-24 tabular-nums"
              />
            </div>
            <div className="text-end shrink-0">
              <div className="text-xs text-muted-foreground tabular-nums">{formatNumberAr(Math.round(shares[i]! * 100), arabicNumerals)}٪</div>
              <div className="font-bold tabular-nums">{formatBHD(amounts[i]!, { arabicNumerals })}</div>
            </div>
          </div>
        ))}
      </div>

      {allEqual ? (
        <div className="flex flex-wrap gap-2">
          <StatTile label="الإجمالي" value={formatBHD(totalFils, { arabicNumerals })} />
          <StatTile label="لكل فرد بالتساوي" value={formatBHD(equalShare, { arabicNumerals })} tone="primary" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <StatTile label="الإجمالي" value={formatBHD(totalFils, { arabicNumerals })} />
          <StatTile label="مجموع الأوزان" value={formatNumberAr(round1(sum), arabicNumerals)} hint="تُطبَّع النسب تلقائياً" />
        </div>
      )}

      <Eq>
        حصة الفرد = {formatBHD(totalFils, { arabicNumerals, withUnit: false })} د.ب × (وزنه ÷ {formatNumberAr(round1(sum), arabicNumerals)})
      </Eq>

      <InfoNote>الأوزان متساوية افتراضياً — عدّلها لتقسيم غير متساوٍ (مثلاً 2 و1 و1). المبالغ مقرّبة لأقرب فلس.</InfoNote>
    </GlassCard>
  )
}

// ------------------------------ view ------------------------------

export function CalculatorsView() {
  const [tab, setTab] = useState<string>('diapers')

  return (
    <div className="space-y-5 pb-8 pt-2">
      <nav className="flex gap-2 overflow-x-auto nice-scroll pb-1" role="tablist" aria-label="الحاسبات">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`min-h-11 px-4 rounded-xl text-sm font-semibold whitespace-nowrap flex items-center gap-2 shrink-0 transition-all active:scale-[0.98] ${active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'glass-thin hover:bg-secondary/60'}`}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              {t.label}
            </button>
          )
        })}
      </nav>

      {tab === 'diapers' ? (
        <section aria-label="حاسبة الحفاضات"><DiapersCalc /></section>
      ) : null}
      {tab === 'formula' ? (
        <section aria-label="حاسبة حليب الأطفال"><FormulaCalc /></section>
      ) : null}
      {tab === 'smoking' ? (
        <section aria-label="حاسبة التدخين"><SmokingGate><SmokingCalc /></SmokingGate></section>
      ) : null}
      {tab === 'lasts' ? (
        <section aria-label="حاسبة كم يكفي؟"><LastsCalc /></section>
      ) : null}
      {tab === 'unit' ? (
        <section aria-label="حاسبة سعر الوحدة"><UnitPriceCalc /></section>
      ) : null}
      {tab === 'hospitality' ? (
        <section aria-label="حاسبة الضيافة"><HospitalityCalc /></section>
      ) : null}
      {tab === 'split' ? (
        <section aria-label="حاسبة تقسيم المصروف"><SplitCalc /></section>
      ) : null}
    </div>
  )
}
