import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'

export async function GET() {
  let dbOk = false
  try {
    await db.setting.count()
    dbOk = true
  } catch { dbOk = false }
  return NextResponse.json({
    status: dbOk && existsSync('data/curated/catalog.json') ? 'ok' : 'degraded',
    db: dbOk,
    catalogFile: existsSync('data/curated/catalog.json'),
    time: new Date().toISOString(),
  })
}
