import { NextRequest, NextResponse } from 'next/server'
import { searchProducts } from '@/lib/server/catalog'
import { rateLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 'search', 120, 60_000)
  if (limited) return limited
  const sp = req.nextUrl.searchParams
  try {
    const result = await searchProducts({
      q: sp.get('q') ?? undefined,
      category: sp.get('category') ?? undefined,
      brand: sp.get('brand') ?? undefined,
      store: sp.get('store') ?? undefined,
      need: sp.get('need') ?? undefined,
      minFils: sp.get('minFils') ? Number(sp.get('minFils')) : undefined,
      maxFils: sp.get('maxFils') ? Number(sp.get('maxFils')) : undefined,
      sort: (sp.get('sort') as 'relevance' | 'price-asc' | 'price-desc' | 'unit-asc' | 'popularity' | null) ?? 'relevance',
      limit: sp.get('limit') ? Number(sp.get('limit')) : 30,
      offset: sp.get('offset') ? Number(sp.get('offset')) : 0,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('invalid_')) return NextResponse.json({ error: message }, { status: 400 })
    return NextResponse.json({ error: 'search_failed' }, { status: 500 })
  }
}
