import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { getCatalog } from '@/lib/server/catalog'
import { rateLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/** Open data dump (spec 9.4): full curated catalog JSON download */
export async function GET(req: NextRequest) {
  // The dump is a multi-megabyte serialization — keep it out of tight loops.
  const limited = rateLimit(req, 'dump', 6, 60_000)
  if (limited) return limited
  if (!existsSync('data/curated/catalog.json')) {
    return NextResponse.json({ error: 'not_available' }, { status: 503 })
  }
  const catalog = await getCatalog()
  const body = JSON.stringify(catalog)
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="khassis-baqalatak-catalog-${catalog.version}.json"`,
      'cache-control': 'public, max-age=3600',
    },
  })
}
