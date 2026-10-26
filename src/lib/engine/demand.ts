/**
 * Stage 1 — Demand estimation (spec 6.3).
 * D_n = Σ_m rate(n, class(m)) · (H/period) · λ_season · λ_household · λ_eating_out
 * Plus habit modules (diapers/formula/tobacco/coffee/tea/water/soft drinks)
 * and pantry deductions — and the ADVANCED profile: per-need user overrides
 * (absolute quantity or multiplier, ~87 options) + lifestyle percentages.
 */
import type { Catalog, DemandItem, Household, HouseholdMember, NeedDef, PlanContext, PantryItem } from './types'
import { NEEDS_MAP, categoryFallbackNeed } from './needs'
import { SEASONAL_FACTORS } from './config'
import { adultEquivalent, ageClass, infantInfos, adultCount } from './habits'
import { bannedNeedsFor, treatDemandScale, type AdvancedProfile } from './advanced'

const PERIOD_DAYS = 30 // adultMonthly rates are per 30 days

/** hospitality-sensitive needs (guests boost) */
const HOSPITALITY = new Set(['coffee', 'tea', 'dates', 'juice', 'water', 'cat.arabic-sweets', 'nuts'])

/** needs reduced when household eats out often (home-cooked staples) */
const HOME_COOKED = new Set(['rice', 'pasta', 'flour', 'oil', 'sugar', 'chicken', 'meat.red', 'fish', 'vegetables', 'eggs', 'bread', 'laban', 'cheese'])

export function memberFactor(m: HouseholdMember, need: NeedDef): number {
  const cls = ageClass(m)
  switch (cls) {
    case 'infant':
      return need.childFactor * 0.3
    case 'toddler':
      return need.childFactor
    case 'child':
      return need.childFactor
    case 'teen':
      return 1.0
    case 'adult': {
      let f = adultEquivalent(m)
      if (m.specials.includes('pregnant') || m.specials.includes('nursing')) {
        // +15% on dairy/water/juice needs only
        if (['milk.fresh.full', 'milk.uht.full', 'laban', 'water', 'juice', 'cheese', 'eggs'].includes(need.id)) f += 0.15
      }
      if (m.activity === 'high' && ['water', 'fruits', 'energy-drinks'].includes(need.id)) f += 0.1
      return f
    }
    case 'elder':
      return 0.85 * (need.childFactor > 0.7 ? 1 : need.childFactor + 0.3)
    default:
      return adultEquivalent(m)
  }
}

export function computeDemand(
  catalog: Catalog,
  household: Household,
  horizonDays: number,
  context: PlanContext,
  pantry: PantryItem[] = [],
  advanced?: AdvancedProfile
): { demand: DemandItem[]; fixedSpends: { needId: string; label: string; fils: number; note: string }[]; warnings: string[]; advancedNotes: string[] } {
  const demand: Map<string, DemandItem> = new Map()
  const warnings: string[] = []
  const advancedNotes: string[] = []
  const fixedSpends: { needId: string; label: string; fils: number; note: string }[] = []
  const season = SEASONAL_FACTORS[context.season] ?? {}
  const adv = advanced
  const bannedNeeds = adv ? bannedNeedsFor(adv.diet) : new Set<string>()

  const push = (needId: string, qty: number, derivation: string[], confidence = 0.85) => {
    if (qty <= 0) return
    const existing = demand.get(needId)
    if (existing) {
      existing.qtyBaseUnit += qty
      existing.derivation.push(...derivation)
    } else {
      demand.set(needId, { needId, qtyBaseUnit: qty, confidence, derivation })
    }
  }

  const H = horizonDays
  const hFactor = H / PERIOD_DAYS
  // advanced lifestyle: home-cooking percentage overrides the eating-out factor
  let eatOutFactor = Math.max(0.55, 1 - household.eatingOutPerWeek / 42)
  if (adv && adv.lifestyle.homeCookingPct != null) {
    const hc = Math.max(0, Math.min(100, adv.lifestyle.homeCookingPct)) / 100
    eatOutFactor = Math.max(0.4, Math.min(1, 0.55 + hc * 0.45))
    advancedNotes.push(`الطبخ المنزلي ${Math.round(hc * 100)}% من الوجبات — معامل الطلب للأصناف المطبوخة ×${eatOutFactor.toFixed(2)}`)
  }
  const guestFactor = 1 + Math.min(1.5, (household.guestsPerMonth / 30) * 0.4)

  // ---- standard needs from consumption rules
  const members = household.members
  for (const need of NEEDS_MAP.values()) {
    if (need.adultMonthly <= 0) continue // habit-driven needs handled below
    if (bannedNeeds.has(need.id)) continue // diet flags (advanced page)
    let total = 0
    for (const m of members) {
      const f = memberFactor(m, need)
      total += need.adultMonthly * f
    }
    if (total <= 0) continue
    let qty = total * hFactor
    qty *= season[need.id] ?? 1
    if (HOSPITALITY.has(need.id)) qty *= guestFactor
    if (HOME_COOKED.has(need.id)) qty *= eatOutFactor
    // advanced: treat/comfort lifestyle scaling (sweet tooth / snacks level)
    if (adv) {
      const ts = treatDemandScale(need.clazz, need.id, adv.lifestyle)
      if (ts !== 1) qty *= ts
    }
    // advanced: per-need user override (absolute or multiplier)
    const ov = adv?.needOverrides[need.id]
    const ovDerivation: string[] = []
    if (ov && ov.mode !== 'auto') {
      if (ov.mode === 'abs' && ov.abs != null && ov.abs >= 0) {
        qty = ov.abs
        ovDerivation.push(`تعديلك اليدوي: الكمية ثُبّتت على ${ov.abs} ${need.baseUnit}`)
      } else if (ov.mode === 'mult' && ov.mult != null) {
        qty *= Math.max(0, ov.mult)
        ovDerivation.push(`تعديلك اليدوي ×${ov.mult}`)
      }
    }
    push(need.id, round3(qty), [
      `الاستهلاك المرجعي لكل بالغ ${need.adultMonthly} ${need.baseUnit}/شهر × معاملات الأفراد`,
      ...(season[need.id] ? [`الموسم (${context.season}) يرفع الطلب ×${season[need.id]}`] : []),
      ...(HOSPITALITY.has(need.id) && guestFactor > 1.05 ? [`الضيافة (≈${household.guestsPerMonth} ضيف/شهر) ×${guestFactor.toFixed(2)}`] : []),
      ...(HOME_COOKED.has(need.id) && eatOutFactor < 1 ? [`الأكل خارج المنزل (${household.eatingOutPerWeek}/21 وجبة) يخفض ×${eatOutFactor.toFixed(2)}`] : []),
      ...ovDerivation,
    ])
  }

  // ---- habit: coffee (cups per adult per day)
  const coffeeCups = Number(household.habits['coffee']?.cupsPerDay ?? 0)
  if (coffeeCups > 0) {
    const adults = Math.max(1, adultCount(household))
    const gPerCup = 9 // 8-12g range mid
    const grams = coffeeCups * gPerCup * adults * H
    push('coffee', round3(grams * (season.coffee ?? 1) * guestFactor), [
      `${coffeeCups} فنجان/يوم × ${adults} بالغ × ${gPerCup} جم/فنجان × ${H} يوم`,
      ...(guestFactor > 1.05 ? ['يشمل ضيافة الضيوف'] : []),
    ])
  }

  // ---- habit: tea
  const teaCups = Number(household.habits['tea']?.cupsPerDay ?? 0)
  if (teaCups > 0) {
    const adults = Math.max(1, adultCount(household))
    const bags = teaCups * adults * H * (guestFactor * 0.8 + 0.2)
    push('tea', round3(bags), [`${teaCups} كوب/يوم × ${adults} بالغ × ${H} يوم (كيس لكل كوب)`])
  }

  // ---- habit: water liters per person per day (default 1.5 ≈ spec 45L/month)
  const litersPerPerson = Number(household.habits['water']?.litersPerPersonDay ?? 1.5)
  {
    const persons = members.filter((m) => m.ageMonths >= 36).length || 1
    const liters = litersPerPerson * persons * H * (season.water ?? 1) * 0.85 // 15% from dispenser/tap usage
    push('water', round3(liters * 1000), [`${litersPerPerson} لتر/فرد/يوم × ${persons} فرد × ${H} يوم (85% مياه معبأة)`])
  }

  // ---- habit: soft drinks (skipped when diet bans sugary drinks)
  const sodaCans = Number(household.habits['soft-drinks']?.cansPerWeek ?? 0)
  if (sodaCans > 0 && !bannedNeeds.has('soft-drinks')) {
    const cans = sodaCans * (H / 7)
    push('soft-drinks', round3(cans * 330), [`${sodaCans} عبوة/أسبوع × ${Math.ceil(H / 7)} أسبوع × 330 مل`])
  }

  // ---- habit: diapers per infant (split by size so different babies get their own)
  const infants = infantInfos(household)
  for (const inf of infants) {
    const diaperHabit = household.habits['diapers'] ?? {}
    const enabled = diaperHabit[`on_${inf.member.id}`] !== false
    if (!enabled) continue
    const changes = diaperChangesPerDaySafe(inf)
    const qty = changes * H
    push(`diapers@${inf.diaperSize}`, Math.round(qty), [
      `${inf.member.name ?? 'الطفل'} (${Math.round(inf.member.ageMonths)} شهر، ≈${inf.weightKg.toFixed(1)} كجم): ${changes} حفاضة/يوم × ${H} يوم — مقاس ${inf.diaperSize}`,
    ])
    if (inf.diaperNearBoundary) {
      warnings.push(`${inf.member.name ?? 'طفلك'} قريب من الانتقال لمقاس الحفاضات التالي (${inf.diaperSize}) — لا تكوّن مخزوناً كبيراً من المقاس الحالي`)
    }
    // complementary: wipes (~40/day under 1y, ~20/day toddlers)
    const wipesPerDay = inf.member.ageMonths < 12 ? 40 : 20
    push('baby-wipes', Math.round(wipesPerDay * H), [`مناديل مبللة: ~${wipesPerDay} منديل/يوم`])
  }

  // ---- habit: formula per infant (split by stage)
  for (const inf of infants) {
    const formulaHabit = household.habits['formula'] ?? {}
    const enabled = formulaHabit[`on_${inf.member.id}`] !== false && inf.formulaGramsPerDay > 0
    if (!enabled) continue
    const grams = inf.formulaGramsPerDay * H
    push(`formula@${inf.formulaStage}`, round3(grams), [
      `${inf.member.name ?? 'الرضيع'} (${Math.round(inf.member.ageMonths)} شهر): ${Math.round(inf.formulaGramsPerDay)} جم/يوم × ${H} يوم — مرحلة ${inf.formulaStage}`,
      'ملاحظة: يسبق ملصق العلبة وتوجيه طبيب الأطفال أي تقدير',
    ])
    if (inf.formulaTransitionInDays != null && inf.formulaTransitionInDays <= 21) {
      warnings.push(`الرضيع يقترب من الانتقال إلى مرحلة الحليب التالية خلال ≈${inf.formulaTransitionInDays} يوم — اشترِ ما يكفي المرحلة الحالية فقط`)
    }
  }

  // ---- habit: tobacco (fixed spend, brand-locked; spec 6.6-3) — skipped when noTobacco
  const smoking = household.habits['smoking']
  if (smoking?.active === true && !bannedNeeds.has('tobacco')) {
    const perDay = Number(smoking.cigsPerDay ?? 20)
    const brand = String(smoking.brand ?? '')
    const manualPrice = Number(smoking.manualPriceFils ?? 0)
    const packsPerMonth = (perDay * H) / 20
    if (manualPrice > 0) {
      fixedSpends.push({
        needId: 'tobacco',
        label: `تبغ (${brand || 'حسب اختيارك'}): ${perDay} سيجارة/يوم`,
        fils: Math.round(packsPerMonth * manualPrice),
        note: 'سعر مدخل يدوياً — لا توجد بيانات كافية للعلامة في الكتالوج',
      })
    } else {
      // catalog products will be used by the planner as fixed items
      push('tobacco', Math.round(perDay * H), [`${perDay} سيجارة/يوم × ${H} يوم — بند ثابت (${brand || 'أي علامة متوفرة'})`], 0.6)
    }
  }

  // ---- pantry deductions
  for (const item of pantry) {
    if (!item.needId || item.qtyBaseUnit <= 0) continue
    const d = demand.get(item.needId)
    if (d) {
      d.qtyBaseUnit = Math.max(0, round3(d.qtyBaseUnit - item.qtyBaseUnit))
      d.derivation.push(`خُصم ${item.qtyBaseUnit} ${item.unit} من المخزون المنزلي`)
      if (d.qtyBaseUnit === 0) demand.delete(item.needId)
    }
  }

  // ---- advanced: report diet exclusions transparently
  if (adv) {
    const dietNotes: string[] = []
    if (adv.diet.vegetarian) dietNotes.push('نباتي')
    if (adv.diet.vegan) dietNotes.push('نباتي صرف')
    if (adv.diet.pescatarian) dietNotes.push('بيسكتري')
    if (adv.diet.keto) dietNotes.push('كيتو')
    if (adv.diet.lowCarb) dietNotes.push('قليل الكارب')
    if (bannedNeeds.size && dietNotes.length) {
      advancedNotes.push(`النمط الغذائي (${dietNotes.join(' + ')}): استبعدنا ${bannedNeeds.size} فئة من الطلب`)
    }
    if (adv.lifestyle.sweetToothPct !== 100) {
      advancedNotes.push(`سطر الحلاوة عند ${adv.lifestyle.sweetToothPct}% — طلب الحلويات ×${(adv.lifestyle.sweetToothPct / 100).toFixed(2)}`)
    }
  }

  return { demand: [...demand.values()], fixedSpends, warnings, advancedNotes }
}

function diaperChangesPerDaySafe(inf: { diaperChangesPerDay: number; member: HouseholdMember }): number {
  // night diapers + sensitive skin add a bit
  return inf.diaperChangesPerDay
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** resolve need def incl. category fallbacks */
export function resolveNeed(needId: string | null, category: string): NeedDef | null {
  if (!needId) return null
  const direct = NEEDS_MAP.get(needId)
  if (direct) return direct
  if (needId.startsWith('cat.')) return categoryFallbackNeed(needId.slice(4))
  return categoryFallbackNeed(category)
}
