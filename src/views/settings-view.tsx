'use client'
/**
 * Settings (spec 7.10-style): language & numerals, appearance & accessibility,
 * simplified mode, default report names, local data export/import/wipe, age
 * gate, and app/engine/catalog info. Everything persists on-device only.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useApp, type PriceAlert } from '@/store/app-store'
import { fetchCatalogMeta, type CatalogMeta } from '@/lib/api-client'
import { formatNumberAr, formatDateAr } from '@/lib/money'
import { ENGINE_VERSION } from '@/lib/engine'
import type { Budget, BudgetEnvelope, Household, LockedChoice, PantryItem, PlanResult, SpendLogEntry } from '@/lib/engine/types'
import { GlassCard, GlassButton, Pill, SectionTitle, Spinner } from '@/components/glass/glass'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  Languages, Palette, Gauge, UserRound, Database, ShieldCheck, Info,
  Download, Upload, Trash2, RefreshCw, Check, TriangleAlert,
} from 'lucide-react'

const APP_VERSION = '0.2.1'

// ---------------------------------------------------------------- atoms

function SettingsRow({ icon: Icon, title, desc, children }: {
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>
  title: string
  desc?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-border/40 last:border-b-0">
      {Icon ? (
        <span className="w-10 h-10 rounded-xl glass-thin grid place-items-center shrink-0 text-primary">
          <Icon size={17} strokeWidth={1.75} aria-hidden />
        </span>
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        {desc ? <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</div> : null}
      </div>
      {children ? <div className="shrink-0 self-center">{children}</div> : null}
    </div>
  )
}

function Segmented<T extends string>({ options, value, onChange, ariaLabel }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="glass-thin rounded-xl p-1 flex gap-1 min-h-13" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 min-h-11 px-3 rounded-lg text-sm font-semibold transition-all ${value === o.value ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'hover:bg-secondary/60'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ToggleSwitch({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label htmlFor={id} className="grid place-items-center min-h-11 min-w-11 cursor-pointer" aria-hidden={false}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="scale-[1.3]" />
    </label>
  )
}

// ---------------------------------------------------------------- view

export function SettingsView() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const arabicNumerals = settings.arabicNumerals

  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // language direction on <html> (also handled by the app shell — idempotent)
  useEffect(() => {
    document.documentElement.lang = settings.lang
    document.documentElement.dir = settings.lang === 'ar' ? 'rtl' : 'ltr'
  }, [settings.lang])

  // reduced motion: toggle class on <html>; inject the style rules once
  // (globals CSS consumes the class for the aurora background)
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('reduce-motion', settings.reduceMotion)
    if (!document.getElementById('kb-reduce-motion-style')) {
      const style = document.createElement('style')
      style.id = 'kb-reduce-motion-style'
      style.textContent = [
        '.reduce-motion .aurora-blob, .reduce-motion .aurora-noise { animation: none !important; }',
        '.reduce-motion * { scroll-behavior: auto !important; }',
        '.reduce-motion *, .reduce-motion *::before, .reduce-motion *::after { transition-duration: 0.01ms !important; }',
      ].join('\n')
      document.head.appendChild(style)
    }
  }, [settings.reduceMotion])

  // catalog meta (once)
  useEffect(() => {
    let cancelled = false
    fetchCatalogMeta()
      .then((m) => { if (!cancelled) setCatalogMeta(m) })
      .catch(() => { /* offline is fine */ })
      .finally(() => { if (!cancelled) setMetaLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ---- data export / import / wipe
  const exportAll = () => {
    const s = useApp.getState()
    const data = {
      app: 'khassis-baqalatak',
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      household: s.household,
      budget: s.budget,
      envelopes: s.envelopes,
      locks: s.locks,
      plan: s.plan,
      pantry: s.pantry,
      spendLog: s.spendLog,
      alerts: s.alerts,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `khassis-baqalatak-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importFile = (file: File) => {
    setImportMsg(null)
    void file.text()
      .then((text) => {
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(text) as Record<string, unknown>
        } catch {
          setImportMsg('الملف ليس JSON صالحاً.')
          return
        }
        const data = parsed
        const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null)
        const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
        const household = obj(data.household)
        const budget = obj(data.budget)
        const plan = obj(data.plan)
        if (!household && !budget && !plan && !Array.isArray(data.pantry)) {
          setImportMsg('لم نجد بيانات «خصص بقالتك» معروفة داخل الملف.')
          return
        }
        useApp.setState({
          household: household ? (household as unknown as Household) : null,
          budget: budget ? (budget as unknown as Budget) : null,
          envelopes: list<BudgetEnvelope>(data.envelopes),
          locks: list<LockedChoice>(data.locks),
          plan: plan ? (plan as unknown as PlanResult) : null,
          pantry: list<PantryItem>(data.pantry),
          spendLog: list<SpendLogEntry>(data.spendLog),
          alerts: list<PriceAlert>(data.alerts),
        })
        const count = list(data.pantry).length + list(data.spendLog).length + list(data.alerts).length
        setImportMsg(`تم الاستيراد بنجاح${count > 0 ? ` — ${formatNumberAr(count, arabicNumerals)} سجلاً جانبياً` : ''}. قد تحتاج لإعادة توليد خطتك.`)
      })
      .catch(() => setImportMsg('تعذر قراءة الملف.'))
  }

  const wipeAll = () => {
    useApp.getState().resetAll()
    try { localStorage.removeItem('khassis-baqalatak') } catch { /* storage unavailable */ }
    window.location.reload()
  }

  return (
    <div className="space-y-8 pt-2 pb-8">
      {/* 1. language & numerals */}
      <section aria-label="اللغة والأرقام">
        <SectionTitle>اللغة والأرقام</SectionTitle>
        <GlassCard className="px-4 py-1">
          <SettingsRow icon={Languages} title="اللغة" desc="العربية هي اللغة الأساسية للتطبيق؛ الإنجليزية تغطي التنقل وأهم العناصر.">
            <Segmented
              ariaLabel="اختيار اللغة"
              value={settings.lang}
              onChange={(v) => setSettings({ lang: v })}
              options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]}
            />
          </SettingsRow>
          <SettingsRow
            icon={Info}
            title="الأرقام العربية الهندية"
            desc="عرض الأرقام بالصيغة العربية (٠١٢٣) بدل الغربية (0123) في كل المبالغ والعدّادات."
          >
            <ToggleSwitch id="sw-arabic-numerals" checked={settings.arabicNumerals} onChange={(v) => setSettings({ arabicNumerals: v })} />
          </SettingsRow>
        </GlassCard>
      </section>

      {/* 2. appearance */}
      <section aria-label="المظهر">
        <SectionTitle>المظهر</SectionTitle>
        <GlassCard className="px-4 py-1">
          <SettingsRow icon={Palette} title="السمة" desc="فاتح أو داكن أو تبعاً لنظام جهازك.">
            <Segmented
              ariaLabel="اختيار السمة"
              value={settings.theme}
              onChange={(v) => setSettings({ theme: v })}
              options={[{ value: 'light', label: 'فاتح' }, { value: 'dark', label: 'داكن' }, { value: 'system', label: 'النظام' }]}
            />
          </SettingsRow>
          <SettingsRow
            title="تقليل الشفافية"
            desc="استبدال الخلفيات الزجاجية بخلفيات مصمتة أوضح للقراءة وأخف على الأجهزة الضعيفة."
          >
            <ToggleSwitch id="sw-transparency" checked={settings.reduceTransparency} onChange={(v) => setSettings({ reduceTransparency: v })} />
          </SettingsRow>
          <SettingsRow
            title="تقليل الحركة"
            desc="إيقاف حركة الخلفية المتدرجة (أورورا) وتقصير الانتقالات — مفيد لحساسية الحركة."
          >
            <ToggleSwitch id="sw-motion" checked={settings.reduceMotion} onChange={(v) => setSettings({ reduceMotion: v })} />
          </SettingsRow>
        </GlassCard>
      </section>

      {/* 3. simplified mode */}
      <section aria-label="الوضع المبسّط">
        <SectionTitle>الوضع المبسّط</SectionTitle>
        <GlassCard className="px-4 py-1">
          <SettingsRow icon={Gauge} title="الوضع المبسّط" desc="أزرار أكبر وخطوات أقل">
            <ToggleSwitch id="sw-simplified" checked={settings.simplifiedMode} onChange={(v) => setSettings({ simplifiedMode: v })} />
          </SettingsRow>
        </GlassCard>
      </section>

      {/* 4. default report names */}
      <section aria-label="الأسماء الافتراضية للتقارير">
        <SectionTitle>الأسماء الافتراضية للتقارير</SectionTitle>
        <GlassCard className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            تُستخدم هذه الأسماء في تقاريرك المطبوعة ما لم تغيّرها عند التوليد. اتركها فارغة للبقاء مجهولاً.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="def-family" className="block text-sm font-semibold mb-2">اسم الأسرة</label>
              <input
                id="def-family"
                value={settings.defaultNames.familyName ?? ''}
                onChange={(e) => setSettings({ defaultNames: { ...settings.defaultNames, familyName: e.target.value || undefined } })}
                maxLength={80}
                placeholder="مثال: آل العريبي"
                className="w-full min-h-11 rounded-xl glass-thin bg-transparent px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
            <div>
              <label htmlFor="def-preparer" className="block text-sm font-semibold mb-2">اسم معدّ التقرير</label>
              <input
                id="def-preparer"
                value={settings.defaultNames.preparerName ?? ''}
                onChange={(e) => setSettings({ defaultNames: { ...settings.defaultNames, preparerName: e.target.value || undefined } })}
                maxLength={80}
                placeholder="مثال: أم عبدالله"
                className="w-full min-h-11 rounded-xl glass-thin bg-transparent px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          </div>
        </GlassCard>
      </section>

      {/* 5. my data */}
      <section aria-label="بياناتي">
        <SectionTitle>بياناتي</SectionTitle>
        <GlassCard className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            كل بياناتك محفوظة في هذا الجهاز فقط. صدّرها كملف نسخ احتياطي أو لنقلها إلى جهاز آخر —
            أو امسحها نهائياً.
          </p>
          <div className="flex flex-wrap gap-2">
            <GlassButton onClick={exportAll}>
              <Download size={15} strokeWidth={1.75} aria-hidden /> تصدير كل البيانات (JSON)
            </GlassButton>
            <GlassButton onClick={() => fileRef.current?.click()}>
              <Upload size={15} strokeWidth={1.75} aria-hidden /> استيراد من ملف
            </GlassButton>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="اختر ملف النسخة الاحتياطية"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importFile(f)
                e.target.value = ''
              }}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <GlassButton variant="danger">
                  <Trash2 size={15} strokeWidth={1.75} aria-hidden /> حذف كل بياناتي
                </GlassButton>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader className="text-right">
                  <AlertDialogTitle>حذف كل بياناتك نهائياً؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    سيُمحو أفراد أسرك وميزانيتك وخطتك ومخزونك وسجل إنفاقك وتنبيهاتك من هذا الجهاز.
                    لا يمكن التراجع — صدّر نسخة احتياطية أولاً إن كنت تحتاجها.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>إلغاء</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={wipeAll}
                  >
                    نعم، احذف كل شيء
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {importMsg ? (
            <div className="glass-thin rounded-xl p-3 text-sm flex items-center gap-2" role="status">
              {importMsg.startsWith('تم') ? <Check size={15} strokeWidth={1.75} className="text-primary" aria-hidden /> : <TriangleAlert size={15} strokeWidth={1.75} className="text-destructive" aria-hidden />}
              {importMsg}
            </div>
          ) : null}
        </GlassCard>
      </section>

      {/* 6. age gate */}
      <section aria-label="بوابة العمر">
        <SectionTitle>بوابة العمر</SectionTitle>
        <GlassCard className="px-4 py-1">
          <SettingsRow
            icon={ShieldCheck}
            title="بوابة العمر"
            desc="فحص واحد عند أول استخدام يتيح محتوى فئات البالغين (مثل التبغ)."
          >
            <div className="flex items-center gap-2">
              <Pill tone={settings.ageGatePassed ? 'primary' : 'warn'}>
                {settings.ageGatePassed ? 'تم اجتيازها' : 'لم تُجتز بعد'}
              </Pill>
              <GlassButton size="sm" onClick={() => setSettings({ ageGatePassed: false })}>
                <RefreshCw size={13} strokeWidth={1.75} aria-hidden /> إعادة الضبط
              </GlassButton>
            </div>
          </SettingsRow>
        </GlassCard>
      </section>

      {/* 7. about */}
      <section aria-label="معلومات">
        <SectionTitle>معلومات</SectionTitle>
        <GlassCard className="px-4 py-1">
          <SettingsRow title="إصدار التطبيق">
            <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">{APP_VERSION}</span>
          </SettingsRow>
          <SettingsRow title="إصدار محرك التوصيات">
            <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">{ENGINE_VERSION}</span>
          </SettingsRow>
          <SettingsRow title="إصدار قاعدة البيانات">
            {metaLoading ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="w-3.5 h-3.5" /> نحمّل…</span>
            ) : catalogMeta ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                <span dir="ltr">{catalogMeta.version}</span> · {formatNumberAr(catalogMeta.productCount, arabicNumerals)} منتجاً · لقطة {formatDateAr(catalogMeta.generatedAt)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">غير متاح حالياً</span>
            )}
          </SettingsRow>
          <SettingsRow title="الترخيص والخصوصية">
            <Pill tone="primary">مفتوح المصدر — بياناتك محلية</Pill>
          </SettingsRow>
        </GlassCard>
      </section>
    </div>
  )
}
