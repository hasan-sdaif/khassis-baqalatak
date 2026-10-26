'use client'
/**
 * Home (spec 10.10): value promise, LIVE plan preview using the real engine
 * (members + budget sliders + a generic envelope), how-it-works, open data,
 * personas.
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/store/app-store'
import { getAllPlanItems } from '@/lib/engine'
import { navigate } from '@/lib/router'
import { generatePlanApi } from '@/lib/api-client'
import { formatBHD, formatNumberAr } from '@/lib/money'
import { GlassCard, GlassButton, Pill, StatTile, Spinner, SectionTitle } from '@/components/glass/glass'
import { CategoryIcon } from '@/components/icons/category-icons'
import { Sparkles, Users, Wallet, SlidersHorizontal, ChevronLeft, ArrowLeft, HeartHandshake, Database, Sigma, ShieldCheck } from 'lucide-react'
import type { PlanResult } from '@/lib/engine/types'

export function HomeView() {
  const lang = useApp((s) => s.settings.lang)
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const household = useApp((s) => s.household)
  const [members, setMembers] = useState(household?.members.length ?? 5)
  const [budgetBHD, setBudgetBHD] = useState(180)
  const [infant, setInfant] = useState(false)
  const [chocoEnv, setChocoEnv] = useState(true)
  const [plan, setPlan] = useState<PlanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const budgetFils = budgetBHD * 1000

  const body = useMemo(() => {
    const memberList = Array.from({ length: members }).map((_, i) => ({
      id: `demo${i}`,
      ageMonths: i === 0 ? 400 : infant && i === members - 1 ? 5 : 60 + ((i * 41) % 130),
      specials: [],
    }))
    return {
      household: {
        members: memberList,
        habits: {
          ...(infant ? { formula: { [`dep_demo${members - 1}`]: 100 }, diapers: {} } : {}),
          water: { litersPerPersonDay: 1.5 },
          coffee: { cupsPerDay: 2 },
          tea: { cupsPerDay: 3 },
        },
        dietary: { halalOnly: true },
        prefs: { favoriteBrands: [], blockedBrands: [], blockedProducts: [], qualityBias: {}, globalQualityBias: 0 },
        eatingOutPerWeek: 2, guestsPerMonth: 4, hasWaterDispenser: false, storage: 'medium',
      },
      budget: { fils: budgetFils, period: 'month', horizonDays: 30, flexibilityPct: 0, reservePct: 0.05 },
      mode: 'balanced',
      season: 'normal',
      storeMode: 'median',
      availableStores: [],
      locks: [],
      envelopes: chocoEnv
        ? [{ id: 'demo-choc', name: 'شوكولاتة', groups: ['chocolate'], mode: 'range', minFils: 1500, maxFils: 7000, priority: 'ifLeft', fillToMax: false }]
        : [],
      seed: 42,
    }
  }, [members, budgetFils, infant, chocoEnv])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      generatePlanApi(body)
        .then((r) => { if (!cancelled) { setPlan(r.plan); setError(null) } })
        .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [body])

  const topItems = plan ? getAllPlanItems(plan).sort((a, b) => b.costFils - a.costFils).slice(0, 5) : []
  const allPlanItemCount = plan ? getAllPlanItems(plan).length : 0
  const surplus = plan ? plan.diagnostics.targetFils - plan.totals.costFils : 0

  return (
    <div className="space-y-8 pb-8">
      {/* hero */}
      <section className="pt-4">
        <Pill tone="primary" className="mb-3"><Sparkles size={13} strokeWidth={1.75} aria-hidden /> قاعدة بيانات مفتوحة: {formatNumberAr(39831, arabicNumerals)} منتجاً من {formatNumberAr(37, arabicNumerals)} متجراً بحرينياً</Pill>
        <h1 className="big-title mb-3">خصص بقالتك</h1>
        <p className="text-muted-foreground text-lg leading-relaxed max-w-xl">
          أخبرنا عن أسرتك وميزانيتك، ونرتّب لك بقالتك بأذكى توزيع —
          <span className="font-semibold text-foreground"> الأنسب لك تحديداً</span>، لا الأرخص ولا الأغلى، مع شرح مفهوم لكل اختيار.
        </p>
        <div className="flex flex-wrap gap-3 mt-5">
          <GlassButton variant="primary" size="lg" onClick={() => navigate({ name: 'start' })}>
            <Sparkles size={18} strokeWidth={1.75} aria-hidden />
            ابدأ خطتك الآن
          </GlassButton>
          <GlassButton size="lg" onClick={() => navigate({ name: 'catalog' })}>
            تصفّح الكتالوج
          </GlassButton>
        </div>
      </section>

      {/* live playground */}
      <section aria-label="مجرب تفاعلي">
        <SectionTitle>جرّبها الآن — بلا تسجيل</SectionTitle>
        <GlassCard className="p-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="flex items-center justify-between text-sm font-semibold mb-2">
                <span className="flex items-center gap-2"><Users size={16} strokeWidth={1.75} aria-hidden /> عدد الأفراد</span>
                <span className="tabular-nums text-primary text-lg font-bold">{formatNumberAr(members, arabicNumerals)}</span>
              </label>
              <input
                type="range" min={1} max={12} value={members}
                onChange={(e) => setMembers(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
                aria-label="عدد أفراد الأسرة"
              />
            </div>
            <div>
              <label className="flex items-center justify-between text-sm font-semibold mb-2">
                <span className="flex items-center gap-2"><Wallet size={16} strokeWidth={1.75} aria-hidden /> الميزانية الشهرية</span>
                <span className="tabular-nums text-primary text-lg font-bold">{formatBHD(budgetFils, { arabicNumerals })}</span>
              </label>
              <input
                type="range" min={20} max={600} step={10} value={budgetBHD}
                onChange={(e) => setBudgetBHD(Number(e.target.value))}
                className="w-full accent-[var(--primary)]"
                aria-label="الميزانية الشهرية بالدينار"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => setInfant((v) => !v)}
              className={`min-h-11 px-4 rounded-xl text-sm font-semibold transition-all ${infant ? 'bg-primary/15 text-primary' : 'glass-thin'}`}
              aria-pressed={infant}
            >
              رضيع (حفاضات + حليب أطفال)
            </button>
            <button
              onClick={() => setChocoEnv((v) => !v)}
              className={`min-h-11 px-4 rounded-xl text-sm font-semibold transition-all ${chocoEnv ? 'bg-accent/15 text-accent' : 'glass-thin'}`}
              aria-pressed={chocoEnv}
            >
              ظرف شوكولاتة 1.500 – 7.000 د.ب
            </button>
          </div>

          <div className="mt-5 pt-4 border-t border-border/60">
            {loading && !plan ? (
              <div className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
                <Spinner className="w-7 h-7 text-primary" />
                <div className="text-sm">نحسب احتياج أسرتك… نبحث في 39,831 منتجاً…</div>
              </div>
            ) : error ? (
              <div className="text-destructive text-sm py-4" role="alert">تعذر توليد المعاينة: {error}</div>
            ) : plan ? (
              <div className="space-y-3" aria-live="polite">
                <div className="flex flex-wrap gap-2">
                  <StatTile label="التكلفة المتوقعة" value={formatBHD(plan.totals.costFils, { arabicNumerals })} tone="primary" hint={`نطاق ${formatBHD(plan.totals.optimisticFils, { arabicNumerals, withUnit: false })} – ${formatBHD(plan.totals.pessimisticFils, { arabicNumerals, withUnit: false })}`} />
                  <StatTile label="عدد البنود" value={formatNumberAr(allPlanItemCount, arabicNumerals)} />
                  <StatTile label="الهدر المتوقع" value={`${formatNumberAr(plan.totals.wastePct, arabicNumerals)}٪`} />
                  <StatTile
                    label={surplus >= 0 ? 'الوفر المتوقع' : 'العجز'}
                    value={formatBHD(Math.abs(surplus), { arabicNumerals })}
                    tone={surplus >= 0 ? 'default' : 'danger'}
                  />
                </div>
                <div className="space-y-2">
                  {topItems.map((it) => (
                    <div key={it.key} className="glass-row rounded-xl px-3 py-2.5 flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg glass-ultrathin grid place-items-center shrink-0 text-primary">
                        <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{it.productName}</div>
                        <div className="text-[11px] text-muted-foreground">× {formatNumberAr(it.packQty, arabicNumerals)} {it.sizeText ?? ''}</div>
                      </div>
                      <div className="text-sm font-bold tabular-nums">{formatBHD(it.costFils, { arabicNumerals })}</div>
                    </div>
                  ))}
                  {plan.envelopes.map((e) => (
                    <div key={e.envelopeId} className="glass-row rounded-xl px-3 py-2.5 flex items-center gap-3 border-accent/30">
                      <span className="w-9 h-9 rounded-lg bg-accent/15 grid place-items-center shrink-0 text-accent">
                        <CategoryIcon category="chocolate-sweets" size={16} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{e.name} — تشكيلة عامة</div>
                        <div className="text-[11px] text-muted-foreground">{e.items.length} أصناف متنوعة — اعرضها في الخطة</div>
                      </div>
                      <div className="text-sm font-bold tabular-nums text-accent">{formatBHD(e.spentFils, { arabicNumerals })}</div>
                    </div>
                  ))}
                </div>
                <GlassButton variant="primary" className="w-full mt-2" onClick={() => navigate({ name: 'start' })}>
                  أكمل بياناتك للحصول على الخطة الكاملة والقائمة والتقارير
                  <ChevronLeft size={16} strokeWidth={1.75} className="flip-x" aria-hidden />
                </GlassButton>
              </div>
            ) : null}
          </div>
        </GlassCard>
      </section>

      {/* how it works */}
      <section>
        <SectionTitle>كيف نختار «الأنسب»؟</SectionTitle>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { icon: Sigma, title: 'نقدّر احتياج أسرتك', text: 'لكل فرد عمره وعاداته: حليب، حفاضات، قهوة… بقواعد استهلاك موثقة وقابلة للتعديل.' },
            { icon: SlidersHorizontal, title: 'نحاكي العبوات والهدر', text: 'أسرة كبيرة؟ عبوات عائلية. فرد واحد؟ أحجام تُستهلك قبل انتهاء صلاحيتها.' },
            { icon: HeartHandshake, title: 'نختار النقطة المثلى', text: 'لا الأرخص (رديء أو حجم غير مناسب) ولا الأغلى (تبذير) — الأنسب لميزانيتك، مع شرح كل اختيار.' },
          ].map(({ icon: Icon, title, text }) => (
            <GlassCard key={title} className="p-4">
              <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center mb-3 text-primary"><Icon size={20} strokeWidth={1.75} aria-hidden /></span>
              <div className="font-bold mb-1">{title}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{text}</div>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* open source & privacy */}
      <section>
        <div className="grid sm:grid-cols-2 gap-3">
          <GlassCard className="p-5">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center mb-3 text-primary"><Database size={20} strokeWidth={1.75} aria-hidden /></span>
            <div className="font-bold mb-1">مفتوح المصدر والبيانات</div>
            <div className="text-sm text-muted-foreground leading-relaxed mb-3">
              الكود والخوارزمية وقاعدة بيانات {formatNumberAr(39831, arabicNumerals)} منتجاً كلها قابلة للتدقيق والمساهمة،
              مع تصدير مفتوح للبيانات ومؤشر أسعار وسلال قياسية.
            </div>
            <div className="flex flex-wrap gap-2">
              <GlassButton size="sm" onClick={() => navigate({ name: 'index' })}>مؤشر الأسعار</GlassButton>
              <GlassButton size="sm" onClick={() => window.open('/api/dump', '_blank')}>تنزيل البيانات</GlassButton>
            </div>
          </GlassCard>
          <GlassCard className="p-5">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center mb-3 text-primary"><ShieldCheck size={20} strokeWidth={1.75} aria-hidden /></span>
            <div className="font-bold mb-1">خصوصيتك أولاً</div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              يعمل التطبيق كاملاً بدون حساب، وبيانات أسرتك تبقى في جهازك. لا تتبّع ولا إعلانات.
              المشاركة مع المجتمع اختيارية وصريحة.
            </div>
          </GlassCard>
        </div>
      </section>

      {/* personas */}
      <section>
        <SectionTitle>صُمم لأسر مثل هذه</SectionTitle>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { title: 'أسرة كبيرة مع رضيع', text: 'عبوات عائلية، حفاضات وحليب أطفال أولاً بأفضل قيمة' },
            { title: 'فرد واحد', text: 'أحجام تناسب الفرد بلا هدر، التدخين كبند ثابت' },
            { title: 'زوجان يقدّران القهوة', text: 'جودة أعلى في فئات محددة وتنويع مدروس' },
            { title: 'طالب جامعي', text: 'اقتصادي ذكي دون الإضرار بالجودة الأساسية' },
          ].map((p) => (
            <GlassCard key={p.title} className="p-4">
              <div className="font-semibold text-sm mb-1">{p.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{p.text}</div>
            </GlassCard>
          ))}
        </div>
      </section>
    </div>
  )
}
