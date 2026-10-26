'use client'
/**
 * App shell: three layout shells (phone bottom-tabs / tablet split / desktop
 * sidebar), aurora background, RTL-first, theme handling, age-gate modal.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app-store'
import { useRoute, navigate, type Route } from '@/lib/router'
import { t } from '@/lib/i18n'
import { Home, Sparkles, ClipboardList, Store, Wallet, Settings as SettingsIcon, HelpCircle, Users, BarChart3, Calculator, Bell, Boxes, ShieldCheck, ArrowLeft, ShoppingCart, SlidersHorizontal } from 'lucide-react'

const TABS: { route: Route; key: Parameters<typeof t>[0]; icon: typeof Home }[] = [
  { route: { name: 'home' }, key: 'home', icon: Home },
  { route: { name: 'catalog' }, key: 'catalog', icon: Store },
  { route: { name: 'plan' }, key: 'plan', icon: ClipboardList },
  { route: { name: 'reports' }, key: 'reports', icon: BarChart3 },
  { route: { name: 'settings' }, key: 'settings', icon: SettingsIcon },
]

const SIDE_LINKS: { route: Route; key: Parameters<typeof t>[0]; icon: typeof Home }[] = [
  { route: { name: 'home' }, key: 'home', icon: Home },
  { route: { name: 'start' }, key: 'start', icon: Sparkles },
  { route: { name: 'plan' }, key: 'plan', icon: ClipboardList },
  { route: { name: 'shopping' }, key: 'shopping', icon: Store },
  { route: { name: 'catalog' }, key: 'catalog', icon: Boxes },
  { route: { name: 'envelopes' }, key: 'envelopes', icon: Wallet },
  { route: { name: 'advanced' }, key: 'advanced', icon: SlidersHorizontal },
  { route: { name: 'reports' }, key: 'reports', icon: BarChart3 },
  { route: { name: 'calculators' }, key: 'calculators', icon: Calculator },
  { route: { name: 'pantry' }, key: 'pantry', icon: Boxes },
  { route: { name: 'spending' }, key: 'spending', icon: BarChart3 },
  { route: { name: 'alerts' }, key: 'alerts', icon: Bell },
  { route: { name: 'index' }, key: 'index', icon: BarChart3 },
  { route: { name: 'community' }, key: 'community', icon: Users },
  { route: { name: 'help' }, key: 'help', icon: HelpCircle },
  { route: { name: 'settings' }, key: 'settings', icon: SettingsIcon },
  { route: { name: 'admin' }, key: 'admin', icon: ShieldCheck },
]

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const [route] = useRoute()
  const lang = useApp((s) => s.settings.lang)
  const theme = useApp((s) => s.settings.theme)
  const reduceTransparency = useApp((s) => s.settings.reduceTransparency)

  // apply theme class + transparency class to <html>
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-transparency', reduceTransparency)
  }, [reduceTransparency])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const active = (r: Route) => {
    if (r.name === 'catalog' && route.name === 'product') return true
    return route.name === r.name
  }

  return (
    <div className={cn('shell relative', reduceTransparency && 'reduce-transparency')}>
      <div className="aurora-bg" aria-hidden>
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
        <div className="aurora-noise" />
      </div>

      {/* desktop / tablet sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 inset-inline-start-0 w-[68px] lg:w-[240px] z-30 flex-col gap-1 p-3 glass-chrome m-3 rounded-3xl" aria-label="التنقل الرئيسي">
        <button onClick={() => navigate({ name: 'home' })} className="flex items-center gap-3 px-3 py-3 mb-2 rounded-2xl hover:bg-secondary/50 transition-colors text-start">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary text-primary-foreground shrink-0">
            <ShoppingCart size={22} strokeWidth={1.75} aria-hidden />
          </span>
          <span className="hidden lg:block font-extrabold text-lg leading-tight">{t('appName', lang)}</span>
        </button>
        <nav className="flex-1 overflow-y-auto nice-scroll space-y-0.5">
          {SIDE_LINKS.map(({ route: r, key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => navigate(r)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                active(r) ? 'bg-primary/15 text-primary' : 'text-foreground/75 hover:bg-secondary/50'
              )}
              aria-current={active(r) ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="hidden lg:block">{t(key, lang)}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* main column (offset for sidebar on >=md) */}
      <div className={cn('flex-1 flex flex-col', 'md:ms-[92px] lg:ms-[264px]')}>
        {title ? (
          <header className="sticky top-0 z-20 glass-chrome mx-3 mt-3 rounded-2xl px-4 py-3 flex items-center gap-2 no-print">
            <button
              onClick={() => window.history.back()}
              className="md:hidden grid place-items-center w-9 h-9 rounded-full hover:bg-secondary/60"
              aria-label={t('back', lang)}
            >
              <ArrowLeft size={20} strokeWidth={1.75} className="flip-x" aria-hidden />
            </button>
            <h1 className="text-base font-bold truncate">{title}</h1>
          </header>
        ) : null}
        <main className="shell-main" id="main-content">{children}</main>
      </div>

      {/* phone tab bar */}
      <nav className="tabbar md:hidden px-3 pb-3" aria-label="التنقل السفلي">
        <div className="glass-chrome rounded-3xl flex items-stretch justify-around px-1 py-1 max-w-md mx-auto">
          {TABS.map(({ route: r, key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => navigate(r)}
              className={cn(
                'flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium transition-all',
                active(r) ? 'text-primary bg-primary/10' : 'text-foreground/60'
              )}
              aria-current={active(r) ? 'page' : undefined}
            >
              <Icon size={22} strokeWidth={1.75} aria-hidden />
              <span>{t(key, lang)}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
