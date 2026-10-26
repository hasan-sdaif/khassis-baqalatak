'use client'
/**
 * Advanced preferences view — the "hundreds of options" page (Task 15-a).
 *
 * Basic choices live in the wizard; this page exposes EVERYTHING:
 *   1. Monthly consumption override per need (auto / multiplier / absolute)
 *   2. 34 diet & health flags (grouped, with cross-flag logic)
 *   3. Quality tier per category (auto / econ / standard / premium)
 *   4. 5 recommendation-engine weights (live-normalized to 100%)
 *   5. 8 budget-allocation percentages (live-normalized to 100%)
 *   6. Lifestyle & shopping preferences (sliders, null = smart auto)
 *   7. Stores as price references (preferred/banned) + 365 brand ratings
 *   8. Summary with jump-links + the local-only honesty note
 *
 * Every edit writes IMMEDIATELY to the zustand store (auto-persisted);
 * no save button — a subtle "حُفظ" pill flashes on each change.
 * All colors come from theme variables, icons are lucide (strokeWidth 1.75,
 * aria-hidden), keyboard-accessible segmented controls (buttons with
 * aria-pressed + roving tabindex + arrow keys) and switches.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta, type CatalogMeta } from '@/lib/api-client'
import { formatBHD, formatPct, formatQty, toArabicDigits, unitLabelAr } from '@/lib/money'
import { GlassCard, GlassButton, Pill, SkeletonRows } from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import { cn } from '@/lib/utils'
import {
  ALLOC_GROUPS, DEFAULT_ALLOCATION, DEFAULT_WEIGHTS, NEEDS, bannedNeedsFor, countActiveOptions,
  defaultAdvanced, normalizeAllocation, normalizeArabic, normalizeWeights,
} from '@/lib/engine'
import type {
  AdvancedProfile, AllocGroupId, AllocationPercents, CategoryTier, DietFlags,
  LifestylePrefs, NeedOverride, NeedOverrideMode, StorePrefs, WeightPercents,
} from '@/lib/engine'
import type { LucideProps } from 'lucide-react'
import {
  Activity, Baby, Ban, Check, ChevronLeft, Heart, Info, Layers, ListChecks, Minus,
  Percent, PieChart, Plus, RotateCcw, Salad, Search, SlidersHorizontal, Store,
  TriangleAlert, Utensils, X,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// module-level catalog-meta cache (same pattern as the other views)

let metaCache: CatalogMeta | null = null

const EMPTY_CATS: CatalogMeta['categories'] = []
const EMPTY_STORES: CatalogMeta['stores'] = []
const EMPTY_BRANDS: CatalogMeta['brands'] = []

// ---------------------------------------------------------------------------
// small local flash animation (self-contained — no globals.css edits allowed)

const ADV_CSS = `
@keyframes adv-saved { 0% { opacity: 0; } 12% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
.adv-saved-flash { animation: adv-saved 1500ms ease forwards; }
@media (prefers-reduced-motion: reduce) { .adv-saved-flash { animation-duration: 700ms; } }
`

// ---------------------------------------------------------------------------
// static data & labels

interface NeedLite {
  id: string
  nameAr: string
  nameEn: string
  baseUnit: string
  clazz: string
  visibleInWizard: boolean
}

/** engine needs as offline fallback until/without the meta API */
const FALLBACK_NEEDS: NeedLite[] = NEEDS.map((n) => ({
  id: n.id, nameAr: n.nameAr, nameEn: n.nameEn, baseUnit: n.baseUnit, clazz: n.clazz,
  visibleInWizard: n.visibleInWizard ?? false,
}))

const CLASS_ORDER: Record<string, number> = { essential: 0, mandatory: 1, regular: 2, comfort: 3, treat: 4 }
const CLASS_LABEL: Record<string, string> = { mandatory: 'إلزامي', essential: 'أساسي', regular: 'اعتيادي', comfort: 'رفاهية', treat: 'كمالية' }
const CLASS_TONE: Record<string, 'default' | 'primary' | 'accent' | 'warn' | 'danger'> = {
  essential: 'primary', regular: 'default', comfort: 'accent', treat: 'warn', mandatory: 'danger',
}

/** sensible starting quantity when switching a need to absolute mode */
const ABS_DEFAULT: Record<string, number> = { g: 1000, ml: 1000, pcs: 30, rolls: 4, sheets: 500, bags: 30 }

const MODE_OPTS: { value: NeedOverrideMode; label: string }[] = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'mult', label: 'مضاعف' },
  { value: 'abs', label: 'كمية ثابتة' },
]

const TIER_OPTS: { value: CategoryTier; label: string }[] = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'econ', label: 'اقتصادي' },
  { value: 'standard', label: 'قياسي' },
  { value: 'premium', label: 'فاخر' },
]

const TRIPS_OPTS: { value: LifestylePrefs['tripsPreference']; label: string }[] = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'monthly', label: 'شهري' },
  { value: 'biweekly', label: 'نصف شهري' },
  { value: 'weekly', label: 'أسبوعي' },
  { value: 'twice-weekly', label: 'مرتين أسبوعياً' },
]

const PACK_OPTS: { value: LifestylePrefs['packSizeBias']; label: string }[] = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'small', label: 'عبوات صغيرة' },
  { value: 'medium', label: 'متوسطة' },
  { value: 'large', label: 'عائلية' },
]

const SPLIT_BASE: { value: number; label: string }[] = [
  { value: 1, label: 'متجر واحد' },
  { value: 2, label: 'متجران' },
  { value: 3, label: '3 متاجر' },
]

const ALLOC_ORDER: AllocGroupId[] = ['grains', 'protein', 'dairy', 'produce', 'fats', 'pantry', 'cleaning', 'treats']

const WEIGHT_DEFS: { key: keyof WeightPercents; label: string; desc: string; color: string }[] = [
  { key: 'target', label: 'الملاءمة السعرية', desc: 'قرب سعر المنتج من النقطة المثلى لصنفه', color: 'bg-primary' },
  { key: 'value', label: 'القيمة مقابل السعر', desc: 'أرخص سعر للوحدة بغضّ النظر عن الجودة', color: 'bg-accent' },
  { key: 'quality', label: 'الجودة وقلة الهدر', desc: 'ملاءمة العبوة للأسرة، هدر أقل، ثقة أعلى بالبيانات', color: 'bg-foreground/50' },
  { key: 'brand', label: 'الولاء للعلامات', desc: 'انحياز لعلاماتك المحبوبة وتفضيلاتك الشخصية', color: 'bg-foreground/30' },
  { key: 'local', label: 'التوفر والشهرة', desc: 'سهولة إيجاد المنتج وشهرة العلامة في السوق', color: 'bg-foreground/15' },
]

interface DietDef { k: keyof DietFlags; label: string; desc: string }
const DIET_GROUPS: { title: string; defs: DietDef[] }[] = [
  {
    title: 'الأنماط الغذائية',
    defs: [
      { k: 'vegetarian', label: 'نباتي', desc: 'بلا لحوم أو دواجن أو أسماك — البيض والألبان تبقى' },
      { k: 'vegan', label: 'نباتي صرف', desc: 'بلا لحوم ولا أسماك ولا ألبان ولا بيض ولا عسل' },
      { k: 'pescatarian', label: 'نباتي مع أسماك', desc: 'بلا لحوم أو دواجن، مع إبقاء الأسماك والبحريات' },
      { k: 'keto', label: 'كيتو', desc: 'دهون وبروتين أساساً: يستبعد الحبوب والخبز والسكريات والتمر' },
      { k: 'lowCarb', label: 'تقليل الكربوهيدرات', desc: 'حبوب وخبز ومكرونة وسكريات بمقدار أقل' },
    ],
  },
  {
    title: 'الحساسيات',
    defs: [
      { k: 'nutFree', label: 'خالٍ من المكسرات', desc: 'يستبعد المكسرات والفول السوداني ومنتجاتها' },
      { k: 'eggFree', label: 'خالٍ من البيض', desc: 'يستبعد البيض والمنتجات الحاوية عليه' },
      { k: 'soyFree', label: 'خالٍ من الصويا', desc: 'يستبعد الصويا وصلصاتها ومشتقاتها' },
      { k: 'shellfishFree', label: 'خالٍ من القشريات', desc: 'روبيان وجمبري وكراب ومحار — يستبعدها كلها' },
      { k: 'glutenFree', label: 'خالٍ من الغلوتين', desc: 'قمح وشعير ومكرونة وبرغل — لحساسية الغلوتين' },
      { k: 'lactoseFree', label: 'خالٍ من اللاكتوز', desc: 'حليب ومشتقاته بلا لاكتوز أو بدائل نباتية' },
    ],
  },
  {
    title: 'الصحة والتغذية',
    defs: [
      { k: 'noAddedSugar', label: 'بلا سكر مضاف', desc: 'يفضّل خيارات «بدون سكر» عند توفرها' },
      { k: 'lowSodium', label: 'صوديوم منخفض', desc: 'يفضّل الملصقات المخفّضة الملح' },
      { k: 'diabeticFriendly', label: 'مناسب للسكري', desc: 'سكريات أقل وانحياز لمنتجات الدايت' },
      { k: 'hypertensionFriendly', label: 'مناسب لضغط الدم', desc: 'ملح وصوديوم أقل في الاختيارات' },
      { k: 'highProtein', label: 'بروتين أعلى', desc: 'انحياز للتونة والصدور والبقوليات' },
      { k: 'highFiber', label: 'ألياف أعلى', desc: 'نخالة وشوفان وبقول وحبوب كاملة' },
      { k: 'lowFat', label: 'دسم أقل', desc: 'يفضّل قليل الدسم ويُبعد كامل الدسم' },
      { k: 'organicLean', label: 'ميل للعضوي', desc: 'درجة أعلى للمنتجات العضوية والطبيعية' },
      { k: 'halalStrict', label: 'حلال صارم', desc: 'يستبعد ما فيه شبهة كالجلاتين غير الموثّق' },
    ],
  },
  {
    title: 'ما تتجنّبه',
    defs: [
      { k: 'avoidFried', label: 'تجنّب المقلي', desc: 'مقرمشات وبطاطس مقلية وأشباهها' },
      { k: 'avoidProcessed', label: 'تجنّب المصنّع', desc: 'مرتديلا ونقانق ولانشون وبرجر جاهز' },
      { k: 'avoidCanned', label: 'تجنّب المعلبات', desc: 'فاصوليا وذرة وخضار معلبة' },
      { k: 'avoidFrozen', label: 'تجنّب المجمدات', desc: 'وجبات وأغذية مجمدة جاهزة' },
      { k: 'avoidInstant', label: 'تجنّب الفوري', desc: 'نودلز وإندومي وأطباق سريعة التحضير' },
      { k: 'avoidSugaryDrinks', label: 'تجنّب المشروبات السكرية', desc: 'عصائر محلاة ومشروبات سكرية بأنواعها' },
      { k: 'avoidEnergyDrinks', label: 'تجنّب مشروبات الطاقة', desc: 'تُستبعد من الخطة نهائياً' },
      { k: 'avoidCarbonated', label: 'تجنّب الغازيات', desc: 'مشروبات غازية بأنواعها' },
      { k: 'noCaffeine', label: 'بلا كافيين', desc: 'قهوة وشاي ومشروبات طاقة' },
      { k: 'noTobacco', label: 'بلا تبغ', desc: 'يستبعد السجائر والمعسل من بنود الخطة' },
      { k: 'noVape', label: 'بلا فيب', desc: 'يستبعد التدخين الإلكتروني' },
    ],
  },
  {
    title: 'التفضيلات',
    defs: [
      { k: 'preferLocal', label: 'تفضيل المحلي', desc: 'انحياز للعلامات البحرينية: عذاري، التنمية، أوال…' },
      { k: 'preferWholeGrain', label: 'تفضيل الحبوب الكاملة', desc: 'أرز أسمر ونخالة وخبز البر' },
      { k: 'preferFamilyPacks', label: 'تفضيل العبوات العائلية', desc: 'أحجام أكبر أوفر بسعر الوحدة' },
    ],
  },
]

const SECTIONS: { id: string; label: string; icon: ComponentType<LucideProps> }[] = [
  { id: 'sec-needs', label: 'الاستهلاك', icon: Utensils },
  { id: 'sec-diet', label: 'الغذاء والصحة', icon: Salad },
  { id: 'sec-tiers', label: 'جودة الفئات', icon: Layers },
  { id: 'sec-weights', label: 'الأوزان', icon: Percent },
  { id: 'sec-allocation', label: 'التوزيع', icon: PieChart },
  { id: 'sec-lifestyle', label: 'نمط الحياة', icon: Activity },
  { id: 'sec-stores', label: 'المتاجر والماركات', icon: Store },
  { id: 'sec-summary', label: 'الملخص', icon: ListChecks },
]

// Arabic plural forms helper
interface CountForms { zero: string; one: string; two: string; few: string; many: string }
function arCount(n: number, f: CountForms, dig: (v: string | number) => string): string {
  if (n === 0) return f.zero
  if (n === 1) return f.one
  if (n === 2) return f.two
  if (n <= 10) return `${dig(n)} ${f.few}`
  return `${dig(n)} ${f.many}`
}

const ACTIVE_FORMS: CountForms = { zero: 'لا خيارات مفعّلة', one: 'خيار واحد مفعّل', two: 'خياران مفعّلان', few: 'خيارات مفعّلة', many: 'خياراً مفعّلاً' }
const NEEDS_FORMS: CountForms = { zero: 'لا تعديلات مفعّلة', one: 'تعديل واحد مفعّل', two: 'تعديلان مفعّلان', few: 'تعديلات مفعّلة', many: 'تعديلاً مفعّلاً' }
const DIET_FORMS: CountForms = { zero: 'لا قيود مفعّلة', one: 'قيد واحد مفعّل', two: 'قيدان مفعّلان', few: 'قيود مفعّلة', many: 'قيداً مفعّلاً' }
const TIERS_FORMS: CountForms = { zero: 'لا فئات مخصصة', one: 'فئة واحدة مخصصة', two: 'فئتان مخصصتان', few: 'فئات مخصصة', many: 'فئة مخصصة' }
const LIFE_FORMS: CountForms = { zero: 'لا تعديلات', one: 'تعديل واحد', two: 'تعديلان', few: 'تعديلات مفعّلة', many: 'تعديلاً مفعّلاً' }
const STORES_FORMS: CountForms = { zero: 'لا متاجر محددة', one: 'متجر واحد محدد', two: 'متجران محددان', few: 'متاجر محددة', many: 'متجراً محدداً' }
const BRANDS_FORMS: CountForms = { zero: 'لا علامات محددة', one: 'علامة واحدة محددة', two: 'علامتان محددتان', few: 'علامات محددة', many: 'علامة محددة' }

function clampMult(v: number): number {
  return Math.min(3, Math.max(0, Math.round(v * 4) / 4))
}

function fmtMult(v: number): string {
  return `${Math.round(v * 100) / 100}×`
}

const STORE_STATE_AR: Record<string, string> = { neutral: 'محايد', preferred: 'مفضل', banned: 'مستبعد' }

// ---------------------------------------------------------------------------
// shared UI atoms

/** accessible segmented control (buttons with aria-pressed + roving tabindex + arrow keys) */
function Segmented<T extends string | number>({ options, value, onChange, ariaLabel, compact }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  compact?: boolean
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const found = options.findIndex((o) => o.value === value)
  const activeIdx = found >= 0 ? found : 0
  const move = (dir: 1 | -1) => {
    const next = (activeIdx + dir + options.length) % options.length
    onChange(options[next]!.value)
    refs.current[next]?.focus()
  }
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex flex-wrap glass-ultrathin rounded-xl p-0.5 gap-0.5">
      {options.map((o, i) => {
        const active = i === activeIdx
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            ref={(el) => { refs.current[i] = el }}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              // RTL-natural arrow mapping: visually-next is to the left
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
            }}
            className={cn(
              'font-semibold whitespace-nowrap transition-colors',
              compact ? 'min-h-11 px-2.5 text-xs rounded-lg' : 'min-h-11 px-3.5 text-sm rounded-[10px]',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary/70',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** 44px touch switch (role=switch) */
function SwitchBtn({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn('relative shrink-0 w-[52px] h-11 rounded-full transition-colors duration-200', checked ? 'bg-primary' : 'bg-secondary')}
    >
      <span className={cn('absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-card shadow-sm transition-all duration-200', checked ? 'start-[18px]' : 'start-[6px]')} />
    </button>
  )
}

/** slider row — value may be null (= engine auto) with a clear-back chip */
function SliderRow({ label, desc, min, max, step = 1, value, fallback, display, onChange, onAuto, extra, neutralAt }: {
  label: string
  desc?: string
  min: number
  max: number
  step?: number
  value: number | null
  fallback?: number
  display: (v: number) => string
  onChange: (v: number) => void
  onAuto?: () => void
  extra?: string
  neutralAt?: number
}) {
  const isAuto = value == null
  const shown = isAuto ? (fallback ?? min) : value
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-sm font-semibold flex-1 min-w-[130px] leading-snug">{label}</span>
        {neutralAt != null && value === neutralAt ? <Pill>محايد</Pill> : null}
        {extra ? <span className="text-[11px] text-muted-foreground tabular-nums">{extra}</span> : null}
        {isAuto ? (
          <Pill tone="primary">تلقائي</Pill>
        ) : (
          <span dir="ltr" className="text-sm font-bold tabular-nums text-primary min-w-10 text-end">{display(value)}</span>
        )}
        {onAuto && !isAuto ? (
          <button
            type="button"
            onClick={onAuto}
            className="min-h-9 px-2.5 rounded-full glass-thin text-[11px] font-semibold text-muted-foreground hover:bg-secondary/60 transition-colors"
          >
            تلقائي
          </button>
        ) : null}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={isAuto ? 'تلقائي' : display(shown)}
        className={cn('w-full h-11 cursor-pointer accent-[var(--primary)]', isAuto && 'opacity-60')}
      />
      {desc ? <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p> : null}
    </div>
  )
}

/** note card (info / warn) */
function NoteCard({ icon: Icon, tone = 'info', children }: { icon?: ComponentType<LucideProps>; tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl p-3 flex items-start gap-2.5 text-xs leading-relaxed', tone === 'warn' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-secondary/60 text-secondary-foreground')}>
      {Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 mt-0.5" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** section wrapper with anchor id + icon header */
function SectionCard({ id, icon: Icon, title, subtitle, badge, footer, children }: {
  id: string
  icon: ComponentType<LucideProps>
  title: string
  subtitle?: string
  badge?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-52 mb-4 print-avoid-break">
      <GlassCard>
        <header className="flex items-start gap-3 mb-3">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            <Icon size={19} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold tracking-tight leading-snug">{title}</h2>
            {subtitle ? <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{subtitle}</p> : null}
          </div>
          {badge ? <div className="shrink-0">{badge}</div> : null}
        </header>
        {children}
        {footer ? (
          <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-2 flex-wrap">{footer}</div>
        ) : null}
      </GlassCard>
    </section>
  )
}

// ---------------------------------------------------------------------------
// heavy list rows (memoized — dispatch props are stable)

const NeedRow = memo(function NeedRow({ need, mode, mult, abs, dig, onPatch }: {
  need: NeedLite
  mode: NeedOverrideMode
  mult: number
  abs: number
  dig: (v: string | number) => string
  onPatch: (id: string, o: NeedOverride | null) => void
}) {
  return (
    <div className={cn('p-3 transition-colors', mode !== 'auto' && 'bg-primary/[0.05]')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold flex-1 min-w-[130px] leading-snug">{need.nameAr}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">الوحدة: {unitLabelAr(need.baseUnit)}</span>
        <Pill tone={CLASS_TONE[need.clazz] ?? 'default'}>{CLASS_LABEL[need.clazz] ?? 'صنف'}</Pill>
        {mode !== 'auto' ? (
          <button
            type="button"
            onClick={() => onPatch(need.id, null)}
            aria-label={`رجوع للتلقائي: ${need.nameAr}`}
            title="رجوع للتلقائي"
            className="w-11 h-11 grid place-items-center rounded-full text-muted-foreground hover:text-primary hover:bg-secondary/60 transition-colors"
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <Segmented
          compact
          options={MODE_OPTS}
          value={mode}
          ariaLabel={`نمط الكمية: ${need.nameAr}`}
          onChange={(m) => {
            if (m === 'auto') onPatch(need.id, null)
            else if (m === 'mult') onPatch(need.id, { mode: 'mult', mult: clampMult(mult || 1) })
            else onPatch(need.id, { mode: 'abs', abs: abs > 0 ? abs : (ABS_DEFAULT[need.baseUnit] ?? 10) })
          }}
        />
        {mode === 'mult' ? (
          <MultStepper value={mult} dig={dig} onChange={(v) => onPatch(need.id, { mode: 'mult', mult: v })} />
        ) : null}
        {mode === 'abs' ? (
          <AbsInput value={abs} unit={need.baseUnit} dig={dig} onCommit={(v) => onPatch(need.id, { mode: 'abs', abs: v })} />
        ) : null}
        {mode === 'mult' && mult === 0 ? <span className="text-[11px] font-bold text-destructive">استبعاد كامل</span> : null}
      </div>
    </div>
  )
})

function MultStepper({ value, dig, onChange }: { value: number; dig: (v: string | number) => string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(clampMult(value - 0.25))}
          disabled={value <= 0}
          aria-label="إنقاص المضاعف ربع درجة"
          className="w-11 h-11 glass-thin rounded-xl grid place-items-center hover:bg-secondary/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Minus size={15} strokeWidth={1.75} aria-hidden />
        </button>
        <span dir="ltr" className="w-14 text-center text-sm font-bold tabular-nums">{dig(fmtMult(value))}</span>
        <button
          type="button"
          onClick={() => onChange(clampMult(value + 0.25))}
          disabled={value >= 3}
          aria-label="زيادة المضاعف ربع درجة"
          className="w-11 h-11 glass-thin rounded-xl grid place-items-center hover:bg-secondary/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={15} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="مضاعفات سريعة">
        {[0.5, 1, 1.5, 2].map((qv) => (
          <button
            key={qv}
            type="button"
            onClick={() => onChange(clampMult(qv))}
            aria-pressed={value === qv}
            className={cn(
              'min-h-9 px-2.5 rounded-full text-[11px] font-bold tabular-nums transition-colors',
              value === qv ? 'bg-primary text-primary-foreground' : 'glass-thin text-muted-foreground hover:bg-secondary/60',
            )}
          >
            {dig(qv)}×
          </button>
        ))}
      </div>
    </div>
  )
}

/** absolute quantity input in the need's base unit (local text state, live commits) */
function AbsInput({ value, unit, dig, onCommit }: {
  value: number
  unit: string
  dig: (v: string | number) => string
  onCommit: (v: number) => void
}) {
  // local draft text; the store value only changes through this input's commits
  // (any reset switches the row back to `auto`, remounting fresh)
  const [text, setText] = useState(() => (value > 0 ? String(value) : ''))
  const commit = (t: string) => {
    setText(t)
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) {
      onCommit(n)
    }
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative w-36">
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={text}
          onChange={(e) => commit(e.target.value)}
          placeholder="0"
          aria-label="الكمية الشهرية الثابتة بالوحدة الأساسية"
          className="glass-thin min-h-11 w-full rounded-xl ps-3 pe-10 text-sm tabular-nums text-right"
        />
        <span className="absolute end-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">{unitLabelAr(unit)}</span>
      </div>
      {value > 0 ? (
        <span className="text-[11px] text-muted-foreground tabular-nums">≈ {dig(formatQty(unit, value))}</span>
      ) : (
        <span className="text-[11px] font-bold text-destructive">استبعاد كامل</span>
      )}
    </div>
  )
}

const DietRow = memo(function DietRow({ label, desc, note, checked, k, onToggle }: {
  label: string
  desc: string
  note?: string
  checked: boolean
  k: keyof DietFlags
  onToggle: (k: keyof DietFlags, v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 min-h-[56px]">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-snug">{label}</div>
        <div className="text-[11px] text-muted-foreground leading-snug">{desc}</div>
        {note ? <div className="text-[11px] text-primary font-medium mt-0.5">{note}</div> : null}
      </div>
      <SwitchBtn checked={checked} ariaLabel={label} onChange={(v) => onToggle(k, v)} />
    </div>
  )
})

const TierCard = memo(function TierCard({ cat, tier, onSet }: {
  cat: CatalogMeta['categories'][number]
  tier: CategoryTier
  onSet: (id: string, t: CategoryTier) => void
}) {
  return (
    <div className={cn('glass-row rounded-xl p-3 flex flex-col gap-2', tier !== 'auto' && 'ring-1 ring-primary/40')}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
          <CategoryIcon category={cat.id} size={18} />
        </span>
        <span className="text-sm font-semibold truncate">{cat.nameAr}</span>
      </div>
      <Segmented compact options={TIER_OPTS} value={tier} ariaLabel={`مستوى جودة ${cat.nameAr}`} onChange={(t) => onSet(cat.id, t)} />
    </div>
  )
})

type StoreState = 'neutral' | 'preferred' | 'banned'

const StoreChip = memo(function StoreChip({ store, pref, banned, onSet }: {
  store: CatalogMeta['stores'][number]
  pref: boolean
  banned: boolean
  onSet: (id: string, state: StoreState) => void
}) {
  const state: StoreState = banned ? 'banned' : pref ? 'preferred' : 'neutral'
  return (
    <div className={cn(
      'glass-row rounded-xl p-1.5 flex items-center gap-1 transition-colors',
      state === 'preferred' && 'ring-1 ring-primary/50 bg-primary/10',
      state === 'banned' && 'ring-1 ring-destructive/40 opacity-75',
    )}>
      <button
        type="button"
        onClick={() => onSet(store.id, state === 'neutral' ? 'preferred' : state === 'preferred' ? 'banned' : 'neutral')}
        aria-label={`${store.nameAr} — ${STORE_STATE_AR[state]}، اضغط للتبديل`}
        className="flex-1 min-w-0 min-h-11 flex items-center px-2 text-start rounded-lg hover:bg-secondary/50 transition-colors"
      >
        <span className={cn('text-sm font-semibold truncate', state === 'banned' && 'line-through decoration-destructive/60')}>{store.nameAr}</span>
      </button>
      <button
        type="button"
        onClick={() => onSet(store.id, pref ? 'neutral' : 'preferred')}
        aria-pressed={pref}
        aria-label={`${store.nameAr}: مرجع مفضل`}
        title="مرجع مفضل"
        className={cn('w-11 h-11 grid place-items-center rounded-lg transition-colors shrink-0', pref ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:bg-secondary/60')}
      >
        <Heart size={16} strokeWidth={1.75} fill={pref ? 'currentColor' : 'none'} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onSet(store.id, banned ? 'neutral' : 'banned')}
        aria-pressed={banned}
        aria-label={`${store.nameAr}: مستبعد`}
        title="استبعاد"
        className={cn('w-11 h-11 grid place-items-center rounded-lg transition-colors shrink-0', banned ? 'text-destructive bg-destructive/15' : 'text-muted-foreground hover:bg-secondary/60')}
      >
        <Ban size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
})

type BrandState = 'favorite' | 'neutral' | 'blocked'

const BrandRow = memo(function BrandRow({ brand, count, fav, blocked, disabled, dig, onSet }: {
  brand: string
  count: number
  fav: boolean
  blocked: boolean
  disabled: boolean
  dig: (v: string | number) => string
  onSet: (brand: string, state: BrandState) => void
}) {
  return (
    <div className={cn('p-2.5 flex items-center gap-1.5 transition-colors', fav && 'bg-primary/[0.06]', blocked && 'bg-destructive/[0.05]')}>
      <span dir="auto" className={cn('flex-1 min-w-0 text-sm font-semibold truncate', blocked && 'line-through decoration-destructive/50')}>{brand}</span>
      <Pill className="tabular-nums shrink-0">{dig(count)} منتج</Pill>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSet(brand, fav ? 'neutral' : 'favorite')}
        aria-pressed={fav}
        aria-label={`${brand}: علامة محبوبة`}
        title="محبوبة"
        className={cn('w-11 h-11 grid place-items-center rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed', fav ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:bg-secondary/60')}
      >
        <Heart size={16} strokeWidth={1.75} fill={fav ? 'currentColor' : 'none'} aria-hidden />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSet(brand, blocked ? 'neutral' : 'blocked')}
        aria-pressed={blocked}
        aria-label={`${brand}: علامة محظورة`}
        title="محظورة"
        className={cn('w-11 h-11 grid place-items-center rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed', blocked ? 'text-destructive bg-destructive/15' : 'text-muted-foreground hover:bg-secondary/60')}
      >
        <Ban size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
})

// ---------------------------------------------------------------------------
// main view

export function AdvancedView() {
  // precise selectors — `advanced` once, derive the rest
  const advanced = useApp((s) => s.advanced)
  const setAdvanced = useApp((s) => s.setAdvanced)
  const resetAdvanced = useApp((s) => s.resetAdvanced)
  const household = useApp((s) => s.household)
  const setHousehold = useApp((s) => s.setHousehold)
  const budget = useApp((s) => s.budget)
  const hasPlan = useApp((s) => s.plan != null)
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)

  // ---- catalog meta (module-cached, offline-safe via engine fallbacks)
  const [meta, setMeta] = useState<CatalogMeta | null>(metaCache)
  const [metaState, setMetaState] = useState<'loading' | 'ok' | 'error'>(metaCache ? 'ok' : 'loading')
  const [retryKey, setRetryKey] = useState(0)
  useEffect(() => {
    if (metaCache) { setMeta(metaCache); setMetaState('ok'); return }
    let cancelled = false
    setMetaState('loading')
    fetchCatalogMeta()
      .then((m) => { metaCache = m; if (!cancelled) { setMeta(m); setMetaState('ok') } })
      .catch(() => { if (!cancelled) setMetaState('error') })
    return () => { cancelled = true }
  }, [retryKey])

  // ---- saved flash
  const [savedAt, setSavedAt] = useState(0)
  const flashSaved = useCallback(() => { setSavedAt(Date.now()) }, [])

  // ---- danger reset (two-step inline confirm)
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!confirmReset) return
    const t = setTimeout(() => setConfirmReset(false), 6000)
    return () => clearTimeout(t)
  }, [confirmReset])

  const dig = useCallback((v: string | number) => (arabicNumerals ? toArabicDigits(String(v)) : String(v)), [arabicNumerals])

  // ---- stable patch dispatchers (read fresh state via getState — no stale closures)
  const patch = useCallback((p: Partial<AdvancedProfile>) => {
    setAdvanced(p)
    flashSaved()
  }, [setAdvanced, flashSaved])

  const patchNeed = useCallback((id: string, o: NeedOverride | null) => {
    const overrides = { ...useApp.getState().advanced.needOverrides }
    const cur = overrides[id]
    if (o == null) {
      if (!cur) return
      delete overrides[id]
    } else {
      if (cur && cur.mode === o.mode && cur.mult === o.mult && cur.abs === o.abs) return
      overrides[id] = o
    }
    setAdvanced({ needOverrides: overrides })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setDietFlag = useCallback((k: keyof DietFlags, val: boolean) => {
    const diet: DietFlags = { ...useApp.getState().advanced.diet, [k]: val }
    if (val) {
      // radio-like trio + implications
      if (k === 'vegan') { diet.vegetarian = true; diet.pescatarian = false }
      else if (k === 'vegetarian') { diet.vegan = false; diet.pescatarian = false }
      else if (k === 'pescatarian') { diet.vegetarian = false; diet.vegan = false }
      if (k === 'keto') diet.lowCarb = true
    } else {
      // turning off an implied flag releases its implier (no orphaned vegan-without-vegetarian)
      if (k === 'vegetarian' && diet.vegan) diet.vegan = false
      if (k === 'lowCarb' && diet.keto) diet.keto = false
    }
    setAdvanced({ diet })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setTier = useCallback((id: string, t: CategoryTier) => {
    const tiers = { ...useApp.getState().advanced.categoryTiers }
    if (t === 'auto') {
      if (!tiers[id]) return
      delete tiers[id]
    } else {
      if (tiers[id] === t) return
      tiers[id] = t
    }
    setAdvanced({ categoryTiers: tiers })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setWeight = useCallback((k: keyof WeightPercents, v: number) => {
    const cur = useApp.getState().advanced.weights
    if (cur[k] === v) return
    setAdvanced({ weights: { ...cur, [k]: v } })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setAlloc = useCallback((k: Exclude<keyof AllocationPercents, 'enforce'>, v: number) => {
    const cur = useApp.getState().advanced.allocation
    if (cur[k] === v) return
    setAdvanced({ allocation: { ...cur, [k]: v } })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setAllocEnforce = useCallback((v: boolean) => {
    const cur = useApp.getState().advanced.allocation
    if (cur.enforce === v) return
    setAdvanced({ allocation: { ...cur, enforce: v } })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setLifestyle = useCallback(<K extends keyof LifestylePrefs>(k: K, v: LifestylePrefs[K]) => {
    const cur = useApp.getState().advanced.lifestyle
    if (cur[k] === v) return
    setAdvanced({ lifestyle: { ...cur, [k]: v } })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setStores = useCallback((p: Partial<StorePrefs>) => {
    const cur = useApp.getState().advanced.stores
    setAdvanced({ stores: { ...cur, ...p } })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setStoreState = useCallback((id: string, state: StoreState) => {
    const st = useApp.getState().advanced.stores
    const preferred = state === 'preferred'
      ? [...st.preferred.filter((x) => x !== id), id]
      : st.preferred.filter((x) => x !== id)
    const banned = state === 'banned'
      ? [...st.banned.filter((x) => x !== id), id]
      : st.banned.filter((x) => x !== id)
    setAdvanced({ stores: { ...st, preferred, banned } })
    flashSaved()
  }, [setAdvanced, flashSaved])

  const setBrandState = useCallback((brand: string, state: BrandState) => {
    const h = useApp.getState().household
    if (!h) return
    const fav = new Set(h.prefs.favoriteBrands)
    const block = new Set(h.prefs.blockedBrands)
    fav.delete(brand)
    block.delete(brand)
    if (state === 'favorite') fav.add(brand)
    if (state === 'blocked') block.add(brand)
    setHousehold({ ...h, prefs: { ...h.prefs, favoriteBrands: [...fav], blockedBrands: [...block] } })
    flashSaved()
  }, [setHousehold, flashSaved])

  // ---- derived counts / normalized views
  const activeCount = countActiveOptions(advanced)
  const needsActive = Object.values(advanced.needOverrides).filter((o) => o.mode !== 'auto').length
  const dietCount = Object.values(advanced.diet).filter(Boolean).length
  const tiersCount = Object.values(advanced.categoryTiers).filter((t) => t && t !== 'auto').length
  const normWeights = normalizeWeights(advanced.weights)
  const weightsCustom = JSON.stringify(normWeights) !== JSON.stringify(normalizeWeights(DEFAULT_WEIGHTS))
  const normAlloc = normalizeAllocation(advanced.allocation)
  const allocCustom = JSON.stringify(normAlloc) !== JSON.stringify(normalizeAllocation(DEFAULT_ALLOCATION))
  const L = advanced.lifestyle
  let lifestyleCount = 0
  if (L.homeCookingPct != null) lifestyleCount++
  if (L.sweetToothPct !== 100) lifestyleCount++
  if (L.snacksLevelPct !== 100) lifestyleCount++
  if (L.wasteTolerancePct != null) lifestyleCount++
  if (L.tripsPreference !== 'auto') lifestyleCount++
  if (L.reservePct != null) lifestyleCount++
  if (L.treatCapPct != null) lifestyleCount++
  if (L.varietyLevel !== 50) lifestyleCount++
  if (L.packSizeBias !== 'auto') lifestyleCount++
  if (L.customModeOffsetPct !== 0) lifestyleCount++
  const storesCount = advanced.stores.banned.length + advanced.stores.preferred.length
  const brandsFav = household?.prefs.favoriteBrands.length ?? 0
  const brandsBlocked = household?.prefs.blockedBrands.length ?? 0
  const bannedNeedsCount = bannedNeedsFor(advanced.diet).size

  // ---- section resets
  const resetNeeds = () => { if (needsActive === 0) return; patch({ needOverrides: {} }) }
  const resetDiet = () => { if (dietCount === 0) return; patch({ diet: { ...defaultAdvanced().diet } }) }
  const resetTiers = () => { if (tiersCount === 0) return; patch({ categoryTiers: {} }) }
  const resetWeights = () => { if (!weightsCustom) return; patch({ weights: { ...DEFAULT_WEIGHTS } }) }
  const resetAlloc = () => { if (!allocCustom && !advanced.allocation.enforce) return; patch({ allocation: { ...DEFAULT_ALLOCATION } }) }
  const resetLifestyle = () => { if (lifestyleCount === 0) return; patch({ lifestyle: defaultAdvanced().lifestyle }) }
  const resetStoresPrefs = () => {
    const st = advanced.stores
    if (storesCount === 0 && st.maxSplitStores === 3 && st.includeDeliveryFees) return
    patch({ stores: defaultAdvanced().stores })
  }
  const resetBrands = () => {
    if (!household || (brandsFav === 0 && brandsBlocked === 0)) return
    setHousehold({ ...household, prefs: { ...household.prefs, favoriteBrands: [], blockedBrands: [] } })
    flashSaved()
  }
  const doResetAll = () => {
    resetAdvanced()
    const h = useApp.getState().household
    if (h && (h.prefs.favoriteBrands.length > 0 || h.prefs.blockedBrands.length > 0)) {
      setHousehold({ ...h, prefs: { ...h.prefs, favoriteBrands: [], blockedBrands: [] } })
    }
    setConfirmReset(false)
    flashSaved()
  }

  // ---- needs search (300ms debounce)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(t)
  }, [qInput])

  const needs = useMemo(() => {
    const list: NeedLite[] = meta ? meta.needs : FALLBACK_NEEDS
    return [...list].sort((a, b) =>
      Number(b.visibleInWizard) - Number(a.visibleInWizard) ||
      (CLASS_ORDER[a.clazz] ?? 9) - (CLASS_ORDER[b.clazz] ?? 9) ||
      a.nameAr.localeCompare(b.nameAr, 'ar'))
  }, [meta])

  const filteredNeeds = useMemo(() => {
    if (!q) return needs
    const needle = normalizeArabic(q).toLowerCase()
    if (!needle) return needs
    return needs.filter((n) =>
      normalizeArabic(n.nameAr).includes(needle) ||
      n.nameEn.toLowerCase().includes(needle) ||
      n.id.includes(needle))
  }, [needs, q])

  // ---- brands search (live, slice + show-more)
  const [brandQInput, setBrandQInput] = useState('')
  const [brandLimit, setBrandLimit] = useState(60)
  const brands = meta?.brands ?? EMPTY_BRANDS
  const stores = useMemo(() => (meta ? meta.stores.filter((s) => s.active) : EMPTY_STORES), [meta])
  const tiers = useMemo(() => (meta ? [...meta.categories].sort((a, b) => b.priority - a.priority) : EMPTY_CATS), [meta])
  const filteredBrands = useMemo(() => {
    const needle = normalizeArabic(brandQInput).trim().toLowerCase()
    if (!needle) return brands
    return brands.filter((b) => normalizeArabic(b.brand).toLowerCase().includes(needle))
  }, [brands, brandQInput])
  const setBrandQuery = (v: string) => {
    setBrandQInput(v)
    setBrandLimit(60)
  }
  const shownBrands = filteredBrands.slice(0, brandLimit)

  const brandState = (b: string): BrandState => {
    if (!household) return 'neutral'
    if (household.prefs.blockedBrands.includes(b)) return 'blocked'
    if (household.prefs.favoriteBrands.includes(b)) return 'favorite'
    return 'neutral'
  }

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const chipCounts: Record<string, number | null> = {
    'sec-needs': needsActive,
    'sec-diet': dietCount,
    'sec-tiers': tiersCount,
    'sec-weights': weightsCustom ? 1 : 0,
    'sec-allocation': allocCustom ? 1 : 0,
    'sec-lifestyle': lifestyleCount,
    'sec-stores': storesCount,
    'sec-summary': null,
  }

  const metaError = metaState === 'error' && !meta ? (
    <div className="flex items-center gap-2 justify-center flex-wrap p-4 text-sm text-muted-foreground">
      <span>تعذّر تحميل بيانات الفهرس من الخادم</span>
      <GlassButton size="sm" className="min-h-11" onClick={() => setRetryKey((k) => k + 1)}>
        <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> إعادة المحاولة
      </GlassButton>
    </div>
  ) : null

  const budgetFils = budget?.fils

  return (
    <div className="pb-6">
      <style>{ADV_CSS}</style>

      {/* ============ sticky secondary header + section chip strip ============ */}
      <div className="sticky top-[76px] z-10 no-print mb-4">
        <div className="glass-chrome rounded-2xl p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary text-primary-foreground shrink-0">
              <SlidersHorizontal size={19} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex-1 min-w-[150px]">
              <h1 className="text-base font-extrabold leading-tight">الخيارات المتقدمة</h1>
              <p className="text-[11px] text-muted-foreground">الأساسيات في مساعد البدء — وهنا كل المفاتيح الدقيقة</p>
            </div>
            <div aria-live="polite" className="min-w-14 h-9 grid place-items-center">
              {savedAt > 0 ? (
                <span key={savedAt} className="adv-saved-flash inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2.5 py-1 text-[11px] font-bold">
                  <Check size={12} strokeWidth={1.75} aria-hidden /> حُفظ
                </span>
              ) : null}
            </div>
            <Pill tone="accent" className="tabular-nums whitespace-nowrap">{arCount(activeCount, ACTIVE_FORMS, dig)}</Pill>
            {confirmReset ? (
              <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="تأكيد إعادة تعيين كل الخيارات">
                <TriangleAlert size={15} strokeWidth={1.75} aria-hidden className="text-destructive" />
                <span className="text-xs font-bold text-destructive">تمسح كل الخيارات؟</span>
                <GlassButton variant="danger" size="sm" className="min-h-11" onClick={doResetAll}>تأكيد المسح</GlassButton>
                <GlassButton size="sm" className="min-h-11" onClick={() => setConfirmReset(false)}>إلغاء</GlassButton>
              </div>
            ) : (
              <GlassButton variant="danger" size="sm" className="min-h-11" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> إعادة تعيين الكل
              </GlassButton>
            )}
            <GlassButton variant="primary" size="sm" className="min-h-11" onClick={() => navigate(hasPlan ? { name: 'plan' } : { name: 'start' })}>
              <Check size={15} strokeWidth={1.75} aria-hidden /> تم — ولّد الخطة
            </GlassButton>
          </div>
          <nav aria-label="أقسام الخيارات المتقدمة" className="mt-2.5 overflow-x-auto nice-scroll flex gap-1.5 pt-0.5">
            {SECTIONS.map((s) => {
              const c = chipCounts[s.id]
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jump(s.id)}
                  className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl glass-ultrathin whitespace-nowrap text-xs font-semibold text-foreground/80 hover:bg-secondary/60 transition-colors shrink-0"
                >
                  <s.icon size={14} strokeWidth={1.75} aria-hidden className="text-primary" />
                  {s.label}
                  {c != null && c > 0 ? (
                    <span className="min-w-5 h-5 px-1 grid place-items-center rounded-full bg-accent/20 text-accent text-[10px] font-bold tabular-nums">{dig(c)}</span>
                  ) : null}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-4 px-1">
        هذه الصفحة تفتح كل مفاصل المحرك: تعديل استهلاك كل صنف، قيود غذائية وصحية، جودة كل فئة، أوزان التوصية،
        توزيع الميزانية، نمط الحياة، المتاجر والماركات. كل تعديل يُحفظ فوراً ويُطبَّق عند توليد خطتك القادمة.
      </p>

      {/* ============ 1. needs overrides ============ */}
      <SectionCard
        id="sec-needs"
        icon={Utensils}
        title="الاستهلاك الشهري (تعديل كل صنف)"
        subtitle={`لكل صنف: تلقائي (يُحسب حسب أفراد أسرتك)، أو مضاعف ${dig(0)}×–${dig(3)}×، أو كمية ثابتة بالوحدة الأساسية للشهر كله. المضاعف ${dig(0)}× يستبعد الصنف.`}
        badge={<Pill tone={needsActive > 0 ? 'accent' : 'default'} className="tabular-nums whitespace-nowrap">{arCount(needsActive, NEEDS_FORMS, dig)}</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground tabular-nums">
              {arCount(needsActive, NEEDS_FORMS, dig)}
              {bannedNeedsCount > 0 ? ` · ${dig(bannedNeedsCount)} صنفاً مستبعَداً بالقيود الغذائية` : ''}
            </p>
            <GlassButton size="sm" className="min-h-11" onClick={resetNeeds} aria-disabled={needsActive === 0}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> تصفير تعديلات القسم
            </GlassButton>
          </>
        }
      >
        <div className="mb-2">
          <div className="relative">
            <Search size={16} strokeWidth={1.75} aria-hidden className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              dir="auto"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="ابحث عن صنف… حليب، أرز، حفاضات"
              aria-label="البحث في الأصناف"
              className="glass-thin w-full min-h-11 rounded-xl ps-10 pe-11 py-2.5 text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {qInput !== '' ? (
              <button
                type="button"
                onClick={() => setQInput('')}
                aria-label="مسح نص البحث"
                className="absolute end-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground"
              >
                <X size={15} strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 px-1 tabular-nums" aria-live="polite">
            {q
              ? (filteredNeeds.length > 0 ? `يعرض ${dig(filteredNeeds.length)} من ${dig(needs.length)} صنفاً` : 'لا نتائج مطابقة للبحث')
              : `${dig(needs.length)} صنفاً قابلاً للتعديل`}
          </p>
        </div>
        <div className="max-h-[520px] overflow-y-auto nice-scroll rounded-xl border border-border/60 divide-y divide-border/50">
          {filteredNeeds.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">لا نتائج مطابقة — جرّب كلمة أخرى</div>
          ) : filteredNeeds.map((n) => {
            const o = advanced.needOverrides[n.id]
            return (
              <NeedRow
                key={n.id}
                need={n}
                mode={o?.mode ?? 'auto'}
                mult={o?.mult ?? 1}
                abs={o?.abs ?? 0}
                dig={dig}
                onPatch={patchNeed}
              />
            )
          })}
        </div>
      </SectionCard>

      {/* ============ 2. diet & health ============ */}
      <SectionCard
        id="sec-diet"
        icon={Salad}
        title="النمط الغذائي والصحة"
        subtitle={`${dig(34)} قيداً غذائياً وصحياً — تُطبَّق على الطلب والفلترة والتسجيل معاً. الأنماط الثلاثة الأولى (نباتي/صرف/مع أسماك) تعمل كأزرار راديو، واحتياجات الرضّع محمية دائماً.`}
        badge={<Pill tone={dietCount > 0 ? 'accent' : 'default'} className="tabular-nums whitespace-nowrap">{arCount(dietCount, DIET_FORMS, dig)}</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground tabular-nums">
              {arCount(dietCount, DIET_FORMS, dig)}
              {bannedNeedsCount > 0 ? ` · يستبعد ${dig(bannedNeedsCount)} صنفاً من الطلب` : ''}
            </p>
            <GlassButton size="sm" className="min-h-11" onClick={resetDiet} aria-disabled={dietCount === 0}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> تصفير قيود القسم
            </GlassButton>
          </>
        }
      >
        {DIET_GROUPS.map((g) => (
          <div key={g.title} className="mb-3 last:mb-0">
            <h3 className="text-xs font-bold text-primary mb-1 px-0.5">{g.title}</h3>
            <div className="divide-y divide-border/50 rounded-xl border border-border/50">
              {g.defs.map((d) => {
                const checked = advanced.diet[d.k]
                const note =
                  d.k === 'vegetarian' && advanced.diet.vegan ? 'مفعّل تلقائياً — النباتي الصرف يشمله'
                  : d.k === 'lowCarb' && advanced.diet.keto ? 'مفعّل تلقائياً مع الكيتو'
                  : d.k === 'vegan' && checked ? 'يشمل النباتي'
                  : undefined
                return (
                  <DietRow key={d.k} label={d.label} desc={d.desc} note={note} checked={checked} k={d.k} onToggle={setDietFlag} />
                )
              })}
            </div>
          </div>
        ))}
        <NoteCard icon={Baby}>
          احتياجات الرضّع (الحليب والحفاضات) محمية دائماً ولا تستبعدها أي قيود — راجع طبيب الأطفال.
        </NoteCard>
      </SectionCard>

      {/* ============ 3. category tiers ============ */}
      <SectionCard
        id="sec-tiers"
        icon={Layers}
        title="مستوى جودة كل فئة"
        subtitle={`«اقتصادي» ينزل مستوى السعر المستهدف للفئة ${dig('-18')}٪، «فاخر» يرفعه ${dig('+15')}٪ — والوضع التلقائي يتبع نمط الخطة العام.`}
        badge={<Pill tone={tiersCount > 0 ? 'accent' : 'default'} className="tabular-nums whitespace-nowrap">{arCount(tiersCount, TIERS_FORMS, dig)}</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground tabular-nums">
              {arCount(tiersCount, TIERS_FORMS, dig)}{tiers.length > 0 ? ` من ${dig(tiers.length)} فئة` : ''}
            </p>
            <GlassButton size="sm" className="min-h-11" onClick={resetTiers} aria-disabled={tiersCount === 0}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> تصفير مستويات القسم
            </GlassButton>
          </>
        }
      >
        {meta ? (
          <div className="grid grid-cols-1 min-[700px]:grid-cols-2 min-[1180px]:grid-cols-3 gap-2.5">
            {tiers.map((c) => (
              <TierCard key={c.id} cat={c} tier={advanced.categoryTiers[c.id] ?? 'auto'} onSet={setTier} />
            ))}
          </div>
        ) : metaError ?? <SkeletonRows rows={6} />}
      </SectionCard>

      {/* ============ 4. engine weights ============ */}
      <SectionCard
        id="sec-weights"
        icon={Percent}
        title="أوزان التوصية (النسب المئوية)"
        subtitle={`خمسة أوزان تحكم معادلة اختيار المنتجات — قيمك الخام تُطبَّع تلقائياً إلى ${dig(100)}٪، والنسب المعروضة بجانب كل وزن هي فاعليته بعد التطبيع.`}
        badge={weightsCustom ? <Pill tone="accent">مخصّصة</Pill> : <Pill>افتراضية</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground">المجموع يُطبَّع إلى {dig(100)}٪ تلقائياً</p>
            <GlassButton size="sm" className="min-h-11" onClick={resetWeights} aria-disabled={!weightsCustom}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> الأوزان الافتراضية
            </GlassButton>
          </>
        }
      >
        <div className="mb-3">
          <div
            className="h-4 rounded-full overflow-hidden flex bg-secondary gap-px"
            role="img"
            aria-label={`توزيع الأوزان بعد التطبيع: ${WEIGHT_DEFS.map((w) => `${w.label} ${formatPct(normWeights[w.key], arabicNumerals)}`).join('، ')}`}
          >
            {WEIGHT_DEFS.map((w) => (
              <div
                key={w.key}
                className={cn('h-full transition-all duration-300', w.color)}
                style={{ width: `${Math.max(0, normWeights[w.key] - 0.15)}%` }}
                title={`${w.label}: ${formatPct(normWeights[w.key], arabicNumerals)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {WEIGHT_DEFS.map((w) => (
              <span key={w.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', w.color)} />
                {w.label}
                <strong className="text-foreground tabular-nums font-bold">{formatPct(normWeights[w.key], arabicNumerals)}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="divide-y divide-border/50">
          {WEIGHT_DEFS.map((w) => (
            <SliderRow
              key={w.key}
              label={w.label}
              desc={w.desc}
              min={0}
              max={100}
              step={1}
              value={advanced.weights[w.key]}
              display={(v) => dig(v)}
              extra={`الفاعلية: ${formatPct(normWeights[w.key], arabicNumerals)}`}
              onChange={(v) => setWeight(w.key, v)}
            />
          ))}
        </div>
      </SectionCard>

      {/* ============ 5. budget allocation ============ */}
      <SectionCard
        id="sec-allocation"
        icon={PieChart}
        title="توزيع الميزانية بالنسب المئوية"
        subtitle={`ثماني مجموعات — حرّك النسب كما تحب؛ المجموع يُطبَّع دائماً إلى ${dig(100)}٪ والنسب الفاعلية تظهر مباشرة.`}
        badge={<Pill tone="accent">المجموع المُطبَّع = {dig(100)}٪</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground leading-snug">النسب الافتراضية مستلّة من «تشريح سلة الـ١٠٠ دينار» في خطط الإلهام البحرينية</p>
            <GlassButton size="sm" className="min-h-11" onClick={resetAlloc} aria-disabled={!allocCustom && !advanced.allocation.enforce}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> التوزيع الافتراضي
            </GlassButton>
          </>
        }
      >
        <div className="divide-y divide-border/50">
          {ALLOC_ORDER.map((g) => {
            const norm = normAlloc[g]
            const filsHint = budgetFils != null ? ` · ≈ ${formatBHD(Math.round((budgetFils * norm) / 100), { arabicNumerals })}` : ''
            return (
              <div key={g} className="py-2.5">
                <SliderRow
                  label={ALLOC_GROUPS[g].nameAr}
                  min={0}
                  max={60}
                  step={1}
                  value={advanced.allocation[g]}
                  display={(v) => `${dig(v)}٪`}
                  extra={`المُطبَّع: ${formatPct(norm, arabicNumerals)}${filsHint}`}
                  onChange={(v) => setAlloc(g, v)}
                />
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-0.5" aria-hidden>
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${norm}%` }} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-2 pt-3 border-t border-border/60 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">افرض هذا التوزيع على الخطة</div>
            <p className="text-[11px] text-muted-foreground leading-snug">عند التفعيل يدفع المحرك الإنفاق نحو نسبك المستهدفة (قيد مرن) — الافتراضي: إرشادي فقط</p>
          </div>
          <SwitchBtn checked={advanced.allocation.enforce} ariaLabel="افرض توزيع الميزانية على الخطة" onChange={setAllocEnforce} />
        </div>
      </SectionCard>

      {/* ============ 6. lifestyle ============ */}
      <SectionCard
        id="sec-lifestyle"
        icon={Activity}
        title="نمط الحياة والتسوق"
        subtitle="عادات منزلك وإيقاع تسوقك — كل شيء اختياري، والتلقائي ذكي (يُشتق من أفراد أسرتك وعاداتهم)."
        badge={<Pill tone={lifestyleCount > 0 ? 'accent' : 'default'} className="tabular-nums whitespace-nowrap">{arCount(lifestyleCount, LIFE_FORMS, dig)}</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground tabular-nums">{arCount(lifestyleCount, LIFE_FORMS, dig)}</p>
            <GlassButton size="sm" className="min-h-11" onClick={resetLifestyle} aria-disabled={lifestyleCount === 0}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> تصفير نمط الحياة
            </GlassButton>
          </>
        }
      >
        <div className="divide-y divide-border/50">
          <SliderRow
            label="الوجبات المطبوخة منزلاً"
            desc="نسبة الوجبات المطبوخة في البيت — أعلى يعني طلباً أكبر ومطاعم أقل"
            min={0} max={100} step={5}
            value={L.homeCookingPct}
            fallback={60}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('homeCookingPct', v)}
            onAuto={() => setLifestyle('homeCookingPct', null)}
          />
          <SliderRow
            label="شهوة الحلو"
            desc={`مقياس الحلويات — ${dig(100)} محايد، أعلى يعني حلويات أكثر`}
            min={0} max={200} step={5}
            value={L.sweetToothPct}
            neutralAt={100}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('sweetToothPct', v)}
          />
          <SliderRow
            label="مستوى السناكس"
            desc={`مقياس المقرمشات والسناكس — ${dig(100)} محايد`}
            min={0} max={200} step={5}
            value={L.snacksLevelPct}
            neutralAt={100}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('snacksLevelPct', v)}
          />
          <SliderRow
            label="سقف الهدر المقبول"
            desc="أعلى يعني قبول عبوات أكبر مع هدر محتمل أكثر — تلقائي يعني توازناً محسوباً"
            min={0} max={30} step={1}
            value={L.wasteTolerancePct}
            fallback={10}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('wasteTolerancePct', v)}
            onAuto={() => setLifestyle('wasteTolerancePct', null)}
          />
          <div className="py-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <div className="text-sm font-semibold">إيقاع رحلات التسوق</div>
              <p className="text-[11px] text-muted-foreground leading-snug">كم مرة تتسوق شهرياً — يؤثر على جدول الرحلات والأصناف الأسبوعية</p>
            </div>
            <Segmented options={TRIPS_OPTS} value={L.tripsPreference} ariaLabel="إيقاع رحلات التسوق" onChange={(v) => setLifestyle('tripsPreference', v)} />
          </div>
          <SliderRow
            label="احتياطي المرونة"
            desc={`نسبة تُحجز من الميزانية للمفاجآت — الافتراضي ${dig(5)}٪`}
            min={0} max={15} step={1}
            value={L.reservePct}
            fallback={5}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('reservePct', v)}
            onAuto={() => setLifestyle('reservePct', null)}
          />
          <SliderRow
            label="سقف بند الترفيه"
            desc={`حد أعلى لإنفاق الكماليات والتحليات — الافتراضي ${dig(8)}٪`}
            min={0} max={20} step={1}
            value={L.treatCapPct}
            fallback={8}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('treatCapPct', v)}
            onAuto={() => setLifestyle('treatCapPct', null)}
          />
          <SliderRow
            label="التنويع بين العلامات"
            desc={`ضغط التنويع عبر العلامات والمنتجات — ${dig(50)} محايد`}
            min={0} max={100} step={5}
            value={L.varietyLevel}
            neutralAt={50}
            display={(v) => `${dig(v)}٪`}
            onChange={(v) => setLifestyle('varietyLevel', v)}
          />
          <div className="py-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <div className="text-sm font-semibold">ميل حجم العبوات</div>
              <p className="text-[11px] text-muted-foreground leading-snug">عبوات صغيرة (حفاظة أسهل) أم عائلية (أوفر بالوحدة)</p>
            </div>
            <Segmented compact options={PACK_OPTS} value={L.packSizeBias} ariaLabel="ميل حجم العبوات" onChange={(v) => setLifestyle('packSizeBias', v)} />
          </div>
          <SliderRow
            label="إزاحة الوضع المخصص"
            desc="تُطبَّق فقط عندما يكون وضع الخطة «مخصص» — تُزيح مستوى السعر المستهدف كله"
            min={-35} max={25} step={1}
            value={L.customModeOffsetPct}
            neutralAt={0}
            display={(v) => `${v > 0 ? `+${dig(v)}` : dig(v)}٪`}
            onChange={(v) => setLifestyle('customModeOffsetPct', v)}
          />
        </div>
      </SectionCard>

      {/* ============ 7. stores + brands ============ */}
      <SectionCard
        id="sec-stores"
        icon={Store}
        title="المتاجر (مراجع الأسعار)"
        subtitle={`${dig(stores.length)} متجراً بحرينياً في قاعدة الأسعار — فعّل ما تشاء كمرجع مفضل أو استبعد ما لا تتعامل معه.`}
        badge={<Pill tone={storesCount > 0 ? 'accent' : 'default'} className="tabular-nums whitespace-nowrap">{arCount(storesCount, STORES_FORMS, dig)}</Pill>}
        footer={
          <>
            <p className="text-xs text-muted-foreground tabular-nums">{arCount(storesCount, STORES_FORMS, dig)}</p>
            <GlassButton size="sm" className="min-h-11" onClick={resetStoresPrefs} aria-disabled={storesCount === 0 && advanced.stores.maxSplitStores === 3 && advanced.stores.includeDeliveryFees}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> تصفير تفضيلات المتاجر
            </GlassButton>
          </>
        }
      >
        <NoteCard icon={Info}>
          المتاجر هنا مراجع أسعار فقط — الخطة تُحسب بالسعر الوسيط افتراضياً. فعّل ما تشاء كمرجع مفضل أو استبعد ما لا تتعامل معه.
        </NoteCard>

        <div className="mt-3">
          {meta ? (
            <div className="grid grid-cols-1 min-[700px]:grid-cols-2 min-[1180px]:grid-cols-3 gap-2">
              {stores.map((s) => (
                <StoreChip
                  key={s.id}
                  store={s}
                  pref={advanced.stores.preferred.includes(s.id)}
                  banned={advanced.stores.banned.includes(s.id)}
                  onSet={setStoreState}
                />
              ))}
            </div>
          ) : metaError ?? <SkeletonRows rows={4} />}
        </div>

        <div className="mt-3 pt-3 border-t border-border/60 divide-y divide-border/50">
          <div className="py-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <div className="text-sm font-semibold">حد تقسيم المشتريات</div>
              <p className="text-[11px] text-muted-foreground leading-snug">عدد المتاجر كحد أقصى عند تفعيل تقسيم المشتريات بين متاجرين</p>
            </div>
            <Segmented options={SPLIT_BASE.map((o) => (o.value === 3 ? { ...o, label: `${dig(3)} متاجر` } : o))} value={advanced.stores.maxSplitStores} ariaLabel="حد تقسيم المشتريات" onChange={(v) => setStores({ maxSplitStores: v })} />
          </div>
          <div className="py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">احتسب رسوم التوصيل عند مقارنة المتاجر</div>
              <p className="text-[11px] text-muted-foreground leading-snug">تُضاف رسوم التوصيل للفاتورة عند مقارنة أسعار المتاجر</p>
            </div>
            <SwitchBtn checked={advanced.stores.includeDeliveryFees} ariaLabel="احتسب رسوم التوصيل عند مقارنة المتاجر" onChange={(v) => setStores({ includeDeliveryFees: v })} />
          </div>
        </div>

        {/* ---- brand preferences (household-level) ---- */}
        <h3 className="text-sm font-bold mt-5 mb-2 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-accent/15 text-accent grid place-items-center shrink-0">
            <Heart size={14} strokeWidth={1.75} aria-hidden />
          </span>
          تفضيلات الماركات
          {brands.length > 0 ? <Pill className="tabular-nums">{dig(brands.length)} علامة</Pill> : null}
        </h3>
        {!household ? (
          <NoteCard tone="warn" icon={Info}>
            أنشئ خطتك أولاً لتفعيل تفضيلات الماركات —{' '}
            <button type="button" onClick={() => navigate({ name: 'start' })} className="underline font-bold text-foreground">
              ابدأ من مساعد البدء
            </button>
            . دونها تبقى العلامات متاحة للعرض فقط.
          </NoteCard>
        ) : null}
        <div className="mb-2">
          <div className="relative">
            <Search size={16} strokeWidth={1.75} aria-hidden className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              dir="auto"
              value={brandQInput}
              onChange={(e) => setBrandQuery(e.target.value)}
              placeholder="ابحث عن ماركة… المراعي، نستله، عذاري"
              aria-label="البحث في الماركات"
              className="glass-thin w-full min-h-11 rounded-xl ps-10 pe-11 py-2.5 text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {brandQInput !== '' ? (
              <button
                type="button"
                onClick={() => setBrandQuery('')}
                aria-label="مسح بحث الماركات"
                className="absolute end-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground"
              >
                <X size={15} strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 px-1 tabular-nums" aria-live="polite">
            {brandQInput.trim()
              ? (filteredBrands.length > 0 ? `يعرض ${dig(shownBrands.length)} من ${dig(filteredBrands.length)} نتيجة` : 'لا نتائج مطابقة')
              : `أشهر ${dig(brands.length)} علامة في الكتالوج`}
          </p>
        </div>
        {meta ? (
          <>
            <div className="max-h-[460px] overflow-y-auto nice-scroll rounded-xl border border-border/60 divide-y divide-border/50">
              {shownBrands.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">لا نتائج مطابقة — جرّب اسماً آخر</div>
              ) : shownBrands.map((b) => {
                const st = brandState(b.brand)
                return (
                  <BrandRow
                    key={b.brand}
                    brand={b.brand}
                    count={b.count}
                    fav={st === 'favorite'}
                    blocked={st === 'blocked'}
                    disabled={!household}
                    dig={dig}
                    onSet={setBrandState}
                  />
                )
              })}
            </div>
            {filteredBrands.length > shownBrands.length ? (
              <GlassButton className="mt-2 w-full min-h-11" onClick={() => setBrandLimit((n) => n + 60)}>
                <Plus size={15} strokeWidth={1.75} aria-hidden />
                عرض المزيد ({dig(filteredBrands.length - shownBrands.length)} متبقٍّ)
              </GlassButton>
            ) : null}
            <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground tabular-nums">
                {arCount(brandsFav + brandsBlocked, BRANDS_FORMS, dig)}
                {brandsFav > 0 || brandsBlocked > 0 ? ` (${dig(brandsFav)} محبوبة · ${dig(brandsBlocked)} محظورة)` : ''}
              </p>
              <GlassButton size="sm" className="min-h-11" onClick={resetBrands} aria-disabled={brandsFav === 0 && brandsBlocked === 0}>
                <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> تصفير تفضيلات الماركات
              </GlassButton>
            </div>
          </>
        ) : metaError ?? <SkeletonRows rows={4} />}
      </SectionCard>

      {/* ============ 8. summary ============ */}
      <SectionCard
        id="sec-summary"
        icon={ListChecks}
        title="ملخص ومساعدة"
        subtitle="نظرة سريعة على كل ما فعّلته في هذه الصفحة — اضغط أي سطر للقفز إلى قسمه."
      >
        <div className="space-y-1.5">
          <SummaryRow icon={Utensils} label="تعديلات الاستهلاك" value={<Pill tone={needsActive > 0 ? 'accent' : 'default'} className="tabular-nums">{arCount(needsActive, NEEDS_FORMS, dig)}</Pill>} onClick={() => jump('sec-needs')} />
          <SummaryRow icon={Salad} label="قيود النمط الغذائي" value={<Pill tone={dietCount > 0 ? 'accent' : 'default'} className="tabular-nums">{arCount(dietCount, DIET_FORMS, dig)}</Pill>} onClick={() => jump('sec-diet')} />
          <SummaryRow icon={Layers} label="مستويات جودة الفئات" value={<Pill tone={tiersCount > 0 ? 'accent' : 'default'} className="tabular-nums">{arCount(tiersCount, TIERS_FORMS, dig)}</Pill>} onClick={() => jump('sec-tiers')} />
          <SummaryRow icon={Percent} label="أوزان التوصية" value={weightsCustom ? <Pill tone="accent">مخصّصة</Pill> : <Pill>افتراضية</Pill>} onClick={() => jump('sec-weights')} />
          <SummaryRow
            icon={PieChart}
            label="توزيع الميزانية"
            value={allocCustom || advanced.allocation.enforce ? <Pill tone="accent">مخصّص{advanced.allocation.enforce ? ' + مفروض' : ''}</Pill> : <Pill>افتراضي</Pill>}
            onClick={() => jump('sec-allocation')}
          />
          <SummaryRow icon={Activity} label="نمط الحياة" value={<Pill tone={lifestyleCount > 0 ? 'accent' : 'default'} className="tabular-nums">{arCount(lifestyleCount, LIFE_FORMS, dig)}</Pill>} onClick={() => jump('sec-lifestyle')} />
          <SummaryRow icon={Store} label="المتاجر والمركات" value={<Pill tone={storesCount > 0 ? 'accent' : 'default'} className="tabular-nums">{arCount(storesCount, STORES_FORMS, dig)}</Pill>} onClick={() => jump('sec-stores')} />
          <SummaryRow icon={Heart} label="تفضيلات الماركات" value={<Pill tone={brandsFav + brandsBlocked > 0 ? 'accent' : 'default'} className="tabular-nums">{arCount(brandsFav + brandsBlocked, BRANDS_FORMS, dig)}</Pill>} onClick={() => jump('sec-stores')} />
        </div>
        <NoteCard icon={Info}>
          <strong>كل شيء يُحفظ محلياً على جهازك فوراً</strong> — لا يغادر بياناتك إلا عند مشاركة خطة.
        </NoteCard>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          هذه الخيارات تُدمج في كل مراحل المحرك التسعة (الطلب ← الفلترة ← التسجيل ← التوزيع ← الصقل) ولا تتجاوزه أبداً —
          عدّل ما تشاء ثم ولّد خطتك من زر «تم» في الأعلى، وستجدها مطبَّقة في نتائج الخطة القادمة وتقاريرها.
        </p>
      </SectionCard>
    </div>
  )
}

function SummaryRow({ icon: Icon, label, value, onClick }: {
  icon: ComponentType<LucideProps>
  label: string
  value: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full glass-row rounded-xl p-3 flex items-center gap-2 hover:bg-secondary/50 transition-colors text-start min-h-11"
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className="text-muted-foreground shrink-0" />
      <span className="flex-1 text-sm font-semibold min-w-0 truncate">{label}</span>
      <span className="shrink-0">{value}</span>
      <ChevronLeft size={15} strokeWidth={1.75} aria-hidden className="text-muted-foreground shrink-0" />
    </button>
  )
}
