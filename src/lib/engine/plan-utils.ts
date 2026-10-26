import type { PlanItem, PlanResult } from './types'

/**
 * Return every purchasable line in a plan, including mandatory/fixed habits and
 * generic-envelope selections. The engine stores envelope selections separately
 * from regular items, so consumers must not reconstruct this list ad hoc.
 * A stable key is the line identity; defensive de-duplication prevents a future
 * engine adapter from rendering the same row twice.
 */
export function getAllPlanItems(
  plan: Pick<PlanResult, 'items' | 'fixedItems' | 'envelopes'> | null | undefined,
): PlanItem[] {
  if (!plan) return []
  const result: PlanItem[] = []
  const seen = new Set<string>()
  for (const item of [
    ...plan.items,
    ...plan.fixedItems,
    ...plan.envelopes.flatMap((envelope) => envelope.items),
  ]) {
    if (!item || typeof item.key !== 'string' || seen.has(item.key)) continue
    seen.add(item.key)
    result.push(item)
  }
  return result
}

/** Sum a unified plan line list using integer fils only. */
export function sumPlanItemsFils(items: readonly PlanItem[]): number {
  return items.reduce((sum, item) => sum + Math.round(item.costFils), 0)
}
