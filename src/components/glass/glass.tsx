'use client'
/**
 * Glass UI primitives (spec section 10): monochrome SVG icons ONLY (no emoji),
 * glass materials, tab bar, large titles. Icons: lucide-react (mono, ISC license)
 * wrapped for consistency + custom category icons.
 */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function GlassCard({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div ref={undefined} className={cn('glass rounded-2xl p-4', className)} {...rest}>
      {children}
    </div>
  )
}

export function GlassRow({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass-row rounded-xl p-3', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-lg font-bold tracking-tight mb-3', className)}>{children}</h2>
}

export function Pill({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'primary' | 'accent' | 'warn' | 'danger'; className?: string }) {
  const tones: Record<string, string> = {
    default: 'bg-secondary text-secondary-foreground',
    primary: 'bg-primary/15 text-primary dark:text-primary',
    accent: 'bg-accent/15 text-accent',
    warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    danger: 'bg-destructive/15 text-destructive',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
}

/** value accepts ReactNode so animated counters (CountUp) can be embedded; plain strings keep working */
export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'primary' | 'accent' | 'danger' | 'default' }) {
  const tones: Record<string, string> = {
    default: 'text-foreground',
    primary: 'text-primary',
    accent: 'text-accent',
    danger: 'text-destructive',
  }
  return (
    <div className="glass-thin rounded-xl p-3 flex-1 min-w-[130px]">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={cn('text-xl font-bold tabular-nums', tones[tone ?? 'default'])}>{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </div>
  )
}

export function EmptyState({ icon, title, subtitle, action }: { icon?: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="glass-ultrathin rounded-2xl p-8 text-center max-w-md mx-auto my-8">
      {icon ? <div className="mx-auto mb-3 w-12 h-12 rounded-full glass-thin grid place-items-center text-muted-foreground">{icon}</div> : null}
      <div className="font-bold text-lg mb-1">{title}</div>
      {subtitle ? <div className="text-sm text-muted-foreground mb-4">{subtitle}</div> : null}
      {action}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('inline-block w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin', className)} role="status" aria-label="جارٍ التحميل" />
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-row h-16 rounded-xl animate-pulse opacity-60" />
      ))}
    </div>
  )
}

/** primary glass button (44px+ touch target) — accepts native button props incl. `disabled` */
export const GlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }>(
  function GlassButton({ className, variant = 'ghost', size = 'md', ...rest }, ref) {
    const variants: Record<string, string> = {
      primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20',
      ghost: 'glass-thin hover:bg-secondary/60',
      danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    }
    const sizes: Record<string, string> = {
      sm: 'h-9 px-3 text-sm rounded-lg',
      md: 'min-h-11 px-4 text-sm rounded-xl',
      lg: 'min-h-13 px-6 text-base rounded-2xl',
    }
    return <button ref={ref} className={cn('inline-flex items-center justify-center gap-2 font-semibold transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none', variants[variant], sizes[size], className)} {...rest} />
  }
)
