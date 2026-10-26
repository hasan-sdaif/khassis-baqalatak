'use client'
/**
 * Home pantry (spec 7.5): manual stock items linked to needs, quick-add from
 * the active plan, run-out estimates from household consumption, and plan
 * regeneration that deducts stock from demand.
 */
import { useMemo, useState } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { generatePlanApi } from '@/lib/api-client'
import { formatQty, formatDateAr, formatNumberAr } from '@/lib/money'
import { GlassCard, GlassButton, GlassRow, Pill, EmptyState, SectionTitle, Spinner } from '@/components/glass/glass'
import { getAllPlanItems, NEEDS, NEEDS_MAP } from '@/lib/engine'
import type { PantryItem, PlanItem, UnitKind } from '@/lib/engine/types'
import { Boxes, Plus, Trash2, RefreshCw, Info, Timer, PackagePlus } from 'lucide-react'

const UNIT_OPTIONS: { id: UnitKind; label: string }[] = [
  { id: 'ml', label: 'مل' },
  { id: 'g', label: 'جم' },
  { id: 'pcs', label: 'حبة' },
  { id: 'rolls', label: 'رول' },
  { id: 'sheets', label: 'منديل' },
]

function needLabel(needId: string): string {
  const base = needId.split('@')[0]!
  if (base === 'formula') return `حليب أطفال — مرحلة ${needId.split('@')[1] ?? ''}`
  if (base === 'diapers') return `حفاضات — مقاس ${needId.split('@')[1] ?? ''}`
  return NEEDS_MAP.get(base)?.nameAr ?? base
}

export function PantryView() {
  const store = useApp()
  const plan = store.plan
  const household = store.household
  const arabicNumerals = store.settings.arabicNumerals

  // add-item form state
  const [name, setName] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [unit, setUnit] = useState<UnitKind>('pcs')
  const [needId, setNeedId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // regeneration state
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)

  const wizardNeeds = useMemo(() => NEEDS.filter((n) => n.visibleInWizard), [])
  const otherNeeds = useMemo(() => NEEDS.filter((n) => !n.visibleInWizard), [])

  /** rough run-out estimate from adult monthly consumption × members */
  const runOutDays = (p: PantryItem): number | null => {
    if (!household || !p.needId || p.qtyBaseUnit <= 0) return null
    const need = NEEDS_MAP.get(p.needId.split('@')[0]!)
    if (!need || need.adultMonthly <= 0) return null
    const members = Math.max(1, household.members.length)
    const perDay = (need.adultMonthly / 30) * members
    if (perDay <= 0) return null
    return p.qtyBaseUnit / perDay
  }

  const onNeedChange = (id: string) => {
    setNeedId(id)
    const base = id.split('@')[0]!
    const needUnit = id ? NEEDS_MAP.get(base)?.baseUnit : undefined
    if (needUnit) setUnit(needUnit)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const qty = Number(qtyRaw)
    if (!name.trim() || !Number.isFinite(qty) || qty <= 0) {
      setFormError('أدخل اسم المادة وكمية أكبر من صفر')
      return
    }
    const chosenUnit = needId ? (NEEDS_MAP.get(needId.split('@')[0]!)?.baseUnit ?? unit) : unit
    store.addPantry({
      id: `p${Date.now()}`,
      name: name.trim(),
      needId: needId || undefined,
      qtyBaseUnit: qty,
      unit: chosenUnit,
      addedAtISO: new Date().toISOString(),
    })
    setName('')
    setQtyRaw('')
    setFormError(null)
  }

  // plan items that can stock the pantry (not already stocked by product/need)
  const planCandidates = useMemo<PlanItem[]>(() => {
    if (!plan) return []
    const pantryNeedIds = new Set(store.pantry.map((p) => p.needId).filter((x): x is string => Boolean(x)))
    const pantryProductIds = new Set(store.pantry.map((p) => p.productId).filter((x): x is string => Boolean(x)))
    return getAllPlanItems(plan).filter((it) =>
      it.unitQtyBase > 0
      && !it.productId.startsWith('manual:')
      && !pantryProductIds.has(it.productId)
      && !(it.needId && pantryNeedIds.has(it.needId)),
    )
  }, [plan, store.pantry])

  const quickAdd = (it: PlanItem) => {
    const base = it.needId.split('@')[0]!
    const baseUnit = NEEDS_MAP.get(base)?.baseUnit ?? 'pcs'
    store.addPantry({
      id: `p${Date.now()}`,
      productId: it.productId,
      name: it.productName,
      needId: it.needId,
      qtyBaseUnit: it.unitQtyBase,
      unit: baseUnit,
      addedAtISO: new Date().toISOString(),
    })
  }

  const regen = async () => {
    if (!store.household || !store.budget) {
      navigate({ name: 'start' })
      return
    }
    setRegenerating(true)
    setRegenError(null)
    try {
      const { plan: p } = await generatePlanApi({
        household: store.household,
        budget: store.budget,
        mode: store.planMode,
        ...store.planContext,
        envelopes: store.envelopes,
        locks: store.locks,
        pantry: store.pantry,
        advanced: store.advanced,
      })
      store.setPlan(p)
      navigate({ name: 'plan' })
    } catch (err) {
      setRegenError(String((err as Error).message ?? err))
    } finally {
      setRegenerating(false)
    }
  }

  const inputCls = 'w-full h-11 rounded-xl glass-thin px-3 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40'

  return (
    <div className="space-y-6 pb-8 pt-2">
      {/* explain + regenerate */}
      <section aria-label="كيف يعمل المخزون">
        <GlassCard className="p-4 border-accent/30">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-accent/15 grid place-items-center shrink-0 text-accent" aria-hidden>
              <Info size={20} strokeWidth={1.75} />
            </span>
            <div className="flex-1 text-sm leading-relaxed">
              <span className="font-bold block mb-1">المخزون يُخصم تلقائياً من احتياج الخطة عند إعادة التوليد</span>
              <span className="text-muted-foreground">
                سجّل ما لديك فعلاً في المنزل — المولّد يخفض الكميات المشتراة بمقدار المخزون المرتبط باحتياج، فلا تشتري ما تكفيك منه.
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <GlassButton
              variant="primary"
              onClick={regen}
              aria-busy={regenerating}
              className={regenerating ? 'pointer-events-none opacity-50' : ''}
            >
              {regenerating ? <Spinner className="w-4 h-4" /> : <RefreshCw size={16} strokeWidth={1.75} aria-hidden />}
              أعد توليد الخطة
            </GlassButton>
            {!store.household || !store.budget ? (
              <GlassButton size="sm" onClick={() => navigate({ name: 'start' })}>أكمل معالج البدء أولاً</GlassButton>
            ) : null}
            {regenError ? (
              <div className="text-destructive text-sm w-full" role="alert">{`تعذر إعادة التوليد: ${regenError}`}</div>
            ) : null}
          </div>
        </GlassCard>
      </section>

      {/* add form */}
      <section aria-label="إضافة مادة إلى المخزون">
        <SectionTitle>أضف مادة إلى المخزون</SectionTitle>
        <GlassCard>
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div>
              <label htmlFor="pantry-name" className="block text-sm font-semibold mb-1.5">اسم المادة</label>
              <input
                id="pantry-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: أرز بسمتي"
                className={inputCls}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pantry-qty" className="block text-sm font-semibold mb-1.5">الكمية</label>
                <input
                  id="pantry-qty"
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  min={0}
                  step="any"
                  value={qtyRaw}
                  onChange={(e) => setQtyRaw(e.target.value)}
                  placeholder="0"
                  className={`${inputCls} text-end tabular-nums`}
                />
              </div>
              <div>
                <label htmlFor="pantry-unit" className="block text-sm font-semibold mb-1.5">الوحدة</label>
                <select
                  id="pantry-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as UnitKind)}
                  className={inputCls}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.id} value={u.id}>{u.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="pantry-need" className="block text-sm font-semibold mb-1.5">اربط باحتياج (اختياري)</label>
              <select
                id="pantry-need"
                value={needId}
                onChange={(e) => onNeedChange(e.target.value)}
                className={inputCls}
              >
                <option value="">بدون ربط باحتياج</option>
                <optgroup label="الاحتياجات الشائعة">
                  {wizardNeeds.map((n) => (
                    <option key={n.id} value={n.id}>{n.nameAr}</option>
                  ))}
                </optgroup>
                <optgroup label="احتياجات أخرى">
                  {otherNeeds.map((n) => (
                    <option key={n.id} value={n.id}>{n.nameAr}</option>
                  ))}
                </optgroup>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                الربط بالاحتياج يفعّل الخصم من الخطة وتقدير «متى سينفد».
              </p>
            </div>
            {formError ? <div className="text-destructive text-sm" role="alert">{formError}</div> : null}
            <GlassButton variant="primary" className="w-full">
              <Plus size={16} strokeWidth={1.75} aria-hidden />
              أضف إلى المخزون
            </GlassButton>
          </form>
        </GlassCard>
      </section>

      {/* pantry list */}
      <section aria-label="محتويات المخزون">
        <SectionTitle className="flex items-center gap-2">
          <Boxes size={18} strokeWidth={1.75} aria-hidden className="text-primary" />
          {`مخزونك (${formatNumberAr(store.pantry.length, arabicNumerals)})`}
        </SectionTitle>
        {store.pantry.length === 0 ? (
          <EmptyState
            icon={<Boxes size={24} strokeWidth={1.75} aria-hidden />}
            title="مخزونك فارغ"
            subtitle="أضف ما لديك في المنزل يدوياً أو بنقرة واحدة من بنود خطتك الحالية"
          />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto nice-scroll pe-1">
            {store.pantry.map((p) => {
              const days = runOutDays(p)
              const dayLabel = days == null ? null : days < 1 ? 'أقل من يوم' : `≈ ${formatNumberAr(Math.floor(days), arabicNumerals)} يوم`
              return (
                <GlassRow key={p.id} className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg glass-ultrathin grid place-items-center shrink-0 text-primary" aria-hidden>
                    <Boxes size={16} strokeWidth={1.75} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {formatQty(p.unit, p.qtyBaseUnit)}
                      {p.needId ? ` · ${needLabel(p.needId)}` : ''}
                      {` · أُضيف ${formatDateAr(p.addedAtISO)}`}
                    </div>
                  </div>
                  {dayLabel ? (
                    <Pill tone={days != null && days < 5 ? 'warn' : 'default'} className="shrink-0">
                      <Timer size={12} strokeWidth={1.75} aria-hidden />
                      {dayLabel}
                    </Pill>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => store.removePantry(p.id)}
                    aria-label={`حذف ${p.name} من المخزون`}
                    className="shrink-0 w-11 h-11 rounded-xl glass-thin hover:bg-destructive/15 hover:text-destructive grid place-items-center transition-colors"
                  >
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </GlassRow>
              )
            })}
          </div>
        )}
      </section>

      {/* quick add from plan */}
      {plan ? (
        <section aria-label="أضف من خطتك">
          <SectionTitle className="flex items-center gap-2">
            <PackagePlus size={18} strokeWidth={1.75} aria-hidden className="text-primary" />
            أضف من خطتك
          </SectionTitle>
          {planCandidates.length === 0 ? (
            <GlassCard className="p-4 text-sm text-muted-foreground">
              كل بنود خطتك الحالية مسجّلة في المخزون أو غير قابلة للتخزين.
            </GlassCard>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto nice-scroll pe-1">
              {planCandidates.map((it) => (
                <GlassRow key={it.key} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.productName}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {`${needLabel(it.needId)} · ${formatQty(NEEDS_MAP.get(it.needId.split('@')[0]!)?.baseUnit ?? 'pcs', it.unitQtyBase)}`}
                    </div>
                  </div>
                  <GlassButton size="sm" onClick={() => quickAdd(it)} className="shrink-0">
                    <Plus size={14} strokeWidth={1.75} aria-hidden />
                    أضف
                  </GlassButton>
                </GlassRow>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
