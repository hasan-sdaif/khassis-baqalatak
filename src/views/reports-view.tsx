'use client'
/**
 * Reports Center (spec 7.19–7.20): 8 report types, printable documents with
 * custom names (7.20), paper size / orientation / ink-saver, public vs
 * detailed versions, section toggles, notes + signature lines, saved reports
 * (localStorage 'khassis-reports') and print / export / share actions.
 *
 * The document (#report-doc) is print-first: solid white, black text, thin
 * #bbb borders — no glass inside it. The global @media print CSS drops the
 * glass chrome; this view additionally hides the app navigation while
 * printing via body.printing-report (see injected DOC_CSS below).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '@/store/app-store'
import { navigate } from '@/lib/router'
import { fetchCatalogMeta } from '@/lib/api-client'
import {
  formatBHD, formatNumberAr, formatDateAr, hijriDateISO, formatPct, toArabicDigits, unitLabelAr,
} from '@/lib/money'
import { GlassCard, GlassButton, Pill, EmptyState, SectionTitle } from '@/components/glass/glass'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NEEDS_MAP, categoryFallbackNeed, infantInfos } from '@/lib/engine'
import type { InfantInfo } from '@/lib/engine/habits'
import type {
  Household, PantryItem, PlanItem, PlanResult, ReportNames, ReportOptions, SpendLogEntry,
} from '@/lib/engine/types'
import { cn } from '@/lib/utils'
import {
  ArrowLeftRight, Boxes, Braces, Calculator, CalendarDays, Copy, FileDown, FileText, Layers,
  MessageCircle, Printer, Receipt, RotateCcw, Save, ShoppingBasket, StickyNote, Tag, Trash2,
  TrendingUp, TriangleAlert, Wallet,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// local types
// ---------------------------------------------------------------------------

type ReportTypeId =
  | 'full-plan' | 'shopping-list' | 'budget' | 'spending'
  | 'consumption' | 'product-compare' | 'pantry' | 'calculator'

interface SavedReport {
  id: string
  type: ReportTypeId
  names: ReportNames
  options: ReportOptions & { hijriOptional?: boolean; notesText?: string }
  createdAt: string
  planFingerprint: string
}

interface SpendAgg {
  byEnvelope: Map<string, { planned: number; actual: number }>
  planned: number
  actual: number
}

interface PantryRow { item: PantryItem; daysLeft: number | null }

/** one printed page: id for keys, title for TOC, node = content */
interface PageDef { id: string; title: string; node: ReactNode }

/** everything the document builders need */
interface DocCtx {
  reportType: ReportTypeId
  an: boolean
  fmt: (fils: number, withUnit?: boolean) => string
  num: (n: number) => string
  pct: (x: number) => string
  dateAr: (iso: string) => string
  plan: PlanResult
  household: Household | null
  budgetFils: number
  effNames: { reportName: string; familyName: string; preparerName: string; planName: string; showNames: boolean }
  familyLabel: string
  notesText: string
  hijri: boolean
  detailed: boolean
  storeLabel: (storeId: string | null | undefined) => string
  catalogInfo: { version: string; generatedAt: string } | null
  allItems: PlanItem[]
  classSortedItems: PlanItem[]
  classGroups: { clazz: string; count: number; fils: number }[]
  grandTotalFils: number
  reportRef: string
  todayISO: string
  infants: InfantInfo[]
  pantryRows: PantryRow[]
  spendAgg: SpendAgg
  spendByMonth: [string, { planned: number; actual: number }][]
  topOverspend: SpendLogEntry[]
  spendLog: SpendLogEntry[]
  rowsPerPage: number
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const REPORT_TYPES: { id: ReportTypeId; label: string; hint: string; icon: typeof FileText }[] = [
  { id: 'full-plan', label: 'تقرير الخطة الكاملة', hint: 'كل الأقسام: الملخص والبنود والأظرف والرحلات', icon: FileText },
  { id: 'shopping-list', label: 'قائمة التسوق', hint: 'قائمة جاهزة للطباعة حسب الرحلة والمتجر', icon: ShoppingBasket },
  { id: 'budget', label: 'الميزانية والأظرف', hint: 'المخطط مقابل الفعلي لكل ظرف وفئة', icon: Wallet },
  { id: 'spending', label: 'الإنفاق الفعلي', hint: 'المصروف المسجّل وأين تسرّب المال', icon: Receipt },
  { id: 'consumption', label: 'استهلاك الأسرة', hint: 'الطلب المقدّر ومدة كفاية كل بند', icon: TrendingUp },
  { id: 'product-compare', label: 'مقارنة المنتجات', hint: 'أهم 5 بنود بالتكلفة مع بدائلها', icon: ArrowLeftRight },
  { id: 'pantry', label: 'المخزون المنزلي', hint: 'جرد المخزون وتقدير النفاد القريب', icon: Boxes },
  { id: 'calculator', label: 'الحاسبات', hint: 'حفاضات وحليب أطفال وتدخين بالمعادلات', icon: Calculator },
]

const TYPE_LABEL: Record<ReportTypeId, string> = {
  'full-plan': 'الخطة الكاملة',
  'shopping-list': 'قائمة التسوق',
  budget: 'الميزانية والأظرف',
  spending: 'الإنفاق الفعلي',
  consumption: 'استهلاك الأسرة',
  'product-compare': 'مقارنة المنتجات',
  pantry: 'المخزون المنزلي',
  calculator: 'الحاسبات',
}

const SECTION_DEFS: { id: string; label: string }[] = [
  { id: 'cover', label: 'الغلاف' },
  { id: 'summary', label: 'الملخص' },
  { id: 'household', label: 'الأسرة والعادات' },
  { id: 'items', label: 'بنود الخطة' },
  { id: 'envelopes', label: 'الأظرف' },
  { id: 'stores', label: 'المتاجر والرحلات' },
  { id: 'explanations', label: 'الشروحات' },
  { id: 'diagnostics', label: 'التشخيص والتحذيرات' },
  { id: 'methodology', label: 'المنهجية والمصادر' },
  { id: 'notes', label: 'ملاحظات + توقيع' },
]

/** sections relevant to each report type */
const TYPE_SECTIONS: Record<ReportTypeId, string[]> = {
  'full-plan': ['cover', 'summary', 'household', 'items', 'envelopes', 'stores', 'explanations', 'diagnostics', 'methodology', 'notes'],
  'shopping-list': ['cover', 'items', 'stores', 'methodology', 'notes'],
  budget: ['cover', 'summary', 'envelopes', 'diagnostics', 'methodology', 'notes'],
  spending: ['cover', 'summary', 'diagnostics', 'methodology', 'notes'],
  consumption: ['cover', 'household', 'items', 'diagnostics', 'methodology', 'notes'],
  'product-compare': ['cover', 'items', 'methodology', 'notes'],
  pantry: ['cover', 'items', 'diagnostics', 'methodology', 'notes'],
  calculator: ['cover', 'household', 'items', 'methodology', 'notes'],
}

const CLASS_ORDER: string[] = ['mandatory', 'essential', 'regular', 'comfort', 'treat']
const CLASS_LABEL: Record<string, string> = {
  mandatory: 'بنود ثابتة (عادات/رضّع)',
  essential: 'الأساسيات',
  regular: 'الاعتيادية',
  comfort: 'الرفاهية',
  treat: 'التحلية والكماليات',
}
const MODE_LABEL: Record<string, string> = { economy: 'اقتصادية', balanced: 'متوازنة', comfortable: 'مريحة' }
const NUTRITION_LABELS: Record<string, string> = {
  dairy: 'الحليب ومشتقاته', produce: 'الفواكه والخضار', grains: 'الحبوب والنشويات', protein: 'البروتينات', sweets: 'الحلويات',
}
const STORAGE_LABELS: Record<string, string> = { small: 'صغيرة', medium: 'متوسطة', large: 'كبيرة' }

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function needBase(needId: string): string {
  return needId.split('@')[0] ?? needId
}

function needLabel(needId: string): string {
  const base = needBase(needId)
  if (base === 'formula') return `حليب أطفال — مرحلة ${needId.split('@')[1] ?? ''}`
  if (base === 'diapers') return `حفاضات — مقاس ${needId.split('@')[1] ?? ''}`
  return NEEDS_MAP.get(base)?.nameAr ?? categoryFallbackNeed(base)?.nameAr ?? base
}

function needClassOf(needId: string): string {
  return NEEDS_MAP.get(needBase(needId))?.clazz ?? 'regular'
}

function needUnitShort(needId: string): string {
  return unitLabelAr(NEEDS_MAP.get(needBase(needId))?.baseUnit ?? 'pcs')
}

/** humanized quantity in the need's base unit, honoring arabic numerals */
function qtyText(ctx: DocCtx, needId: string, qty: number): string {
  const unit = NEEDS_MAP.get(needBase(needId))?.baseUnit ?? 'pcs'
  if (unit === 'g' && qty >= 1000) return `${ctx.num(Math.round((qty / 1000) * 10) / 10)} كجم`
  if (unit === 'ml' && qty >= 1000) return `${ctx.num(Math.round((qty / 1000) * 10) / 10)} لتر`
  return `${ctx.num(Math.round(qty * 10) / 10)} ${unitLabelAr(unit)}`
}

function habitSummaryLines(h: Household, num: (n: number) => string): string[] {
  const lines: string[] = []
  const hb = h.habits ?? {}
  const coffee = Number(hb['coffee']?.cupsPerDay ?? 0)
  if (coffee > 0) lines.push(`قهوة: ${num(coffee)} فنجان/يوم لكل بالغ`)
  const tea = Number(hb['tea']?.cupsPerDay ?? 0)
  if (tea > 0) lines.push(`شاي: ${num(tea)} كوب/يوم لكل بالغ`)
  const water = Number(hb['water']?.litersPerPersonDay ?? 0)
  if (water > 0) lines.push(`مياه معبأة: ${num(water)} لتر/فرد/يوم`)
  const soda = Number(hb['soft-drinks']?.cansPerWeek ?? 0)
  if (soda > 0) lines.push(`مشروبات غازية: ${num(soda)} عبوة/أسبوع`)
  const smoking = hb['smoking']
  if (smoking?.active === true) {
    const cigs = Number(smoking.cigsPerDay ?? 20)
    lines.push(`تدخين: ${num(cigs)} سيجارة/يوم${smoking.brand ? ` (${String(smoking.brand)})` : ''}`)
  }
  const infants = infantInfos(h)
  const diapersOn = infants.filter((i) => (hb['diapers'] ?? {})[`on_${i.member.id}`] !== false).length
  if (diapersOn > 0) lines.push(`حفاضات: مفعّلة لـ ${num(diapersOn)} من الرضع`)
  const formulaOn = infants.filter((i) => (hb['formula'] ?? {})[`on_${i.member.id}`] !== false).length
  if (formulaOn > 0) lines.push(`حليب أطفال: مفعّل لـ ${num(formulaOn)} من الرضع`)
  return lines
}

function dietaryLine(h: Household): string {
  const parts: string[] = []
  if (h.dietary?.halalOnly) parts.push('حلال فقط')
  if (h.dietary?.sugarFree) parts.push('خالٍ من السكر')
  if (h.dietary?.lowSodium) parts.push('منخفض الصوديوم')
  if (h.dietary?.glutenFree) parts.push('خالٍ من الغلوتين')
  if (h.dietary?.lactoseFree) parts.push('خالٍ من اللاكتوز')
  if (h.dietary?.nutFree) parts.push('خالٍ من المكسرات')
  return parts.length > 0 ? parts.join('، ') : 'لا قيود غذائية'
}

function csvEscape(v: string | number): string {
  const s = String(v).replace(/\s+/g, ' ').trim()
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadBlob(content: string, mime: string, filename: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function safeFileName(name: string, ext: string): string {
  const clean = name.replace(/[\\/:*?"<>|#%&{}$!'@+`=:]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '')
  const d = new Date().toISOString().slice(0, 10)
  return `${clean || 'تقرير'}_${d}.${ext}`
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function pageRuleFor(paper: string, orientation: string): string {
  if (paper === '80mm') return '@page{size:80mm auto;margin:5mm;}'
  const size = paper === 'letter' ? 'letter' : paper
  return `@page{size:${size} ${orientation === 'landscape' ? 'landscape' : 'portrait'};}`
}

/** monochrome basket logo mark (print-safe, green — grayscales in ink-saver) */
function BasketMark({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="شعار خصص بقالتك">
      <path d="M8 18h32l-3.6 20.5a4 4 0 0 1-3.9 3.4H15.5a4 4 0 0 1-4-3.4L8 18Z" stroke="#1e6b4f" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M16.5 18 24 7l7.5 11" stroke="#1e6b4f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 24.5v10M24 24.5v10M30.5 24.5v10" stroke="#1e6b4f" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

/** segmented control button (44px target) */
function SegBtn({ active, onClick, ariaLabel, children }: { active: boolean; onClick: () => void; ariaLabel: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex-1 min-h-11 px-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]',
        active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'glass-thin hover:bg-secondary/60',
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// report document CSS (injected client-side; global print CSS stays untouched)
// ---------------------------------------------------------------------------

const DOC_CSS = `
#report-doc{width:210mm;max-width:100%;font-size:13px;}
#report-doc[data-paper='A5']{width:148mm;font-size:12.5px;}
#report-doc[data-paper='letter']{width:216mm;}
#report-doc[data-paper='80mm']{width:80mm;font-size:11px;padding:14px;}
#report-doc[data-orientation='landscape']{width:297mm;}
#report-doc[data-orientation='landscape'][data-paper='A5']{width:210mm;}
#report-doc[data-orientation='landscape'][data-paper='letter']{width:279mm;}
#report-doc[data-orientation='landscape'][data-paper='80mm']{width:80mm;}
#report-doc[data-paper='80mm'] .rdoc-hide-80{display:none!important;}
#report-doc .rdoc-h2{font-size:16px;font-weight:800;margin:0 0 10px;padding-bottom:4px;border-bottom:2px solid #333;}
#report-doc .rdoc-h3{font-size:13px;font-weight:700;margin:12px 0 6px;}
#report-doc .rdoc-p{font-size:12px;line-height:2;margin:0 0 6px;}
#report-doc .rdoc-muted{color:#555;}
#report-doc .rdoc-table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.7;}
#report-doc .rdoc-table th,#report-doc .rdoc-table td{border:1px solid #bbb;padding:3px 6px;text-align:right;vertical-align:top;}
#report-doc .rdoc-table thead th{background:#f0f0ec;font-weight:700;}
#report-doc .rdoc-table .rdoc-sub td{font-weight:700;background:#f7f7f2;}
#report-doc .rdoc-table .rdoc-grand td{font-weight:800;background:#edede5;border-top:2.5px double #444;}
#report-doc .rdoc-num{font-variant-numeric:tabular-nums;white-space:nowrap;}
#report-doc .rdoc-kv{width:100%;border-collapse:collapse;font-size:12px;}
#report-doc .rdoc-kv th,#report-doc .rdoc-kv td{padding:3px 8px;border-bottom:1px solid #ddd;text-align:right;}
#report-doc .rdoc-kv th{font-weight:700;width:42%;}
#report-doc .rdoc-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid #bbb;margin-top:16px;padding-top:5px;font-size:10px;color:#555;}
#report-doc .rdoc-check{display:inline-block;width:11px;height:11px;border:1.2px solid #444;border-radius:2px;}
#report-doc .rdoc-sig{display:block;min-width:150px;border-bottom:1px solid #333;height:12px;}
#report-doc .rdoc-cover-title{font-size:26px;font-weight:800;line-height:1.45;}
#report-doc .rdoc-bullets{margin:0;padding-inline-start:18px;font-size:12px;line-height:2.1;}
#report-doc .rdoc-bullets li{margin-bottom:2px;}
#report-doc[data-paper='80mm'] .rdoc-table{font-size:10.5px;}
#report-doc[data-paper='80mm'] .rdoc-h2{font-size:14px;}
#report-doc[data-paper='80mm'] .rdoc-cover-title{font-size:17px;}
#report-doc[data-paper='80mm'] .rdoc-footer{font-size:9px;}
#report-doc.ink-saver,#report-doc.ink-saver svg{filter:grayscale(1);}
@media screen{
  #report-doc .print-page+.print-page{margin-top:28px;padding-top:28px;border-top:2px dashed #d9d9d2;}
}
@media print{
  #report-doc{width:auto!important;max-width:none!important;box-shadow:none!important;border-radius:0!important;padding:0!important;font-size:12px;}
  #report-doc[data-paper='80mm']{font-size:11px;}
  #report-doc .print-page{margin:0!important;padding:0!important;border-top:none!important;}
  #report-doc .print-page:last-child{page-break-after:auto;}
  body.printing-report aside[aria-label='التنقل الرئيسي']{display:none!important;}
  body.printing-report .shell>div{margin:0!important;}
  body.printing-report .shell-main{padding:0!important;max-width:none!important;}
}
`

// ---------------------------------------------------------------------------
// document section builders (pure — take DocCtx, return nodes/pages)
// ---------------------------------------------------------------------------

function buildCover(ctx: DocCtx, tocEntries: { title: string; page: number }[]): ReactNode {
  const { plan, effNames: eff } = ctx
  const hij = ctx.hijri ? hijriDateISO(ctx.todayISO) : ''
  const dateLine = ctx.dateAr(ctx.todayISO) + (hij ? ` — ${hij} هـ` : '')
  const catalogDate = ctx.catalogInfo ? ctx.dateAr(ctx.catalogInfo.generatedAt) : ctx.dateAr(plan.generatedAt)
  return (
    <div className="flex flex-col items-center text-center gap-1.5 py-4">
      <BasketMark size={56} />
      <div className="text-lg font-extrabold tracking-tight">خصص بقالتك</div>
      <div className="rdoc-muted text-xs mb-3">مساعد ميزانية البقالة — البحرين</div>
      <h2 className="rdoc-cover-title">{eff.reportName}</h2>
      <div className="text-sm font-semibold mt-1">{ctx.familyLabel}</div>
      {eff.preparerName ? <div className="text-sm">أعدّه: {eff.preparerName}</div> : null}
      {eff.planName ? <div className="text-sm">الخطة: {eff.planName}</div> : null}
      <table className="rdoc-kv mt-5 max-w-[340px]">
        <tbody>
          <tr><th>رقم التقرير</th><td className="rdoc-num" dir="ltr">{ctx.reportRef}</td></tr>
          <tr><th>التاريخ</th><td>{dateLine}</td></tr>
          <tr><th>الفترة</th><td>خطة {ctx.num(plan.horizonDays)} يوماً</td></tr>
          <tr><th>العملة</th><td>دينار بحريني (د.ب)</td></tr>
        </tbody>
      </table>
      <div className="rdoc-muted text-[11px] mt-4 leading-relaxed max-w-[380px]">
        بصمة الخطة: <span dir="ltr">{plan.fingerprint}</span> — المحرك <span dir="ltr">{plan.engineVersion}</span> — الإعدادات <span dir="ltr">{plan.configVersion}</span>
        {ctx.catalogInfo ? ` — لقطة الكتالوج <span dir="ltr">${ctx.catalogInfo.version}</span>` : ''}
      </div>
      <div className="rdoc-muted text-[11px] mt-1">آخر تحديث للأسعار (تاريخ الكتالوج): {catalogDate}</div>
      <div className="text-[11px] mt-5 border border-[#999] px-3 py-1.5 rounded">الأسعار تقديرية تاريخية — تحقق قبل الشراء</div>
      {tocEntries.length >= 4 ? (
        <div className="mt-6 w-full max-w-[380px]">
          <div className="rdoc-h3" style={{ marginTop: 0 }}>الفهرس</div>
          <ul className="rdoc-bullets text-start">
            {tocEntries.map((e) => (
              <li key={`${e.title}-${e.page}`}>{e.title} — صفحة {ctx.num(e.page)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function buildSummaryNode(ctx: DocCtx): ReactNode {
  const { plan } = ctx
  const budgetFils = ctx.budgetFils || plan.diagnostics.budgetFils
  const surplus = budgetFils - ctx.grandTotalFils
  const rows: [string, string][] = [
    ['الميزانية', ctx.fmt(budgetFils)],
    ['المتوقع صرفه (مجموع البنود)', ctx.fmt(ctx.grandTotalFils)],
    ['النطاق المتوقع (متفائل – متشائم)', `${ctx.fmt(plan.totals.optimisticFils, false)} – ${ctx.fmt(plan.totals.pessimisticFils)}`],
    [surplus >= 0 ? 'الوفر المتوقع' : 'العجز المتوقع', ctx.fmt(Math.abs(surplus))],
    ['عدد البنود', ctx.num(ctx.allItems.length)],
    ['الهدر المتوقع', ctx.pct(plan.totals.wastePct)],
    ['تغطية الأساسيات', ctx.pct(plan.totals.coverageEssentials * 100)],
  ]
  if (plan.totals.savingsVsMedianFils !== 0) {
    rows.push(['الوفر مقابل أسعار الوسيط', ctx.fmt(plan.totals.savingsVsMedianFils)])
  }
  rows.push(['نمط الخطة', MODE_LABEL[plan.mode] ?? plan.mode])
  rows.push(['أفق التخطيط', `${ctx.num(plan.horizonDays)} يوماً`])
  return (
    <div>
      <h2 className="rdoc-h2">ملخص الخطة</h2>
      <table className="rdoc-table">
        <thead><tr><th>البند</th><th>القيمة</th></tr></thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="print-avoid-break">
              <td className="font-semibold">{k}</td>
              <td className="rdoc-num">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function buildHouseholdNode(ctx: DocCtx): ReactNode {
  const h = ctx.household
  if (!h) return <p className="rdoc-p">لا توجد بيانات أسرة محفوظة.</p>
  const members = h.members ?? []
  const adults = members.filter((m) => m.ageMonths >= 144).length
  const infantsCount = members.filter((m) => m.ageMonths < 24).length
  const children = members.length - adults - infantsCount
  const habits = habitSummaryLines(h, ctx.num)
  return (
    <div>
      <h2 className="rdoc-h2">الأسرة والعادات</h2>
      <table className="rdoc-kv">
        <tbody>
          <tr><th>عدد الأفراد</th><td className="rdoc-num">{ctx.num(members.length)}</td></tr>
          {infantsCount > 0 ? <tr><th>دون سن الثانية (رضّع)</th><td className="rdoc-num">{ctx.num(infantsCount)}</td></tr> : null}
          {children > 0 ? <tr><th>أطفال (2–12 سنة)</th><td className="rdoc-num">{ctx.num(children)}</td></tr> : null}
          <tr><th>بالغون</th><td className="rdoc-num">{ctx.num(adults)}</td></tr>
        </tbody>
      </table>
      <h3 className="rdoc-h3">العادات</h3>
      {habits.length > 0 ? (
        <ul className="rdoc-bullets">{habits.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : <p className="rdoc-p rdoc-muted">لا عادات خاصة مسجلة.</p>}
      <h3 className="rdoc-h3">القيود الغذائية</h3>
      <p className="rdoc-p">{dietaryLine(h)}</p>
      <h3 className="rdoc-h3">نمط الحياة</h3>
      <ul className="rdoc-bullets">
        <li>وجبات خارج المنزل: {ctx.num(h.eatingOutPerWeek)} وجبة/أسبوع</li>
        <li>الضيافة: {ctx.num(h.guestsPerMonth)} ضيف/شهر تقريباً</li>
        <li>موزّع مياه: {h.hasWaterDispenser ? 'نعم' : 'لا'}</li>
        <li>سعة التخزين: {STORAGE_LABELS[h.storage] ?? h.storage}</li>
      </ul>
    </div>
  )
}

// ----- items (full plan) -----------------------------------------------------

type ItemRow =
  | { kind: 'cont'; label: string }
  | { kind: 'item'; item: PlanItem }
  | { kind: 'subtotal'; label: string; fils: number }
  | { kind: 'grand'; fils: number }

function itemRowNode(r: ItemRow, key: string): ReactNode {
  if (r.kind === 'cont') return <tr key={key} className="rdoc-sub"><td colSpan={7}>تابع — {r.label}</td></tr>
  if (r.kind === 'subtotal') {
    return (
      <tr key={key} className="rdoc-sub print-avoid-break">
        <td colSpan={4}>{r.label}</td>
        <td className="rdoc-num">{r.fils}</td>
      </tr>
    )
  }
  if (r.kind === 'grand') {
    return (
      <tr key={key} className="rdoc-grand print-avoid-break">
        <td colSpan={4}>المجموع الكلي (مجموع البنود)</td>
        <td className="rdoc-num">{r.fils}</td>
      </tr>
    )
  }
  return null
}

function buildDetailedItemPages(ctx: DocCtx): PageDef[] {
  const per = ctx.rowsPerPage
  const pages: { rows: ItemRow[]; cont: string | null }[] = []
  let rows: ItemRow[] = []
  let count = 0
  let currentClass: string | null = null
  let classSum = 0
  const flushClass = () => {
    if (currentClass != null && classSum > 0) {
      rows.push({ kind: 'subtotal', label: `مجموع ${CLASS_LABEL[currentClass] ?? currentClass}`, fils: classSum })
    }
  }
  for (const it of ctx.classSortedItems) {
    const cls = needClassOf(it.needId)
    if (currentClass != null && cls !== currentClass) {
      flushClass()
      currentClass = null
      classSum = 0
    }
    if (count >= per) {
      pages.push({ rows, cont: currentClass != null ? (CLASS_LABEL[currentClass] ?? currentClass) : null })
      rows = []
      count = 0
    }
    if (currentClass == null) currentClass = cls
    rows.push({ kind: 'item', item: it })
    classSum += it.costFils
    count++
  }
  flushClass()
  if (rows.length > 0 || pages.length === 0) pages.push({ rows, cont: null })
  const last = pages[pages.length - 1]!
  last.rows.push({ kind: 'grand', fils: ctx.grandTotalFils })

  return pages.map((pg, i) => ({
    id: `items-${i}`,
    title: 'بنود الخطة',
    node: (
      <div>
        <h2 className="rdoc-h2">بنود الخطة (تفصيلية){i > 0 ? ' — تابع' : ''}</h2>
        <table className="rdoc-table">
          <thead>
            <tr>
              <th>البند</th>
              <th>العلامة</th>
              <th>الحجم</th>
              <th>الكمية</th>
              <th>السعر (د.ب)</th>
              <th className="rdoc-hide-80">سعر الوحدة</th>
              <th className="rdoc-hide-80">المتجر</th>
            </tr>
          </thead>
          <tbody>
            {pg.cont ? itemRowNode({ kind: 'cont', label: pg.cont }, 'cont') : null}
            {pg.rows.map((r, j) => {
              if (r.kind === 'item') {
                const it = r.item
                return (
                  <tr key={`r${j}`} className="print-avoid-break">
                    <td>{it.productName}</td>
                    <td>{it.brand ?? '—'}</td>
                    <td>{it.sizeText ?? '—'}</td>
                    <td className="rdoc-num">{ctx.num(it.packQty)}</td>
                    <td className="rdoc-num">{ctx.fmt(it.costFils, false)}</td>
                    <td className="rdoc-num rdoc-hide-80">{it.unitCostFils != null ? `${ctx.fmt(it.unitCostFils, false)} /${needUnitShort(it.needId)}` : '—'}</td>
                    <td className="rdoc-hide-80">{ctx.storeLabel(it.storeId)}</td>
                  </tr>
                )
              }
              return itemRowNode(r, `x${j}`)
            })}
          </tbody>
        </table>
      </div>
    ),
  }))
}

function buildGroupedItemsPage(ctx: DocCtx): PageDef {
  const envs = ctx.plan.envelopes
  return {
    id: 'items-grouped',
    title: 'بنود الخطة',
    node: (
      <div>
        <h2 className="rdoc-h2">بنود الخطة (نسخة عامة — مجموعات ومبالغ)</h2>
        <table className="rdoc-table">
          <thead><tr><th>الفئة</th><th>عدد البنود</th><th>المبلغ (د.ب)</th><th>النسبة</th></tr></thead>
          <tbody>
            {ctx.classGroups.map((g) => (
              <tr key={g.clazz} className="print-avoid-break">
                <td>{CLASS_LABEL[g.clazz] ?? g.clazz}</td>
                <td className="rdoc-num">{ctx.num(g.count)}</td>
                <td className="rdoc-num">{ctx.fmt(g.fils, false)}</td>
                <td className="rdoc-num">{ctx.pct(ctx.grandTotalFils > 0 ? (g.fils / ctx.grandTotalFils) * 100 : 0)}</td>
              </tr>
            ))}
            <tr className="rdoc-grand">
              <td>المجموع الكلي</td>
              <td className="rdoc-num">{ctx.num(ctx.allItems.length)}</td>
              <td className="rdoc-num">{ctx.fmt(ctx.grandTotalFils, false)}</td>
              <td className="rdoc-num">{ctx.pct(100)}</td>
            </tr>
          </tbody>
        </table>
        {envs.length > 0 ? (
          <div>
            <h3 className="rdoc-h3">الأظرف — أسماء ومبالغ</h3>
            <table className="rdoc-table">
              <thead><tr><th>الظرف</th><th>المبلغ (د.ب)</th></tr></thead>
              <tbody>
                {envs.map((e) => (
                  <tr key={e.envelopeId} className="print-avoid-break"><td>{e.name}</td><td className="rdoc-num">{ctx.fmt(e.spentFils, false)}</td></tr>
                ))}
                <tr className="rdoc-sub"><td>مجموع الأظرف</td><td className="rdoc-num">{ctx.fmt(envs.reduce((s, e) => s + e.spentFils, 0), false)}</td></tr>
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="rdoc-p rdoc-muted mt-2">هذه نسخة عامة تعرض أسماء المجموعات والمبالغ فقط دون بنود المنتجات؛ النسخة التفصيلية تعرض المنتجات والعلامات.</p>
      </div>
    ),
  }
}

// ----- shopping list ---------------------------------------------------------

function buildShoppingListPages(ctx: DocCtx): PageDef[] {
  const byKey = new Map(ctx.allItems.map((it) => [it.key, it]))
  const blocks: { title: string; items: PlanItem[] }[] = []
  const trips = [...ctx.plan.trips].sort((a, b) => a.trip - b.trip)
  if (trips.length > 0) {
    for (const tr of trips) {
      const tripItems = tr.itemKeys.map((k) => byKey.get(k)).filter((x): x is PlanItem => x != null)
      const byStore = new Map<string, PlanItem[]>()
      for (const it of tripItems) {
        const key = it.storeId ?? '_median'
        byStore.set(key, [...(byStore.get(key) ?? []), it])
      }
      const dateTxt = tr.dateISO ? ` — ${ctx.dateAr(tr.dateISO)}` : ''
      for (const [storeKey, items] of byStore) {
        if (items.length === 0) continue
        blocks.push({ title: `${tr.label}${dateTxt} — ${ctx.storeLabel(storeKey === '_median' ? null : storeKey)}`, items })
      }
    }
  }
  if (blocks.length === 0) {
    const byStore = new Map<string, PlanItem[]>()
    for (const it of ctx.allItems) {
      const key = it.storeId ?? '_median'
      byStore.set(key, [...(byStore.get(key) ?? []), it])
    }
    for (const [storeKey, items] of byStore) {
      if (items.length === 0) continue
      blocks.push({ title: ctx.storeLabel(storeKey === '_median' ? null : storeKey), items })
    }
  }
  if (blocks.length === 0) {
    return [{
      id: 'shop-0', title: 'قائمة التسوق',
      node: <div><h2 className="rdoc-h2">قائمة التسوق</h2><p className="rdoc-p">لا بنود في هذه الخطة.</p></div>,
    }]
  }
  const packed: { blocks: { title: string; items: PlanItem[] }[] }[] = []
  let cur: { title: string; items: PlanItem[] }[] = []
  let curRows = 0
  for (const b of blocks) {
    const bRows = b.items.length + 3
    if (curRows > 0 && curRows + bRows > ctx.rowsPerPage + 4) {
      packed.push({ blocks: cur })
      cur = []
      curRows = 0
    }
    cur.push(b)
    curRows += bRows
  }
  if (cur.length > 0) packed.push({ blocks: cur })
  const lastIdx = packed.length - 1
  return packed.map((pg, i) => {
    const pageTotal = pg.blocks.reduce((s, b) => s + b.items.reduce((ss, it) => ss + it.costFils, 0), 0)
    return {
      id: `shop-${i}`,
      title: 'قائمة التسوق',
      node: (
        <div>
          <h2 className="rdoc-h2">قائمة التسوق{i > 0 ? ' — تابع' : ''}</h2>
          {pg.blocks.map((b, bi) => (
            <div key={bi} className="print-avoid-break mb-4">
              <h3 className="rdoc-h3">{b.title}</h3>
              <table className="rdoc-table">
                <thead>
                  <tr>
                    <th aria-label="تم" style={{ width: '9mm' }} />
                    <th>البند</th>
                    <th>الحجم</th>
                    <th>الكمية</th>
                    <th>السعر (د.ب)</th>
                  </tr>
                </thead>
                <tbody>
                  {b.items.map((it) => (
                    <tr key={it.key} className="print-avoid-break">
                      <td><span className="rdoc-check" aria-hidden="true" /></td>
                      <td>{it.productName}</td>
                      <td>{it.sizeText ?? '—'}</td>
                      <td className="rdoc-num">{ctx.num(it.packQty)}</td>
                      <td className="rdoc-num">{ctx.fmt(it.costFils, false)}</td>
                    </tr>
                  ))}
                  <tr className="rdoc-sub">
                    <td colSpan={4}>مجموع القسم</td>
                    <td className="rdoc-num">{ctx.fmt(b.items.reduce((s, it) => s + it.costFils, 0), false)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold border-t border-[#999] pt-2 mt-1">
            <span>مجموع هذه الصفحة</span>
            <span className="rdoc-num">{ctx.fmt(pageTotal, false)} د.ب</span>
          </div>
          {i === lastIdx ? (
            <div className="flex justify-between text-sm font-extrabold mt-1">
              <span>الإجمالي الكلي للقائمة</span>
              <span className="rdoc-num">{ctx.fmt(ctx.grandTotalFils, false)} د.ب</span>
            </div>
          ) : null}
        </div>
      ),
    }
  })
}

// ----- consumption -----------------------------------------------------------

function buildConsumptionPages(ctx: DocCtx): PageDef[] {
  const demand = [...ctx.plan.demand].sort((a, b) => b.qtyBaseUnit - a.qtyBaseUnit)
  const pages: PageDef[] = []
  for (const [i, ds] of chunk(demand, ctx.rowsPerPage).entries()) {
    pages.push({
      id: `dem-${i}`,
      title: 'الطلب المقدّر',
      node: (
        <div>
          <h2 className="rdoc-h2">الطلب المقدّر لكل احتياج{i > 0 ? ' — تابع' : ''}</h2>
          <p className="rdoc-p rdoc-muted">كميات الفترة ({ctx.num(ctx.plan.horizonDays)} يوماً) مقدّرة من أعمار الأفراد وعاداتهم.</p>
          <table className="rdoc-table">
            <thead><tr><th>الاحتياج</th><th>الكمية المقدّرة</th><th>درجة الثقة</th></tr></thead>
            <tbody>
              {ds.map((d) => (
                <tr key={d.needId} className="print-avoid-break">
                  <td>{needLabel(d.needId)}</td>
                  <td className="rdoc-num">{qtyText(ctx, d.needId, d.qtyBaseUnit)}</td>
                  <td className="rdoc-num">{ctx.pct(d.confidence * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    })
  }
  for (const [i, its] of chunk(ctx.classSortedItems, ctx.rowsPerPage).entries()) {
    pages.push({
      id: `cov-${i}`,
      title: 'مدة الكفاية',
      node: (
        <div>
          <h2 className="rdoc-h2">التغطية ومدة الكفاية{i > 0 ? ' — تابع' : ''}</h2>
          <table className="rdoc-table">
            <thead><tr><th>البند</th><th>الكمية</th><th>التغطية</th><th>يكفي حتى</th></tr></thead>
            <tbody>
              {its.map((it) => (
                <tr key={it.key} className="print-avoid-break">
                  <td>{it.productName}</td>
                  <td className="rdoc-num">{ctx.num(it.packQty)}</td>
                  <td className="rdoc-num">{ctx.pct(Math.min(it.coverage, 9.99) * 100)}</td>
                  <td>{it.lastsUntilISO ? ctx.dateAr(it.lastsUntilISO) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    })
  }
  if (pages.length === 0) {
    pages.push({ id: 'dem-0', title: 'الطلب المقدّر', node: <div><h2 className="rdoc-h2">الطلب المقدّر</h2><p className="rdoc-p">لا احتياجات مقدّرة.</p></div> })
  }
  return pages
}

// ----- product compare ---------------------------------------------------------

function compareNode(items: PlanItem[], first: boolean, ctx: DocCtx): ReactNode {
  return (
    <div>
      <h2 className="rdoc-h2">{first ? 'مقارنة المنتجات — أهم 5 بنود بالتكلفة مع بدائلها' : 'مقارنة المنتجات — تابع'}</h2>
      {items.map((it) => (
        <div key={it.key} className="print-avoid-break mb-4">
          <h3 className="rdoc-h3">{it.productName} — {ctx.fmt(it.costFils)} {it.brand ? `(${it.brand})` : ''}</h3>
          <p className="rdoc-p rdoc-muted">
            المختار: {it.sizeText ?? '—'} × {ctx.num(it.packQty)} — سعر الوحدة {it.unitCostFils != null ? `${ctx.fmt(it.unitCostFils, false)} /${needUnitShort(it.needId)}` : '—'}
          </p>
          {it.alternatives.length > 0 ? (
            <table className="rdoc-table">
              <thead>
                <tr>
                  <th>البديل</th>
                  <th>الحجم</th>
                  <th>الكمية</th>
                  <th>التكلفة (د.ب)</th>
                  <th>الفرق (د.ب)</th>
                  <th className="rdoc-hide-80">الملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {it.alternatives.map((alt) => (
                  <tr key={alt.productId} className="print-avoid-break">
                    <td>{alt.productName}{alt.brand ? ` — ${alt.brand}` : ''}</td>
                    <td>{alt.sizeText ?? '—'}</td>
                    <td className="rdoc-num">{ctx.num(alt.packQty)}</td>
                    <td className="rdoc-num">{ctx.fmt(alt.costFils, false)}</td>
                    <td className="rdoc-num">{alt.deltaFils !== 0 ? `${alt.deltaFils > 0 ? '+' : '−'}${ctx.fmt(Math.abs(alt.deltaFils), false)}` : '—'}</td>
                    <td className="rdoc-hide-80">{alt.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="rdoc-p rdoc-muted">لا بدائل متاحة لهذا البند في الكتالوج الحالي.</p>}
        </div>
      ))}
    </div>
  )
}

function buildComparePages(ctx: DocCtx): PageDef[] {
  const top = [...ctx.allItems].sort((a, b) => b.costFils - a.costFils).slice(0, 5)
  const pages: PageDef[] = []
  let cur: PlanItem[] = []
  let curRows = 0
  const flush = () => {
    if (cur.length === 0) return
    pages.push({ id: `cmp-${pages.length}`, title: 'مقارنة المنتجات', node: compareNode(cur, pages.length === 0, ctx) })
    cur = []
    curRows = 0
  }
  for (const it of top) {
    const rows = 4 + it.alternatives.length
    if (curRows > 0 && curRows + rows > ctx.rowsPerPage) flush()
    cur.push(it)
    curRows += rows
  }
  flush()
  if (pages.length === 0) {
    pages.push({ id: 'cmp-0', title: 'مقارنة المنتجات', node: <div><h2 className="rdoc-h2">مقارنة المنتجات</h2><p className="rdoc-p">لا بنود في هذه الخطة.</p></div> })
  }
  return pages
}

// ----- pantry -----------------------------------------------------------------

function pantryQtyText(ctx: DocCtx, row: PantryRow): string {
  if (row.item.needId) return qtyText(ctx, row.item.needId, row.item.qtyBaseUnit)
  const u = row.item.unit
  if ((u === 'g' || u === 'ml') && row.item.qtyBaseUnit >= 1000) {
    return `${ctx.num(Math.round((row.item.qtyBaseUnit / 1000) * 10) / 10)} ${u === 'g' ? 'كجم' : 'لتر'}`
  }
  return `${ctx.num(Math.round(row.item.qtyBaseUnit * 10) / 10)} ${unitLabelAr(u)}`
}

function buildPantryPages(ctx: DocCtx): PageDef[] {
  if (ctx.pantryRows.length === 0) {
    return [{
      id: 'pantry-0', title: 'المخزون المنزلي',
      node: (
        <div>
          <h2 className="rdoc-h2">المخزون المنزلي</h2>
          <p className="rdoc-p">المخزون فارغ حالياً — أضف أصنافك من شاشة «المخزون المنزلي» لتتبّع ما لديك وتقدير نفاده.</p>
        </div>
      ),
    }]
  }
  return chunk(ctx.pantryRows, ctx.rowsPerPage).map((rows, i) => ({
    id: `pantry-${i}`,
    title: 'المخزون المنزلي',
    node: (
      <div>
        <h2 className="rdoc-h2">المخزون المنزلي{i > 0 ? ' — تابع' : ''}</h2>
        <p className="rdoc-p rdoc-muted">تقدير النفاد يُحسب بمقارنة الكمية المتوفرة مع الطلب اليومي المقدّر للخطة.</p>
        <table className="rdoc-table">
          <thead><tr><th>الصنف</th><th>الكمية</th><th>أضيف في</th><th>ينفد خلال</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item.id} className="print-avoid-break">
                <td>{r.item.name}</td>
                <td className="rdoc-num">{pantryQtyText(ctx, r)}</td>
                <td>{ctx.dateAr(r.item.addedAtISO)}</td>
                <td className="rdoc-num">{r.daysLeft != null ? `${ctx.num(r.daysLeft)} يوم${r.daysLeft <= 14 ? ' — نفاد قريب' : ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  }))
}

// ----- calculators --------------------------------------------------------------

function buildCalculatorPages(ctx: DocCtx): PageDef[] {
  const H = ctx.plan.horizonDays || 30
  const infantName = (inf: InfantInfo) => inf.member.name ?? `طفل ${ctx.num(inf.member.ageMonths)} شهراً`
  const diaperRows = ctx.infants.map((inf) => {
    const sizeKey = `diapers@${inf.diaperSize}`
    const qty = ctx.plan.demand.find((d) => d.needId === sizeKey)?.qtyBaseUnit ?? null
    const cost = ctx.allItems.filter((it) => it.needId === sizeKey).reduce((s, it) => s + it.costFils, 0)
    return { inf, qty, cost }
  })
  const formulaRows = ctx.infants.map((inf) => {
    const stageKey = `formula@${inf.formulaStage}`
    const grams = ctx.plan.demand.find((d) => d.needId === stageKey)?.qtyBaseUnit ?? null
    const cost = ctx.allItems.filter((it) => it.needId === stageKey).reduce((s, it) => s + it.costFils, 0)
    const packs = ctx.allItems.filter((it) => it.needId === stageKey).reduce((s, it) => s + it.packQty, 0)
    return { inf, grams, cost, packs }
  })
  const smoking = ctx.household?.habits['smoking']
  const tobaccoCost = ctx.allItems.filter((it) => needBase(it.needId) === 'tobacco').reduce((s, it) => s + it.costFils, 0)
  const membersCount = ctx.household?.members.length ?? 1
  const daily = ctx.grandTotalFils / H
  const perMember = daily / Math.max(1, membersCount)
  const topUnit = ctx.allItems
    .filter((it) => it.unitCostFils != null)
    .sort((a, b) => (b.unitCostFils ?? 0) - (a.unitCostFils ?? 0))
    .slice(0, 5)
  return [{
    id: 'calc-0',
    title: 'الحاسبات',
    node: (
      <div>
        <h2 className="rdoc-h2">ملخص الحاسبات</h2>

        <div className="print-avoid-break mb-4">
          <h3 className="rdoc-h3">حاسبة الحفاضات</h3>
          {diaperRows.length > 0 ? (
            <>
              <table className="rdoc-table">
                <thead>
                  <tr><th>الطفل</th><th>العمر</th><th>الوزن التقديري</th><th>المقاس</th><th>تغييرات/يوم</th><th>حفاضات الفترة</th><th>التكلفة (د.ب)</th></tr>
                </thead>
                <tbody>
                  {diaperRows.map(({ inf, qty, cost }) => (
                    <tr key={inf.member.id} className="print-avoid-break">
                      <td>{infantName(inf)}</td>
                      <td className="rdoc-num">{ctx.num(inf.member.ageMonths)} شهراً</td>
                      <td className="rdoc-num">{ctx.num(Math.round(inf.weightKg * 10) / 10)} كجم</td>
                      <td className="rdoc-num">{ctx.num(inf.diaperSize)}</td>
                      <td className="rdoc-num">{ctx.num(Math.round(inf.diaperChangesPerDay))}</td>
                      <td className="rdoc-num">{qty != null ? ctx.num(Math.round(qty)) : '—'}</td>
                      <td className="rdoc-num">{cost > 0 ? ctx.fmt(cost, false) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rdoc-p rdoc-muted">المعادلة: تغييرات يومياً × {ctx.num(H)} يوماً = عدد حفاضات الفترة لكل طفل.</p>
            </>
          ) : <p className="rdoc-p rdoc-muted">لا رضّع في الأسرة — الحاسبة غير مطلوبة.</p>}
        </div>

        <div className="print-avoid-break mb-4">
          <h3 className="rdoc-h3">حاسبة حليب الأطفال</h3>
          {formulaRows.length > 0 ? (
            <>
              <table className="rdoc-table">
                <thead>
                  <tr><th>الطفل</th><th>المرحلة</th><th>جم/يوم</th><th>جم الفترة</th><th>العبوات في الخطة</th><th>التكلفة (د.ب)</th></tr>
                </thead>
                <tbody>
                  {formulaRows.map(({ inf, grams, cost, packs }) => (
                    <tr key={inf.member.id} className="print-avoid-break">
                      <td>{infantName(inf)}</td>
                      <td className="rdoc-num">{ctx.num(inf.formulaStage)}</td>
                      <td className="rdoc-num">{ctx.num(Math.round(inf.formulaGramsPerDay))}</td>
                      <td className="rdoc-num">{grams != null ? ctx.num(Math.round(grams)) : '—'}</td>
                      <td className="rdoc-num">{packs > 0 ? ctx.num(packs) : '—'}</td>
                      <td className="rdoc-num">{cost > 0 ? ctx.fmt(cost, false) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rdoc-p rdoc-muted">المعادلة: احتياج المل يومي × نسبة البودرة (0.135) = جم يومياً، × {ctx.num(H)} يوم = جم الفترة.</p>
            </>
          ) : <p className="rdoc-p rdoc-muted">لا رضّع في الأسرة — الحاسبة غير مطلوبة.</p>}
        </div>

        <div className="print-avoid-break mb-4">
          <h3 className="rdoc-h3">حاسبة التدخين (اختيارية)</h3>
          {smoking?.active === true ? (
            <>
              <table className="rdoc-kv">
                <tbody>
                  <tr><th>السجائر يومياً</th><td className="rdoc-num">{ctx.num(Number(smoking.cigsPerDay ?? 20))}</td></tr>
                  {smoking.brand ? <tr><th>العلامة</th><td>{String(smoking.brand)}</td></tr> : null}
                  <tr><th>تكلفة الفترة</th><td className="rdoc-num">{tobaccoCost > 0 ? ctx.fmt(tobaccoCost) : '—'}</td></tr>
                </tbody>
              </table>
              <p className="rdoc-p rdoc-muted">المعادلة: {ctx.num(Number(smoking.cigsPerDay ?? 20))} سيجارة/يوم × {ctx.num(H)} يوماً ÷ 20 سيجارة/علبة = عدد العلب.</p>
            </>
          ) : <p className="rdoc-p rdoc-muted">غير مفعّلة لهذه الأسرة.</p>}
        </div>

        <div className="print-avoid-break">
          <h3 className="rdoc-h3">حاسبات عامة</h3>
          <table className="rdoc-kv">
            <tbody>
              <tr><th>تكلفة اليوم</th><td className="rdoc-num">{ctx.fmt(Math.round(daily))}</td></tr>
              <tr><th>تكلفة الفرد اليومي</th><td className="rdoc-num">{ctx.fmt(Math.round(perMember))}</td></tr>
              <tr><th>متوسط تكلفة البند</th><td className="rdoc-num">{ctx.fmt(ctx.allItems.length > 0 ? Math.round(ctx.grandTotalFils / ctx.allItems.length) : 0)}</td></tr>
            </tbody>
          </table>
          {topUnit.length > 0 ? (
            <table className="rdoc-table mt-2">
              <thead><tr><th>أعلى أسعار الوحدة</th><th>سعر الوحدة</th></tr></thead>
              <tbody>
                {topUnit.map((it) => (
                  <tr key={it.key} className="print-avoid-break">
                    <td>{it.productName}</td>
                    <td className="rdoc-num">{ctx.fmt(it.unitCostFils!, false)} /{needUnitShort(it.needId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    ),
  }]
}

// ----- envelopes ------------------------------------------------------------------

function buildEnvelopePages(ctx: DocCtx): PageDef[] {
  const envs = ctx.plan.envelopes
  if (envs.length === 0) {
    return [{
      id: 'env-0', title: 'الأظرف',
      node: (
        <div>
          <h2 className="rdoc-h2">أظرف الميزانية والعناصر العامة</h2>
          <p className="rdoc-p">لا أظرف في هذه الخطة — يمكنك إنشاء أظرف (مثل «سلة الضيافة» أو «شوكولاتة») من شاشة العناصر العامة وأظرف الميزانية.</p>
        </div>
      ),
    }]
  }
  const showActual = ctx.spendLog.length > 0
  const envTotal = envs.reduce((s, e) => s + e.spentFils, 0)
  const envActual = envs.reduce((s, e) => s + (ctx.spendAgg.byEnvelope.get(e.envelopeId)?.actual ?? 0), 0)

  const over = envs.filter((e) => (ctx.spendAgg.byEnvelope.get(e.envelopeId)?.actual ?? 0) > e.spentFils)
  const devNode = showActual && over.length > 0 ? (
    <div>
      <h3 className="rdoc-h3">الانحرافات</h3>
      <ul className="rdoc-bullets">
        {over.map((e) => {
          const actual = ctx.spendAgg.byEnvelope.get(e.envelopeId)?.actual ?? 0
          return <li key={e.envelopeId}>تجاوز ظرف «{e.name}» المخطط بمقدار {ctx.fmt(actual - e.spentFils, false)} د.ب.</li>
        })}
      </ul>
    </div>
  ) : null

  const itemByKey = new Map(ctx.allItems.map((it) => [it.key, it]))
  const actualByClass = new Map<string, number>()
  for (const e of ctx.spendLog) {
    if (!e.planItemKey) continue
    const it = itemByKey.get(e.planItemKey)
    if (!it) continue
    const c = needClassOf(it.needId)
    actualByClass.set(c, (actualByClass.get(c) ?? 0) + e.actualFils)
  }
  const classNode = ctx.reportType === 'budget' && showActual ? (
    <div>
      <h3 className="rdoc-h3">المخطط مقابل الفعلي حسب الفئة</h3>
      <table className="rdoc-table">
        <thead><tr><th>الفئة</th><th>المخطط (د.ب)</th><th>الفعلي المسجّل (د.ب)</th><th>النسبة من المخطط</th></tr></thead>
        <tbody>
          {ctx.classGroups.map((g) => {
            const actual = actualByClass.get(g.clazz) ?? 0
            return (
              <tr key={g.clazz} className="print-avoid-break">
                <td>{CLASS_LABEL[g.clazz] ?? g.clazz}</td>
                <td className="rdoc-num">{ctx.fmt(g.fils, false)}</td>
                <td className="rdoc-num">{ctx.fmt(actual, false)}</td>
                <td className="rdoc-num">{g.fils > 0 ? ctx.pct((actual / g.fils) * 100) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  ) : null

  const mainNode = (
    <div>
      <h2 className="rdoc-h2">أظرف الميزانية — المخطط{showActual ? ' مقابل الفعلي' : ''}</h2>
      <table className="rdoc-table">
        <thead>
          <tr>
            <th>الظرف</th>
            <th>النطاق (د.ب)</th>
            <th>المخطط (د.ب)</th>
            {showActual ? <th>الفعلي (د.ب)</th> : null}
            {showActual ? <th>المتبقي (د.ب)</th> : null}
            <th>الأصناف</th>
          </tr>
        </thead>
        <tbody>
          {envs.map((e) => {
            const actual = ctx.spendAgg.byEnvelope.get(e.envelopeId)?.actual ?? 0
            const range = e.minFils != null && e.maxFils != null ? `${ctx.fmt(e.minFils, false)} – ${ctx.fmt(e.maxFils, false)}` : '—'
            return (
              <tr key={e.envelopeId} className="print-avoid-break">
                <td>{e.name}</td>
                <td className="rdoc-num">{range}</td>
                <td className="rdoc-num">{ctx.fmt(e.spentFils, false)}</td>
                {showActual ? <td className="rdoc-num">{ctx.fmt(actual, false)}</td> : null}
                {showActual ? <td className="rdoc-num">{ctx.fmt(e.spentFils - actual, false)}</td> : null}
                <td className="rdoc-num">{ctx.num(e.items.length)}</td>
              </tr>
            )
          })}
          <tr className="rdoc-grand">
            <td>مجموع الأظرف</td>
            <td />
            <td className="rdoc-num">{ctx.fmt(envTotal, false)}</td>
            {showActual ? <td className="rdoc-num">{ctx.fmt(envActual, false)}</td> : null}
            {showActual ? <td /> : null}
            <td className="rdoc-num">{ctx.num(envs.reduce((s, e) => s + e.items.length, 0))}</td>
          </tr>
        </tbody>
      </table>
      <p className="rdoc-p rdoc-muted mt-2">بنود الخطة خارج الأظرف: {ctx.fmt(ctx.grandTotalFils - envTotal, false)} د.ب — إجمالي الخطة {ctx.fmt(ctx.grandTotalFils, false)} د.ب.</p>
      {showActual ? devNode : <p className="rdoc-p rdoc-muted">لا يوجد إنفاق مسجّل بعد — سجّل مشترياتك من شاشة «تتبع الإنفاق» لتظهر المقارنة الفعلية.</p>}
      {classNode}
    </div>
  )

  const pages: PageDef[] = [{ id: 'env-main', title: 'الأظرف', node: mainNode }]
  if (ctx.detailed) {
    const per = ctx.rowsPerPage
    let curEnvs: typeof envs = []
    let curRows = 0
    const flush = () => {
      if (curEnvs.length === 0) return
      pages.push({
        id: `env-detail-${pages.length}`,
        title: 'بنود الأظرف',
        node: (
          <div>
            <h2 className="rdoc-h2">بنود الأظرف (تفصيلية)</h2>
            {curEnvs.map((e) => (
              <div key={e.envelopeId} className="print-avoid-break mb-4">
                <h3 className="rdoc-h3">ظرف «{e.name}» — {ctx.fmt(e.spentFils, false)} د.ب</h3>
                <table className="rdoc-table">
                  <thead><tr><th>البند</th><th>الحجم</th><th>الكمية</th><th>التكلفة (د.ب)</th></tr></thead>
                  <tbody>
                    {e.items.map((it) => (
                      <tr key={it.key} className="print-avoid-break">
                        <td>{it.productName}</td>
                        <td>{it.sizeText ?? '—'}</td>
                        <td className="rdoc-num">{ctx.num(it.packQty)}</td>
                        <td className="rdoc-num">{ctx.fmt(it.costFils, false)}</td>
                      </tr>
                    ))}
                    <tr className="rdoc-sub"><td colSpan={3}>مجموع الظرف</td><td className="rdoc-num">{ctx.fmt(e.items.reduce((s, it) => s + it.costFils, 0), false)}</td></tr>
                  </tbody>
                </table>
                {e.explanation.length > 0 ? <ul className="rdoc-bullets">{e.explanation.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
              </div>
            ))}
          </div>
        ),
      })
      curEnvs = []
      curRows = 0
    }
    for (const e of envs) {
      const rows = e.items.length + 5
      if (curRows > 0 && curRows + rows > per + 4) flush()
      curEnvs.push(e)
      curRows += rows
    }
    flush()
  }
  return pages
}

// ----- stores & trips -----------------------------------------------------------

function buildStoresPage(ctx: DocCtx): PageDef {
  const splits = ctx.plan.storeSplits
  const trips = [...ctx.plan.trips].sort((a, b) => a.trip - b.trip)
  return {
    id: 'stores',
    title: 'المتاجر والرحلات',
    node: (
      <div>
        <h2 className="rdoc-h2">المتاجر والرحلات</h2>
        <h3 className="rdoc-h3">توزيع المشتريات على المتاجر</h3>
        {splits.length > 0 ? (
          <table className="rdoc-table">
            <thead><tr><th>المتجر</th><th>عدد البنود</th><th>المجموع الفرعي (د.ب)</th><th>التوصيل (د.ب)</th><th>الإجمالي (د.ب)</th></tr></thead>
            <tbody>
              {splits.map((s) => (
                <tr key={s.storeId} className="print-avoid-break">
                  <td>{ctx.storeLabel(s.storeId)}</td>
                  <td className="rdoc-num">{ctx.num(s.itemsCount)}</td>
                  <td className="rdoc-num">{ctx.fmt(s.subtotalFils, false)}</td>
                  <td className="rdoc-num">{s.deliveryFils > 0 ? ctx.fmt(s.deliveryFils, false) : '—'}</td>
                  <td className="rdoc-num">{ctx.fmt(s.subtotalFils + s.deliveryFils, false)}</td>
                </tr>
              ))}
              <tr className="rdoc-grand">
                <td>المجموع</td>
                <td className="rdoc-num">{ctx.num(splits.reduce((s, x) => s + x.itemsCount, 0))}</td>
                <td className="rdoc-num">{ctx.fmt(splits.reduce((s, x) => s + x.subtotalFils, 0), false)}</td>
                <td className="rdoc-num">{ctx.fmt(splits.reduce((s, x) => s + x.deliveryFils, 0), false)}</td>
                <td className="rdoc-num">{ctx.fmt(splits.reduce((s, x) => s + x.subtotalFils + x.deliveryFils, 0), false)}</td>
              </tr>
            </tbody>
          </table>
        ) : <p className="rdoc-p rdoc-muted">لا توزيع متاجر — استُخدمت أسعار وسيطة (الوسيط عبر المتاجر).</p>}
        <h3 className="rdoc-h3">رحلات الشراء</h3>
        {trips.length > 0 ? (
          <table className="rdoc-table">
            <thead><tr><th>الرحلة</th><th>التاريخ</th><th>عدد البنود</th><th>المبلغ (د.ب)</th></tr></thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.trip} className="print-avoid-break">
                  <td>{t.label}</td>
                  <td>{t.dateISO ? ctx.dateAr(t.dateISO) : '—'}</td>
                  <td className="rdoc-num">{ctx.num(t.itemKeys.length)}</td>
                  <td className="rdoc-num">{ctx.fmt(t.fils, false)}</td>
                </tr>
              ))}
              <tr className="rdoc-sub">
                <td>مجموع الرحلات</td>
                <td>—</td>
                <td className="rdoc-num">{ctx.num(trips.reduce((s, t) => s + t.itemKeys.length, 0))}</td>
                <td className="rdoc-num">{ctx.fmt(trips.reduce((s, t) => s + t.fils, 0), false)}</td>
              </tr>
            </tbody>
          </table>
        ) : <p className="rdoc-p rdoc-muted">رحلة واحدة للتخزين الشهري.</p>}
      </div>
    ),
  }
}

// ----- explanations ----------------------------------------------------------------

function buildExplanationsPage(ctx: DocCtx): PageDef {
  const top = [...ctx.allItems].sort((a, b) => b.costFils - a.costFils).slice(0, 10)
  return {
    id: 'expl',
    title: 'الشروحات',
    node: (
      <div>
        <h2 className="rdoc-h2">لماذا اختيرت هذه البنود؟ — أعلى {ctx.num(top.length)} بنود بالتكلفة</h2>
        {top.map((it) => (
          <div key={it.key} className="print-avoid-break mb-3">
            <h3 className="rdoc-h3">{it.productName} — {ctx.fmt(it.costFils, false)} د.ب</h3>
            <ul className="rdoc-bullets">
              {it.reasons.map((r, i) => <li key={i}>{r.ar}</li>)}
            </ul>
          </div>
        ))}
        {top.length === 0 ? <p className="rdoc-p">لا بنود في هذه الخطة.</p> : null}
      </div>
    ),
  }
}

// ----- diagnostics -------------------------------------------------------------------

function buildDiagnosticsPage(ctx: DocCtx): PageDef {
  const d = ctx.plan.diagnostics
  const nut = ctx.plan.nutrition
  return {
    id: 'diag',
    title: 'التشخيص والتحذيرات',
    node: (
      <div>
        <h2 className="rdoc-h2">التشخيص والتحذيرات</h2>
        <h3 className="rdoc-h3">توزيع الإنفاق على الفئات</h3>
        <table className="rdoc-table">
          <thead><tr><th>الفئة</th><th>المبلغ (د.ب)</th><th>النسبة</th></tr></thead>
          <tbody>
            {d.distributionByClass.map((row) => (
              <tr key={row.clazz} className="print-avoid-break">
                <td>{CLASS_LABEL[row.clazz] ?? row.clazz}</td>
                <td className="rdoc-num">{ctx.fmt(row.fils, false)}</td>
                <td className="rdoc-num">{ctx.pct(row.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="rdoc-h3">المجموعات الغذائية (تقدير)</h3>
        <table className="rdoc-table">
          <thead><tr><th>المجموعة</th><th>نسبة الخطة</th><th>المستهدف التقريبي</th></tr></thead>
          <tbody>
            {nut.groups.map((g) => (
              <tr key={g.group} className="print-avoid-break">
                <td>{NUTRITION_LABELS[g.group] ?? g.group}</td>
                <td className="rdoc-num">{ctx.pct(g.pct)}</td>
                <td className="rdoc-num">{ctx.pct(g.targetPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rdoc-p rdoc-muted">{nut.disclaimer}</p>
        <h3 className="rdoc-h3">التحذيرات</h3>
        {d.warnings.length > 0 ? (
          <ul className="rdoc-bullets">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        ) : <p className="rdoc-p rdoc-muted">لا تحذيرات على هذه الخطة.</p>}
        <h3 className="rdoc-h3">ملاحظات</h3>
        {d.notes.length > 0 ? (
          <ul className="rdoc-bullets">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        ) : <p className="rdoc-p rdoc-muted">لا ملاحظات إضافية.</p>}
      </div>
    ),
  }
}

// ----- methodology + notes ---------------------------------------------------------------

function buildMethodologyNode(ctx: DocCtx): ReactNode {
  const catalogDate = ctx.catalogInfo ? ctx.dateAr(ctx.catalogInfo.generatedAt) : ctx.dateAr(ctx.plan.generatedAt)
  return (
    <div>
      <h2 className="rdoc-h2">المنهجية والمصادر</h2>
      <ul className="rdoc-bullets">
        <li>مصدر البيانات: قاعدة بيانات مفتوحة تضم 37 متجراً بحرينياً (هايبرماركت وأسواق سريعة ومتاجر متخصصة)، بأسعار وسيطة مجمّعة لكل منتج بتاريخ لقطة الكتالوج المذكور على الغلاف ({catalogDate}).</li>
        <li>منهجية التقدير: يُقدّر استهلاك الأسرة من أعمار الأفراد وعاداتهم (قهوة، شاي، مياه، حفاضات…)، ثم تُحاكى العبوات وصلاحيتها والهدر المتوقع، ويُختار لكل احتياج «الأنسب»: لا الأرخص المبتذل ولا الأغلى، بل الأوفى للقيمة ضمن الميزانية.</li>
        <li>حدود الدقة: الأسعار تقديرية تاريخية — تحقق قبل الشراء؛ فقد تختلف بين الفروع والعروض والمناسبات.</li>
        <li>إصدار المحرك: <span dir="ltr">{ctx.plan.engineVersion}</span> — إصدار الإعدادات: <span dir="ltr">{ctx.plan.configVersion}</span> — بصمة الخطة: <span dir="ltr">{ctx.plan.fingerprint}</span>.</li>
        <li>الخصوصية: تُعالَج بيانات أسرتك محلياً في جهازك ولا تُرسل إلى أي خادم إلا عند مشاركة اختيارية صريحة منك.</li>
        <li>هذا التقرير ليس نصيحة غذائية أو طبية أو مالية.</li>
      </ul>
    </div>
  )
}

function buildNotesSignaturesNode(ctx: DocCtx): ReactNode {
  return (
    <div>
      <h2 className="rdoc-h2">ملاحظات وتوقيعات</h2>
      <div className="border border-[#bbb] rounded p-3 min-h-[90px]">
        <p className="rdoc-p" style={{ marginBottom: 0 }}>{ctx.notesText.trim() || 'مساحة للملاحظات اليدوية…'}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-10">
        <div>
          <div className="text-sm font-bold">توقيع معدّ التقرير{ctx.effNames.preparerName ? `: ${ctx.effNames.preparerName}` : ''}</div>
          <div className="rdoc-sig mt-10" aria-hidden="true" />
          <div className="rdoc-muted text-[10px] mt-1">التاريخ: ....... / ....... / .......</div>
        </div>
        <div>
          <div className="text-sm font-bold">توقيع المراجع</div>
          <div className="rdoc-sig mt-10" aria-hidden="true" />
          <div className="rdoc-muted text-[10px] mt-1">التاريخ: ....... / ....... / .......</div>
        </div>
      </div>
    </div>
  )
}

function buildMethodNotesPage(ctx: DocCtx, showMethod: boolean, showNotes: boolean): PageDef {
  const title = showMethod && showNotes ? 'المنهجية والملاحظات' : showMethod ? 'المنهجية والمصادر' : 'ملاحظات وتوقيع'
  return {
    id: 'method-notes',
    title,
    node: (
      <div>
        {showMethod ? buildMethodologyNode(ctx) : null}
        {showNotes ? <div className="mt-6">{buildNotesSignaturesNode(ctx)}</div> : null}
      </div>
    ),
  }
}

// ----- spending ----------------------------------------------------------------------------

function buildSpendingPages(ctx: DocCtx): PageDef[] {
  const pages: PageDef[] = []
  const agg = ctx.spendAgg
  const noData = ctx.spendLog.length === 0
  pages.push({
    id: 'spend-sum',
    title: 'ملخص الإنفاق',
    node: (
      <div>
        <h2 className="rdoc-h2">الإنفاق الفعلي مقابل الخطة</h2>
        {noData ? (
          <p className="rdoc-p">لا توجد حركات إنفاق مسجّلة بعد — سجّل مشترياتك من شاشة «تتبع الإنفاق» ثم أعد توليد هذا التقرير.</p>
        ) : (
          <>
            <table className="rdoc-table">
              <thead><tr><th>البند</th><th>القيمة</th></tr></thead>
              <tbody>
                <tr className="print-avoid-break"><td className="font-semibold">إجمالي المخطط (المسجّل)</td><td className="rdoc-num">{ctx.fmt(agg.planned)}</td></tr>
                <tr className="print-avoid-break"><td className="font-semibold">إجمالي الفعلي (المسجّل)</td><td className="rdoc-num">{ctx.fmt(agg.actual)}</td></tr>
                <tr className="print-avoid-break"><td className="font-semibold">{agg.actual - agg.planned <= 0 ? 'الوفر عن المخطط' : 'تجاوز المخطط'}</td><td className="rdoc-num">{ctx.fmt(Math.abs(agg.actual - agg.planned))}</td></tr>
                <tr className="print-avoid-break"><td className="font-semibold">عدد الحركات</td><td className="rdoc-num">{ctx.num(ctx.spendLog.length)}</td></tr>
                <tr className="print-avoid-break"><td className="font-semibold">الميزانية (خطة الفترة)</td><td className="rdoc-num">{ctx.fmt(ctx.budgetFils)}</td></tr>
                <tr className="print-avoid-break"><td className="font-semibold">المتبقي من الميزانية</td><td className="rdoc-num">{ctx.fmt(ctx.budgetFils - agg.actual)}</td></tr>
              </tbody>
            </table>
            {ctx.spendByMonth.length > 0 ? (
              <div>
                <h3 className="rdoc-h3">الاتجاه الشهري</h3>
                <table className="rdoc-table">
                  <thead><tr><th>الشهر</th><th>المخطط (د.ب)</th><th>الفعلي (د.ب)</th><th>الفرق (د.ب)</th></tr></thead>
                  <tbody>
                    {ctx.spendByMonth.map(([m, v]) => (
                      <tr key={m} className="print-avoid-break">
                        <td className="rdoc-num" dir="ltr">{m}</td>
                        <td className="rdoc-num">{ctx.fmt(v.planned, false)}</td>
                        <td className="rdoc-num">{ctx.fmt(v.actual, false)}</td>
                        <td className="rdoc-num">{v.actual - v.planned !== 0 ? `${v.actual - v.planned > 0 ? '+' : '−'}${ctx.fmt(Math.abs(v.actual - v.planned), false)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {ctx.topOverspend.length > 0 ? (
              <div>
                <h3 className="rdoc-h3">أين تسرّب المال — أكبر التجاوزات</h3>
                <table className="rdoc-table">
                  <thead><tr><th>البيان</th><th>المخطط (د.ب)</th><th>الفعلي (د.ب)</th><th>الفرق (د.ب)</th></tr></thead>
                  <tbody>
                    {ctx.topOverspend.map((e) => (
                      <tr key={e.id} className="print-avoid-break">
                        <td>{e.name}</td>
                        <td className="rdoc-num">{ctx.fmt(e.plannedFils, false)}</td>
                        <td className="rdoc-num">{ctx.fmt(e.actualFils, false)}</td>
                        <td className="rdoc-num">{e.actualFils - e.plannedFils !== 0 ? `${e.actualFils - e.plannedFils > 0 ? '+' : '−'}${ctx.fmt(Math.abs(e.actualFils - e.plannedFils), false)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    ),
  })
  if (!noData) {
    const chunks = chunk(ctx.spendLog, ctx.rowsPerPage)
    chunks.forEach((entries, i) => {
      pages.push({
        id: `spend-log-${i}`,
        title: 'سجل الإنفاق',
        node: (
          <div>
            <h2 className="rdoc-h2">سجل حركات الإنفاق{i > 0 ? ' — تابع' : ''}</h2>
            <table className="rdoc-table">
              <thead>
                <tr><th>البيان</th><th>التاريخ</th><th>المخطط (د.ب)</th><th>الفعلي (د.ب)</th><th>الفرق (د.ب)</th><th className="rdoc-hide-80">المتجر</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="print-avoid-break">
                    <td>{e.name}</td>
                    <td>{ctx.dateAr(e.dateISO)}</td>
                    <td className="rdoc-num">{ctx.fmt(e.plannedFils, false)}</td>
                    <td className="rdoc-num">{ctx.fmt(e.actualFils, false)}</td>
                    <td className="rdoc-num">{e.actualFils - e.plannedFils !== 0 ? `${e.actualFils - e.plannedFils > 0 ? '+' : '−'}${ctx.fmt(Math.abs(e.actualFils - e.plannedFils), false)}` : '—'}</td>
                    <td className="rdoc-hide-80">{e.storeId ? ctx.storeLabel(e.storeId) : '—'}</td>
                  </tr>
                ))}
                {i === chunks.length - 1 ? (
                  <tr className="rdoc-grand">
                    <td>المجموع</td>
                    <td>—</td>
                    <td className="rdoc-num">{ctx.fmt(agg.planned, false)}</td>
                    <td className="rdoc-num">{ctx.fmt(agg.actual, false)}</td>
                    <td className="rdoc-num">{agg.actual - agg.planned !== 0 ? `${agg.actual - agg.planned > 0 ? '+' : '−'}${ctx.fmt(Math.abs(agg.actual - agg.planned), false)}` : '—'}</td>
                    <td className="rdoc-hide-80" />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ),
      })
    })
  }
  return pages
}

// ---------------------------------------------------------------------------
// main view
// ---------------------------------------------------------------------------

export function ReportsView() {
  // store
  const arabicNumerals = useApp((s) => s.settings.arabicNumerals)
  const plan = useApp((s) => s.plan)
  const household = useApp((s) => s.household)
  const budget = useApp((s) => s.budget)
  const planNames = useApp((s) => s.planNames)
  const spendLog = useApp((s) => s.spendLog)
  const pantry = useApp((s) => s.pantry)

  // report state
  const [reportType, setReportType] = useState<ReportTypeId | null>(null)
  const [names, setNames] = useState<ReportNames>({ reportName: '', familyName: '', preparerName: '', planName: '', showNames: true })
  const [paper, setPaper] = useState<ReportOptions['paper']>('A4')
  const [orientation, setOrientation] = useState<ReportOptions['orientation']>('portrait')
  const [inkSaver, setInkSaver] = useState(false)
  const [detailed, setDetailed] = useState(true)
  const [hijri, setHijri] = useState(false)
  const [sections, setSections] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTION_DEFS.map((s) => [s.id, true])))
  const [notesText, setNotesText] = useState('')
  const [savedReports, setSavedReports] = useState<SavedReport[]>([])
  const [storeMeta, setStoreMeta] = useState<{ version: string; generatedAt: string; stores: Record<string, string> } | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const optionsRef = useRef<HTMLDivElement | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // load saved reports (localStorage 'khassis-reports')
  useEffect(() => {
    try {
      const raw = localStorage.getItem('khassis-reports')
      if (raw) setSavedReports(JSON.parse(raw) as SavedReport[])
    } catch {
      /* قائمة التقارير المحفوظة غير قابلة للقراءة — نبدأ بقائمة فارغة */
    }
  }, [])

  // printing: hide app chrome (works for Ctrl+P too, scoped to this view's lifetime)
  useEffect(() => {
    const add = () => document.body.classList.add('printing-report')
    const remove = () => document.body.classList.remove('printing-report')
    window.addEventListener('beforeprint', add)
    window.addEventListener('afterprint', remove)
    return () => {
      window.removeEventListener('beforeprint', add)
      window.removeEventListener('afterprint', remove)
      remove()
    }
  }, [])

  // catalog meta (store names + snapshot date) — loaded once a report is selected
  useEffect(() => {
    if (!reportType || !plan || storeMeta) return
    let cancelled = false
    fetchCatalogMeta()
      .then((meta) => {
        if (cancelled) return
        setStoreMeta({ version: meta.version, generatedAt: meta.generatedAt, stores: Object.fromEntries(meta.stores.map((s) => [s.id, s.nameAr])) })
      })
      .catch(() => {
        /* أسماء المتاجر غير متاحة الآن — ستُعرض معرفات المتاجر */
      })
    return () => { cancelled = true }
  }, [reportType, plan, storeMeta])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ----- formatting helpers -----
  const an = arabicNumerals
  const fmt = useCallback((fils: number, withUnit = true) => formatBHD(fils, { arabicNumerals: an, withUnit }), [an])
  const num = useCallback((n: number) => formatNumberAr(n, an), [an])
  const pct = useCallback((x: number) => formatPct(x, an), [an])
  const dateAr = useCallback((iso: string) => formatDateAr(iso), [])

  // ----- derived plan data (all totals computed from the items themselves) -----
  const allItems = useMemo(() => (plan ? [...plan.items, ...plan.fixedItems] : []), [plan])
  const grandTotalFils = useMemo(() => allItems.reduce((s, it) => s + it.costFils, 0), [allItems])
  const classSortedItems = useMemo(() => {
    const order = (c: string) => CLASS_ORDER.indexOf(c)
    return [...allItems].sort((a, b) => {
      const ca = order(needClassOf(a.needId))
      const cb = order(needClassOf(b.needId))
      if (ca !== cb) return ca - cb
      return b.costFils - a.costFils
    })
  }, [allItems])
  const classGroups = useMemo(() => {
    const map = new Map<string, { clazz: string; count: number; fils: number }>()
    for (const it of allItems) {
      const c = needClassOf(it.needId)
      const g = map.get(c) ?? { clazz: c, count: 0, fils: 0 }
      g.count++
      g.fils += it.costFils
      map.set(c, g)
    }
    return CLASS_ORDER.filter((c) => map.has(c)).map((c) => map.get(c)!)
  }, [allItems])

  // smart default report name: «خطة نوفمبر 2026 — أسرة العلي»
  const smartName = useMemo(() => {
    if (!plan) return 'تقرير الخطة'
    const d = new Date(plan.generatedAt)
    let month = ''
    try { month = new Intl.DateTimeFormat('ar-BH', { month: 'long' }).format(d) } catch { month = '' }
    const year = an ? toArabicDigits(d.getFullYear()) : String(d.getFullYear())
    const fam = names.familyName?.trim() || household?.familyName || planNames.familyName
    if (!month) return fam ? `تقرير الخطة — ${fam}` : 'تقرير الخطة'
    return fam ? `خطة ${month} ${year} — ${fam}` : `خطة ${month} ${year}`
  }, [plan, an, names.familyName, household?.familyName, planNames.familyName])

  const effNames = useMemo(() => ({
    reportName: names.reportName.trim() || smartName,
    familyName: names.showNames ? (names.familyName?.trim() || household?.familyName || planNames.familyName || '') : '',
    preparerName: names.showNames ? (names.preparerName?.trim() || '') : '',
    planName: names.showNames ? (names.planName?.trim() || planNames.reportName || '') : '',
    showNames: names.showNames,
  }), [names, smartName, household?.familyName, planNames.familyName, planNames.reportName])
  const familyLabel = effNames.familyName || 'أسرة (بدون اسم)'

  const storeLabel = useCallback((storeId: string | null | undefined): string => {
    if (!storeId) return 'متوسط المتاجر'
    return storeMeta?.stores[storeId] ?? storeId
  }, [storeMeta])

  const spendAgg = useMemo<SpendAgg>(() => {
    const byEnvelope = new Map<string, { planned: number; actual: number }>()
    let planned = 0
    let actual = 0
    for (const e of spendLog) {
      planned += e.plannedFils
      actual += e.actualFils
      const k = e.envelopeId ?? '_none'
      const g = byEnvelope.get(k) ?? { planned: 0, actual: 0 }
      g.planned += e.plannedFils
      g.actual += e.actualFils
      byEnvelope.set(k, g)
    }
    return { byEnvelope, planned, actual }
  }, [spendLog])

  const spendByMonth = useMemo(() => {
    const m = new Map<string, { planned: number; actual: number }>()
    for (const e of spendLog) {
      const k = (e.dateISO ?? '').slice(0, 7)
      if (k.length !== 7) continue
      const g = m.get(k) ?? { planned: 0, actual: 0 }
      g.planned += e.plannedFils
      g.actual += e.actualFils
      m.set(k, g)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [spendLog])

  const topOverspend = useMemo(
    () => [...spendLog].sort((a, b) => (b.actualFils - b.plannedFils) - (a.actualFils - a.plannedFils)).slice(0, 8),
    [spendLog],
  )

  const infants = useMemo(() => (household ? infantInfos(household) : []), [household])

  const pantryRows = useMemo<PantryRow[]>(() => {
    if (!plan) return []
    const H = plan.horizonDays || 30
    return pantry.map((p) => {
      let daysLeft: number | null = null
      if (p.needId) {
        const base = needBase(p.needId)
        const dem = plan.demand.find((d) => d.needId === p.needId || needBase(d.needId) === base)
        if (dem && dem.qtyBaseUnit > 0) daysLeft = Math.floor(p.qtyBaseUnit / (dem.qtyBaseUnit / H))
      }
      return { item: p, daysLeft }
    })
  }, [pantry, plan])

  const reportRef = useMemo(() => {
    const d = new Date()
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    return `R-${ymd}-${String(d.getTime() % 10000).padStart(4, '0')}`
  }, [])
  const todayISO = useMemo(() => new Date().toISOString(), [])
  const docDate = dateAr(todayISO)

  // ----- assemble the document pages -----
  const docPages = useMemo<PageDef[]>(() => {
    if (!plan || !reportType) return []
    const rowsPerPage = paper === '80mm' ? 24 : paper === 'A5' ? 15 : orientation === 'landscape' ? 20 : 26
    const ctx: DocCtx = {
      reportType,
      an,
      fmt,
      num,
      pct,
      dateAr,
      plan,
      household,
      budgetFils: budget?.fils ?? plan.diagnostics.budgetFils,
      effNames,
      familyLabel,
      notesText,
      hijri,
      detailed,
      storeLabel,
      catalogInfo: storeMeta ? { version: storeMeta.version, generatedAt: storeMeta.generatedAt } : null,
      allItems,
      classSortedItems,
      classGroups,
      grandTotalFils,
      reportRef,
      todayISO,
      infants,
      pantryRows,
      spendAgg,
      spendByMonth,
      topOverspend,
      spendLog,
      rowsPerPage,
    }
    const avail = TYPE_SECTIONS[reportType]
    const want = (id: string) => avail.includes(id) && sections[id] !== false
    const pages: PageDef[] = []

    if (reportType === 'spending') {
      if (want('summary')) pages.push(...buildSpendingPages(ctx))
      if (want('diagnostics')) pages.push(buildDiagnosticsPage(ctx))
      if (want('methodology') || want('notes')) pages.push(buildMethodNotesPage(ctx, want('methodology'), want('notes')))
    } else {
      if (want('summary') || want('household')) {
        const title = want('summary') && want('household') ? 'الملخص والأسرة' : want('summary') ? 'الملخص' : 'الأسرة والعادات'
        pages.push({
          id: 'summary',
          title,
          node: (
            <div>
              {want('summary') ? buildSummaryNode(ctx) : null}
              {want('household') ? <div className="mt-6">{buildHouseholdNode(ctx)}</div> : null}
            </div>
          ),
        })
      }
      if (want('items')) {
        if (reportType === 'full-plan') {
          pages.push(...(detailed ? buildDetailedItemPages(ctx) : [buildGroupedItemsPage(ctx)]))
        } else if (reportType === 'shopping-list') {
          pages.push(...buildShoppingListPages(ctx))
        } else if (reportType === 'consumption') {
          pages.push(...buildConsumptionPages(ctx))
        } else if (reportType === 'product-compare') {
          pages.push(...buildComparePages(ctx))
        } else if (reportType === 'pantry') {
          pages.push(...buildPantryPages(ctx))
        } else if (reportType === 'calculator') {
          pages.push(...buildCalculatorPages(ctx))
        }
      }
      if (want('envelopes')) pages.push(...buildEnvelopePages(ctx))
      if (want('stores')) pages.push(buildStoresPage(ctx))
      if (want('explanations') && detailed) pages.push(buildExplanationsPage(ctx))
      if (want('diagnostics')) pages.push(buildDiagnosticsPage(ctx))
      if (want('methodology') || want('notes')) pages.push(buildMethodNotesPage(ctx, want('methodology'), want('notes')))
    }
    if (want('cover')) {
      const tocEntries: { title: string; page: number }[] = []
      const seenTitles = new Set<string>()
      pages.forEach((p, i) => {
        if (!seenTitles.has(p.title)) {
          seenTitles.add(p.title)
          tocEntries.push({ title: p.title, page: i + 2 })
        }
      })
      pages.unshift({ id: 'cover', title: 'الغلاف', node: buildCover(ctx, tocEntries) })
    }
    return pages
  }, [plan, reportType, household, budget, an, fmt, num, pct, dateAr, effNames, familyLabel, notesText, hijri, detailed, storeLabel, storeMeta, allItems, classSortedItems, classGroups, grandTotalFils, reportRef, todayISO, infants, pantryRows, spendAgg, spendByMonth, topOverspend, spendLog, sections, paper, orientation])

  // ----- share/export text -----
  const summaryText = useMemo(() => {
    if (!plan) return ''
    const top5 = [...allItems].sort((a, b) => b.costFils - a.costFils).slice(0, 5)
    return [
      `خصص بقالتك — ${effNames.reportName}`,
      familyLabel,
      `التكلفة المتوقعة: ${formatBHD(grandTotalFils)} (النطاق ${formatBHD(plan.totals.optimisticFils, { withUnit: false })} – ${formatBHD(plan.totals.pessimisticFils, { withUnit: false })})`,
      `عدد البنود: ${allItems.length}`,
      'أهم البنود:',
      ...top5.map((it) => `• ${it.productName} ×${it.packQty} — ${formatBHD(it.costFils)}`),
      'الأسعار تقديرية تاريخية — تحقق قبل الشراء',
    ].join('\n')
  }, [plan, allItems, grandTotalFils, effNames.reportName, familyLabel])

  // ----- actions -----
  const handlePrint = useCallback(() => {
    document.body.classList.add('printing-report')
    window.print()
  }, [])

  const typeSections = reportType
    ? Object.fromEntries(TYPE_SECTIONS[reportType].map((id) => [id, sections[id] !== false]))
    : {}

  const saveReport = () => {
    if (!plan || !reportType) return
    const entry: SavedReport = {
      id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      type: reportType,
      names: effNames,
      options: { paper, orientation, inkSaver, detailed, sections: typeSections as Record<string, boolean>, hijriOptional: hijri, notesText },
      createdAt: new Date().toISOString(),
      planFingerprint: plan.fingerprint,
    }
    const next = [entry, ...savedReports]
    setSavedReports(next)
    try { localStorage.setItem('khassis-reports', JSON.stringify(next)) } catch {
      /* التخزين المحلي ممتلئ — التقارير المحفوظة قد لا تُحفظ */
    }
    toast('حُفظ التقرير — أعد توليده متى شئت')
  }

  const regenerate = (r: SavedReport) => {
    setReportType(r.type)
    setNames({ ...r.names })
    setPaper(r.options.paper)
    setOrientation(r.options.orientation)
    setInkSaver(r.options.inkSaver)
    setDetailed(r.options.detailed)
    setSections((prev) => ({ ...prev, ...r.options.sections }))
    setHijri(r.options.hijriOptional ?? false)
    setNotesText(r.options.notesText ?? '')
    toast('حُمّلت إعدادات التقرير المحفوظ')
    setTimeout(() => optionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const deleteSaved = (id: string) => {
    const next = savedReports.filter((r) => r.id !== id)
    setSavedReports(next)
    try { localStorage.setItem('khassis-reports', JSON.stringify(next)) } catch {
      /* تعذّر تحديث التخزين */
    }
    toast('حُذف التقرير المحفوظ')
  }

  const exportCsv = () => {
    if (!plan || !reportType) return
    const rows: (string | number)[][] = [
      ['البند', 'العلامة', 'الحجم', 'الكمية', 'السعر (د.ب)', 'سعر الوحدة (د.ب)', 'المتجر'],
    ]
    for (const it of classSortedItems) {
      rows.push([
        it.productName,
        it.brand ?? '',
        it.sizeText ?? '',
        it.packQty,
        (it.costFils / 1000).toFixed(3),
        it.unitCostFils != null ? (it.unitCostFils / 1000).toFixed(3) : '',
        storeLabel(it.storeId),
      ])
    }
    rows.push(['المجموع الكلي', '', '', '', (grandTotalFils / 1000).toFixed(3), '', ''])
    const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
    downloadBlob(csv, 'text/csv;charset=utf-8', safeFileName(effNames.reportName, 'csv'))
    toast('صُدّرت بنود الخطة بصيغة CSV (متوافقة مع Excel)')
  }

  const exportJson = () => {
    if (!plan || !reportType) return
    const data = {
      app: 'khassis-baqalatak',
      generatedAt: new Date().toISOString(),
      type: reportType,
      names: effNames,
      options: { paper, orientation, inkSaver, detailed, sections: typeSections, hijriOptional: hijri, notesText },
      plan,
    }
    downloadBlob(JSON.stringify(data, null, 2), 'application/json;charset=utf-8', safeFileName(effNames.reportName, 'json'))
    toast('صُدّر التقرير كاملاً بصيغة JSON')
  }

  const shareWhatsApp = () => {
    if (!summaryText) return
    window.open(`https://wa.me/?text=${encodeURIComponent(summaryText)}`, '_blank', 'noopener')
    toast('افتح واتساب لإرسال الملخص')
  }

  const copySummary = async () => {
    if (!summaryText) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(summaryText)
      toast('نُسخ ملخص التقرير إلى الحافظة')
    } catch {
      toast('تعذّر النسخ التلقائي — جرّب زر واتساب أو التصدير')
    }
  }

  const showWorkspace = reportType != null && plan != null

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6 pb-8 pt-2">
      {/* injected report-document CSS (paper sizes, print overrides) */}
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: pageRuleFor(paper, orientation) }} />

      {/* header */}
      <section className="no-print space-y-2">
        <h1 className="big-title">مركز التقارير</h1>
        <p className="text-muted-foreground leading-relaxed max-w-xl text-[15px]">
          ولّد تقارير قابلة للطباعة من خطتك: الغلاف بالأسماء المخصصة، الملخص، البنود، الأظرف،
          المتاجر والرحلات — باختيارك للمقاس والاتجاه ووضع توفير الحبر، مع تصدير ومشاركة.
        </p>
      </section>

      {/* saved reports */}
      <section className="no-print" aria-label="التقارير المحفوظة">
        <SectionTitle>التقارير المحفوظة</SectionTitle>
        <GlassCard className="p-4 space-y-3">
          {savedReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد تقارير محفوظة — ولّد تقريراً ثم اضغط «احفظ التقرير».</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto nice-scroll">
              {savedReports.map((r) => {
                const def = REPORT_TYPES.find((t) => t.id === r.type)
                const Icon = def?.icon ?? FileText
                return (
                  <div key={r.id} className="glass-row rounded-xl p-3 flex items-center gap-3">
                    <span className="w-10 h-10 rounded-lg glass-ultrathin grid place-items-center text-primary shrink-0">
                      <Icon size={18} strokeWidth={1.75} aria-hidden />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{r.names.reportName}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {TYPE_LABEL[r.type] ?? r.type} — {formatDateAr(r.createdAt)} — بصمة <span dir="ltr">{r.planFingerprint.slice(0, 10)}</span>
                      </div>
                    </div>
                    {plan && r.planFingerprint !== plan.fingerprint ? <Pill tone="warn">خطة مختلفة</Pill> : null}
                    <div className="flex gap-1 shrink-0">
                      <GlassButton size="sm" onClick={() => regenerate(r)}>
                        <RotateCcw size={13} strokeWidth={1.75} aria-hidden /> أعد التوليد
                      </GlassButton>
                      <GlassButton size="sm" variant="danger" onClick={() => deleteSaved(r.id)} aria-label={`حذف تقرير ${r.names.reportName}`}>
                        <Trash2 size={13} strokeWidth={1.75} aria-hidden />
                      </GlassButton>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground flex items-start gap-2 border-t border-border/60 pt-3">
            <CalendarDays size={14} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden />
            <span>جدولة شهرية: افتح التقرير في أول الشهر وأعد توليده — نعمل على التذكير التلقائي.</span>
          </div>
        </GlassCard>
      </section>

      {/* report type picker */}
      <section className="no-print" aria-label="نوع التقرير">
        <SectionTitle>اختر نوع التقرير</SectionTitle>
        {!plan ? (
          <EmptyState
            icon={<FileText size={24} strokeWidth={1.75} aria-hidden />}
            title="ولّد خطة أولاً"
            subtitle="التقارير تُبنى من خطتك — أكمل معالج البدء (أقل من دقيقتين) ثم عد إلى هنا"
            action={<GlassButton variant="primary" size="lg" onClick={() => navigate({ name: 'start' })}>ابدأ الخطة الآن</GlassButton>}
          />
        ) : null}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {REPORT_TYPES.map(({ id, label, hint, icon: Icon }) => {
            const disabled = !plan
            const active = reportType === id
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => setReportType(id)}
                className={cn(
                  'text-start rounded-2xl p-4 min-h-[120px] flex flex-col gap-1.5 transition-all',
                  active ? 'bg-primary/15 border-2 border-primary' : 'glass border border-transparent hover:bg-secondary/50',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <Icon size={22} strokeWidth={1.75} aria-hidden className={active ? 'text-primary' : 'text-muted-foreground'} />
                <span className={cn('font-bold text-sm leading-snug', active && 'text-primary')}>{label}</span>
                <span className="text-[11px] text-muted-foreground leading-relaxed">{hint}</span>
                {disabled ? <span className="text-[10px] text-muted-foreground">يتطلب خطة مولّدة</span> : null}
              </button>
            )
          })}
        </div>
      </section>

      {showWorkspace ? (
        <>
          {/* options panel */}
          <section className="no-print" aria-label="خيارات التقرير" ref={optionsRef}>
            <SectionTitle>خيارات التقرير</SectionTitle>
            <GlassCard className="p-5 space-y-6">
              {/* custom names (7.20) */}
              <div>
                <h3 className="font-bold text-sm mb-1 flex items-center gap-2"><Tag size={15} strokeWidth={1.75} aria-hidden /> الأسماء (تظهر على الغلاف)</h3>
                <p className="text-[11px] text-muted-foreground mb-3">اترك أي حقل فارغاً لاستخدام الاسم الذكي المقترح تلقائياً.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-name">اسم التقرير</Label>
                    <Input id="rep-name" value={names.reportName} placeholder={smartName} onChange={(e) => setNames({ ...names, reportName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-family">اسم الأسرة</Label>
                    <Input id="rep-family" value={names.familyName ?? ''} placeholder={household?.familyName || planNames.familyName || 'مثال: أسرة العلي'} onChange={(e) => setNames({ ...names, familyName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-preparer">اسم معدّ التقرير</Label>
                    <Input id="rep-preparer" value={names.preparerName ?? ''} placeholder="من أعدّ التقرير" onChange={(e) => setNames({ ...names, preparerName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-plan">اسم الخطة</Label>
                    <Input id="rep-plan" value={names.planName ?? ''} placeholder={planNames.reportName || 'خطة البقالة'} onChange={(e) => setNames({ ...names, planName: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-11 mt-3">
                  <div>
                    <Label htmlFor="show-names" className="cursor-pointer">إظهار الأسماء</Label>
                    <p className="text-[11px] text-muted-foreground">عند الإيقاف يظهر «أسرة (بدون اسم)» في التقرير المطبوع.</p>
                  </div>
                  <Switch id="show-names" checked={names.showNames} onCheckedChange={(v) => setNames({ ...names, showNames: v })} />
                </div>
              </div>

              {/* paper / orientation / version / ink saver / hijri */}
              <div>
                <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><Printer size={15} strokeWidth={1.75} aria-hidden /> الورق والطباعة</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-paper">مقاس الورق</Label>
                    <Select value={paper} onValueChange={(v) => setPaper(v as ReportOptions['paper'])}>
                      <SelectTrigger id="rep-paper" className="w-full" aria-label="مقاس الورق">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A4">A4 — قياسي</SelectItem>
                        <SelectItem value="A5">A5 — صغير</SelectItem>
                        <SelectItem value="letter">Letter</SelectItem>
                        <SelectItem value="80mm">80mm — شريط إيصالات</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>الاتجاه</Label>
                    <div className="flex gap-2" role="radiogroup" aria-label="اتجاه الورق">
                      <SegBtn active={orientation === 'portrait'} onClick={() => setOrientation('portrait')} ariaLabel="عمودي">عمودي</SegBtn>
                      <SegBtn active={orientation === 'landscape'} onClick={() => setOrientation('landscape')} ariaLabel="أفقي">أفقي</SegBtn>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>النسخة</Label>
                    <div className="flex gap-2" role="radiogroup" aria-label="نسخة التقرير">
                      <SegBtn active={!detailed} onClick={() => setDetailed(false)} ariaLabel="نسخة عامة">عامة (مجموعات)</SegBtn>
                      <SegBtn active={detailed} onClick={() => setDetailed(true)} ariaLabel="نسخة تفصيلية">تفصيلية (منتجات)</SegBtn>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 min-h-11">
                    <div>
                      <Label htmlFor="ink-saver" className="cursor-pointer">وضع توفير الحبر</Label>
                      <p className="text-[11px] text-muted-foreground">أبيض وأسود بلا ألوان.</p>
                    </div>
                    <Switch id="ink-saver" checked={inkSaver} onCheckedChange={setInkSaver} />
                  </div>
                  <label className="flex items-center gap-2 min-h-11 cursor-pointer glass-thin rounded-xl px-3 sm:col-span-2">
                    <Checkbox checked={hijri} onCheckedChange={(v) => setHijri(v === true)} aria-label="إظهار التاريخ الهجري" />
                    <span className="text-sm font-medium">أضف التاريخ الهجري بجانب الميلادي على الغلاف</span>
                  </label>
                </div>
              </div>

              {/* sections */}
              <div>
                <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><Layers size={15} strokeWidth={1.75} aria-hidden /> الأقسام المعروضة</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SECTION_DEFS.filter((s) => (reportType ? TYPE_SECTIONS[reportType] : []).includes(s.id)).map((s) => (
                    <label key={s.id} className="flex items-center gap-2 min-h-11 glass-thin rounded-xl px-3 cursor-pointer">
                      <Checkbox
                        checked={sections[s.id] !== false}
                        onCheckedChange={(v) => setSections((prev) => ({ ...prev, [s.id]: v === true }))}
                        aria-label={s.label}
                      />
                      <span className="text-sm">{s.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* notes */}
              <div className="space-y-1.5">
                <h3 className="font-bold text-sm flex items-center gap-2"><StickyNote size={15} strokeWidth={1.75} aria-hidden /> ملاحظات التقرير</h3>
                <Textarea
                  id="rep-notes"
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="ملاحظاتك على الخطة أو التقرير — تُطبع في قسم «ملاحظات وتوقيعات»…"
                  className="bg-white/60"
                  rows={3}
                />
              </div>
            </GlassCard>
          </section>

          {/* print preview */}
          <section aria-label="معاينة التقرير">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">معاينة التقرير</h2>
                <Pill tone="primary">{docPages.length > 0 ? `${num(docPages.length)} صفحات` : 'بلا أقسام'}</Pill>
                <Pill>{detailed ? 'تفصيلية' : 'عامة'}</Pill>
                <Pill>{paper}{orientation === 'landscape' ? ' — أفقي' : ''}</Pill>
              </div>
              <GlassButton variant="primary" onClick={handlePrint}>
                <Printer size={16} strokeWidth={1.75} aria-hidden /> طباعة
              </GlassButton>
            </div>
            <p className="no-print text-[11px] text-muted-foreground flex items-center gap-1.5 mb-3">
              <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
              عند الطباعة تُطبع المعاينة فقط — تُخفى خيارات التطبيق والتنقل تلقائياً.
            </p>
            <div
              id="report-doc"
              data-paper={paper}
              data-orientation={orientation}
              dir="rtl"
              className={cn('bg-white text-black rounded-xl p-8 shadow-xl mx-auto', inkSaver && 'ink-saver')}
            >
              {docPages.length > 0 ? docPages.map((p, i) => (
                <div key={`${i}-${p.id}`} className="print-page">
                  {p.node}
                  <div className="rdoc-footer">
                    <span>خصص بقالتك — تقرير {TYPE_LABEL[reportType!]} — {familyLabel} — {docDate} — الأسعار تقديرية</span>
                    <span className="rdoc-num">صفحة {num(i + 1)} من {num(docPages.length)}</span>
                  </div>
                </div>
              )) : (
                <div className="print-page">
                  <p className="rdoc-p">لم تُحدَّد أي أقسام — فعّل قسماً واحداً على الأقل من خيارات التقرير.</p>
                </div>
              )}
            </div>
          </section>

          {/* action bar (sticky bottom) */}
          <div className="sticky bottom-24 md:bottom-6 z-30 no-print">
            <div className="glass-chrome rounded-2xl p-2 flex flex-wrap items-center justify-center gap-2 max-w-3xl mx-auto">
              <GlassButton variant="primary" onClick={handlePrint}>
                <Printer size={16} strokeWidth={1.75} aria-hidden /> طباعة
              </GlassButton>
              <GlassButton onClick={saveReport}>
                <Save size={16} strokeWidth={1.75} aria-hidden /> احفظ التقرير
              </GlassButton>
              <GlassButton onClick={exportCsv}>
                <FileDown size={16} strokeWidth={1.75} aria-hidden /> تصدير CSV
              </GlassButton>
              <GlassButton onClick={exportJson}>
                <Braces size={16} strokeWidth={1.75} aria-hidden /> تصدير JSON
              </GlassButton>
              <GlassButton onClick={shareWhatsApp}>
                <MessageCircle size={16} strokeWidth={1.75} aria-hidden /> واتساب
              </GlassButton>
              <GlassButton onClick={copySummary}>
                <Copy size={16} strokeWidth={1.75} aria-hidden /> نسخ كنص
              </GlassButton>
            </div>
          </div>
        </>
      ) : null}

      {/* local toast */}
      {toastMsg ? (
        <div className="no-print fixed bottom-24 md:bottom-8 inset-x-0 z-50 flex justify-center px-4 pointer-events-none" role="status" aria-live="polite">
          <div className="glass-chrome rounded-full px-5 py-2.5 text-sm font-semibold shadow-lg max-w-full truncate">{toastMsg}</div>
        </div>
      ) : null}
    </div>
  )
}
