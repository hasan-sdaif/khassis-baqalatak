'use client'
/**
 * Community (spec 7.9): shared-plan gallery + shared-plan detail (fork to your
 * own plan), share-your-plan flow, and the public contribution queue with
 * voting. No accounts — an anonymous local user key signs votes.
 */
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ComponentType } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import {
  fetchSharedPlans, fetchSharedPlan, sharePlan, generatePlanApi,
  fetchContributions, voteContribution, submitContribution,
  type SharedPlanListItem,
} from '@/lib/api-client'
import { formatBHD, formatNumberAr, formatDateAr, parseBHDToFils } from '@/lib/money'
import { membersLabel } from '@/lib/i18n'
import { NEEDS_MAP } from '@/lib/engine'
import {
  GlassCard, GlassRow, GlassButton, Pill, StatTile, EmptyState, Spinner,
  SkeletonRows, SectionTitle,
} from '@/components/glass/glass'
import {
  Users, Heart, Eye, Share2, Copy, Check, ArrowLeft, Sparkles, Lock, Wheat,
  Package, Coffee, Candy, Wallet, ThumbsUp, ThumbsDown, Send, Info,
} from 'lucide-react'
import type { Budget, BudgetEnvelope, Household, LockedChoice, PlanItem, PlanMode, PlanResult } from '@/lib/engine/types'

// GlassButton accepts HTMLAttributes only; widen it with native button attrs
// (disabled/type) for the async action buttons in this view.
const ActionButton = GlassButton as unknown as ComponentType<
  ComponentProps<typeof GlassButton> & ButtonHTMLAttributes<HTMLButtonElement>
>

// ---------------------------------------------------------------- helpers

const CLASS_ORDER = ['mandatory', 'essential', 'regular', 'comfort', 'treat']
const CLASS_LABEL: Record<string, string> = {
  mandatory: 'بنود ثابتة (عادات/رضّع)',
  essential: 'الأساسيات',
  regular: 'الاعتيادية',
  comfort: 'الرفاهية',
  treat: 'التحلية والكماليات',
}
const CLASS_ICON: Record<string, typeof Package> = {
  mandatory: Lock, essential: Wheat, regular: Package, comfort: Coffee, treat: Candy,
}
const MODE_LABEL: Record<string, string> = {
  economy: 'اقتصادية', balanced: 'متوازنة', comfortable: 'مريحة',
}
const KIND_LABEL: Record<string, string> = {
  'price-update': 'تحديث سعر',
  'name-fix': 'تصحيح اسم',
  'size-fix': 'تصحيح حجم',
  'category-fix': 'تصحيح تصنيف',
  'new-product': 'منتج جديد',
  availability: 'إبلاغ عن توفر',
  barcode: 'باركود',
  generic: 'ملاحظة عامة',
}

/** need class via NEEDS_MAP (base id before '@') */
function classOf(needId: string): string {
  const base = needId.split('@')[0] ?? needId
  return NEEDS_MAP.get(base)?.clazz ?? 'regular'
}

function planAuthor(p: { familyName?: string | null; authorName?: string | null }): string {
  if (p.familyName) return `أسرة ${p.familyName}`
  if (p.authorName) return p.authorName
  return 'مجهول'
}

/** readable one-line summary of a contribution payload */
function contribSummary(kind: string, payload: Record<string, unknown>): string {
  const g = (k: string): string | null => (payload[k] == null || payload[k] === '' ? null : String(payload[k]))
  const note = g('note')
  switch (kind) {
    case 'price-update': {
      const fils = Number(payload.fils ?? payload.priceFils ?? NaN)
      const price = Number.isFinite(fils) && fils > 0 ? `السعر المقترح: ${formatBHD(fils)}` : null
      return [price, note].filter(Boolean).join(' — ') || 'تحديث سعر منتج'
    }
    case 'name-fix':
      return [g('nameAr') ?? g('name'), note].filter(Boolean).join(' — ') || 'تصحيح اسم منتج'
    case 'new-product':
      return [[g('nameAr') ?? g('name'), g('category')].filter(Boolean).join(' — '), note].filter(Boolean).join(' — ') || 'إضافة منتج جديد'
    default:
      return note ?? KIND_LABEL[kind] ?? 'مساهمة'
  }
}

interface SharedPlanDetail {
  id: string
  slug: string
  title: string
  familyName?: string | null
  authorName?: string | null
  likes: number
  forks: number
  createdAt: string
  stats: { costFils?: number; items?: number; members?: number; mode?: string; coverage?: number; wastePct?: number }
  input: {
    household: Household
    budget: Budget
    envelopes?: BudgetEnvelope[]
    mode?: PlanMode
    season?: string
    storeMode?: string
    availableStores?: string[]
    locks?: LockedChoice[]
  }
  plan?: PlanResult
}

interface ContributionItem {
  id: string
  kind: string
  productId?: string
  payload: Record<string, unknown>
  votes: number
  createdAt: string
}

/** fire-and-forget like ping; server endpoint may not exist yet — 404 is fine */
function pingLike(slug: string): void {
  void fetch(`/api/plans/${encodeURIComponent(slug)}/like`, { method: 'POST' }).catch(() => {})
}

// ---------------------------------------------------------------- entry

export function CommunityView({ slug }: { slug?: string }) {
  if (slug) return <SharedPlanDetail key={slug} slug={slug} />
  return <CommunityGallery />
}

// ---------------------------------------------------------------- detail

function SharedPlanDetail({ slug }: { slug: string }) {
  const lang = useApp((s) => s.settings.lang)
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const favorites = useApp((s) => s.favoriteSharedPlans)
  const toggleFavoriteShared = useApp((s) => s.toggleFavoriteShared)

  const [res, setRes] = useState<{ key: string; detail: SharedPlanDetail | null; error: string | null } | null>(null)
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSharedPlan(slug)
      .then((r) => { if (!cancelled) setRes({ key: slug, detail: r as SharedPlanDetail, error: null }) })
      .catch(() => { if (!cancelled) setRes({ key: slug, detail: null, error: 'تعذر تحميل هذه الخطة — ربما حُذفت أو الرابط غير صحيح.' }) })
    return () => { cancelled = true }
  }, [slug])

  // derived load state (no synchronous setState needed in the effect body)
  const loading = !res || res.key !== slug
  const detail = res && res.key === slug ? res.detail : null
  const error = res && res.key === slug ? res.error : null

  const liked = favorites.includes(slug)
  const likes = (detail?.likes ?? 0) + (liked ? 1 : 0)

  const toggleLike = () => {
    toggleFavoriteShared(slug)
    pingLike(slug)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/#/community/${slug}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const useIt = async () => {
    if (!detail) return
    setForking(true)
    setForkError(null)
    try {
      const { plan } = await generatePlanApi({
        household: detail.input.household,
        budget: detail.input.budget,
        mode: detail.input.mode ?? 'balanced',
        season: detail.input.season ?? 'normal',
        storeMode: detail.input.storeMode ?? 'median',
        availableStores: detail.input.availableStores ?? [],
        locks: detail.input.locks ?? [],
        envelopes: detail.input.envelopes ?? [],
      })
      const store = useApp.getState()
      store.setHousehold(detail.input.household)
      store.setBudget(detail.input.budget)
      store.setEnvelopes(detail.input.envelopes ?? [])
      store.setPlan(plan)
      store.setPlanMode(detail.input.mode ?? 'balanced')
      navigate({ name: 'plan' })
    } catch (e) {
      setForkError(String((e as Error).message ?? e))
    } finally {
      setForking(false)
    }
  }

  const grouped = useMemo(() => {
    if (!detail?.plan) return [] as [string, PlanItem[]][]
    const all = [...detail.plan.fixedItems, ...detail.plan.items]
    const groups = new Map<string, PlanItem[]>()
    for (const it of all) {
      const cls = classOf(it.needId)
      if (!groups.has(cls)) groups.set(cls, [])
      groups.get(cls)!.push(it)
    }
    return [...groups.entries()].sort((a, b) => CLASS_ORDER.indexOf(a[0]) - CLASS_ORDER.indexOf(b[0]))
  }, [detail])

  const top5 = useMemo(() => {
    if (!detail?.plan) return [] as PlanItem[]
    return [...detail.plan.items, ...detail.plan.fixedItems]
      .sort((a, b) => b.costFils - a.costFils)
      .slice(0, 5)
  }, [detail])

  if (loading) {
    return (
      <div className="space-y-6 pt-4 pb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="text-primary" /> نحمّل الخطة المشتركة…
        </div>
        <SkeletonRows rows={6} />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <EmptyState
        icon={<Users size={24} strokeWidth={1.75} aria-hidden />}
        title="لم نجد هذه الخطة"
        subtitle={error ?? 'ربما حُذفت أو الرابط غير صحيح.'}
        action={<GlassButton variant="primary" onClick={() => navigate({ name: 'community' })}>تصفّح خطط المجتمع</GlassButton>}
      />
    )
  }

  const stats = detail.stats ?? {}
  const cost = stats.costFils ?? detail.plan?.totals.costFils ?? 0
  const coverage = stats.coverage ?? detail.plan?.totals.coverageEssentials ?? 0
  const waste = stats.wastePct ?? detail.plan?.totals.wastePct ?? 0
  const members = stats.members ?? detail.input.household?.members?.length ?? 0
  const itemsCount = stats.items
    ?? ((detail.plan?.items.length ?? 0) + (detail.plan?.fixedItems.length ?? 0) + (detail.plan?.envelopes.length ?? 0))

  return (
    <div className="space-y-6 pt-2 pb-8">
      {/* header */}
      <section className="space-y-3">
        <GlassButton size="sm" onClick={() => navigate({ name: 'community' })}>
          <ArrowLeft size={14} strokeWidth={1.75} className="flip-x" aria-hidden /> رجوع إلى المجتمع
        </GlassButton>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Pill tone="primary" className="mb-2"><Users size={13} strokeWidth={1.75} aria-hidden /> خطة مشاركة</Pill>
            <h1 className="text-2xl font-extrabold tracking-tight break-words">{detail.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {planAuthor(detail)} · {formatDateAr(detail.createdAt)}
              {detail.forks > 0 ? <> · استخدمها {formatNumberAr(detail.forks, arabicNumerals)} شخصاً</> : null}
            </p>
          </div>
          <button
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? 'إلغاء الإعجاب' : 'أعجبتني'}
            className={`min-h-11 px-4 rounded-xl flex items-center gap-2 font-semibold text-sm transition-all active:scale-[0.98] ${liked ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60'}`}
          >
            <Heart size={16} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} aria-hidden />
            <span className="tabular-nums">{formatNumberAr(likes, arabicNumerals)}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 no-print">
          <ActionButton variant="primary" onClick={useIt} disabled={forking}>
            {forking ? <Spinner className="w-4 h-4" /> : <Sparkles size={16} strokeWidth={1.75} aria-hidden />}
            استخدم هذه الخطة لنفسك
          </ActionButton>
          <GlassButton onClick={copyLink}>
            {copied ? <Check size={16} strokeWidth={1.75} aria-hidden /> : <Copy size={16} strokeWidth={1.75} aria-hidden />}
            {copied ? 'تم نسخ الرابط' : 'انسخ الرابط'}
          </GlassButton>
        </div>
        {forkError ? (
          <div className="glass-thin rounded-xl p-3 text-sm text-destructive" role="alert">
            تعذر توليد الخطة على بيانات هذه الأسرة: {forkError}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2" aria-live="polite">
          <StatTile label="التكلفة الشهرية" value={formatBHD(cost, { arabicNumerals })} tone="primary" />
          <StatTile label="البنود" value={formatNumberAr(itemsCount, arabicNumerals)} />
          <StatTile label="الأسرة" value={membersLabel(members, lang)} />
          <StatTile label="النمط" value={MODE_LABEL[stats.mode ?? detail.input.mode ?? 'balanced'] ?? 'متوازنة'} />
          <StatTile label="تغطية الأساسيات" value={`${formatNumberAr(Math.round(coverage * 100), arabicNumerals)}٪`} tone={coverage < 0.9 ? 'danger' : 'default'} />
          <StatTile label="الهدر المتوقع" value={`${formatNumberAr(waste, arabicNumerals)}٪`} />
        </div>
      </section>

      {/* items grouped: essentials first */}
      <section aria-label="بنود الخطة">
        <SectionTitle>بنود الخطة</SectionTitle>
        <div className="space-y-4">
          {grouped.map(([cls, list]) => {
            const Icon = CLASS_ICON[cls] ?? Package
            const sum = list.reduce((s, it) => s + it.costFils, 0)
            return (
              <div key={cls}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <Icon size={15} strokeWidth={1.75} className="text-primary" aria-hidden />
                    {CLASS_LABEL[cls] ?? cls}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatNumberAr(list.length, arabicNumerals)} بند · {formatBHD(sum, { arabicNumerals })}
                  </div>
                </div>
                <div className="space-y-2">
                  {list.map((it) => (
                    <GlassRow key={it.key} className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg glass-ultrathin grid place-items-center shrink-0 text-primary">
                        <Icon size={16} strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {it.productName}
                          {it.brand ? <span className="text-muted-foreground font-normal"> — {it.brand}</span> : null}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          × {formatNumberAr(it.packQty, arabicNumerals)} {it.sizeText ?? ''}
                        </div>
                      </div>
                      <div className="text-sm font-bold tabular-nums">{formatBHD(it.costFils, { arabicNumerals })}</div>
                    </GlassRow>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* envelopes */}
      {(detail.plan?.envelopes.length ?? 0) > 0 ? (
        <section aria-label="أظرف الخطة">
          <SectionTitle>الأظرف العامة</SectionTitle>
          <div className="space-y-2">
            {detail.plan!.envelopes.map((e) => (
              <GlassRow key={e.envelopeId} className="flex items-center gap-3 border-accent/30">
                <span className="w-9 h-9 rounded-lg bg-accent/15 grid place-items-center shrink-0 text-accent">
                  <Wallet size={16} strokeWidth={1.75} aria-hidden />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{e.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatNumberAr(e.items.length, arabicNumerals)} أصناف متنوعة
                    {e.explanation[0] ? ` — ${e.explanation[0]}` : ''}
                  </div>
                </div>
                <div className="text-sm font-bold tabular-nums text-accent">{formatBHD(e.spentFils, { arabicNumerals })}</div>
              </GlassRow>
            ))}
          </div>
        </section>
      ) : null}

      {/* reasons for top 5 */}
      <section aria-label="أسباب الاختيار">
        <SectionTitle>لماذا اختارها المحرك؟ — أعلى {formatNumberAr(5, arabicNumerals)} بنود</SectionTitle>
        <div className="space-y-2">
          {top5.map((it) => (
            <div key={it.key} className="glass-row rounded-xl p-3">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className="text-sm font-semibold truncate">{it.productName}</div>
                <div className="text-xs text-muted-foreground tabular-nums shrink-0">{formatBHD(it.costFils, { arabicNumerals })}</div>
              </div>
              <ul className="space-y-1">
                {it.reasons.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
                    <span className="w-1 h-1 rounded-full bg-primary/60 mt-1.5 shrink-0" aria-hidden />
                    <span>{r.ar}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- gallery

function CommunityGallery() {
  const lang = useApp((s) => s.settings.lang)
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const favorites = useApp((s) => s.favoriteSharedPlans)
  const toggleFavoriteShared = useApp((s) => s.toggleFavoriteShared)

  const [sort, setSort] = useState<'recent' | 'likes'>('recent')
  const [reloadKey, setReloadKey] = useState(0)
  const [res, setRes] = useState<
    { key: string; items: SharedPlanListItem[]; error: null } | { key: string; items: null; error: string } | null
  >(null)
  const key = `${sort}:${reloadKey}`

  useEffect(() => {
    let cancelled = false
    fetchSharedPlans(sort)
      .then((r) => { if (!cancelled) setRes({ key, items: r.items, error: null }) })
      .catch(() => { if (!cancelled) setRes({ key, items: null, error: 'تعذر تحميل خطط المجتمع — جرّب مرة أخرى.' }) })
    return () => { cancelled = true }
  }, [sort, key])

  // derived load state — no synchronous setState in the effect body
  const loading = !res || res.key !== key
  const items = res && res.key === key ? res.items : null
  const error = res && res.key === key ? res.error : null

  return (
    <div className="space-y-8 pt-2 pb-8">
      <section>
        <SectionTitle>خطط مشاركة من المجتمع</SectionTitle>
        <div className="flex gap-2 mb-4" role="tablist" aria-label="ترتيب الخطط">
          {([['recent', 'الأحدث'], ['likes', 'الأكثر إعجاباً']] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={sort === id}
              onClick={() => setSort(id)}
              className={`min-h-11 px-5 rounded-xl text-sm font-semibold transition-all ${sort === id ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'glass-thin hover:bg-secondary/60'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? <SkeletonRows rows={4} /> : error ? (
          <EmptyState
            icon={<Users size={24} strokeWidth={1.75} aria-hidden />}
            title="تعذر التحميل"
            subtitle={error}
            action={<GlassButton variant="primary" onClick={() => setReloadKey((k) => k + 1)}>أعد المحاولة</GlassButton>}
          />
        ) : !items || items.length === 0 ? (
          <EmptyState
            icon={<Share2 size={24} strokeWidth={1.75} aria-hidden />}
            title="لا خطط مشاركة بعد"
            subtitle="كن أول من يشارك خطته أدناه — المشاركة اختيارية ومجهولة الهوية إن شئت."
          />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((p) => {
              const liked = favorites.includes(p.slug)
              const s = p.stats ?? {}
              return (
                <GlassCard key={p.slug} className="p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="font-bold truncate" title={p.title}>{p.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {planAuthor(p)} · {formatDateAr(p.createdAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => { toggleFavoriteShared(p.slug); pingLike(p.slug) }}
                      aria-pressed={liked}
                      aria-label={liked ? 'إلغاء الإعجاب' : 'أعجبتني'}
                      className={`min-h-11 min-w-11 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 shrink-0 transition-all active:scale-[0.98] ${liked ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60'}`}
                    >
                      <Heart size={15} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} aria-hidden />
                      <span className="text-[10px] font-semibold tabular-nums">{formatNumberAr(p.likes + (liked ? 1 : 0), arabicNumerals)}</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {s.costFils != null ? <Pill tone="primary">{formatBHD(s.costFils, { arabicNumerals })}</Pill> : null}
                    {s.members != null ? <Pill>{membersLabel(s.members, lang)}</Pill> : null}
                    {s.mode ? <Pill>{MODE_LABEL[s.mode] ?? s.mode}</Pill> : null}
                  </div>
                  <GlassButton size="sm" className="mt-auto w-full" onClick={() => navigate({ name: 'community', slug: p.slug })}>
                    <Eye size={14} strokeWidth={1.75} aria-hidden /> افتح
                  </GlassButton>
                </GlassCard>
              )
            })}
          </div>
        )}
      </section>

      <ShareYourPlan />
      <ContributionsSection />
    </div>
  )
}

// ---------------------------------------------------------------- share

function ShareYourPlan() {
  const plan = useApp((s) => s.plan)
  const household = useApp((s) => s.household)
  const budget = useApp((s) => s.budget)
  const envelopes = useApp((s) => s.envelopes)
  const locks = useApp((s) => s.locks)
  const planMode = useApp((s) => s.planMode)
  const planNames = useApp((s) => s.planNames)
  const defaultNames = useApp((s) => s.settings.defaultNames)

  const [title, setTitle] = useState(planNames.reportName || 'خطة بقالة')
  const [anonymous, setAnonymous] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [sharedSlug, setSharedSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (navTimer.current) clearTimeout(navTimer.current) }, [])

  if (!plan || !household || !budget) {
    return (
      <section>
        <SectionTitle>شارك خطتك</SectionTitle>
        <EmptyState
          icon={<Sparkles size={24} strokeWidth={1.75} aria-hidden />}
          title="لا خطة لديك بعد"
          subtitle="ولّد خطتك أولاً (أقل من دقيقتين) ثم شاركها مع المجتمع بضغطة واحدة."
          action={<GlassButton variant="primary" onClick={() => navigate({ name: 'start' })}>ابدأ معالج الخطة</GlassButton>}
        />
      </section>
    )
  }

  const doShare = async () => {
    setSharing(true)
    setError(null)
    try {
      const { slug } = await sharePlan({
        title: title.trim() || 'خطة بقالة',
        familyName: anonymous ? undefined : (planNames.familyName || household.familyName || defaultNames.familyName || undefined),
        authorName: anonymous ? undefined : (defaultNames.preparerName || undefined),
        household,
        budget,
        envelopes,
        mode: planMode,
        season: 'normal',
        storeMode: 'median',
        availableStores: [],
        locks,
        isAnonymous: anonymous,
      })
      setSharedSlug(slug)
      // let the user see the success box briefly, then open the shared plan
      navTimer.current = setTimeout(() => navigate({ name: 'community', slug }), 2400)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setSharing(false)
    }
  }

  const copyLink = async () => {
    if (!sharedSlug) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/#/community/${sharedSlug}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const shareUrl = sharedSlug ? `${window.location.origin}/#/community/${sharedSlug}` : null

  return (
    <section aria-label="شارك خطتك">
      <SectionTitle>شارك خطتك</SectionTitle>
      <GlassCard className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          تُنشر مدخلات خطتك (تركيبة الأسرة والميزانية والأظرف) ليعاد توليد النتائج على الخادم —
          بلا أسماء ولا مفاتيح هوية. الأسرة التي تشبهك قد توفر الكثير بتجربتك.
        </p>
        <div>
          <label htmlFor="share-title" className="block text-sm font-semibold mb-2">عنوان الخطة</label>
          <input
            id="share-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="w-full min-h-11 rounded-xl glass-thin bg-transparent px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="مثال: أسرة من ٥ أفراد برضيع — ٢٢٠ د.ب"
          />
        </div>
        <button
          onClick={() => setAnonymous((v) => !v)}
          aria-pressed={anonymous}
          className={`min-h-11 px-4 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${anonymous ? 'bg-primary/15 text-primary' : 'glass-thin'}`}
        >
          {anonymous ? <Check size={15} strokeWidth={1.75} aria-hidden /> : null}
          مشاركة مجهولة الهوية (بلا اسم أسرة ولا معدّ تقرير)
        </button>

        {shareUrl ? (
          <div className="glass-thin rounded-xl p-4 space-y-3" role="status">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Check size={16} strokeWidth={1.75} aria-hidden /> تمت المشاركة بنجاح
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate" dir="ltr">{shareUrl}</span>
              <GlassButton size="sm" onClick={copyLink}>
                {copied ? <Check size={14} strokeWidth={1.75} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />}
                {copied ? 'تم' : 'انسخ'}
              </GlassButton>
            </div>
            <GlassButton variant="primary" size="sm" onClick={() => navigate({ name: 'community', slug: sharedSlug ?? undefined })}>
              <Eye size={14} strokeWidth={1.75} aria-hidden /> افتح صفحة الخطة الآن
            </GlassButton>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="primary" onClick={doShare} disabled={sharing || !title.trim()}>
              {sharing ? <Spinner className="w-4 h-4" /> : <Share2 size={16} strokeWidth={1.75} aria-hidden />}
              انشر خطتي في المجتمع
            </ActionButton>
          </div>
        )}
        {error ? <div className="text-sm text-destructive" role="alert">تعذر النشر: {error}</div> : null}
      </GlassCard>
    </section>
  )
}

// ---------------------------------------------------------------- contributions

const CONTRIB_KINDS: { id: string; label: string }[] = [
  { id: 'price-update', label: 'تحديث سعر' },
  { id: 'name-fix', label: 'تصحيح اسم' },
  { id: 'new-product', label: 'منتج جديد' },
  { id: 'availability', label: 'إبلاغ عن توفر' },
]

function ContributionsSection() {
  const userKey = useApp((s) => s.settings.userKey)
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)

  const [reloadKey, setReloadKey] = useState(0)
  const [res, setRes] = useState<{ key: number; items: ContributionItem[] } | null>(null)
  const [myVotes, setMyVotes] = useState<Record<string, 1 | -1>>({})
  const [voteDelta, setVoteDelta] = useState<Record<string, number>>({})
  const [kind, setKind] = useState('price-update')
  const [note, setNote] = useState('')
  const [productId, setProductId] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchContributions('pending')
      .then((r) => { if (!cancelled) setRes({ key: reloadKey, items: r.items }) })
      .catch(() => { if (!cancelled) setRes({ key: reloadKey, items: [] }) })
    return () => { cancelled = true }
  }, [reloadKey])

  // derived load state — no synchronous setState in the effect body
  const loading = !res || res.key !== reloadKey
  const items = res && res.key === reloadKey ? res.items : null

  const vote = async (id: string, value: 1 | -1) => {
    const prev = myVotes[id]
    if (prev === value) return
    const delta = prev ? value * 2 : value
    setMyVotes((m) => ({ ...m, [id]: value }))
    setVoteDelta((d) => ({ ...d, [id]: (d[id] ?? 0) + delta }))
    try {
      await voteContribution(id, userKey, value)
    } catch {
      // revert optimistic state on failure
      setMyVotes((m) => {
        const n = { ...m }
        if (prev) n[id] = prev
        else delete n[id]
        return n
      })
      setVoteDelta((d) => ({ ...d, [id]: (d[id] ?? 0) - delta }))
    }
  }

  const submit = async () => {
    if (!note.trim() && !price.trim() && kind !== 'availability') {
      setError('اكتب ملاحظة أو سعراً قبل الإرسال.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await submitContribution({
        kind,
        productId: productId.trim() || undefined,
        payload: {
          note: note.trim() || undefined,
          ...(kind === 'price-update' && price.trim() ? { fils: parseBHDToFils(price.trim()) } : {}),
        },
        submittedBy: userKey,
      })
      setSubmitted(true)
      setNote('')
      setPrice('')
      setProductId('')
      setReloadKey((k) => k + 1)
      setTimeout(() => setSubmitted(false), 4000)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setSubmitting(false)
    }
  }

  const visible = (items ?? []).slice(0, 12)

  return (
    <section aria-label="مساهمات المجتمع">
      <SectionTitle>مساهمات تحسّن الكتالوج</SectionTitle>

      <GlassCard className="p-4 mb-4">
        <div className="flex gap-2 items-start text-sm text-muted-foreground leading-relaxed">
          <Info size={16} strokeWidth={1.75} className="text-primary shrink-0 mt-0.5" aria-hidden />
          <p>
            كل مساهمة تُرسل إلى قائمة انتظار يراجعها المشرفون قبل اعتمادها في الكتالوج،
            وتصويت المجتمع (أعلى/أدنى) يرتّب أولوية المراجعة. لا حاجة لحساب — مفتاحك المحلي المجهول يوقّع صوتك.
          </p>
        </div>
      </GlassCard>

      {/* queue */}
      {loading ? (
        <SkeletonRows rows={3} />
      ) : visible.length === 0 ? (
        <GlassRow className="text-sm text-muted-foreground text-center py-6">لا مساهمات في الانتظار حالياً — كن أول المساهمين.</GlassRow>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto nice-scroll pl-1">
          {visible.map((c) => {
            const mine = myVotes[c.id]
            return (
              <GlassRow key={c.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone="accent">{KIND_LABEL[c.kind] ?? c.kind}</Pill>
                    {c.productId ? <span className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">{c.productId}</span> : null}
                    <span className="text-[11px] text-muted-foreground">{formatDateAr(c.createdAt)}</span>
                  </div>
                  <div className="text-sm mt-1 leading-relaxed">{contribSummary(c.kind, c.payload)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-sm font-bold tabular-nums w-8 text-center" aria-live="polite">
                    {formatNumberAr(c.votes + (voteDelta[c.id] ?? 0), arabicNumerals)}
                  </span>
                  <button
                    onClick={() => vote(c.id, 1)}
                    aria-pressed={mine === 1}
                    aria-label="صوت موافق"
                    className={`min-h-11 min-w-11 grid place-items-center rounded-xl transition-all active:scale-[0.98] ${mine === 1 ? 'bg-primary/15 text-primary' : 'glass-thin hover:bg-secondary/60'}`}
                  >
                    <ThumbsUp size={15} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button
                    onClick={() => vote(c.id, -1)}
                    aria-pressed={mine === -1}
                    aria-label="صوت غير موافق"
                    className={`min-h-11 min-w-11 grid place-items-center rounded-xl transition-all active:scale-[0.98] ${mine === -1 ? 'bg-destructive/15 text-destructive' : 'glass-thin hover:bg-secondary/60'}`}
                  >
                    <ThumbsDown size={15} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </GlassRow>
            )
          })}
        </div>
      )}

      {/* submit form */}
      <div className="mt-4">
        <h3 className="text-sm font-bold mb-3">أضف مساهمتك</h3>
        <GlassCard className="p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold mb-2">نوع المساهمة</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="نوع المساهمة">
              {CONTRIB_KINDS.map((k) => (
                <button
                  key={k.id}
                  role="radio"
                  aria-checked={kind === k.id}
                  onClick={() => setKind(k.id)}
                  className={`min-h-11 px-4 rounded-xl text-sm font-semibold transition-all ${kind === k.id ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'glass-thin hover:bg-secondary/60'}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {kind === 'price-update' ? (
            <div>
              <label htmlFor="contrib-price" className="block text-sm font-semibold mb-2">السعر الصحيح (د.ب)</label>
              <input
                id="contrib-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder="مثال: 1.250"
                className="w-full min-h-11 rounded-xl glass-thin bg-transparent px-4 text-sm tabular-nums outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          ) : null}

          <div>
            <label htmlFor="contrib-product" className="block text-sm font-semibold mb-2">
              معرّف المنتج <span className="text-muted-foreground font-normal">(اختياري — من صفحة المنتج)</span>
            </label>
            <input
              id="contrib-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              dir="ltr"
              placeholder="p_xxxxx"
              className="w-full min-h-11 rounded-xl glass-thin bg-transparent px-4 text-sm tabular-nums outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>

          <div>
            <label htmlFor="contrib-note" className="block text-sm font-semibold mb-2">ملاحظتك</label>
            <textarea
              id="contrib-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="مثال: الاسم الصحيح «حليب لوز بالفانيليا»، أو المنتج غير متوفر في متجر لولو منذ الأسبوع الماضي"
              className="w-full rounded-xl glass-thin bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)] resize-y"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ActionButton variant="primary" onClick={submit} disabled={submitting}>
              {submitting ? <Spinner className="w-4 h-4" /> : <Send size={15} strokeWidth={1.75} aria-hidden />}
              أرسل للمشرفين
            </ActionButton>
            {submitted ? (
              <span className="text-sm text-primary font-semibold flex items-center gap-1.5" role="status">
                <Check size={15} strokeWidth={1.75} aria-hidden /> وصلت مساهمتك — بانتظار المراجعة
              </span>
            ) : null}
          </div>
          {error ? <div className="text-sm text-destructive" role="alert">{error}</div> : null}
        </GlassCard>
      </div>
    </section>
  )
}
