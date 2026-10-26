'use client'
/**
 * Help & methodology (spec 7.14-style): how recommendations work (plain
 * language + an inline SVG "sweet spot" scale), where the data comes from,
 * why prices differ from the store, FAQ accordion, methodology & disclaimers,
 * privacy in plain words, and how to contribute.
 */
import { useEffect, useState } from 'react'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta, type CatalogMeta } from '@/lib/api-client'
import { formatNumberAr, formatDateAr } from '@/lib/money'
import { useApp } from '@/store/app-store'
import { GlassCard, GlassRow, GlassButton, Pill, SectionTitle, Spinner } from '@/components/glass/glass'
import {
  Sigma, Database, ArrowLeftRight, HelpCircle, Scale, ShieldCheck, Megaphone,
  TriangleAlert, Download, ChevronDown, Info,
} from 'lucide-react'

const PIPELINE_STEPS: { title: string; text: string }[] = [
  {
    title: 'تقدير الاحتياج',
    text: 'نحسب كمية شهرية لكل احتياج (حليب، بيض، أرز…) من أعمار أفراد الأسرة وعاداتهم — قهوة، شاي، ماء، تدخين — ومن عادات الضيافة والمطاعم، ثم نخصم ما لديك في المخزون.',
  },
  {
    title: 'ترشيح المنتجات',
    text: 'من بين عشرات الآلاف من المنتجات، نستبعد ما يخالف قيودك الغذائية وعلاماتك المحظورة، وما لا يناسب مرحلة عمر الرضيع أو مقاس الحفاضات.',
  },
  {
    title: 'ملاءمة العبوات والهدر',
    text: 'نحاكي الاستهلاك والصلاحية: عبوات عائلية للأسرة الكبيرة، وأحجام صغيرة تُستهلك قبل تلفها للفرد الواحد — حتى لا تدفع ثمن ما سيُرمى.',
  },
  {
    title: 'النقطة المثلى',
    text: 'لكل احتياج نقيّم المنتجات على مقياس يمتد من «الأرخص» إلى «الأغلى» ونختار الأنسب قيمةً لحجم أسرتك وميزانيتك — لا الأرخص لأنه قد يكون رديئاً أو بحجم غير مناسب، ولا الأغلى لأنه تبذير.',
  },
  {
    title: 'التخصيص تحت الميزانية',
    text: 'نوزّع الميزانية بالأولوية: الأساسيات أولاً ثم الاعتيادي ثم الرفاهية، مع سقفٍ للتحليات واحتياطي للطوارئ. وإن ضاقت الميزانية نخفض بترتيب معلن أمامك — الرضّع لا يُمسّون أبداً.',
  },
  {
    title: 'المتاجر',
    text: 'نقارن أسعار كل منتج بين المتاجر، ثم نختار السعر الوسيط للاستقرار، أو أرخص متجر واحد، أو تقسيم القائمة إن وفّر ذلك فعلاً بعد رسوم التوصيل.',
  },
  {
    title: 'الشرح',
    text: 'كل بند في خطتك يأتي بأسباب مقروءة وبدائل (أرخص / مكافئ / أعلى جودة) — فتعدّل ما تشاء بقرار واعٍ لا بثقة عمياء.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'كيف تعدّل كمية بند؟',
    a: 'من صفحة «خطتي»: أزرار الزيادة والإنقاص على كل بند تعدّل الكمية فوراً، أو عدّل أفراد الأسرة والعادات في معالج البدء وأعد التوليد لتتغير كل الكميات معاً.',
  },
  {
    q: 'ماذا تعني «ثابت»؟',
    a: 'البند المثبّت بقرارك (زر التثبيت) لا يستبدله المحرك عند إعادة التوليد — يبقى المنتج والكمية كما اخترتها مهما تغيّرت الميزانية.',
  },
  {
    q: 'كيف أشارك خطة؟',
    a: 'من صفحة «خطتي» أو من صفحة المجتمع: اختر عنواناً وقرّر هل تظهر باسم أسرة أم مجهولاً. تُنشر المدخلات (تركيبة الأسرة والميزانية) لتُولَّد النتائج على الخادم — بلا أي بيانات هوية.',
  },
  {
    q: 'هل بياناتي محفوظة عندك؟',
    a: 'لا. كل بياناتك تبقى في متصفح جهازك — لا حساب ولا تتبع ولا إعلانات. لا يغادر جهازك شيء إلا الخطة التي تختار مشاركتها صراحةً، والمساهمات التي ترسلها بنفسك.',
  },
  {
    q: 'ما دقة تقديرات الاستهلاك؟',
    a: 'هي تقديرات أولية مبنية على قيم استهلاك عامة، وهي قابلة للتعديل: حرّر الكميات بعد التوليد لتناسب أسرك، وستتاح بيئةً لضبط قيم الاستهلاك نفسها من الإعدادات في إصدارات قادمة.',
  },
]

/** 3-point scale: cheapest (muted) — sweet spot (highlighted middle) — priciest (muted) */
function SweetSpotScale() {
  return (
    <svg
      viewBox="0 0 320 96"
      className="w-full max-w-[340px] mx-auto my-2 block"
      role="img"
      aria-label="مقياس الاختيار من ثلاث درجات: الأرخص في الطرف الأيمن، الأنسب في المنتصف مُظللاً، والأغلى في الطرف الأيسر"
    >
      <line x1="28" y1="52" x2="292" y2="52" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
      {/* cheapest (right end) */}
      <circle cx="276" cy="52" r="7" fill="currentColor" fillOpacity="0.3" />
      <text x="276" y="82" textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.65">الأرخص</text>
      {/* sweet spot (middle, highlighted) */}
      <circle cx="160" cy="52" r="17" fill="none" stroke="var(--primary)" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="160" cy="52" r="9" fill="var(--primary)" />
      <text x="160" y="26" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--primary)">الأنسب</text>
      {/* priciest (left end) */}
      <circle cx="44" cy="52" r="7" fill="currentColor" fillOpacity="0.3" />
      <text x="44" y="82" textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.65">الأغلى</text>
    </svg>
  )
}

export function HelpView() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchCatalogMeta()
      .then((m) => { if (!cancelled) setMeta(m) })
      .catch(() => { /* offline is fine */ })
      .finally(() => { if (!cancelled) setMetaLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-8 pt-2 pb-8">
      {/* 1. how recommendations work */}
      <section aria-label="كيف تعمل التوصيات">
        <SectionTitle>كيف تعمل التوصيات؟</SectionTitle>
        <GlassCard className="p-5">
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            مسار القرار عندنا سبع مراحل متتابعة، وكلها تعمل على جهاز الخادم من قاعدة بيانات مفتوحة —
            لا تخمين ولا آراء غامضة — بل قواعد رقمية قابلة للتدقيق:
          </p>
          <ol className="space-y-3">
            {PIPELINE_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="w-8 h-8 rounded-xl glass-thin grid place-items-center shrink-0 text-sm font-bold tabular-nums text-primary">
                  {formatNumberAr(i + 1, arabicNumerals)}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold">{s.title}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{s.text}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 pt-4 border-t border-border/60">
            <div className="text-sm font-bold mb-1 flex items-center gap-2">
              <Sigma size={15} strokeWidth={1.75} className="text-primary" aria-hidden />
              «الأنسب» لا الأرخص ولا الأغلى
            </div>
            <SweetSpotScale />
            <p className="text-xs text-muted-foreground leading-relaxed text-center">
              نبحث عن نقطة التوازن: جودة كافية وعبوة مناسبة وسعر عادل بالنسبة لسوق المنتج نفسه.
            </p>
          </div>
        </GlassCard>
      </section>

      {/* 2. where the data comes from */}
      <section aria-label="من أين البيانات">
        <SectionTitle>من أين البيانات؟</SectionTitle>
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center shrink-0 text-primary">
              <Database size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="text-sm leading-relaxed">
              <span className="font-bold">
                {metaLoading ? '…' : meta ? `${formatNumberAr(meta.stores.length, arabicNumerals)} متجراً بحرينياً` : 'متاجر بحرينية'}
              </span>{' '}
              — سوبرماركات وهايبرماركتس وتط توصيل سريع. لكل منتج نجمع أسعاره من المتاجر المتاحة له ونحسب
              <span className="font-semibold"> السعر الوسيط </span>
              (الوسيط لا تتأثر بالقيم الشاذة بعكس المتوسط).
            </div>
          </div>
          <GlassRow className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold">تاريخ اللقطة</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {metaLoading ? (
                  <span className="inline-flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> نحمّل معلومات قاعدة البيانات…</span>
                ) : meta ? (
                  <>
                    {formatDateAr(meta.generatedAt)} · {formatNumberAr(meta.productCount, arabicNumerals)} منتجاً · إصدار{' '}
                    <span dir="ltr">{meta.version}</span>
                  </>
                ) : 'غير متاح حالياً'}
              </div>
            </div>
            <Pill tone="warn">تقديرات تاريخية</Pill>
          </GlassRow>
          <div className="glass-thin rounded-xl p-3.5 text-sm flex gap-2 items-start border-amber-500/30" role="note">
            <TriangleAlert size={16} strokeWidth={1.75} className="text-amber-600 shrink-0 mt-0.5" aria-hidden />
            <p className="leading-relaxed">
              الأسعار المعروضة <span className="font-semibold">تقديرات تاريخية</span> لحظة آخر لقطة للبيانات،
              وليست عرضاً ملزماً — تحقق من السعر في المتجر قبل الشراء.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GlassButton size="sm" onClick={() => window.open('/api/dump', '_blank')}>
              <Download size={14} strokeWidth={1.75} aria-hidden /> تنزيل البيانات المفتوحة (JSON)
            </GlassButton>
          </div>
        </GlassCard>
      </section>

      {/* 3. why prices differ */}
      <section aria-label="لماذا تختلف الأسعار">
        <SectionTitle>لماذا تختلف الأسعار عن المتجر؟</SectionTitle>
        <GlassCard className="p-4 space-y-3">
          {[
            { title: 'الوسيط مقابل سعر متجرك', text: 'نعرض سعراً وسيطاً عبر المتاجر؛ متجرك المعتاد قد يكون أرخص أو أغلى من الوسيط لحظة الشراء.' },
            { title: 'العروض الترويجية', text: 'خصومات «اشترِ ٢ واحصل على ١» وعروض الأسبوع لحظية وسريعة الزوال، واللقطات الدورية قد لا تلتقطها.' },
            { title: 'المخزون والتوفر', text: 'توفر المنتج وحجم العبوة يتغيّران بين المتاجر وبين اللقطات، فيختلف المنتج الأرخص المتاح لكل احتياج.' },
          ].map((r) => (
            <div key={r.title} className="flex gap-3 items-start">
              <ArrowLeftRight size={16} strokeWidth={1.75} className="text-primary shrink-0 mt-0.5" aria-hidden />
              <div>
                <div className="text-sm font-semibold">{r.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{r.text}</div>
              </div>
            </div>
          ))}
        </GlassCard>
      </section>

      {/* 4. FAQ */}
      <section aria-label="أسئلة شائعة">
        <SectionTitle>أسئلة شائعة</SectionTitle>
        <div className="space-y-2">
          {FAQ.map((f) => (
            <details key={f.q} className="glass-row rounded-xl group">
              <summary className="flex items-center justify-between gap-3 min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <HelpCircle size={15} strokeWidth={1.75} className="text-primary shrink-0" aria-hidden />
                  {f.q}
                </span>
                <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground leading-relaxed">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* 5. methodology & disclaimers */}
      <section aria-label="المنهجية والإخلاءات">
        <SectionTitle>المنهجية والإخلاءات</SectionTitle>
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Scale size={17} strokeWidth={1.75} className="text-primary shrink-0 mt-0.5" aria-hidden />
            <ul className="text-sm text-muted-foreground leading-relaxed space-y-2 list-none">
              <li>الأسعار تقديرية تاريخية مبنية على لقطات دورية، وليست أسعاراً لحظية ولا عروضاً ملزمة.</li>
              <li>التوصيات ليست نصيحة طبية ولا غذائية — هي ترتيب تسوّق بحساب القيمة والقيد فقط.</li>
              <li>
                <span className="font-semibold text-foreground">حليب الأطفال:</span> يسبق الملصق على العبوة وطبيبك
                دائماً — لا تعتمد على التطبيق وحده في اختيار مرحلة الحليب أو نوعه.
              </li>
            </ul>
          </div>
          <div className="glass-thin rounded-xl p-3.5 text-xs text-muted-foreground leading-relaxed flex gap-2 items-start">
            <Info size={14} strokeWidth={1.75} className="text-primary shrink-0 mt-0.5" aria-hidden />
            <p>
              <span className="font-semibold">المصادر:</span> قيم استهلاك أولية مبنية على توصيات WHO/FAO العامة
              ومسوح إنفاق الأسرة. سجّلنا القيم التقديرية بوضوح — يمكنك تعديل كل كميات بعد التوليد.
            </p>
          </div>
        </GlassCard>
      </section>

      {/* 6. privacy in plain words */}
      <section aria-label="الخصوصية بلغة بسيطة">
        <SectionTitle>الخصوصية بلغة بسيطة</SectionTitle>
        <GlassCard className="p-5">
          <div className="flex items-start gap-3 mb-3">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center shrink-0 text-primary">
              <ShieldCheck size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <ul className="text-sm text-muted-foreground leading-relaxed space-y-2">
              <li><span className="font-semibold text-foreground">كل شيء محلي:</span> بيانات أسرتك وخطتك وسجل إنفاقك تبقى في متصفح جهازك.</li>
              <li><span className="font-semibold text-foreground">لا حساب:</span> افتح التطبيق واستخدمه مباشرة — لا تسجيل ولا بريد إلكتروني.</li>
              <li><span className="font-semibold text-foreground">لا تتبع:</span> لا تحليلات سلوك ولا إعلانات ولا بيع بيانات.</li>
              <li><span className="font-semibold text-foreground">المشاركة اختيارية وصريحة:</span> ما تنشره في المجتمع أو ترسله كمساهمة هو كل ما يغادر جهازك، وبقرارك.</li>
            </ul>
          </div>
        </GlassCard>
      </section>

      {/* 7. contribute */}
      <section aria-label="المساهمة">
        <SectionTitle>ساهم في تحسين البيانات</SectionTitle>
        <GlassCard className="p-5">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center shrink-0 text-primary">
              <Megaphone size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="text-sm text-muted-foreground leading-relaxed">
              <p>
                لاحظت سعراً قديماً أو اسماً محرفاً أو منتجاً مفقوداً؟ أرسل مساهمة من صفحة المجتمع —
                تصحيح اسم، تحديث سعر، منتج جديد، أو إبلاغ عن توفر. تُراجع المساهمات يدوياً قبل اعتمادها،
                وتصويت المجتمع يرتّب أولويتها.
              </p>
              <GlassButton size="sm" variant="primary" className="mt-3" onClick={() => navigate({ name: 'community' })}>
                اذهب إلى صفحة المجتمع
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      </section>
    </div>
  )
}
