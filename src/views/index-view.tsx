'use client'
/**
 * Price index & standard baskets (spec 7.12): basket cost per store (family-4,
 * infant, student) with the cheapest store highlighted and savings vs the most
 * expensive; category medians as an accessible table with inline bars; open
 * data download. Prices = cheapest available product per need per store at the
 * snapshot date.
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/store/app-store'
import { fetchIndex, fetchCatalogMeta, type IndexResponse, type CatalogMeta } from '@/lib/api-client'
import { formatBHD, formatNumberAr, formatDateAr } from '@/lib/money'
import { CategoryIcon } from '@/components/icons/category-icons'
import {
  GlassCard, GlassButton, Pill, SectionTitle, EmptyState, Spinner, SkeletonRows,
} from '@/components/glass/glass'
import { ShoppingCart, TrendingDown, Download, Link2, Check, Info, RefreshCw, Tag } from 'lucide-react'

interface BasketStore {
  storeId: string
  storeNameAr: string
  totalFils: number
  covered: number
  itemCount: number
}

interface RankedStore extends BasketStore {
  rank: number | null
  isCheapest: boolean
}

/**
 * Ranking is only meaningful between stores that cover the WHOLE basket —
 * a store covering 1 of 16 needs always sums less. So: full-coverage stores
 * first (sorted by totalFils ascending), then partial-coverage stores
 * (also by totalFils), then stores that carry none of the basket (unranked).
 */
function rankStores(stores: BasketStore[]): { rows: RankedStore[]; cheapest: BasketStore | null; savingsVsMostExpensive: number } {
  const full = stores
    .filter((s) => s.itemCount > 0 && s.covered >= s.itemCount)
    .sort((a, b) => a.totalFils - b.totalFils)
  const partial = stores
    .filter((s) => s.covered > 0 && s.covered < s.itemCount)
    .sort((a, b) => a.totalFils - b.totalFils)
  const none = stores.filter((s) => s.covered === 0)
  const cheapest = full[0] ?? null
  const maxFils = full.length ? full[full.length - 1]!.totalFils : 0
  const rows: RankedStore[] = [
    ...full.map((s, i) => ({ ...s, rank: i + 1, isCheapest: i === 0 })),
    ...partial.map((s) => ({ ...s, rank: null, isCheapest: false })),
    ...none.map((s) => ({ ...s, rank: null, isCheapest: false })),
  ]
  return { rows, cheapest, savingsVsMostExpensive: cheapest ? Math.max(0, maxFils - cheapest.totalFils) : 0 }
}

export function IndexView() {
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)

  const [reloadKey, setReloadKey] = useState(0)
  const [res, setRes] = useState<{ key: number; data: IndexResponse | null; error: string | null } | null>(null)
  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchIndex()
      .then((r) => { if (!cancelled) setRes({ key: reloadKey, data: r, error: null }) })
      .catch(() => { if (!cancelled) setRes({ key: reloadKey, data: null, error: 'تعذر حساب المؤشر — حاول مجدداً بعد لحظات.' }) })
    return () => { cancelled = true }
  }, [reloadKey])

  // derived load state — no synchronous setState in the effect body
  const loading = !res || res.key !== reloadKey
  const data = res && res.key === reloadKey ? res.data : null
  const error = res && res.key === reloadKey ? res.error : null

  useEffect(() => {
    let cancelled = false
    fetchCatalogMeta()
      .then((m) => { if (!cancelled) setMeta(m) })
      .catch(() => { /* offline is fine */ })
    return () => { cancelled = true }
  }, [])

  const baskets = useMemo(
    () => (data?.baskets ?? []).map((b) => ({ ...b, ...rankStores(b.stores) })),
    [data],
  )

  const maxMedian = useMemo(
    () => Math.max(1, ...(data?.categoryStats ?? []).map((c) => c.medianFils)),
    [data],
  )

  const copyDumpLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/dump`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  if (loading) {
    return (
      <div className="space-y-6 pt-4 pb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="text-primary" /> نحسب سلال الأسعار عبر المتاجر…
        </div>
        <SkeletonRows rows={6} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<ShoppingCart size={24} strokeWidth={1.75} aria-hidden />}
        title="تعذر تحميل مؤشر الأسعار"
        subtitle={error ?? 'حاول مرة أخرى.'}
        action={<GlassButton variant="primary" onClick={() => setReloadKey((k) => k + 1)}>أعد المحاولة</GlassButton>}
      />
    )
  }

  return (
    <div className="space-y-8 pt-2 pb-8">
      {/* intro */}
      <section>
        <Pill tone="primary" className="mb-3"><Tag size={13} strokeWidth={1.75} aria-hidden /> مؤشر مستقل محسوب من الكتالوج المفتوح</Pill>
        <h1 className="big-title mb-2">مؤشر الأسعار والسلال</h1>
        <p className="text-muted-foreground text-base leading-relaxed max-w-2xl">
          ثلاث سلال معيارية (أسرة من ٤، رضيع، طالب) نحسب قيمتها في كل متجر من أرخص منتج متاح
          لكل احتياج — قارن متاجرك قبل أن تطلب.
        </p>
      </section>

      {/* baskets */}
      <section aria-label="السلال المعيارية">
        <SectionTitle>السلال المعيارية حسب المتجر</SectionTitle>
        <div className="space-y-5">
          {baskets.map((b) => (
            <GlassCard key={b.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-base font-bold">{b.nameAr}</h3>
                {b.cheapest ? (
                  <Pill tone="primary">
                    <TrendingDown size={12} strokeWidth={1.75} aria-hidden />
                    الأرخص: {b.cheapest.storeNameAr} · {formatBHD(b.cheapest.totalFils, { arabicNumerals })}
                  </Pill>
                ) : null}
              </div>

              {b.rows.length === 0 ? (
                <div className="text-sm text-muted-foreground py-3">لا بيانات متاجر لهذه السلة حالياً.</div>
              ) : (
                <div className="max-h-96 overflow-y-auto overflow-x-auto nice-scroll">
                  <table className="w-full text-sm border-separate border-spacing-y-1">
                    <caption className="sr-only">
                      تكلفة {b.nameAr} في كل متجر: المتاجر التي تغطي السلة كاملة مرتبة من الأرخص إلى الأغلى،
                      ثم المتاجر ذات التغطية الجزئية بدون ترتيب، مع تغطية بنود السلة لكل متجر
                    </caption>
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th scope="col" className="text-start font-medium px-2 py-1.5 w-14">الترتيب</th>
                        <th scope="col" className="text-start font-medium px-2 py-1.5">المتجر</th>
                        <th scope="col" className="text-start font-medium px-2 py-1.5">الإجمالي</th>
                        <th scope="col" className="text-start font-medium px-2 py-1.5">التغطية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((s) => (
                        <tr
                          key={s.storeId}
                          className={s.isCheapest ? 'bg-primary/10' : undefined}
                        >
                          <td className="px-2 py-2.5 rounded-s-xl tabular-nums text-muted-foreground">
                            {s.rank != null ? formatNumberAr(s.rank, arabicNumerals) : '—'}
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{s.storeNameAr}</span>
                              {s.isCheapest ? <Pill tone="primary">الأرخص هذا الأسبوع</Pill> : null}
                            </div>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="font-bold tabular-nums">{formatBHD(s.totalFils, { arabicNumerals })}</span>
                          </td>
                          <td className="px-2 py-2.5 rounded-e-xl">
                            <Pill tone={s.covered < s.itemCount ? 'default' : 'primary'}>
                              <span className="tabular-nums">
                                غطى {formatNumberAr(s.covered, arabicNumerals)} من {formatNumberAr(s.itemCount, arabicNumerals)} بند
                              </span>
                            </Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {b.savingsVsMostExpensive > 0 ? (
                <div className="mt-3 text-sm flex flex-wrap items-center gap-x-2 gap-y-1 text-primary font-semibold">
                  <span className="flex items-center gap-2 tabular-nums">
                    <TrendingDown size={15} strokeWidth={1.75} aria-hidden />
                    توفير {formatBHD(b.savingsVsMostExpensive, { arabicNumerals })} مقارنة بأغلى متجر يغطي السلة كاملة
                  </span>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                الترتيب بين المتاجر التي تغطي السلة كاملة (بترتيب تصاعدي للإجمالي)؛
                متوّفر السلة جزئياً يُعرض بعده بلا ترتيب لأن مقارنة إجمالياته غير عادلة.
              </p>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* category index */}
      <section aria-label="مؤشر الفئات">
        <SectionTitle>مؤشر الفئات — الوسيط وعدد المنتجات</SectionTitle>
        <GlassCard className="p-4 sm:p-5">
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            الوسيط = السعر الأوسط لمنتجات الفئة عبر المتاجر. طول الشريط يقارن الوسيط بأعلى وسيط بين الفئات.
          </p>
          <div className="max-h-96 overflow-y-auto nice-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">لكل فئة: عدد المنتجات والسعر الوسيط وشريط نسبي للوسيط</caption>
              <thead className="sticky top-0 bg-[var(--card)] z-[1]">
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="text-start font-medium px-2 py-2">الفئة</th>
                  <th scope="col" className="text-start font-medium px-2 py-2 w-20">المنتجات</th>
                  <th scope="col" className="text-start font-medium px-2 py-2 w-28">الوسيط</th>
                  <th scope="col" className="text-start font-medium px-2 py-2">المقارنة</th>
                </tr>
              </thead>
              <tbody>
                {data.categoryStats.map((c) => {
                  const pct = Math.max(2, Math.round((c.medianFils / maxMedian) * 100))
                  return (
                    <tr key={c.category} className="border-t border-border/40">
                      <td className="px-2 py-2.5">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="w-8 h-8 rounded-lg glass-thin grid place-items-center shrink-0 text-primary">
                            <CategoryIcon category={c.category} size={15} />
                          </span>
                          <span className="truncate font-medium">{c.nameAr}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{formatNumberAr(c.count, arabicNumerals)}</td>
                      <td className="px-2 py-2.5 font-bold tabular-nums">{formatBHD(c.medianFils, { arabicNumerals })}</td>
                      <td className="px-2 py-2.5">
                        <div
                          role="img"
                          aria-label={`الوسيط ${formatBHD(c.medianFils)} أي ${formatNumberAr(pct, arabicNumerals)}٪ من أعلى وسيط بين الفئات`}
                          className="h-2.5 min-w-16 rounded-full bg-secondary overflow-hidden"
                        >
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--primary)' }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </section>

      {/* open data */}
      <section aria-label="البيانات المفتوحة">
        <SectionTitle>البيانات المفتوحة</SectionTitle>
        <GlassCard className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center shrink-0 text-primary">
              <Download size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              قاعدة البيانات كاملة (المنتجات والأسعار والمتاجر) متاحة للتنزيل بصيغة JSON —
              <span className="font-semibold text-foreground"> البيانات مفتوحة للاستخدام مع الإسناد</span>
              (بترخيص من نوع ODbL: انسب المصدر ولا تضع قيوداً على المشتقات).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GlassButton variant="primary" onClick={() => window.open('/api/dump', '_blank')}>
              <Download size={15} strokeWidth={1.75} aria-hidden /> تنزيل JSON
            </GlassButton>
            <GlassButton onClick={copyDumpLink}>
              {copied ? <Check size={15} strokeWidth={1.75} aria-hidden /> : <Link2 size={15} strokeWidth={1.75} aria-hidden />}
              {copied ? 'تم نسخ الرابط' : 'انسخ رابط البيانات'}
            </GlassButton>
          </div>
        </GlassCard>
      </section>

      {/* methodology note */}
      <section>
        <div className="glass-thin rounded-2xl p-4 text-sm text-muted-foreground leading-relaxed flex gap-2 items-start" role="note">
          <Info size={16} strokeWidth={1.75} className="text-primary shrink-0 mt-0.5" aria-hidden />
          <p>
            الأسعار محسوبة من أرخص منتج متاح لكل احتياج في كل متجر بتاريخ اللقطة
            {meta ? <> — لقطة {formatDateAr(meta.generatedAt)}</> : null}.
            المؤشر إصدار <span dir="ltr" className="tabular-nums">{data.version}</span> بعملة الدينار البحريني.
            أسعار تقديرية؛ تحقق منها في المتجر قبل الشراء.
          </p>
        </div>
        <div className="flex justify-center mt-4">
          <GlassButton size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={13} strokeWidth={1.75} aria-hidden /> أعد حساب المؤشر
          </GlassButton>
        </div>
      </section>
    </div>
  )
}
