'use client'
/**
 * Onboarding wizard (spec 7.1): 8 steps + quick-start + natural-language input.
 * Auto-saves to the app store; < 2 minutes for the regular user.
 */
import { useMemo, useState } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { generatePlanApi } from '@/lib/api-client'
import { dateISOInTimeZone } from '@/lib/time'
import { formatBHD, parseBHDToFils } from '@/lib/money'
import { GlassCard, GlassButton, Pill, Spinner, SectionTitle } from '@/components/glass/glass'
import { Users, Baby, Coffee, Wallet, Store, SlidersHorizontal, Sparkles, ArrowRight, ArrowLeft, Plus, Trash2, CheckCircle2, Languages, Lightbulb, Layers, Percent, Banknote, Info } from 'lucide-react'
import type { Household, HouseholdMember, MemberSpecial, PlanMode } from '@/lib/engine/types'
import { ENVELOPE_TEMPLATES, MODE_LABELS, suggestBudgetFils, levelLadderFils, countActiveOptions, adultEquivalent, NEEDS_MAP, DEFAULT_WEIGHTS, DEFAULT_ALLOCATION } from '@/lib/engine'
import type { AdvancedProfile, DietFlags, SuggestMode } from '@/lib/engine'

const HABIT_CARDS = [
  { id: 'coffee', nameAr: 'قهوة', icon: Coffee, default: { cupsPerDay: 2 } },
  { id: 'tea', nameAr: 'شاي', icon: Coffee, default: { cupsPerDay: 3 } },
  { id: 'water', nameAr: 'مياه معبأة', icon: Coffee, default: { litersPerPersonDay: 1.5 } },
  { id: 'soft-drinks', nameAr: 'مشروبات غازية', icon: Coffee, default: { cansPerWeek: 6 } },
  { id: 'smoking', nameAr: 'تدخين (18+)', icon: Coffee, default: { active: true, cigsPerDay: 20 } },
] as const

const SPECIALS: { id: MemberSpecial; label: string }[] = [
  { id: 'pregnant', label: 'حمل/إرضاع' },
  { id: 'diabetic', label: 'سكري' },
  { id: 'hypertension', label: 'ضغط' },
  { id: 'celiac', label: 'سيلياك' },
  { id: 'lactose-intolerant', label: 'لاكتوز' },
  { id: 'nut-allergy', label: 'حساسية مكسرات' },
]

const QUICK_PATTERNS = [
  { label: 'فرد واحد', count: 1 },
  { label: 'زوجان', count: 2 },
  { label: 'أسرة صغيرة (3-4)', count: 4 },
  { label: 'أسرة كبيرة (6-8)', count: 7 },
]

/** Arabic labels for the advanced diet flags (first-active example chips in the summary) */
const DIET_LABELS_AR: Record<keyof DietFlags, string> = {
  vegetarian: 'نباتي',
  vegan: 'نباتي صرف',
  pescatarian: 'نظام سمكي',
  keto: 'كيتو',
  lowCarb: 'قليل الكاربوهيدرات',
  noAddedSugar: 'بدون سكر مضاف',
  lowSodium: 'قليل الصوديوم',
  glutenFree: 'خالٍ من الغلوتين',
  lactoseFree: 'خالٍ من اللاكتوز',
  nutFree: 'بدون مكسرات',
  eggFree: 'بدون بيض',
  soyFree: 'بدون صويا',
  shellfishFree: 'بدون محاريات',
  halalStrict: 'حلال صارم',
  organicLean: 'ميل عضوي',
  highProtein: 'بروتين عالٍ',
  highFiber: 'ألياف عالية',
  lowFat: 'قليل الدهون',
  diabeticFriendly: 'صديق للسكري',
  hypertensionFriendly: 'صديق للضغط',
  avoidFried: 'تجنّب المقلي',
  avoidProcessed: 'تجنّب المصنّع',
  avoidCanned: 'تجنّب المعلب',
  avoidFrozen: 'تجنّب المجمد',
  avoidInstant: 'تجنّب الفوري',
  avoidSugaryDrinks: 'تجنّب المشروبات السكرية',
  avoidEnergyDrinks: 'تجنّب مشروبات الطاقة',
  avoidCarbonated: 'تجنّب الغازية',
  noCaffeine: 'بدون كافيين',
  noTobacco: 'بدون تبغ',
  noVape: 'بدون فيب',
  preferLocal: 'تفضيل المحلي',
  preferWholeGrain: 'تفضيل الحبوب الكاملة',
  preferFamilyPacks: 'عبوات عائلية',
}

/** wizard plan modes — labels/descriptions/offset % come from MODE_LABELS (engine config) */
const WIZARD_MODES: PlanMode[] = ['crisis', 'economy', 'balanced', 'comfortable', 'custom']
/** smart-suggester modes (level ladder A/B/C/D mirrors these anchors) */
const SUGGEST_MODES: SuggestMode[] = ['crisis', 'economy', 'balanced', 'comfortable']

/** financial guidance rule: comprehensive groceries ≈ 29% of a 350-BHD salary, hard cap 100 BHD */
const GROCERY_PCT_OF_INCOME = 0.29
const GROCERY_CAP_FILS = 100_000

const pct1 = (x: number) => `${Math.round(x * 10) / 10}%`
const offsetPctLabel = (pct: number) => (pct > 0 ? `+${pct}%` : pct < 0 ? `\u2212${Math.abs(pct)}%` : '0%')
const eqLabel = (x: number) => String(Math.round(x * 10) / 10)

/** up to 3 example chips describing what is active in an advanced profile */
function advancedExampleChips(p: AdvancedProfile): string[] {
  const chips: string[] = []
  const override = Object.entries(p.needOverrides).find(([, o]) => o.mode !== 'auto')
  if (override) chips.push(NEEDS_MAP.get(override[0])?.nameAr ?? 'كمية مخصصة')
  const diet = Object.entries(p.diet).find(([, v]) => v === true)
  if (diet) chips.push(DIET_LABELS_AR[diet[0] as keyof DietFlags] ?? 'قيود غذائية')
  const w = p.weights
  if (
    w.target !== DEFAULT_WEIGHTS.target || w.value !== DEFAULT_WEIGHTS.value || w.quality !== DEFAULT_WEIGHTS.quality ||
    w.brand !== DEFAULT_WEIGHTS.brand || w.local !== DEFAULT_WEIGHTS.local
  ) chips.push('أوزان التقييم مخصصة')
  const a = p.allocation
  if (
    a.grains !== DEFAULT_ALLOCATION.grains || a.protein !== DEFAULT_ALLOCATION.protein || a.dairy !== DEFAULT_ALLOCATION.dairy ||
    a.produce !== DEFAULT_ALLOCATION.produce || a.fats !== DEFAULT_ALLOCATION.fats || a.pantry !== DEFAULT_ALLOCATION.pantry ||
    a.cleaning !== DEFAULT_ALLOCATION.cleaning || a.treats !== DEFAULT_ALLOCATION.treats || a.enforce !== DEFAULT_ALLOCATION.enforce
  ) chips.push('توزيع الميزانية مخصص')
  const L = p.lifestyle
  if (
    L.homeCookingPct != null || L.sweetToothPct !== 100 || L.snacksLevelPct !== 100 || L.wasteTolerancePct != null ||
    L.tripsPreference !== 'auto' || L.reservePct != null || L.treatCapPct != null || L.varietyLevel !== 50 ||
    L.packSizeBias !== 'auto' || L.customModeOffsetPct !== 0
  ) chips.push('نمط الحياة مضبوط')
  if (p.stores.banned.length || p.stores.preferred.length || p.stores.maxSplitStores !== 3 || !p.stores.includeDeliveryFees) chips.push('تفضيلات المتاجر')
  return chips.slice(0, 3)
}

/** Deterministic Arabic natural-language parser (spec 7.1-8): fills the wizard fields */
function parseNaturalLanguage(text: string): { members: number; infantMonths?: number; budgetFils?: number } {
  const s = text.replace(/[٠-٩]/g, (d) => String(d.codePointAt(0)! - 0x0660))
  let members = 0
  let infantMonths: number | undefined
  let budgetFils: number | undefined
  const fam = s.match(/(?:اسرة|أسرة|عائلة)\s*(?:من\s*)?(\d+)/)
  const num = s.match(/(?:نحن\s*)?(\d+)\s*(?:افرد|أفراد|فرد|اشخاص|أشخاص)/)
  const words: Record<string, number> = { 'فرد': 1, 'فردان': 2, 'زوجان': 2, 'ثلاثة': 3, 'اربعة': 4, 'أربعة': 4, 'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10, 'احدعشر': 11, 'اثنا عشر': 12 }
  for (const [w, v] of Object.entries(words)) if (s.includes(w)) { members = Math.max(members, v); break }
  if (fam) members = Number(fam[1])
  if (num) members = Number(num[1])
  const infant = s.match(/(?:رضيع|طفل)\s*(?:عمره\s*)?(\d+)\s*(?:شهر|شهور|شهور|أشهر)/)
  if (infant) infantMonths = Number(infant[1])
  else if (/رضيع|مولود/.test(s)) infantMonths = 4
  const bd = s.match(/(\d+(?:\.\d+)?)\s*(?:دينار|د\.?ب|bhd|bd)/i)
  if (bd) budgetFils = Math.round(parseFloat(bd[1]!) * 1000)
  return { members, infantMonths, budgetFils }
}

export function WizardView() {
  const store = useApp()
  const [step, setStep] = useState(0)
  const [quickMode, setQuickMode] = useState(false)
  const [nlText, setNlText] = useState('')
  const [nlApplied, setNlApplied] = useState(false)

  // wizard state (initialized from store when returning)
  const [members, setMembers] = useState<HouseholdMember[]>(store.household?.members ?? [
    { id: 'm1', ageMonths: 408, gender: 'f', specials: [] },
    { id: 'm2', ageMonths: 444, gender: 'm', specials: [] },
  ])
  const [habits, setHabits] = useState<Record<string, Record<string, string | number | boolean>>>(store.household?.habits ?? { water: { litersPerPersonDay: 1.5 }, coffee: { cupsPerDay: 2 }, tea: { cupsPerDay: 3 } })
  const [dietary, setDietary] = useState(store.household?.dietary ?? { halalOnly: true })
  const [budgetInput, setBudgetInput] = useState(store.budget ? String(store.budget.fils / 1000) : '')
  const [period, setPeriod] = useState<'week' | 'biweekly' | 'month' | 'custom'>(store.budget?.period ?? 'month')
  const [payday, setPayday] = useState(0)
  const [flexibility, setFlexibility] = useState(0)
  const [reserve, setReserve] = useState(5)
  const [storeMode, setStoreMode] = useState<'median' | 'best-single' | 'split'>('median')
  const [availableStores, setAvailableStores] = useState<string[]>([])
  const [envelopeSelection, setEnvelopeSelection] = useState<string[]>([])
  const [familyName, setFamilyName] = useState(store.household?.familyName ?? '')
  const [planName, setPlanName] = useState(store.planNames.reportName === 'خطة البقالة' ? '' : store.planNames.reportName)
  const [qualityBias, setQualityBias] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // engine v2: plan mode + advanced profile live in the app store (persisted)
  const planMode = useApp((s) => s.planMode)
  const setPlanMode = useApp((s) => s.setPlanMode)
  const advanced = useApp((s) => s.advanced)
  const setAdvanced = useApp((s) => s.setAdvanced)

  // smart suggester + percentages-transparency state
  const [suggestMode, setSuggestMode] = useState<SuggestMode | null>(null)
  const [incomeInput, setIncomeInput] = useState('')
  const [eatingOut, setEatingOut] = useState(store.household?.eatingOutPerWeek ?? 2)
  const [guests, setGuests] = useState(store.household?.guestsPerMonth ?? 4)

  const infantCount = members.filter((m) => m.ageMonths < 36).length
  const hasBaby = members.some((m) => m.ageMonths < 36)
  const budgetFils = parseBHDToFils(budgetInput)
  const horizon = period === 'week' ? 7 : period === 'biweekly' ? 15 : 30

  // smart suggester / percentages derived values
  const adultEq = useMemo(() => members.reduce((s, m) => s + adultEquivalent(m), 0), [members])
  const suggestions = useMemo(() => (members.length ? SUGGEST_MODES.map((m) => ({ mode: m, ...suggestBudgetFils(members, m) })) : []), [members])
  const ladder = useMemo(() => (members.length ? levelLadderFils(members) : []), [members])
  const incomeFils = parseBHDToFils(incomeInput)
  const incomeSuggestFils = incomeFils > 0 ? Math.min(Math.round((incomeFils * GROCERY_PCT_OF_INCOME) / 500) * 500, GROCERY_CAP_FILS) : 0
  const incomeCapped = incomeFils > 0 && incomeFils * GROCERY_PCT_OF_INCOME > GROCERY_CAP_FILS
  const eatingOutReductionPct = Math.min(45, (eatingOut / 42) * 100)
  const guestsImpactPct = Math.min(150, (guests / 30) * 0.4 * 100)
  const activeAdvancedCount = countActiveOptions(advanced)
  const advancedChips = advancedExampleChips(advanced)
  const customOffsetPct = advanced.lifestyle.customModeOffsetPct

  const steps = useMemo(() => {
    const base = [
      { title: 'من أنتم؟', icon: Users },
      { title: 'الرضّع والأطفال', icon: Baby, skip: !hasBaby },
      { title: 'العادات', icon: Coffee },
      { title: 'القيود الغذائية', icon: SlidersHorizontal },
      { title: 'الميزانية', icon: Wallet },
      { title: 'المتاجر والتوصيل', icon: Store },
      { title: 'التسمية والجودة', icon: Sparkles },
      { title: 'الملخص', icon: CheckCircle2 },
    ]
    return base.filter((s) => !s.skip)
  }, [hasBaby])

  const applyNl = () => {
    const r = parseNaturalLanguage(nlText)
    if (r.members > 0) {
      const list: HouseholdMember[] = []
      for (let i = 0; i < r.members; i++) {
        list.push({ id: `m${i + 1}`, ageMonths: r.infantMonths != null && i === r.members - 1 ? r.infantMonths : 380 + ((i * 53) % 140), specials: [] })
      }
      setMembers(list)
    }
    if (r.budgetFils) setBudgetInput(String(r.budgetFils / 1000))
    setNlApplied(true)
  }

  const generate = async () => {
    setGenerating(true)
    setError(null)
    const household: Household = {
      familyName: familyName || undefined,
      members,
      habits,
      dietary,
      prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: qualityBias },
      eatingOutPerWeek: eatingOut,
      guestsPerMonth: guests,
      hasWaterDispenser: false,
      storage: 'medium',
    }
    const budget = { fils: budgetFils, period, horizonDays: horizon, paydayWeekday: payday, flexibilityPct: flexibility / 100, reservePct: reserve / 100 }
    const envelopes = ENVELOPE_TEMPLATES
      .filter((t) => envelopeSelection.includes(t.groupId))
      .map((t) => ({ id: `env-${t.groupId}`, name: t.nameAr, groups: [t.groupId], mode: 'range' as const, minFils: t.min, maxFils: t.max, priority: t.priority, fillToMax: false }))
    try {
      const dateISO = dateISOInTimeZone()
      const { plan } = await generatePlanApi({
        household, budget, mode: planMode, season: 'normal', storeMode,
        availableStores, envelopes, locks: [], pantry: store.pantry ?? [],
        advanced, dateISO,
      })
      store.setHousehold(household)
      store.setBudget(budget)
      store.setEnvelopes(envelopes)
      store.setPlanContext({ dateISO, season: 'normal', storeMode, availableStores, delivery: true })
      store.setPlan(plan)
      store.setPlanNames({ reportName: planName || `خطة ${new Date().toLocaleDateString('ar-BH', { month: 'long', year: 'numeric' })}`, familyName, showNames: true })
      navigate({ name: 'plan' })
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setGenerating(false)
    }
  }

  // quick start
  if (quickMode) {
    return (
      <div className="max-w-lg mx-auto pt-6 space-y-4">
        <SectionTitle>ابدأ بسرعة</SectionTitle>
        <GlassCard className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {QUICK_PATTERNS.map((p) => (
              <button key={p.label} onClick={() => setMembers(Array.from({ length: p.count }, (_, i) => ({ id: `q${i}`, ageMonths: 380 + ((i * 53) % 140), specials: [] })))} className="glass-thin rounded-xl min-h-11 text-xs font-medium px-2">
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-sm font-semibold">عدد الأفراد: {members.length}</label>
          <input type="range" min={1} max={12} value={members.length} onChange={(e) => setMembers(Array.from({ length: Number(e.target.value) }, (_, i) => ({ id: `q${i}`, ageMonths: 380 + ((i * 53) % 140), specials: [] })))} className="w-full accent-[var(--primary)]" />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={hasBaby} onChange={(e) => {
              if (e.target.checked) setMembers((ms) => [...ms, { id: `inf${Date.now()}`, ageMonths: 5, specials: [] }])
              else setMembers((ms) => ms.filter((m) => m.ageMonths >= 36))
            }} className="w-5 h-5 accent-[var(--primary)]" />
            لدينا رضيع (≈5 أشهر)
          </label>
          <div>
            <label className="text-sm font-semibold block mb-1">الميزانية الشهرية (د.ب)</label>
            <input value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} inputMode="decimal" placeholder="مثال: 220" className="w-full glass-thin rounded-xl min-h-11 px-4 text-lg font-bold tabular-nums" />
          </div>
          <GlassButton variant="primary" className="w-full" disabled={!budgetFils} onClick={generate}>
            {generating ? <Spinner /> : <Sparkles size={18} strokeWidth={1.75} aria-hidden />}
            {generating ? 'نولّد خطتك…' : 'ولّد الخطة'}
          </GlassButton>
          {error ? <div className="text-destructive text-sm" role="alert">{error}</div> : null}
          <button onClick={() => setQuickMode(false)} className="text-sm text-muted-foreground underline w-full">الوضع الكامل (دقيقتان)</button>
        </GlassCard>
      </div>
    )
  }

  const StepIcon = steps[step]?.icon ?? Users

  return (
    <div className="max-w-2xl mx-auto pt-4 pb-8">
      {/* progress */}
      <div className="flex items-center gap-2 mb-5" aria-label={`الخطوة ${step + 1} من ${steps.length}`}>
        <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0"><StepIcon size={20} strokeWidth={1.75} aria-hidden /></span>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>{steps[step]?.title}</span><span>{step + 1} / {steps.length}</span></div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
        {/* persistent advanced-preferences link — reachable from every step */}
        <button onClick={() => navigate({ name: 'advanced' })} className="shrink-0 glass-thin rounded-xl min-h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-all active:scale-[0.98]" aria-label="الخيارات المتقدمة">
          <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />
          <span className="hidden min-[420px]:inline">خيارات متقدمة</span>
          {activeAdvancedCount > 0 ? <Pill tone="primary">{activeAdvancedCount}</Pill> : null}
        </button>
      </div>

      {/* NL input */}
      {step === 0 ? (
        <GlassCard className="p-4 mb-4">
          <label className="text-sm font-semibold flex items-center gap-2 mb-2"><Languages size={16} strokeWidth={1.75} aria-hidden /> أو اكتبها بجملة واحدة</label>
          <div className="flex gap-2">
            <input
              value={nlText}
              onChange={(e) => { setNlText(e.target.value); setNlApplied(false) }}
              placeholder="أسرة من 7 أفراد فيهم رضيع عمره 5 شهور وميزانيتنا 200 دينار"
              className="flex-1 glass-thin rounded-xl min-h-11 px-4 text-sm"
            />
            <GlassButton onClick={applyNl} disabled={!nlText.trim()}>حلّل</GlassButton>
          </div>
          {nlApplied ? <div className="text-xs text-primary mt-2 flex items-center gap-1"><CheckCircle2 size={14} aria-hidden /> عبّأنا الحقول — راجعها وأكمل الخطوات</div> : null}
        </GlassCard>
      ) : null}

      <GlassCard className="p-5 min-h-[320px]">
        {/* STEP 0: members */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_PATTERNS.map((p) => (
                <button key={p.label} onClick={() => setMembers(Array.from({ length: p.count }, (_, i) => ({ id: `m${i + 1}`, ageMonths: 380 + ((i * 53) % 140), specials: [] })))} className="glass-thin rounded-xl min-h-11 px-4 text-sm font-medium">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto nice-scroll">
              {members.map((m, i) => (
                <div key={m.id} className="glass-row rounded-xl p-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold w-20">الفرد {i + 1}</span>
                  <label className="text-xs text-muted-foreground">العمر (سنوات)
                    <input
                      type="number" min={0} max={80} value={m.ageMonths >= 36 ? Math.round(m.ageMonths / 12) : 0}
                      onChange={(e) => setMembers((ms) => ms.map((x) => x.id === m.id ? { ...x, ageMonths: Math.max(0, Number(e.target.value)) * 12 } : x))}
                      className="block w-20 glass-thin rounded-lg h-9 px-2 text-sm"
                    />
                  </label>
                  {m.ageMonths < 36 ? (
                    <label className="text-xs text-muted-foreground">أشهر
                      <input
                        type="number" min={0} max={35} value={m.ageMonths}
                        onChange={(e) => setMembers((ms) => ms.map((x) => x.id === m.id ? { ...x, ageMonths: Math.min(35, Number(e.target.value)) } : x))}
                        className="block w-16 glass-thin rounded-lg h-9 px-2 text-sm"
                      />
                    </label>
                  ) : null}
                  <select
                    value={m.gender ?? ''}
                    onChange={(e) => setMembers((ms) => ms.map((x) => x.id === m.id ? { ...x, gender: (e.target.value || undefined) as 'm' | 'f' | undefined } : x))}
                    className="glass-thin rounded-lg h-9 px-2 text-sm"
                    aria-label="الجنس (اختياري)"
                  >
                    <option value="">الجنس (اختياري)</option>
                    <option value="m">ذكر</option>
                    <option value="f">أنثى</option>
                  </select>
                  <div className="flex flex-wrap gap-1 flex-1">
                    {SPECIALS.map((sp) => (
                      <button
                        key={sp.id}
                        onClick={() => setMembers((ms) => ms.map((x) => x.id === m.id ? { ...x, specials: x.specials.includes(sp.id) ? x.specials.filter((s) => s !== sp.id) : [...x.specials, sp.id] } : x))}
                        className={`px-2 py-1 rounded-full text-[11px] font-medium ${m.specials.includes(sp.id) ? 'bg-accent/20 text-accent' : 'bg-secondary/60 text-muted-foreground'}`}
                        aria-pressed={m.specials.includes(sp.id)}
                      >
                        {sp.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setMembers((ms) => ms.filter((x) => x.id !== m.id))} className="text-muted-foreground hover:text-destructive" aria-label={`حذف الفرد ${i + 1}`}>
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <GlassButton onClick={() => setMembers((ms) => [...ms, { id: `m${ms.length + 1}-${Date.now() % 1000}`, ageMonths: 380, specials: [] }])} className="w-full">
              <Plus size={16} strokeWidth={1.75} aria-hidden /> إضافة فرد
            </GlassButton>
            {/* percentages transparency — live household demand breakdown */}
            {members.length ? (
              <div className="glass-thin rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold"><Percent size={14} strokeWidth={1.75} aria-hidden /> شفافية النسب — أثر أسرتك على الطلب</div>
                <div className="text-xs text-muted-foreground">عدد المكافئين البالغين: <span className="font-bold text-foreground tabular-nums">≈ {eqLabel(adultEq)} مكافئ بالغ</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">وجبات خارج المنزل / أسبوع
                    <input type="number" min={0} max={21} value={eatingOut} onChange={(e) => setEatingOut(Math.max(0, Math.min(21, Number(e.target.value) || 0)))} className="block w-full glass-thin rounded-lg h-9 px-2 text-sm mt-1 tabular-nums" />
                  </label>
                  <label className="text-xs text-muted-foreground">ضيوف / شهر
                    <input type="number" min={0} max={60} value={guests} onChange={(e) => setGuests(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} className="block w-full glass-thin rounded-lg h-9 px-2 text-sm mt-1 tabular-nums" />
                  </label>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {eatingOut > 0 ? <div>الأكل الخارجي يخفض الطلب المنزلي <span className="font-bold text-foreground tabular-nums">≈ {pct1(eatingOutReductionPct)}</span></div> : null}
                  {guests > 0 ? <div>الضيافة ترفع طلب الضيافة <span className="font-bold text-foreground tabular-nums">≈ {pct1(guestsImpactPct)}</span></div> : null}
                </div>
              </div>
            ) : null}
            <button onClick={() => setQuickMode(true)} className="text-sm text-muted-foreground underline">بدء سريع (3 حقول فقط)</button>
          </div>
        )}

        {/* STEP: infants */}
        {steps[step]?.title === 'الرضّع والأطفال' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">فعّلنا تلقائياً حفاضات وحليب الأطفال بحسب أعمار الصغار. عدّل التفاصيل:</p>
            {members.filter((m) => m.ageMonths < 36).map((m) => (
              <div key={m.id} className="glass-row rounded-xl p-4 space-y-3">
                <div className="font-semibold text-sm">طفل عمره {m.ageMonths} شهراً</div>
                <label className="flex items-center justify-between text-sm">
                  حفاضات
                  <input type="checkbox" checked={habits['diapers']?.[`on_${m.id}`] !== false} onChange={(e) => setHabits((h) => ({ ...h, diapers: { ...h['diapers'], [`on_${m.id}`]: e.target.checked } }))} className="w-5 h-5 accent-[var(--primary)]" />
                </label>
                <label className="flex items-center justify-between text-sm">
                  حليب صناعي
                  <input type="checkbox" checked={habits['formula']?.[`on_${m.id}`] !== false} onChange={(e) => setHabits((h) => ({ ...h, formula: { ...h['formula'], [`on_${m.id}`]: e.target.checked } }))} className="w-5 h-5 accent-[var(--primary)]" />
                </label>
                <label className="block text-sm">
                  نسبة الاعتماد على الحليب الصناعي: {habits['formula']?.[`dep_${m.id}`] ?? 100}٪
                  <input type="range" min={0} max={100} step={10} value={Number(habits['formula']?.[`dep_${m.id}`] ?? 100)} onChange={(e) => setHabits((h) => ({ ...h, formula: { ...h['formula'], [`dep_${m.id}`]: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" />
                  <span className="text-xs text-muted-foreground">الرضاعة الطبيعية أول وأفضل — هذا التقدير لا يستبدل توجيه طبيب الأطفال</span>
                </label>
              </div>
            ))}
          </div>
        )}

        {/* STEP: habits */}
        {steps[step]?.title === 'العادات' && (
          <div className="space-y-3">
            {HABIT_CARDS.map((card) => {
              const active = card.id === 'water' || card.id === 'coffee' || card.id === 'tea' || habits[card.id] != null
              const Icon = card.icon
              return (
                <div key={card.id} className={`rounded-xl p-4 transition-all ${active ? 'glass-row border-primary/30' : 'glass-ultrathin opacity-70'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 font-semibold text-sm"><Icon size={18} strokeWidth={1.75} aria-hidden /> {card.nameAr}</span>
                    <button
                      onClick={() => setHabits((h) => {
                        const next = { ...h }
                        if (next[card.id] != null) delete next[card.id]
                        else next[card.id] = { ...card.default }
                        return next
                      })}
                      className={`min-h-9 px-3 rounded-lg text-xs font-bold ${active ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}
                      aria-pressed={active}
                    >
                      {active ? 'مفعّلة' : 'موقوفة'}
                    </button>
                  </div>
                  {habits[card.id] != null ? (
                    <div className="space-y-2">
                      {card.id === 'coffee' && (
                        <label className="text-xs text-muted-foreground">فناجين القهوة/يوم لكل بالغ: {habits['coffee']?.cupsPerDay ?? 2}
                          <input type="range" min={0} max={8} value={Number(habits['coffee']?.cupsPerDay ?? 2)} onChange={(e) => setHabits((h) => ({ ...h, coffee: { ...h['coffee'], cupsPerDay: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" />
                        </label>
                      )}
                      {card.id === 'tea' && (
                        <label className="text-xs text-muted-foreground">أكواب الشاي/يوم: {habits['tea']?.cupsPerDay ?? 3}
                          <input type="range" min={0} max={12} value={Number(habits['tea']?.cupsPerDay ?? 3)} onChange={(e) => setHabits((h) => ({ ...h, tea: { ...h['tea'], cupsPerDay: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" />
                        </label>
                      )}
                      {card.id === 'water' && (
                        <label className="text-xs text-muted-foreground">لترات/فرد/يوم: {habits['water']?.litersPerPersonDay ?? 1.5}
                          <input type="range" min={0.5} max={4} step={0.25} value={Number(habits['water']?.litersPerPersonDay ?? 1.5)} onChange={(e) => setHabits((h) => ({ ...h, water: { ...h['water'], litersPerPersonDay: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" />
                        </label>
                      )}
                      {card.id === 'soft-drinks' && (
                        <label className="text-xs text-muted-foreground">عبوات/أسبوع: {habits['soft-drinks']?.cansPerWeek ?? 6}
                          <input type="range" min={0} max={40} value={Number(habits['soft-drinks']?.cansPerWeek ?? 6)} onChange={(e) => setHabits((h) => ({ ...h, 'soft-drinks': { ...h['soft-drinks'], cansPerWeek: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" />
                        </label>
                      )}
                      {card.id === 'smoking' && (
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">تُعامل ك بند إنفاق حقيقي محجوز أولاً — بلا وعظ وبلا اقتراح بدائل</div>
                          <label className="text-xs text-muted-foreground">سيجارة/يوم: {habits['smoking']?.cigsPerDay ?? 20}
                            <input type="range" min={1} max={40} value={Number(habits['smoking']?.cigsPerDay ?? 20)} onChange={(e) => setHabits((h) => ({ ...h, smoking: { ...h['smoking'], cigsPerDay: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" />
                          </label>
                          <input
                            placeholder="العلامة (مثال: مالبورو) — اختياري"
                            value={String(habits['smoking']?.brand ?? '')}
                            onChange={(e) => setHabits((h) => ({ ...h, smoking: { ...h['smoking'], brand: e.target.value } }))}
                            className="w-full glass-thin rounded-lg h-9 px-3 text-sm"
                          />
                          <input
                            placeholder="سعر العلبة (د.ب) — يدوياً إن لم تتوفر بيانات"
                            inputMode="decimal"
                            value={habits['smoking']?.manualPriceFils ? String(Number(habits['smoking']?.manualPriceFils) / 1000) : ''}
                            onChange={(e) => setHabits((h) => ({ ...h, smoking: { ...h['smoking'], manualPriceFils: parseBHDToFils(e.target.value) } }))}
                            className="w-full glass-thin rounded-lg h-9 px-3 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
            <div className="text-xs text-muted-foreground">يمكن إضافة عناصر عامة (شوكولاتة، عصائر…) بميزانية مرنة من صفحة «الأظرف» بعد توليد الخطة.</div>
            {/* slim advanced-options summary + link */}
            <div className="glass-thin rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold">
                <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden /> الخيارات المتقدمة
                <Pill tone={activeAdvancedCount > 0 ? 'primary' : 'default'}>{activeAdvancedCount} خيار مفعّل</Pill>
              </span>
              <GlassButton size="sm" className="min-h-11" onClick={() => navigate({ name: 'advanced' })}>افتحها</GlassButton>
            </div>
          </div>
        )}

        {/* STEP: dietary */}
        {steps[step]?.title === 'القيود الغذائية' && (
          <div className="space-y-3">
            {[
              { key: 'sugarFree' as const, label: 'خالٍ من السكر (سكري)' },
              { key: 'lowSodium' as const, label: 'قليل الصوديوم (ضغط)' },
              { key: 'glutenFree' as const, label: 'خالٍ من الغلوتين (سيلياك)' },
              { key: 'lactoseFree' as const, label: 'خالٍ من اللاكتوز' },
              { key: 'nutFree' as const, label: 'بدون مكسرات (حساسية)' },
            ].map((d) => (
              <label key={d.key} className="flex items-center justify-between glass-row rounded-xl p-4 text-sm font-medium cursor-pointer">
                {d.label}
                <input type="checkbox" checked={!!dietary[d.key]} onChange={(e) => setDietary((x) => ({ ...x, [d.key]: e.target.checked }))} className="w-5 h-5 accent-[var(--primary)]" />
              </label>
            ))}
            <div className="text-xs text-muted-foreground">نستبعد المنتجات المخالفة حازماً؛ وعند غياب معلومات المكوّنات نظهر «تحقق من الملصق» — لا نفترض السلامة عند الجهل.</div>
          </div>
        )}

        {/* STEP: budget */}
        {steps[step]?.title === 'الميزانية' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold block mb-1">مبلغ الميزانية (دينار بحريني)</label>
              <input value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} inputMode="decimal" placeholder="مثال: 220" className="w-full glass-thin rounded-xl min-h-13 px-4 text-2xl font-bold tabular-nums" />
              <div className="text-xs text-muted-foreground mt-1">{budgetFils ? formatBHD(budgetFils) : 'أدخل مبلغاً صحيحاً'}</div>
            </div>

            {/* Smart budget suggester (المقترح الذكي) */}
            {members.length ? (
              <div className="glass-thin rounded-xl p-3 space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold"><Lightbulb size={16} strokeWidth={1.75} aria-hidden /> المقترح الذكي — كم تحتاج أسرتك تقريباً؟</div>
                <div className="grid grid-cols-2 gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.mode}
                      onClick={() => { setBudgetInput(String(s.fils / 1000)); setSuggestMode(s.mode) }}
                      className={`min-h-11 rounded-xl p-2.5 text-start transition-all active:scale-[0.98] ${suggestMode === s.mode ? 'bg-primary/15 border border-primary/30' : 'glass-thin'}`}
                      aria-pressed={suggestMode === s.mode}
                      aria-label={`${MODE_LABELS[s.mode]?.nameAr ?? s.mode}: ${formatBHD(s.fils)}`}
                    >
                      <span className="block text-xs font-semibold">{MODE_LABELS[s.mode]?.nameAr ?? s.mode}{s.mode === 'balanced' ? ' · موصى بها' : ''}</span>
                      <span className="block text-sm font-bold tabular-nums mt-0.5">{formatBHD(s.fils)}</span>
                    </button>
                  ))}
                </div>
                {suggestMode ? <div className="text-xs text-muted-foreground leading-relaxed">{suggestions.find((s) => s.mode === suggestMode)?.noteAr}</div> : null}
              </div>
            ) : null}

            {/* Level ladder (سلّم المستويات) */}
            {members.length ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold"><Layers size={16} strokeWidth={1.75} aria-hidden /> سلّم المستويات (من دليل خطط البقالة البحرينية)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ladder.map((L) => (
                    <button
                      key={L.level}
                      onClick={() => { setBudgetInput(String(L.fils / 1000)); setSuggestMode(null) }}
                      className="glass-thin rounded-xl p-2.5 text-start transition-all active:scale-[0.98] hover:bg-secondary/60"
                      aria-label={`${L.level} — ${L.nameAr}: ${formatBHD(L.fils)}`}
                    >
                      <span className="flex items-center gap-1.5 mb-1">
                        <span className="w-6 h-6 rounded-lg bg-accent/15 text-accent grid place-items-center text-xs font-bold shrink-0">{L.level}</span>
                        <span className="text-[11px] font-semibold leading-tight">{L.nameAr}</span>
                      </span>
                      <span className="block text-sm font-bold tabular-nums">{formatBHD(L.fils)}</span>
                      <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">{L.descAr}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground">كل ضغطة على مستوى تُعبّئ مبلغه في حقل الميزانية</div>
              </div>
            ) : null}

            {/* Income guidance + financial-rule transparency */}
            <div className="glass-thin rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold"><Banknote size={14} strokeWidth={1.75} aria-hidden /> إرشاد بحسب الراتب (اختياري)</div>
              <label className="block text-xs text-muted-foreground">راتب الشهر (د.ب)
                <input value={incomeInput} onChange={(e) => setIncomeInput(e.target.value)} inputMode="decimal" placeholder="مثال: 400" className="block w-full glass-thin rounded-xl min-h-11 px-3 text-sm mt-1 tabular-nums" />
              </label>
              {incomeSuggestFils > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>≈ <span className="font-bold text-foreground tabular-nums">{formatBHD(incomeSuggestFils)}</span> مقترح للبقالة (29%)</span>
                  <GlassButton size="sm" className="min-h-11" onClick={() => { setBudgetInput(String(incomeSuggestFils / 1000)); setSuggestMode(null) }}>عبّئ الميزانية</GlassButton>
                </div>
              ) : null}
              {incomeFils > 0 ? <div className="text-[11px] text-muted-foreground">لا نطلب أكثر من 100 د.ب مهما كان الراتب — خطة الاكتفاء الكريم</div> : null}
              <div className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/60 pt-2 flex items-start gap-1.5">
                <Info size={12} strokeWidth={1.75} aria-hidden className="shrink-0 mt-0.5" />
                <span>قاعدة الإرشاد المالي: البقالة الشاملة ≈ 29% من راتب 350 د.ب (سقف 100 د.ب) — وأنت حر في كتابة أي مبلغ.</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-1">الفترة</label>
              <div className="flex gap-2">
                {([['week', 'أسبوع'], ['biweekly', 'نصف شهر'], ['month', 'شهر']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setPeriod(v)} className={`flex-1 min-h-11 rounded-xl text-sm font-medium ${period === v ? 'bg-primary/15 text-primary' : 'glass-thin'}`}>{label}</button>
                ))}
              </div>
            </div>

            {/* plan-mode picker — five modes with explicit offset percentages */}
            <div className="space-y-2">
              <div className="text-sm font-semibold">نمط الخطة (مستوى الأسعار)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {WIZARD_MODES.map((m) => {
                  const info = MODE_LABELS[m] ?? { nameAr: m, descAr: '', offsetPct: 0 }
                  const selected = planMode === m
                  return (
                    <div key={m} className={`rounded-xl p-3 ${m === 'custom' ? 'sm:col-span-2' : ''} ${selected ? 'bg-primary/15 border border-primary/30' : 'glass-thin'}`}>
                      <button onClick={() => setPlanMode(m)} aria-pressed={selected} className="w-full text-start min-h-11">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold flex flex-wrap items-center gap-1.5">{info.nameAr}{m === 'balanced' ? <Pill tone="accent">موصى بها</Pill> : null}</span>
                          <Pill tone={selected ? 'primary' : 'default'}>{m === 'custom' ? 'متغير' : offsetPctLabel(info.offsetPct)}</Pill>
                        </span>
                        <span className="block text-[11px] text-muted-foreground leading-snug mt-1">{info.descAr}</span>
                        {m === 'crisis' ? <span className="block text-[11px] text-muted-foreground leading-snug mt-1">وضع بقاء منظم مؤقت — بيضة يومية لكل طفل وشاي محلى خط أحمر</span> : null}
                      </button>
                      {m === 'custom' && selected ? (
                        <div className="mt-2 pt-2 border-t border-border/60">
                          <label className="flex items-center justify-between text-xs font-semibold mb-1">
                            <span>إزاحة مستوى الأسعار</span>
                            <span className="tabular-nums text-primary">{offsetPctLabel(customOffsetPct)}</span>
                          </label>
                          <input type="range" min={-35} max={25} step={1} value={customOffsetPct} onChange={(e) => setAdvanced({ lifestyle: { ...advanced.lifestyle, customModeOffsetPct: Number(e.target.value) } })} className="w-full accent-[var(--primary)]" aria-label="إزاحة مستوى الأسعار (نسبة مئوية)" />
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>−35%</span><span>+25%</span></div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <label className="block text-sm font-semibold">
              الاحتياطي للتذبذب: {reserve}٪
              <input type="range" min={0} max={15} value={reserve} onChange={(e) => setReserve(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
              <span className="text-xs text-muted-foreground font-normal">مبلغ محجوز لتقلبات أسعار الفواكه والخضار — يظهر كوفر إن لم يُصرف</span>
            </label>
            <div className="text-xs text-muted-foreground -mt-2">نحجز {reserve}% احتياطي مرونة (قابل للتعديل في الخيارات المتقدمة)</div>
            <label className="block text-sm font-semibold">
              المرونة: {flexibility}٪
              <input type="range" min={0} max={20} value={flexibility} onChange={(e) => setFlexibility(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
            </label>
            {budgetFils && members.length ? (
              <div className="glass-thin rounded-xl p-3 text-sm">
                <div className="font-semibold mb-1">مساعد التقدير</div>
                <div className="text-muted-foreground text-xs leading-relaxed">
                  أسرتك {members.length} أفراد. النطاق المعقول تقديراً من الكتالوج:
                  <span className="font-bold text-foreground"> اقتصادي ≈ {formatBHD(Math.round(members.length * 22) * 1000)}</span> ·
                  <span className="font-bold text-foreground"> معتاد ≈ {formatBHD(Math.round(members.length * 38) * 1000)}</span> ·
                  <span className="font-bold text-foreground"> مريح ≈ {formatBHD(Math.round(members.length * 55) * 1000)}</span>
                  {budgetFils < members.length * 22 * 1000 ? <div className="text-destructive mt-1">ميزانيتك أدنى من النطاق الاقتصادي — سنبني أفضل خطة ممكنة ونعرض الفجوة بشفافية</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* STEP: stores — median-first: stores are price references, optimization is opt-in */}
        {steps[step]?.title === 'المتاجر والتوصيل' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold block mb-2">نمط الأسعار</label>
              <div className="grid grid-cols-3 gap-2">
                {([['median', 'أسعار مرجعية بالوسيط'], ['best-single', 'أرخص متجر واحد (اختياري)'], ['split', 'سلة موزعة (اختياري)']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setStoreMode(v)} aria-pressed={storeMode === v} className={`min-h-11 rounded-xl text-xs font-medium px-2 ${storeMode === v ? 'bg-primary/15 text-primary' : 'glass-thin'}`}>{label}</button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed mt-2">الافتراضي أسعار مرجعية بالوسيط — المتاجر أدناه مراجع أسعار فقط، لا ترشيحات لمتجر بعينه. مقارنة المتاجر وتحسين السلة تفعيل اختياري منك ولا يغيّر خطة الاكتفاء.</div>
            </div>
            <div>
              <label className="text-xs font-semibold block mb-2">مراجع الأسعار (اختياري)</label>
              <div className="flex flex-wrap gap-2">
                {['ninja', 'talabat', 'lulu', 'aljazira', 'hypermax', 'tamimi', 'sultan'].map((sid) => (
                  <button
                    key={sid}
                    onClick={() => setAvailableStores((cur) => cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid])}
                    className={`min-h-11 px-4 rounded-xl text-sm font-medium ${availableStores.includes(sid) ? 'bg-primary/15 text-primary' : 'glass-thin'}`}
                    aria-pressed={availableStores.includes(sid)}
                  >
                    {sid === 'ninja' ? 'نينجا' : sid === 'talabat' ? 'طلبات مارت' : sid === 'lulu' ? 'لولو' : sid === 'aljazira' ? 'الجزيرة' : sid === 'hypermax' ? 'هايبر ماكس' : sid === 'tamimi' ? 'تميمي' : 'السلطان'}
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-2">{storeMode === 'median' ? 'اتركها فارغة لاستخدام كل المتاجر كمراجع أسعار وسيطة' : 'اختياري مفعّل: سنبحث أفضل سعر في متاجرك المختارة فقط'}</div>
            </div>
          </div>
        )}

        {/* STEP: naming & quality */}
        {steps[step]?.title === 'التسمية والجودة' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold block mb-1">اسم الأسرة (اختياري — يظهر في التقارير)</label>
              <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="مثال: أسرة العلي" className="w-full glass-thin rounded-xl min-h-11 px-4 text-sm" />
              <div className="text-xs text-muted-foreground mt-1">نستخدم أسماء مستعارة للأفراد افتراضياً حفاظاً على الخصوصية</div>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">اسم الخطة (اختياري)</label>
              <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="مثال: خطة نوفمبر" className="w-full glass-thin rounded-xl min-h-11 px-4 text-sm" />
            </div>
            <label className="block text-sm font-semibold">
              تفضيل الجودة العام
              <div className="flex justify-between text-xs text-muted-foreground font-normal mb-1"><span>اقتصادي</span><span>متوازن</span><span>مميز</span></div>
              <input type="range" min={-1} max={1} step={0.25} value={qualityBias} onChange={(e) => setQualityBias(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
            </label>
            <div>
              <label className="text-sm font-semibold block mb-2">عناصر عامة بميزانية مرنة (اختياري)</label>
              <div className="flex flex-wrap gap-2">
                {ENVELOPE_TEMPLATES.map((t) => (
                  <button
                    key={t.groupId}
                    onClick={() => setEnvelopeSelection((cur) => cur.includes(t.groupId) ? cur.filter((x) => x !== t.groupId) : [...cur, t.groupId])}
                    className={`min-h-11 px-4 rounded-xl text-sm font-medium ${envelopeSelection.includes(t.groupId) ? 'bg-accent/15 text-accent' : 'glass-thin'}`}
                    aria-pressed={envelopeSelection.includes(t.groupId)}
                  >
                    {t.nameAr} ({t.min / 1000}–{t.max / 1000} د.ب)
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP: summary */}
        {steps[step]?.title === 'الملخص' && (
          <div className="space-y-3">
            <div className="glass-thin rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">الأفراد</span><span className="font-semibold">{members.length}{infantCount ? ` (فيهم ${infantCount} طفل دون 3 سنوات)` : ''}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الميزانية</span><span className="font-semibold tabular-nums">{budgetFils ? `${formatBHD(budgetFils)} / ${period === 'month' ? 'شهر' : period === 'week' ? 'أسبوع' : 'نصف شهر'}` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">العادات</span><span className="font-semibold">{Object.keys(habits).filter((k) => habits[k] != null && k !== 'diapers' && k !== 'formula').join('، ') || 'افتراضية'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">قيود غذائية</span><span className="font-semibold">{Object.entries(dietary).filter(([, v]) => v && v !== true).map(([k]) => k).join('، ') || 'لا يوجد'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">عناصر عامة</span><span className="font-semibold">{envelopeSelection.length || 'لا يوجد'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">نمط الخطة</span><span className="font-semibold">{MODE_LABELS[planMode]?.nameAr ?? planMode} · <span className="tabular-nums">{planMode === 'custom' ? offsetPctLabel(customOffsetPct) : offsetPctLabel(MODE_LABELS[planMode]?.offsetPct ?? 0)}</span></span></div>
            </div>
            {/* advanced preferences summary + link (hundreds of options) */}
            <div className="glass-thin rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2"><SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden /> الخيارات المتقدمة</div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-primary">{activeAdvancedCount}</span>
                <span className="text-xs text-muted-foreground">خيار مفعّل</span>
              </div>
              {advancedChips.length ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {advancedChips.map((c) => <Pill key={c} tone="accent">{c}</Pill>)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-2">كل شيء على الإعدادات الافتراضية — مئات الخيارات بانتظارك في صفحة الخيارات المتقدمة</div>
              )}
              <GlassButton variant="primary" className="w-full mt-3" onClick={() => navigate({ name: 'advanced' })}>
                <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden /> افتح الخيارات المتقدمة (مئات الخيارات)
              </GlassButton>
              <div className="text-[11px] text-muted-foreground mt-2 text-center">التغييرات تُطبّق فوراً على جيلتك القادمة</div>
            </div>
            <GlassButton variant="primary" size="lg" className="w-full" disabled={!budgetFils || generating} onClick={generate}>
              {generating ? <Spinner /> : <Sparkles size={18} strokeWidth={1.75} aria-hidden />}
              {generating ? 'نحسب احتياج أسرتكم… نبحث في 39,831 منتجاً…' : 'ولّد الخطة'}
            </GlassButton>
            {error ? <div className="text-destructive text-sm" role="alert">{error}</div> : null}
          </div>
        )}

        {/* nav buttons */}
        <div className="flex justify-between mt-6 pt-4 border-t border-border/60">
          <GlassButton onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ArrowRight size={16} strokeWidth={1.75} className="flip-x" aria-hidden /> السابق
          </GlassButton>
          <GlassButton variant="primary" onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} disabled={step >= steps.length - 1}>
            التالي <ArrowLeft size={16} strokeWidth={1.75} className="flip-x" aria-hidden />
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  )
}
