import { NextRequest, NextResponse } from 'next/server'

/**
 * Fixed-window in-memory rate limiter for a single-process deployment.
 *
 * Scope and limits are documented in docs/API_SECURITY_MATRIX.md. This is a
 * per-process counter: it protects one running instance and does NOT
 * coordinate across replicas. Deployments behind more than one app instance
 * need a shared store; that limitation is recorded in docs/KNOWN_LIMITATIONS.md.
 *
 * Client IP resolution honours the deployment trust path: X-Forwarded-For /
 * X-Real-IP are trusted ONLY when TRUST_PROXY_HEADERS=true, which is correct
 * behind a reverse proxy that overwrites (not appends to) those headers —
 * e.g. the Caddyfile shipped with this project. With the flag off, all
 * direct requests share one bucket ("direct"), degrading to a global limit.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_BUCKETS = 10_000

export function clientIp(req: NextRequest): string {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwarded = req.headers.get('x-forwarded-for')
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
    const real = req.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  return 'direct'
}

/** Returns a 429 response when the caller exceeded the window budget, else null. */
export function rateLimit(req: NextRequest, name: string, max: number, windowMs: number): NextResponse | null {
  const key = `${name}:${clientIp(req)}`
  const now = Date.now()
  if (buckets.size > MAX_TRACKED_BUCKETS) {
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(k)
    }
  }
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }
  bucket.count += 1
  if (bucket.count > max) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    )
  }
  return null
}

/** Failure counter for shared-secret endpoints (brute-force slowdown). */
export function rateLimitFailure(name: string, ip: string, max: number, windowMs: number): boolean {
  const key = `${name}:fail:${ip}`
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > max
}

export function clearFailures(name: string, ip: string): void {
  buckets.delete(`${name}:fail:${ip}`)
}
