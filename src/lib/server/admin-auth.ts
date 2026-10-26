import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

/** Protect every mutating/admin data endpoint. Configure ADMIN_API_KEY in deployments. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const configured = process.env.ADMIN_API_KEY?.trim()
  const supplied = req.headers.get('x-admin-key') ?? ''

  if (configured) {
    const expectedBytes = Buffer.from(configured)
    const suppliedBytes = Buffer.from(supplied)
    const equal = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
    return equal ? null : NextResponse.json({ error: 'admin_unauthorized' }, { status: 401 })
  }

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'admin_not_configured' }, { status: 503 })
  }

  // Unconfigured development access is permitted only via a loopback Host.
  const hostname = req.nextUrl.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return null
  return NextResponse.json({ error: 'admin_unauthorized' }, { status: 403 })
}
