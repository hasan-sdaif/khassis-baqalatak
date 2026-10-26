'use client'
/**
 * Envelopes view (spec 7.21): generic groups & budget envelopes.
 * Live budget bar (sticky), group picker, full envelope editor
 * (range / fixed / quantity + preferences), per-envelope live assortment
 * preview through the plan API, quick templates, overlap detection with
 * one-tap merge, and "save & regenerate plan".
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { generatePlanApi } from '@/lib/api-client'
import { formatBHD, parseBHDToFils, formatNumberAr, unitLabelAr } from '@/lib/money'
import {
  GlassCard, GlassButton, Pill, StatTile, EmptyState, Spinner, SectionTitle,
} from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import { Switch } from '@/components/ui/switch'
import { GENERIC_GROUPS, ENVELOPE_TEMPLATES } from '@/lib/engine'
import type { Budget, BudgetEnvelope, EnvelopeResult, GenericGroup, Household } from '@/lib/engine/types'
import {
  Wallet, TriangleAlert, Trash2, Pencil, Eye, X, Merge, Sparkles, Save, Info, ChevronDown, ChevronUp,
} from 'lucide-react'

// ------------------------------ constants ------------------------------

const PRIORITY_LABEL: Record<BudgetEnvelope['priority'], string> = {
  must: 'ضروري', high: 'مرتفع', normal: 'عادي', ifLeft: 'إن تيسر',
}
const PRIORITY_TONE: Record<BudgetEnvelope['priority'], 'default' | 'primary' | 'accent' | 'danger'> = {
  must: 'danger', high: 'accent', normal: 'default', ifLeft: 'default',
}
const PRIORITY_RANK: Record<BudgetEnvelope['priority'], number> = { must: 3, high: 2, normal: 1, ifLeft: 0 }
const MODE_LABEL: Record<Draft['mode'], string> = { range: 'نطاق', fixed: 'ثابت', quantity: 'كمية' }
const AUDIENCE_LABEL: Record<'all' | 'kids' | 'adults', string> = { all: 'الكل', kids: 'أطفال', adults: 'بالغون' }
const SIZE_LABEL: Record<'small' | 'medium' | 'large', string> = { small: 'صغير', medium: 'وسط', large: 'كبير' }
const TIER_LABEL: Record<'econ' | 'mid' | 'premium', string> = { econ: 'اقتصادي', mid: 'متوسط', premium: 'مميز' }
const VARIETY_LABEL: Record<'low' | 'normal' | 'high', string> = { low: 'قليل', normal: 'عادي', high: 'عالٍ' }

const COMMON_TAGS: { id: string; label: string }[] = [
  { id: 'dietary:sugar-free', label: 'بدون سكر' },
  { id: 'dietary:gluten-free', label: 'بدون غلوتين' },
  { id: 'dietary:organic', label: 'عضوي' },
  { id: 'allergen:nuts', label: 'مكسرات' },
  { id: 'allergen:milk', label: 'حليب' },
  { id: 'allergen:gluten', label: 'غلوتين' },
  { id: 'allergen:egg', label: 'بيض' },
  { id: 'allergen:soy', label: 'صويا' },
]

const QTY_UNITS: { id: string; label: string }[] = [
  { id: 'pcs', label: 'حبة' }, { id: 'ml', label: 'مل' }, { id: 'g', label: 'جم' },
  { id: 'rolls', label: 'رول' }, { id: 'sheets', label: 'منديل' }, { id: 'bags', label: 'كيس' },
]

const SLIDER_MAX_FILS = 30000
const STEP_FILS = 250

const DEFAULT_HOUSEHOLD: Household = {
  members: [
    { id: 'd-adult-1', ageMonths: 384, gender: 'm', specials: [] },
    { id: 'd-adult-2', ageMonths: 360, gender: 'f', specials: [] },
    { id: 'd-kid-1', ageMonths: 96, specials: [] },
    { id: 'd-kid-2', ageMonths: 48, specials: [] },
  ],
  habits: {},
  dietary: { halalOnly: true },
  prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
  eatingOutPerWeek: 2,
  guestsPerMonth: 4,
  hasWaterDispenser: false,
  storage: 'medium',
}
const DEFAULT_BUDGET: Budget = { fils: 200000, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 }

/** parents first, each followed by its children (visual indent in the picker) */
const ORDERED_GROUPS: GenericGroup[] = (() => {
  const out: GenericGroup[] = []
  for (const g of GENERIC_GROUPS.filter((x) => !x.parent)) {
    out.push(g)
    out.push(...GENERIC_GROUPS.filter((x) => x.parent === g.id))
  }
  for (const g of GENERIC_GROUPS.filter((x) => x.parent && !out.some((o) => o.id === x.parent))) out.push(g)
  return out
})()
const GROUP_BY_ID = new Map<string, GenericGroup>(ORDERED_GROUPS.map((g) => [g.id, g]))

// ------------------------------ draft model ------------------------------

interface Draft {
  editingId: string | null
  groups: string[]
  name: string
  mode: 'range' | 'fixed' | 'quantity'
  minFils: number
  maxFils: number
  fixedFils: number
  qtyValue: number
  qtyUnit: string
  priority: BudgetEnvelope['priority']
  fillToMax: boolean
  audience: ('adults' | 'kids' | 'all')[]
  sizeBias?: 'small' | 'medium' | 'large'
  tierBias?: 'econ' | 'mid' | 'premium'
  variety?: 'low' | 'normal' | 'high'
  avoidTags: string[]
  minStr: string
  maxStr: string
  fixedStr: string
}

function draftFromEnv(e: BudgetEnvelope): Draft {
  const mode: Draft['mode'] = e.mode === 'fixed' ? 'fixed' : e.mode === 'quantity' ? 'quantity' : 'range'
  const minFils = e.minFils ?? 1000
  const maxFils = e.maxFils ?? Math.max(5000, minFils)
  const fixedFils = e.fixedFils ?? 2000
  return {
    editingId: e.id,
    groups: [...e.groups],
    name: e.name,
    mode,
    minFils,
    maxFils,
    fixedFils,
    qtyValue: e.quantity?.value ?? 2,
    qtyUnit: e.quantity?.unit ?? 'pcs',
    priority: e.priority,
    fillToMax: e.fillToMax,
    audience: e.audience ? [...e.audience] : ['all'],
    sizeBias: e.preferences?.sizeBias,
    tierBias: e.preferences?.tierBias,
    variety: e.preferences?.variety,
    avoidTags: e.preferences?.avoidTags ? [...e.preferences?.avoidTags] : [],
    minStr: (minFils / 1000).toString(),
    maxStr: (maxFils / 1000).toString(),
    fixedStr: (fixedFils / 1000).toString(),
  }
}

// ------------------------------ helpers ------------------------------

function envMinFils(e: BudgetEnvelope): number {
  if (e.mode === 'fixed') return Math.max(0, e.fixedFils ?? 0)
  if (e.mode === 'range') return Math.max(0, e.minFils ?? 0)
  return 0
}
function envFlexFils(e: BudgetEnvelope): number {
  if (e.mode !== 'range') return 0
  return Math.max(0, (e.maxFils ?? 0) - (e.minFils ?? 0))
}
function envRangeText(e: BudgetEnvelope): string {
  if (e.mode === 'fixed') return `ثابت ${formatBHD(e.fixedFils ?? 0)}`
  if (e.mode === 'quantity') {
    const q = e.quantity
    return q ? `كمية ${formatNumberAr(q.value)} ${unitLabelAr(q.unit)}` : 'كمية'
  }
  return `${formatBHD(e.minFils ?? 0, { withUnit: false })} – ${formatBHD(e.maxFils ?? 0, { withUnit: false })} د.ب`
}
const filsToBhdStr = (f: number): string => (Math.round(f) / 1000).toString()

/** parse loose numeric input (Arabic-Indic digits tolerated) */
function parseNum(input: string): number {
  const cleaned = String(input).replace(/[٠-٩]/g, (d) => String(d.codePointAt(0)! - 0x0660)).replace(/[^\d.]/g, '')
  const v = parseFloat(cleaned)
  return Number.isNaN(v) ? 0 : v
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'default' | 'primary' | 'danger' }) {
  const tones: Record<string, string> = { default: 'text-foreground', primary: 'text-primary', danger: 'text-destructive' }
  return (
    <div className="glass-thin rounded-lg px-2.5 py-1.5 min-w-[110px] flex-1">
      <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${tones[tone ?? 'default']}`}>{value}</div>
    </div>
  )
}

/** selectable chip (44px touch target) */
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

// ------------------------------ view ------------------------------

export function EnvelopesView() {
  const store = useApp()
  const { envelopes, household, budget } = store
  const arabicNumerals = store.settings.arabicNumerals
  const [draft, setDraft] = useState<Draft | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<EnvelopeResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<string | null>(null)
  const [regenLoading, setRegenLoading] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  const previewSeq = useRef(0)

  // ---- live budget math
  const budgetFils = budget?.fils ?? 0
  const reserved = envelopes.reduce((s, e) => s + envMinFils(e), 0)
  const flexible = envelopes.reduce((s, e) => s + envFlexFils(e), 0)
  const remaining = budgetFils - reserved - flexible
  const overBudget = budgetFils > 0 && reserved > budgetFils
  const minsHeavy = budgetFils > 0 && !overBudget && reserved > budgetFils * 0.6
  const reservedPct = budgetFils > 0 ? Math.min(100, (reserved / budgetFils) * 100) : 0
  const flexPct = budgetFils > 0 ? Math.min(100 - reservedPct, (flexible / budgetFils) * 100) : 0

  // ---- overlap detection
  const overlaps = useMemo(() => {
    const res: { a: BudgetEnvelope; b: BudgetEnvelope; shared: GenericGroup[] }[] = []
    for (let i = 0; i < envelopes.length; i++) {
      for (let j = i + 1; j < envelopes.length; j++) {
        const sharedIds = envelopes[i]!.groups.filter((g) => envelopes[j]!.groups.includes(g))
        if (sharedIds.length) {
          res.push({ a: envelopes[i]!, b: envelopes[j]!, shared: sharedIds.map((g) => GROUP_BY_ID.get(g)).filter((g): g is GenericGroup => !!g) })
        }
      }
    }
    return res
  }, [envelopes])

  const clearPreview = () => {
    previewSeq.current++
    setPreviewId(null)
    setPreviewResult(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }

  // ---- group picker
  const toggleGroup = (id: string) => {
    const g = GROUP_BY_ID.get(id)
    if (!g) return
    if (!draft) {
      const tpl = ENVELOPE_TEMPLATES.find((t) => t.groupId === id)
      setDraft({
        editingId: null,
        groups: [id],
        name: tpl?.nameAr ?? g.nameAr,
        mode: 'range',
        minFils: tpl?.min ?? 1000,
        maxFils: tpl?.max ?? 5000,
        fixedFils: 2000,
        qtyValue: 2,
        qtyUnit: 'pcs',
        priority: tpl?.priority ?? 'normal',
        fillToMax: false,
        audience: tpl ? [...tpl.audience] : ['all'],
        avoidTags: [],
        minStr: ((tpl?.min ?? 1000) / 1000).toString(),
        maxStr: ((tpl?.max ?? 5000) / 1000).toString(),
        fixedStr: '2',
      })
      return
    }
    const groups = draft.groups.includes(id) ? draft.groups.filter((x) => x !== id) : [...draft.groups, id]
    if (groups.length === 0) { setDraft(null); return }
    setDraft({ ...draft, groups })
  }

  // ---- editor field setters
  const setMinStr = (s: string) => { if (draft) setDraft({ ...draft, minStr: s, minFils: parseBHDToFils(s) }) }
  const setMaxStr = (s: string) => { if (draft) setDraft({ ...draft, maxStr: s, maxFils: parseBHDToFils(s) }) }
  const setFixedStr = (s: string) => { if (draft) setDraft({ ...draft, fixedStr: s, fixedFils: parseBHDToFils(s) }) }
  const onMinSlider = (v: number) => {
    if (!draft) return
    const minFils = Math.min(v, SLIDER_MAX_FILS)
    const maxFils = Math.max(minFils, draft.maxFils)
    setDraft({ ...draft, minFils, maxFils, minStr: filsToBhdStr(minFils), maxStr: filsToBhdStr(maxFils) })
  }
  const onMaxSlider = (v: number) => {
    if (!draft) return
    const maxFils = Math.min(v, SLIDER_MAX_FILS)
    const minFils = Math.min(maxFils, draft.minFils)
    setDraft({ ...draft, minFils, maxFils, minStr: filsToBhdStr(minFils), maxStr: filsToBhdStr(maxFils) })
  }
  const onFixedSlider = (v: number) => {
    if (!draft) return
    const fixedFils = Math.min(v, SLIDER_MAX_FILS)
    setDraft({ ...draft, fixedFils, fixedStr: filsToBhdStr(fixedFils) })
  }
  const toggleAudience = (a: 'adults' | 'kids' | 'all') => {
    if (!draft) return
    let audience = draft.audience.includes(a) ? draft.audience.filter((x) => x !== a) : [...draft.audience, a]
    if (audience.length === 0) audience = ['all']
    setDraft({ ...draft, audience })
  }
  const toggleAvoidTag = (t: string) => {
    if (!draft) return
    const avoidTags = draft.avoidTags.includes(t) ? draft.avoidTags.filter((x) => x !== t) : [...draft.avoidTags, t]
    setDraft({ ...draft, avoidTags })
  }
  const setPref = (key: 'sizeBias' | 'tierBias' | 'variety', v: string) => {
    if (!draft) return
    const next = draft[key] === v ? undefined : v
    setDraft({ ...draft, [key]: next } as Draft)
  }

  const saveDraft = () => {
    if (!draft || draft.groups.length === 0) return
    const built: BudgetEnvelope = {
      id: draft.editingId ?? `env-${draft.groups[0]}-${Date.now() % 10000}`,
      name: draft.name.trim() || GROUP_BY_ID.get(draft.groups[0]!)?.nameAr || 'ظرف عام',
      groups: draft.groups,
      mode: draft.mode,
      minFils: draft.mode === 'range' ? Math.max(0, Math.round(draft.minFils)) : undefined,
      maxFils: draft.mode === 'range' ? Math.max(0, Math.round(Math.max(draft.minFils, draft.maxFils))) : undefined,
      fixedFils: draft.mode === 'fixed' ? Math.max(0, Math.round(draft.fixedFils)) : undefined,
      quantity: draft.mode === 'quantity' ? { value: Math.max(0, draft.qtyValue), unit: draft.qtyUnit } : undefined,
      priority: draft.priority,
      fillToMax: draft.fillToMax,
      preferences: {
        avoidTags: draft.avoidTags.length ? draft.avoidTags : undefined,
        sizeBias: draft.sizeBias,
        tierBias: draft.tierBias,
        variety: draft.variety,
      },
      audience: draft.audience.length ? draft.audience : undefined,
    }
    if (draft.editingId) store.updateEnvelope(draft.editingId, built)
    else store.addEnvelope(built)
    setDraft(null)
    clearPreview()
  }

  const addTemplate = (t: (typeof ENVELOPE_TEMPLATES)[number]) => {
    store.addEnvelope({
      id: `env-${t.groupId}-${Date.now() % 10000}`,
      name: t.nameAr,
      groups: [t.groupId],
      mode: 'range',
      minFils: t.min,
      maxFils: t.max,
      priority: t.priority,
      fillToMax: false,
      audience: [...t.audience],
    })
    clearPreview()
  }

  const mergePair = (a: BudgetEnvelope, b: BudgetEnvelope) => {
    const groups = [...new Set([...a.groups, ...b.groups])]
    const bothRange = a.mode === 'range' && b.mode === 'range'
    const merged: BudgetEnvelope = {
      ...a,
      groups,
      minFils: bothRange ? (a.minFils ?? 0) + (b.minFils ?? 0) : a.minFils,
      maxFils: bothRange ? (a.maxFils ?? 0) + (b.maxFils ?? 0) : a.maxFils,
      fixedFils: a.mode === 'fixed' && b.mode === 'fixed' ? (a.fixedFils ?? 0) + (b.fixedFils ?? 0) : a.fixedFils,
      fillToMax: a.fillToMax || b.fillToMax,
      priority: PRIORITY_RANK[a.priority] >= PRIORITY_RANK[b.priority] ? a.priority : b.priority,
    }
    store.addEnvelope(merged)
    store.removeEnvelope(b.id)
    if (previewId === b.id) clearPreview()
  }

  // ---- live preview of one envelope's assortment
  const previewEnv = async (env: BudgetEnvelope) => {
    if (previewId === env.id && (previewResult || previewError)) { clearPreview(); return }
    const seq = ++previewSeq.current
    setPreviewId(env.id)
    setPreviewLoading(true)
    setPreviewResult(null)
    setPreviewError(null)
    try {
      const { plan } = await generatePlanApi({
        household: household ?? DEFAULT_HOUSEHOLD,
        budget: budget ?? DEFAULT_BUDGET,
        envelopes: [env],
        mode: 'balanced',
      })
      if (seq !== previewSeq.current) return
      setPreviewResult(plan.envelopes.find((r) => r.envelopeId === env.id) ?? plan.envelopes[0] ?? null)
    } catch (err) {
      if (seq !== previewSeq.current) return
      setPreviewError(String((err as Error).message ?? err))
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false)
    }
  }

  // ---- save & regenerate the full plan
  const canRegen = !!household && !!budget && envelopes.length > 0
  const saveAndRegen = async () => {
    if (!household || !budget || envelopes.length === 0) return
    setRegenLoading(true)
    setRegenError(null)
    try {
      const { plan } = await generatePlanApi({
        household,
        budget,
        envelopes,
        mode: store.planMode,
        locks: store.locks,
        pantry: store.pantry,
        season: 'normal',
        storeMode: 'median',
        availableStores: [],
      })
      store.setEnvelopes(envelopes)
      store.setPlan(plan)
      navigate({ name: 'plan' })
    } catch (err) {
      setRegenError(String((err as Error).message ?? err))
    } finally {
      setRegenLoading(false)
    }
  }

  const usingDefaults = !household || !budget

  return (
    <div className="space-y-6 pb-8 pt-2">
      {/* intro */}
      <section>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          الأظرف طريقة ذكية لضبط الكماليات: اختر مجموعة عامة (شوكولاتة، عصائر، قهوة…) وحدّد نطاقاً شهرياً،
          ونحن نختار لك تشكيلة متنوعة مناسبة من الكتالوج ضمن النطاق — والفائض يذهب تلقائياً إلى أساسيات بقالتك.
        </p>
      </section>

      {/* live budget bar (sticky glass chrome) */}
      <div className="sticky top-[74px] z-10 glass-chrome rounded-2xl p-3 no-print space-y-2" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-bold flex items-center gap-2">
            <Wallet size={16} strokeWidth={1.75} aria-hidden /> ميزانية الأظرف
          </span>
          {budget ? (
            <span className="text-sm font-bold tabular-nums">{formatBHD(budgetFils, { arabicNumerals })}</span>
          ) : (
            <button type="button" className="text-xs text-primary underline min-h-11" onClick={() => navigate({ name: 'start' })}>
              حدّد ميزانيتك أولاً
            </button>
          )}
        </div>
        {budget ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <MiniStat label="محجوز (الحدود الدنيا)" value={formatBHD(reserved, { arabicNumerals })} tone={overBudget ? 'danger' : 'primary'} />
              <MiniStat label="مرن (الأدنى ← الأقصى)" value={formatBHD(flexible, { arabicNumerals })} />
              <MiniStat label="المتبقي للتوزيع التلقائي" value={formatBHD(remaining, { arabicNumerals })} tone={remaining < 0 ? 'danger' : 'default'} />
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden flex" aria-hidden>
              <div className="bg-primary h-full transition-all" style={{ width: `${reservedPct}%` }} />
              <div className="bg-primary/35 h-full transition-all" style={{ width: `${flexPct}%` }} />
            </div>
            {overBudget ? (
              <div className="flex items-start gap-1.5 text-xs text-destructive font-semibold">
                <TriangleAlert size={14} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
                تجاوز الميزانية — خفّض الحد الأدنى للأقل أولوية
              </div>
            ) : minsHeavy ? (
              <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-semibold">
                <TriangleAlert size={14} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
                الحدود الدنيا تحجز أكثر من نصف الميزانية
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* group picker */}
      <section aria-label="اختيار المجموعات">
        <SectionTitle>اختر مجموعة عامة</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ORDERED_GROUPS.map((g) => {
            const selected = draft ? draft.groups.includes(g.id) : false
            const child = !!g.parent
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGroup(g.id)}
                aria-pressed={selected}
                className={`flex items-center gap-2 min-h-11 px-3 rounded-xl text-start font-semibold transition-all active:scale-[0.98] ${child ? 'ms-5 text-xs' : 'text-sm'} ${selected ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : 'glass-thin hover:bg-secondary/60 text-foreground/85'}`}
              >
                <CategoryIcon category={g.icon} size={child ? 15 : 18} />
                <span className="truncate">{g.nameAr}</span>
              </button>
            )
          })}
        </div>
        <div className="text-[11px] text-muted-foreground mt-2">
          المجموعات الفرعية تظهر مزاحة قليلاً — انقر أكثر من مجموعة لدمجها في ظرف واحد.
        </div>
      </section>

      {/* envelope editor */}
      {draft ? (
        <section aria-label="محرر الظرف">
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2">
                <Wallet size={18} strokeWidth={1.75} aria-hidden /> {draft.editingId ? 'تعديل الظرف' : 'ظرف جديد'}
              </h3>
              <button type="button" onClick={() => setDraft(null)} className="min-h-11 min-w-11 grid place-items-center rounded-full hover:bg-secondary/60" aria-label="إغلاق المحرر">
                <X size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </div>

            {/* selected groups */}
            <div className="flex flex-wrap gap-2 mb-4">
              {draft.groups.map((gid) => {
                const g = GROUP_BY_ID.get(gid)
                return (
                  <span key={gid} className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                    <CategoryIcon category={g?.icon ?? 'boxes'} size={14} />
                    {g?.nameAr ?? gid}
                    <button type="button" onClick={() => toggleGroup(gid)} aria-label={`إزالة ${g?.nameAr ?? gid}`} className="ms-0.5 min-h-11 min-w-11 -me-2 grid place-items-center rounded-full hover:bg-primary/15">
                      <X size={13} strokeWidth={1.75} aria-hidden />
                    </button>
                  </span>
                )
              })}
            </div>

            {/* name */}
            <label className="block text-sm font-semibold mb-1.5" htmlFor="env-name">اسم الظرف</label>
            <input
              id="env-name"
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="glass-thin rounded-xl min-h-11 px-3 w-full mb-4"
              aria-label="اسم الظرف"
            />

            {/* mode segmented */}
            <div className="flex gap-2 mb-4" role="group" aria-label="نوع الظرف">
              {(['range', 'fixed', 'quantity'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraft({ ...draft, mode: m })}
                  aria-pressed={draft.mode === m}
                  className={`flex-1 min-h-11 rounded-xl text-sm font-semibold transition-all ${draft.mode === m ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'glass-thin hover:bg-secondary/60'}`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>

            {/* range mode: two inputs + dual sliders */}
            {draft.mode === 'range' ? (
              <div className="mb-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="env-min">من (دينار)</label>
                    <input id="env-min" type="text" inputMode="decimal" dir="ltr" value={draft.minStr} onChange={(e) => setMinStr(e.target.value)} className="glass-thin rounded-xl min-h-11 px-3 w-full tabular-nums" aria-label="الحد الأدنى بالدينار" />
                    <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{formatBHD(draft.minFils, { arabicNumerals })}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="env-max">إلى (دينار)</label>
                    <input id="env-max" type="text" inputMode="decimal" dir="ltr" value={draft.maxStr} onChange={(e) => setMaxStr(e.target.value)} className="glass-thin rounded-xl min-h-11 px-3 w-full tabular-nums" aria-label="الحد الأقصى بالدينار" />
                    <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{formatBHD(draft.maxFils, { arabicNumerals })}</div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>الحد الأدنى</span>
                    <span className="tabular-nums">{formatBHD(draft.minFils, { arabicNumerals, withUnit: false })} د.ب</span>
                  </div>
                  <input type="range" min={0} max={SLIDER_MAX_FILS} step={STEP_FILS} value={Math.min(draft.minFils, SLIDER_MAX_FILS)} onChange={(e) => onMinSlider(Number(e.target.value))} className="w-full accent-[var(--primary)]" aria-label="منزلق الحد الأدنى" />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>الحد الأقصى</span>
                    <span className="tabular-nums">{formatBHD(draft.maxFils, { arabicNumerals, withUnit: false })} د.ب</span>
                  </div>
                  <input type="range" min={0} max={SLIDER_MAX_FILS} step={STEP_FILS} value={Math.min(draft.maxFils, SLIDER_MAX_FILS)} onChange={(e) => onMaxSlider(Number(e.target.value))} className="w-full accent-[var(--primary)]" aria-label="منزلق الحد الأقصى" />
                </div>
                <div className="text-[11px] text-muted-foreground">خطوة المنزلق 0.250 د.ب — إذا تجاوز الأدنىُ الأقصى يُرفع الأقصى تلقائياً (والعكس).</div>
              </div>
            ) : null}

            {/* fixed mode */}
            {draft.mode === 'fixed' ? (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="env-fixed">المبلغ الثابت (دينار)</label>
                  <input id="env-fixed" type="text" inputMode="decimal" dir="ltr" value={draft.fixedStr} onChange={(e) => setFixedStr(e.target.value)} className="glass-thin rounded-xl min-h-11 px-3 w-full tabular-nums" aria-label="المبلغ الثابت بالدينار" />
                  <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{formatBHD(draft.fixedFils, { arabicNumerals })}</div>
                </div>
                <input type="range" min={0} max={SLIDER_MAX_FILS} step={STEP_FILS} value={Math.min(draft.fixedFils, SLIDER_MAX_FILS)} onChange={(e) => onFixedSlider(Number(e.target.value))} className="w-full accent-[var(--primary)]" aria-label="منزلق المبلغ الثابت" />
              </div>
            ) : null}

            {/* quantity mode */}
            {draft.mode === 'quantity' ? (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="env-qty">الكمية</label>
                  <input id="env-qty" type="text" inputMode="decimal" dir="ltr" value={draft.qtyValue} onChange={(e) => setDraft({ ...draft, qtyValue: Math.max(0, parseNum(e.target.value)) })} className="glass-thin rounded-xl min-h-11 px-3 w-full tabular-nums" aria-label="الكمية" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1" htmlFor="env-unit">الوحدة</label>
                  <select id="env-unit" value={draft.qtyUnit} onChange={(e) => setDraft({ ...draft, qtyUnit: e.target.value })} className="glass-thin rounded-xl min-h-11 px-3 w-full text-sm" aria-label="وحدة الكمية">
                    {QTY_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </div>
              </div>
            ) : null}

            {/* priority */}
            <label className="block text-sm font-semibold mb-1.5">الأولوية</label>
            <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="أولوية الظرف">
              {(['must', 'high', 'normal', 'ifLeft'] as const).map((p) => (
                <Chip key={p} selected={draft.priority === p} onClick={() => setDraft({ ...draft, priority: p })}>
                  {PRIORITY_LABEL[p]}
                </Chip>
              ))}
            </div>

            {/* fillToMax */}
            <div className="flex items-center justify-between gap-3 glass-thin rounded-xl p-3 mb-4">
              <div>
                <div className="text-sm font-semibold">املأ حتى الحد الأقصى</div>
                <div className="text-[11px] text-muted-foreground">إن توفر فائض بعد الأساسيات يُصرف في هذا الظرف</div>
              </div>
              <Switch checked={draft.fillToMax} onCheckedChange={(v) => setDraft({ ...draft, fillToMax: v })} aria-label="املأ حتى الحد الأقصى" />
            </div>

            {/* audience */}
            <label className="block text-sm font-semibold mb-1.5">الجمهور</label>
            <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="جمهور الظرف">
              {(['all', 'kids', 'adults'] as const).map((a) => (
                <Chip key={a} selected={draft.audience.includes(a)} onClick={() => toggleAudience(a)}>
                  {AUDIENCE_LABEL[a]}
                </Chip>
              ))}
            </div>

            {/* preferences */}
            <label className="block text-sm font-semibold mb-1.5">تفضيلات التشكيلة</label>
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground w-24 shrink-0">حجم العبوة</span>
                {(['small', 'medium', 'large'] as const).map((s) => (
                  <Chip key={s} selected={draft.sizeBias === s} onClick={() => setPref('sizeBias', s)} ariaLabel={`حجم العبوة ${SIZE_LABEL[s]}`}>
                    {SIZE_LABEL[s]}
                  </Chip>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground w-24 shrink-0">المستوى</span>
                {(['econ', 'mid', 'premium'] as const).map((t) => (
                  <Chip key={t} selected={draft.tierBias === t} onClick={() => setPref('tierBias', t)} ariaLabel={`المستوى ${TIER_LABEL[t]}`}>
                    {TIER_LABEL[t]}
                  </Chip>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground w-24 shrink-0">التنويع</span>
                {(['low', 'normal', 'high'] as const).map((v) => (
                  <Chip key={v} selected={draft.variety === v} onClick={() => setPref('variety', v)} ariaLabel={`التنويع ${VARIETY_LABEL[v]}`}>
                    {VARIETY_LABEL[v]}
                  </Chip>
                ))}
              </div>
            </div>

            {/* avoid tags */}
            <label className="block text-sm font-semibold mb-1.5">تجنّب</label>
            <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="علامات التجنب">
              {COMMON_TAGS.map((t) => (
                <Chip key={t.id} selected={draft.avoidTags.includes(t.id)} onClick={() => toggleAvoidTag(t.id)} ariaLabel={`تجنب ${t.label}`}>
                  {t.label}
                </Chip>
              ))}
            </div>

            <div className="flex gap-2">
              <GlassButton variant="primary" className="flex-1" onClick={saveDraft}>
                <Save size={16} strokeWidth={1.75} aria-hidden /> حفظ الظرف
              </GlassButton>
              <GlassButton onClick={() => setDraft(null)}>إلغاء</GlassButton>
            </div>
          </GlassCard>
        </section>
      ) : null}

      {/* existing envelopes */}
      <section aria-label="أظرفك">
        <SectionTitle>أظرفك الحالية</SectionTitle>
        {envelopes.length === 0 ? (
          <EmptyState
            icon={<Wallet size={24} strokeWidth={1.75} aria-hidden />}
            title="لا توجد أظرف بعد"
            subtitle="اختر مجموعة من الأعلى لإنشاء أول ظرف، أو استخدم أحد القوالب الجاهزة أدناه"
          />
        ) : (
          <div className="space-y-2">
            {envelopes.map((env) => (
              <GlassCard key={env.id} className="p-4">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center text-primary shrink-0">
                    <CategoryIcon category={GROUP_BY_ID.get(env.groups[0] ?? '')?.icon ?? 'boxes'} size={20} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{env.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{envRangeText(env)}</div>
                    <div className="flex items-center gap-1 mt-1" aria-label="مجموعات الظرف">
                      {env.groups.slice(0, 4).map((gid) => (
                        <CategoryIcon key={gid} category={GROUP_BY_ID.get(gid)?.icon ?? 'boxes'} size={13} />
                      ))}
                      {env.groups.length > 4 ? <span className="text-[10px] text-muted-foreground">+{formatNumberAr(env.groups.length - 4, arabicNumerals)}</span> : null}
                    </div>
                  </div>
                  <Pill tone={PRIORITY_TONE[env.priority]}>{PRIORITY_LABEL[env.priority]}</Pill>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <GlassButton
                    size="sm"
                    variant={previewId === env.id && !!previewResult ? 'primary' : 'ghost'}
                    onClick={() => previewEnv(env)}
                    disabled={previewLoading && previewId === env.id}
                  >
                    {previewLoading && previewId === env.id ? <Spinner className="w-4 h-4" /> : <Eye size={14} strokeWidth={1.75} aria-hidden />} عاين التشكيلة
                  </GlassButton>
                  <GlassButton size="sm" onClick={() => setDraft(draftFromEnv(env))}>
                    <Pencil size={14} strokeWidth={1.75} aria-hidden /> تعديل
                  </GlassButton>
                  <GlassButton size="sm" variant="danger" onClick={() => { store.removeEnvelope(env.id); if (previewId === env.id) clearPreview() }} aria-label={`حذف ${env.name}`}>
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden /> حذف
                  </GlassButton>
                </div>

                {previewId === env.id ? (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    {previewError ? (
                      <div className="text-sm text-destructive" role="alert">تعذر توليد المعاينة: {previewError}</div>
                    ) : previewLoading ? (
                      <div className="py-4 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                        <Spinner className="text-primary" /> نرتّب تشكيلة من الكتالوج…
                      </div>
                    ) : previewResult ? (
                      <div className="space-y-3" aria-live="polite">
                        <div className="flex flex-wrap gap-2">
                          <StatTile label="تكلفة التشكيلة" value={formatBHD(previewResult.spentFils, { arabicNumerals })} tone="accent" />
                          <StatTile label="عدد الأصناف" value={formatNumberAr(previewResult.items.length, arabicNumerals)} />
                          <StatTile label="التنويع" value={`${formatNumberAr(previewResult.variety, arabicNumerals)}٪`} />
                        </div>
                        {previewResult.explanation.length > 0 ? (
                          <div className="space-y-1">
                            {previewResult.explanation.map((line, i) => (
                              <div key={i} className="text-xs text-muted-foreground leading-relaxed">{line}</div>
                            ))}
                          </div>
                        ) : null}
                        <div>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between text-sm font-semibold py-1"
                            onClick={() => setExpandedItems(expandedItems === env.id ? null : env.id)}
                            aria-expanded={expandedItems === env.id}
                          >
                            <span>بنود التشكيلة ({formatNumberAr(previewResult.items.length, arabicNumerals)})</span>
                            {expandedItems === env.id ? <ChevronUp size={16} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={16} strokeWidth={1.75} aria-hidden />}
                          </button>
                          {expandedItems === env.id ? (
                            <div className="space-y-1.5 max-h-72 overflow-y-auto nice-scroll mt-1">
                              {previewResult.items.map((it) => (
                                <div key={it.key} className="glass-row rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
                                  <span className="flex-1 truncate">
                                    {it.productName} <span className="text-muted-foreground text-xs">{it.sizeText}</span>
                                  </span>
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">× {formatNumberAr(it.packQty, arabicNumerals)}</span>
                                  <span className="font-semibold tabular-nums shrink-0">{formatBHD(it.costFils, { arabicNumerals })}</span>
                                </div>
                              ))}
                              {previewResult.items.length === 0 ? <div className="text-xs text-muted-foreground p-2">لم تُخصص أي بنود — جرّب رفع الحد الأدنى أو أولوية أعلى.</div> : null}
                            </div>
                          ) : null}
                        </div>
                        {usingDefaults ? (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <Info size={12} strokeWidth={1.75} aria-hidden />
                            المعاينة تستخدم أسرة افتراضية (2 بالغين + 2 أطفال) وميزانية 200 د.ب حتى تكمل بياناتك.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      {/* quick-add templates */}
      <section aria-label="قوالب جاهزة">
        <SectionTitle>قوالب جاهزة — أضفها بلمسة</SectionTitle>
        <div className="flex gap-2 overflow-x-auto nice-scroll pb-1">
          {ENVELOPE_TEMPLATES.map((t) => (
            <button
              key={`${t.groupId}-${t.nameAr}`}
              type="button"
              onClick={() => addTemplate(t)}
              className="glass-thin min-h-11 px-4 rounded-xl text-sm font-semibold whitespace-nowrap hover:bg-secondary/60 transition-all flex items-center gap-2 shrink-0"
            >
              <CategoryIcon category={GROUP_BY_ID.get(t.groupId)?.icon ?? 'boxes'} size={15} />
              {t.nameAr} {formatBHD(t.min, { withUnit: false })} – {formatBHD(t.max, { withUnit: false })} د.ب
            </button>
          ))}
        </div>
      </section>

      {/* overlap warnings */}
      {overlaps.length > 0 ? (
        <section aria-label="تحذيرات التداخل">
          <div className="space-y-2">
            {overlaps.map((o, i) => (
              <div key={i} className="glass-thin rounded-xl p-3 border border-amber-500/40 flex gap-2 items-start">
                <TriangleAlert size={16} strokeWidth={1.75} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
                <div className="flex-1 text-sm">
                  <div className="font-semibold">ظرفان متداخلان: {o.a.name} و {o.b.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    يشتركان في «{o.shared.map((g) => g.nameAr).join('، ')}» — ادمجهما في ظرف واحد أو ضيّق نطاق أحدهما لتفادي ازدواج الشراء.
                  </div>
                  <GlassButton size="sm" className="mt-2" onClick={() => mergePair(o.a, o.b)}>
                    <Merge size={14} strokeWidth={1.75} aria-hidden /> ادمج في «{o.a.name}»
                  </GlassButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* save & regenerate */}
      <section className="pb-4">
        {canRegen ? (
          <GlassButton variant="primary" size="lg" className="w-full" onClick={saveAndRegen} disabled={regenLoading}>
            {regenLoading ? <Spinner className="w-5 h-5" /> : <Sparkles size={18} strokeWidth={1.75} aria-hidden />}
            حفظ وأعد توليد الخطة
          </GlassButton>
        ) : (
          <div className="glass-thin rounded-xl p-3 text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            <Info size={16} strokeWidth={1.75} aria-hidden />
            <span>{envelopes.length === 0 ? 'أضف ظرفاً واحداً على الأقل لإعادة توليد الخطة.' : 'أكمل بيانات الأسرة والميزانية أولاً لإعادة توليد الخطة.'}</span>
            <button type="button" className="text-primary underline text-xs ms-auto min-h-11" onClick={() => navigate({ name: 'start' })}>معالج البدء</button>
          </div>
        )}
        {regenError ? <div className="text-sm text-destructive mt-2" role="alert">تعذر إعادة التوليد: {regenError}</div> : null}
        <div className="text-[11px] text-muted-foreground mt-2 text-center">
          تُحلّ الأظرف ضمن الخطة مع الأساسيات — قد يُخفَّض الحد الأقصى تلقائياً عند ضيق الميزانية.
        </div>
      </section>
    </div>
  )
}
