import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'node:fs'
import { getCatalog } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

/** Open data dump (spec 9.4): full curated catalog JSON download */
export async function GET() {
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
