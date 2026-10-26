'use client'
/**
 * Spending tracker (spec 7.4): planned-vs-actual summary, monthly log with
 * per-entry delete, envelope burn-down, money-leak ranking, class distribution
 * and CSV/JSON export — all client-side from the local spend log.
 */
import { useMemo, useState } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { formatBHD, formatNumberAr, formatPct } from '@/lib/money'
import { GlassCard, GlassButton, GlassRow, Pill, StatTile, EmptyState, SectionTitle } from '@/components/glass/glass'
import { NEEDS_MAP } from '@/lib/engine'
import type { SpendLogEntry } from '@/lib/engine/types'
import { Wallet, TrendingUp, TrendingDown, FileDown, FileJson, Trash2, BarChart3, Receipt, ShoppingCart, Tags } from 'lucide-react'

const CLASS_LABEL: Record<string, string> = {
  mandatory: 'بنود ثابتة (عادات/رضّع)',
  essential: 'الأساسيات',
  regular: 'الاعتيادية',
  comfort: 'الرفاهية',
  treat: 'التحلية والكماليات',
}
const CLASS_BAR: Record<string, string> = {
  mandatory: 'bg-accent',
  essential: 'bg-primary',
  regular: 'bg-foreground/60',
  comfort: 'bg-amber-500/70',
  treat: 'bg-destructive/70',
}

function monthLabel(ym: string, arabicNumerals: boolean): string {
  try {
    const locale = arabicNumerals ? 'ar-BH' : 'ar-BH-u-nu-latn'
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00`))
  } catch {
    return ym
  }
}

function dateShortAr(dateISO: string, arabicNumerals: boolean): string {
  try {
    const locale = arabicNumerals ? 'ar-BH' : 'ar-BH-u-nu-latn'
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(dateISO))
  } catch {
    return dateISO.slice(0, 10)
  }
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1500)
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function SpendingView() {
  const store = useApp()
  const spendLog = store.spendLog
  const plan = store.plan
  const arabicNumerals = store.settings.arabicNumerals
  const [confirmClear, setConfirmClear] = useState(false)

  const removeEntry = (id: string) => {
    useApp.setState((s) => ({ spendLog: s.spendLog.filter((e) => e.id !== id) }))
  }

  // ---------- summary ----------
  const totalPlanned = spendLog.reduce((s, e) => s + e.plannedFils, 0)
  const totalActual = spendLog.reduce((s, e) => s + e.actualFils, 0)
  const diff = totalActual - totalPlanned
  const over = diff > 0

  // ---------- monthly groups ----------
  const months = useMemo(() => {
    const map = new Map<string, SpendLogEntry[]>()
    for (const e of [...spendLog].sort((a, b) => b.dateISO.localeCompare(a.dateISO))) {
      const k = e.dateISO.slice(0, 7)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [spendLog])

  // ---------- envelopes planned vs actual ----------
  const envelopeStats = useMemo(() => {
    if (!plan) return []
    return plan.envelopes.map((env) => {
      const actual = spendLog
        .filter((e) => e.envelopeId === env.envelopeId)
        .reduce((s, e) => s + e.actualFils, 0)
      const planned = env.spentFils
      const pct = planned > 0 ? actual / planned : 0
      return { env, actual, planned, pct }
    })
  }, [plan, spendLog])

  // ---------- money leaks ----------
  const leaks = useMemo(() => (
    [...spendLog]
      .map((e) => ({ e, delta: e.actualFils - e.plannedFils }))
      .filter((x) => x.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5)
  ), [spendLog])
  const maxLeak = leaks.length ? leaks[0]!.delta : 0

  // ---------- class distribution ----------
  const classTotals = useMemo(() => {
    if (!plan) return []
    const byKey = new Map<string, string>()
    for (const it of [...plan.items, ...plan.fixedItems, ...plan.envelopes.flatMap((e) => e.items)]) {
      byKey.set(it.key, it.needId)
    }
    const totals = new Map<string, number>()
    for (const e of spendLog) {
      if (!e.planItemKey) continue
      const needId = byKey.get(e.planItemKey)
      if (!needId) continue
      const base = needId.split('@')[0]!
      const clazz = NEEDS_MAP.get(base)?.clazz ?? 'regular'
      totals.set(clazz, (totals.get(clazz) ?? 0) + e.actualFils)
    }
    return [...totals.entries()]
      .map(([clazz, fils]) => ({ clazz, fils }))
      .sort((a, b) => b.fils - a.fils)
  }, [plan, spendLog])
  const classMax = classTotals.length ? Math.max(...classTotals.map((c) => c.fils)) : 0
  const classSum = classTotals.reduce((s, c) => s + c.fils, 0)

  // ---------- exports ----------
  const exportCsv = () => {
    const lines = ['name,date,planned,actual']
    for (const e of spendLog) {
      lines.push([csvEscape(e.name), e.dateISO, String(e.plannedFils), String(e.actualFils)].join(','))
    }
    download('khassis-spending.csv', `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8')
  }
  const exportJson = () => {
    download('khassis-spending.json', JSON.stringify(spendLog, null, 2), 'application/json')
  }

  // ---------- empty ----------
  if (spendLog.length === 0) {
    return (
      <EmptyState
        icon={<Receipt size={24} strokeWidth={1.75} aria-hidden />}
        title="لا سجلات إنفاق بعد"
        subtitle="افتح قائمة التسوق وعلّم بنودك كمشتراة — يُسجَّل السعر الفعلي تلقائياً هنا مع مقارنته بالمخطط، وتستطيع تعديل السعر لحظة الشراء"
        action={
          <GlassButton variant="primary" size="lg" onClick={() => navigate({ name: 'shopping' })}>
            <ShoppingCart size={18} strokeWidth={1.75} aria-hidden />
            اذهب لقائمة التسوق
          </GlassButton>
        }
      />
    )
  }

  return (
    <div className="space-y-6 pb-8 pt-2">
      {/* summary tiles */}
      <section className="flex flex-wrap gap-2" aria-label="ملخص الإنفاق">
        <StatTile label="إجمالي المخطط" value={formatBHD(totalPlanned, { arabicNumerals })} />
        <StatTile label="إجمالي الفعلي" value={formatBHD(totalActual, { arabicNumerals })} tone={over ? 'danger' : 'primary'} />
        <StatTile
          label={over ? 'الزيادة عن المخطط' : 'الوفر تحت المخطط'}
          value={formatBHD(Math.abs(diff), { arabicNumerals })}
          tone={over ? 'danger' : 'default'}
        />
        <StatTile label="عدد القيود" value={formatNumberAr(spendLog.length, arabicNumerals)} />
      </section>

      {/* trend + actions */}
      <section className="flex flex-wrap items-center gap-2" aria-label="اتجاه الإنفاق وتصدير">
        <Pill tone={over ? 'danger' : 'primary'}>
          {over ? <TrendingUp size={13} strokeWidth={1.75} aria-hidden /> : <TrendingDown size={13} strokeWidth={1.75} aria-hidden />}
          {over
            ? `تصرف أعلى من المخطط بـ ${formatPct(totalPlanned > 0 ? (diff / totalPlanned) * 100 : 0, arabicNumerals)}`
            : `تصرف أقل من المخطط بـ ${formatPct(totalPlanned > 0 ? (-diff / totalPlanned) * 100 : 0, arabicNumerals)}`}
        </Pill>
        <div className="flex-1" />
        <GlassButton size="sm" onClick={exportCsv}>
          <FileDown size={14} strokeWidth={1.75} aria-hidden />
          تصدير CSV
        </GlassButton>
        <GlassButton size="sm" onClick={exportJson}>
          <FileJson size={14} strokeWidth={1.75} aria-hidden />
          تصدير JSON
        </GlassButton>
      </section>

      {/* envelopes planned vs actual */}
      {envelopeStats.length > 0 ? (
        <section aria-label="الأظرف: المخطط مقابل الفعلي">
          <SectionTitle className="flex items-center gap-2">
            <Wallet size={18} strokeWidth={1.75} aria-hidden className="text-accent" />
            الأظرف — المخطط مقابل الفعلي
          </SectionTitle>
          <div className="space-y-3">
            {envelopeStats.map(({ env, actual, planned, pct }) => {
              const tone = pct > 1.05 ? 'danger' : pct > 0.9 ? 'warn' : 'default'
              const barColor = pct > 1.05 ? 'bg-destructive' : pct > 0.9 ? 'bg-amber-500' : 'bg-primary'
              return (
                <GlassCard key={env.envelopeId} className="p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <div className="text-sm font-bold">{env.name}</div>
                    <div className="flex items-center gap-2">
                      {tone !== 'default' ? (
                        <Pill tone={tone}>{pct > 1.05 ? 'تجاوز الظرف' : 'قارب على السقف'}</Pill>
                      ) : null}
                      <span className="text-sm tabular-nums">
                        <span className={pct > 1.05 ? 'text-destructive font-bold' : 'font-bold'}>
                          {formatBHD(actual, { arabicNumerals })}
                        </span>
                        <span className="text-muted-foreground">{` من ${formatBHD(planned, { arabicNumerals, withUnit: false })} د.ب`}</span>
                      </span>
                    </div>
                  </div>
                  <div
                    className="h-2 rounded-full bg-secondary overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(pct * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`نسبة صرف ظرف ${env.name}`}
                  >
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                    {`صُرف ${formatPct(pct * 100, arabicNumerals)} من مخصص الظرف`}
                  </div>
                </GlassCard>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* money leaks */}
      {leaks.length > 0 ? (
        <section aria-label="أين يتسرب المال">
          <SectionTitle className="flex items-center gap-2">
            <BarChart3 size={18} strokeWidth={1.75} aria-hidden className="text-destructive" />
            أين يتسرب المال؟
          </SectionTitle>
          <GlassCard className="p-4 space-y-3">
            {leaks.map(({ e, delta }) => (
              <div key={e.id}>
                <div className="flex items-center justify-between gap-2 text-sm mb-1">
                  <span className="truncate font-medium">{e.name}</span>
                  <span className="tabular-nums text-destructive font-bold shrink-0">
                    {`+${formatBHD(delta, { arabicNumerals })}`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
                  <div
                    className="h-full rounded-full bg-destructive/70"
                    style={{ width: `${maxLeak > 0 ? Math.max(4, (delta / maxLeak) * 100) : 0}%` }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                  {`مخطط ${formatBHD(e.plannedFils, { arabicNumerals, withUnit: false })} → فعلي ${formatBHD(e.actualFils, { arabicNumerals, withUnit: false })} د.ب`}
                </div>
              </div>
            ))}
          </GlassCard>
        </section>
      ) : null}

      {/* class distribution */}
      {classTotals.length > 0 ? (
        <section aria-label="توزيع الإنفاق على الفئات">
          <SectionTitle className="flex items-center gap-2">
            <Tags size={18} strokeWidth={1.75} aria-hidden className="text-primary" />
            توزيع الإنفاق على فئات الاحتياج
          </SectionTitle>
          <GlassCard className="p-4 space-y-3">
            {classTotals.map((c) => (
              <div key={c.clazz}>
                <div className="flex items-center justify-between gap-2 text-sm mb-1">
                  <span className="font-medium">{CLASS_LABEL[c.clazz] ?? c.clazz}</span>
                  <span className="tabular-nums shrink-0">
                    <span className="font-bold">{formatBHD(c.fils, { arabicNumerals })}</span>
                    <span className="text-muted-foreground text-xs">{` · ${formatPct(classSum > 0 ? (c.fils / classSum) * 100 : 0, arabicNumerals)}`}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
                  <div
                    className={`h-full rounded-full ${CLASS_BAR[c.clazz] ?? 'bg-foreground/60'}`}
                    style={{ width: `${classMax > 0 ? Math.max(4, (c.fils / classMax) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              التصنيف يتبع احتياج كل بند في خطتك النشطة؛ القيود غير المرتبطة ببند لا تُحتسب هنا.
            </p>
          </GlassCard>
        </section>
      ) : null}

      {/* monthly log */}
      <section aria-label="سجل الإنفاق شهرياً">
        <SectionTitle>السجل الشهري</SectionTitle>
        <div className="space-y-4">
          {months.map(([ym, entries]) => {
            const mPlanned = entries.reduce((s, e) => s + e.plannedFils, 0)
            const mActual = entries.reduce((s, e) => s + e.actualFils, 0)
            const mOver = mActual > mPlanned
            return (
              <GlassCard key={ym} className="p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3 pb-2 border-b border-border/60">
                  <div className="font-bold text-sm">{monthLabel(ym, arabicNumerals)}</div>
                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <Pill tone={mOver ? 'danger' : 'primary'}>{formatNumberAr(entries.length, arabicNumerals)} قيد</Pill>
                    <span className={mOver ? 'text-destructive font-bold' : 'font-bold'}>{formatBHD(mActual, { arabicNumerals })}</span>
                    <span className="text-muted-foreground">{`مقابل ${formatBHD(mPlanned, { arabicNumerals, withUnit: false })} د.ب`}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {entries.map((e) => {
                    const d = e.actualFils - e.plannedFils
                    return (
                      <GlassRow key={e.id} className="flex items-center gap-2 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{e.name}</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">
                            {dateShortAr(e.dateISO, arabicNumerals)}
                            {` · مخطط ${formatBHD(e.plannedFils, { arabicNumerals, withUnit: false })} د.ب`}
                          </div>
                        </div>
                        <div className="text-end shrink-0 tabular-nums">
                          <div className={`text-sm font-bold ${d > 0 ? 'text-destructive' : ''}`}>
                            {formatBHD(e.actualFils, { arabicNumerals })}
                          </div>
                          {d !== 0 ? (
                            <div className={`text-[11px] ${d > 0 ? 'text-destructive' : 'text-primary'}`}>
                              {d > 0 ? '+' : '−'}{formatBHD(Math.abs(d), { arabicNumerals })}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeEntry(e.id)}
                          aria-label={`حذف قيد ${e.name}`}
                          className="shrink-0 w-11 h-11 rounded-xl glass-thin hover:bg-destructive/15 hover:text-destructive grid place-items-center transition-colors"
                        >
                          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </GlassRow>
                    )
                  })}
                </div>
              </GlassCard>
            )
          })}
        </div>
      </section>

      {/* danger zone */}
      <section aria-label="حذف السجل" className="flex justify-end">
        {confirmClear ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">حذف كل قيود الإنفاق نهائياً؟</span>
            <GlassButton
              variant="danger"
              size="sm"
              onClick={() => { store.clearSpend(); setConfirmClear(false) }}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden />
              نعم، احذف الكل
            </GlassButton>
            <GlassButton size="sm" onClick={() => setConfirmClear(false)}>تراجع</GlassButton>
          </div>
        ) : (
          <GlassButton size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
            حذف كل السجل
          </GlassButton>
        )}
      </section>
    </div>
  )
}
