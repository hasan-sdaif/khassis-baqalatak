import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { clientIp, clearFailures, rateLimitFailure } from './rate-limit'

/**
 * Protect every mutating/admin data endpoint. Configure ADMIN_API_KEY in deployments.
 *
 * This is a shared-secret owner gate, NOT multi-user RBAC and NOT a user session.
 * Deployments that expose the admin surface to more than one operator must put a
 * real authentication/authorization layer in front of it (see docs/THREAT_MODEL.md).
 *
 * Failed comparisons are rate-limited per client IP to slow key brute-forcing.
 *
 * Dev fallback note: without ADMIN_API_KEY the gate allows requests whose Host
 * header names a loopback address. The Host header is client-controlled and
 * therefore spoofable — this fallback is a development convenience, not a
 * security boundary. Production deployments MUST set ADMIN_API_KEY (the route
 * answers 503 otherwise). req.nextUrl.hostname cannot be used here: Next.js
 * resolves it from the server's own bind address, so it is always loopback.
 */
function loopbackHost(hostHeader: string): boolean {
  const host = hostHeader.trim().toLowerCase()
  if (host.startsWith('[')) {
    const ipv6 = host.slice(1, host.indexOf(']'))
    return ipv6 === '::1'
  }
  const hostname = host.split(':')[0] ?? ''
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function requireAdmin(req: NextRequest): NextResponse | null {
  const ip = clientIp(req)
  const configured = process.env.ADMIN_API_KEY?.trim()
  const supplied = req.headers.get('x-admin-key') ?? ''

  if (configured) {
    if (rateLimitFailure('admin-auth', ip, 12, 5 * 60_000)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '300' } })
    }
    const expectedBytes = Buffer.from(configured)
    const suppliedBytes = Buffer.from(supplied)
    const equal = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
    if (equal) {
      clearFailures('admin-auth', ip)
      return null
    }
    return NextResponse.json({ error: 'admin_unauthorized' }, { status: 401 })
  }

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'admin_not_configured' }, { status: 503 })
  }

  // Unconfigured development access: loopback Host header only (spoofable — see note above).
  if (loopbackHost(req.headers.get('host') ?? '')) return null
  return NextResponse.json({ error: 'admin_unauthorized' }, { status: 403 })
}
