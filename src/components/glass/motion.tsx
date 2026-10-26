'use client'
/**
 * Motion primitives (framer-motion) — the shared animation layer.
 *
 * Every component respects reduced motion from BOTH sources, OR'ed together:
 *   1. the user setting  — `settings.reduceMotion` (app store)
 *   2. the OS preference — `prefers-reduced-motion` (useReducedMotion)
 * When reduced, components render statically (no transforms, no counters,
 * no enter animations) while keeping the exact same DOM/layout.
 *
 * Print safety: enter animations end with the final value as an inline style,
 * and `.motion-fade` / `.motion-item` are force-shown via `@media print`
 * rules in globals.css, so paper output is always complete.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useReducedMotion, type Variants } from 'framer-motion'
import { useApp } from '@/store/app-store'
import { cn } from '@/lib/utils'

/** true when animations are allowed (store setting AND media query both clear) */
function useMotionEnabled(): boolean {
  const setting = useApp((s) => s.settings.reduceMotion)
  const media = useReducedMotion()
  return !setting && !media
}

// ---------------------------------------------------------------------------
// FadeIn — mount fade + rise
// ---------------------------------------------------------------------------

/** Mount fade-in + 8px rise (240ms ease-out). Static when motion is reduced. */
export function FadeIn({ children, delay = 0, y = 8 }: { children: ReactNode; delay?: number; y?: number }) {
  const ok = useMotionEnabled()
  return (
    <motion.div
      className="motion-fade"
      initial={ok ? { opacity: 0, y } : undefined}
      animate={{ opacity: 1, y: 0 }}
      transition={ok ? { duration: 0.24, ease: 'easeOut', delay } : { duration: 0 }}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// StaggerList / StaggerItem — variant cascade
// ---------------------------------------------------------------------------

const LIST_VARIANTS: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.028 } },
}

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: 'easeOut' } },
}

/** Container that staggers its StaggerItem children by 28ms each. */
export function StaggerList({ children, className }: { children: ReactNode; className?: string }) {
  const ok = useMotionEnabled()
  return (
    <motion.div className={className} variants={LIST_VARIANTS} initial={ok ? 'hidden' : 'visible'} animate="visible">
      {children}
    </motion.div>
  )
}

/**
 * Cascade item — must sit inside a StaggerList (variants are inherited from
 * the container; DOM order drives the stagger). `index` is exposed as the
 * framer-motion `custom` value for data-driven variant overrides. Renders
 * statically (visible) when used outside a list or when motion is reduced.
 */
export function StaggerItem({ children, index }: { children: ReactNode; index?: number }) {
  return (
    <motion.div className="motion-item" variants={ITEM_VARIANTS} custom={index}>
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// CountUp — animated number
// ---------------------------------------------------------------------------

/**
 * Animated number: renders the final value immediately, then animates from
 * the previous value to the new one whenever `value` changes.
 * The span is tabular-nums; `announce` adds a polite live region carrying the
 * FINAL value (for meaningful totals only — the animated span is then hidden
 * from assistive tech to avoid update spam).
 */
export function CountUp({ value, format, duration = 600, announce = false }: {
  value: number
  /** display formatter, e.g. (n) => formatBHD(Math.round(n)) */
  format: (n: number) => string
  /** animation length in ms */
  duration?: number
  announce?: boolean
}) {
  const ok = useMotionEnabled()
  // holds the in-flight animated value; null when settled (then `value` wins)
  const [animDisplay, setAnimDisplay] = useState<number | null>(null)
  const shownRef = useRef(value)

  useEffect(() => {
    const from = shownRef.current
    if (!ok || from === value) return
    const controls = animate(from, value, {
      duration: Math.max(0.001, duration / 1000),
      ease: 'easeOut',
      onUpdate: (v) => {
        shownRef.current = v
        setAnimDisplay(v)
      },
      onComplete: () => setAnimDisplay(null),
    })
    return () => controls.stop()
  }, [value, ok, duration])

  const display = animDisplay ?? value
  return (
    <>
      <span className="tabular-nums" aria-hidden={announce ? true : undefined}>{format(display)}</span>
      {announce ? <span className="sr-only" aria-live="polite">{format(value)}</span> : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// AnimatedBar — horizontal progress bar
// ---------------------------------------------------------------------------

const BAR_TONES: Record<string, string> = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  warn: 'bg-amber-500',
  danger: 'bg-destructive',
}

/**
 * Horizontal progress bar animating its width 0 → pct% (500ms ease-out),
 * rounded, theme tones only. `pct` is clamped to 0..100; updates animate
 * smoothly. Fills from the inline-start edge (correct for RTL).
 */
export function AnimatedBar({ pct, tone = 'primary', className }: {
  /** 0..100 (clamped) */
  pct: number
  tone?: 'primary' | 'accent' | 'warn' | 'danger'
  /** extra classes for the track (height, margins…) */
  className?: string
}) {
  const ok = useMotionEnabled()
  const clamped = Math.max(0, Math.min(100, pct))
  const fill = cn('h-full rounded-full', BAR_TONES[tone])
  return (
    <div
      className={cn('h-2 rounded-full bg-secondary overflow-hidden', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      {ok ? (
        <motion.div
          className={fill}
          initial={{ width: '0%' }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      ) : (
        <div className={fill} style={{ width: `${clamped}%` }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AnimatedDonut — SVG donut with staggered segment sweep-in
// ---------------------------------------------------------------------------

export interface DonutSegment {
  /** share in percent (normalized against the segment total when rendering) */
  pct: number
  /** CSS color — pass theme tokens, e.g. 'var(--primary)' */
  color: string
}

/**
 * SVG donut: each segment is a circle stroke whose dash grows from zero,
 * staggered 80ms per segment (mount only — later data updates transition
 * quickly without stagger). Starts at 12 o'clock (rotate -90) and keeps the
 * classic clockwise fill, matching the previous static donut 1:1.
 * `centerLabel` / `centerSub` render as SVG text in the middle.
 */
export function AnimatedDonut({ segments, size = 140, thickness = 18, centerLabel, centerSub, ariaLabel }: {
  segments: DonutSegment[]
  /** outer pixel size (default 140) */
  size?: number
  /** stroke width (default 18) */
  thickness?: number
  centerLabel?: string
  centerSub?: string
  /** accessible description of the full distribution */
  ariaLabel?: string
}) {
  const ok = useMotionEnabled()
  // after the mount cascade completes, switch to fast un-staggered updates
  const [settled, setSettled] = useState(false)
  const total = segments.reduce((s, x) => s + Math.max(0, x.pct), 0)
  useEffect(() => {
    if (!ok) return
    const t = setTimeout(() => setSettled(true), segments.length * 80 + 700)
    return () => clearTimeout(t)
  }, [ok, segments.length])

  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  const c = size / 2
  // cumulative fractions via immutable prefix sums (mutation-free render)
  const fracs = segments.map((s) => (total > 0 ? Math.max(0, s.pct) / total : 0))
  const starts = fracs.map((_, i) => fracs.slice(0, i).reduce((a, b) => a + b, 0))
  const arcs = segments.map((s, i) => ({ ...s, frac: fracs[i] ?? 0, start: starts[i] ?? 0, i }))

  return (
    <div className="flex justify-center" role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a) => {
          const len = a.frac * C
          const dashFinal = `${len} ${C - len}`
          const common = {
            cx: c,
            cy: c,
            r,
            fill: 'none',
            stroke: a.color,
            strokeWidth: thickness,
            strokeDashoffset: -a.start * C,
            transform: `rotate(-90 ${c} ${c})`,
          } as const
          return ok ? (
            <motion.circle
              key={a.i}
              {...common}
              initial={{ strokeDasharray: `0 ${C}` }}
              animate={{ strokeDasharray: dashFinal }}
              transition={settled
                ? { duration: 0.4, ease: 'easeOut' }
                : { duration: 0.6, ease: 'easeOut', delay: a.i * 0.08 }}
            />
          ) : (
            <circle key={a.i} {...common} strokeDasharray={dashFinal} />
          )
        })}
        {centerLabel ? (
          <text
            x={c}
            y={c - size * 0.035}
            textAnchor="middle"
            className="fill-current"
            fontSize={Math.max(11, Math.round(size * 0.095))}
            fontWeight={700}
          >
            {centerLabel}
          </text>
        ) : null}
        {centerSub ? (
          <text
            x={c}
            y={c + size * 0.085}
            textAnchor="middle"
            className="fill-current opacity-60"
            fontSize={Math.max(8, Math.round(size * 0.062))}
          >
            {centerSub}
          </text>
        ) : null}
      </svg>
    </div>
  )
}
