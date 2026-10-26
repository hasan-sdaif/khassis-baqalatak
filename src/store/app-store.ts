'use client'
/**
 * App store (zustand + localStorage): local-first household/budget/plan data.
 * Nothing leaves the device unless the user explicitly shares a plan.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  Budget, BudgetEnvelope, Household, LockedChoice, PantryItem, PlanResult,
  SpendLogEntry, PlanMode, ReportNames, PlanContext,
} from '@/lib/engine/types'
import { defaultAdvanced, normalizeAdvanced, type AdvancedProfile } from '@/lib/engine/advanced'
import { dateISOInTimeZone } from '@/lib/time'

export interface AppSettings {
  lang: 'ar' | 'en'
  arabicNumerals: boolean
  theme: 'light' | 'dark' | 'system'
  reduceTransparency: boolean
  reduceMotion: boolean
  simplifiedMode: boolean
  ageGatePassed: boolean
  userKey: string // anonymous local key
  defaultNames: ReportNames
}

export interface PriceAlert {
  id: string
  productId?: string
  needId?: string
  name: string
  thresholdFils: number
  createdAtISO: string
  triggered?: boolean
}

export type StoredPlanContext = Pick<PlanContext, 'dateISO' | 'season' | 'storeMode' | 'availableStores' | 'delivery'>

interface AppState {
  settings: AppSettings
  household: Household | null
  budget: Budget | null
  envelopes: BudgetEnvelope[]
  locks: LockedChoice[]
  plan: PlanResult | null
  planMode: PlanMode
  planContext: StoredPlanContext
  planNames: ReportNames
  pantry: PantryItem[]
  spendLog: SpendLogEntry[]
  alerts: PriceAlert[]
  favoriteSharedPlans: string[]
  /** advanced preferences (hundreds-of-options layer) */
  advanced: AdvancedProfile
  // actions
  setSettings: (patch: Partial<AppSettings>) => void
  setHousehold: (h: Household) => void
  setBudget: (b: Budget) => void
  setEnvelopes: (e: BudgetEnvelope[]) => void
  addEnvelope: (e: BudgetEnvelope) => void
  updateEnvelope: (id: string, patch: Partial<BudgetEnvelope>) => void
  removeEnvelope: (id: string) => void
  setPlan: (p: PlanResult | null) => void
  setPlanMode: (m: PlanMode) => void
  setPlanContext: (context: StoredPlanContext) => void
  setPlanNames: (n: ReportNames) => void
  addLock: (l: LockedChoice) => void
  removeLock: (productId: string) => void
  addPantry: (p: PantryItem) => void
  setPantry: (items: PantryItem[]) => void
  removePantry: (id: string) => void
  addSpend: (s: SpendLogEntry) => void
  clearSpend: () => void
  addAlert: (a: PriceAlert) => void
  removeAlert: (id: string) => void
  toggleFavoriteShared: (id: string) => void
  setAdvanced: (patch: Partial<AdvancedProfile>) => void
  resetAdvanced: () => void
  resetAll: () => void
}

function randomKey(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

const DEFAULT_SETTINGS: AppSettings = {
  lang: 'ar',
  arabicNumerals: false,
  theme: 'system',
  reduceTransparency: false,
  reduceMotion: false,
  simplifiedMode: false,
  ageGatePassed: false,
  userKey: typeof window !== 'undefined' ? randomKey() : 'u_server',
  defaultNames: { reportName: 'تقرير الخطة', showNames: true },
}

export const useApp = create<AppState>()(
  persist(
    (set, _get) => ({
      settings: DEFAULT_SETTINGS,
      household: null,
      budget: null,
      envelopes: [],
      locks: [],
      plan: null,
      planMode: 'balanced',
      planContext: { dateISO: dateISOInTimeZone(), season: 'normal', storeMode: 'median', availableStores: [], delivery: true },
      planNames: { reportName: 'خطة البقالة', showNames: true },
      pantry: [],
      spendLog: [],
      alerts: [],
      favoriteSharedPlans: [],
      advanced: defaultAdvanced(),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setHousehold: (h) => set({ household: h }),
      setBudget: (b) => set({ budget: b }),
      setEnvelopes: (e) => set({ envelopes: e }),
      addEnvelope: (e) => set((s) => ({ envelopes: [...s.envelopes.filter((x) => x.id !== e.id), e] })),
      updateEnvelope: (id, patch) => set((s) => ({ envelopes: s.envelopes.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      removeEnvelope: (id) => set((s) => ({ envelopes: s.envelopes.filter((e) => e.id !== id) })),
      setPlan: (p) => set({ plan: p }),
      setPlanMode: (m) => set({ planMode: m }),
      setPlanContext: (context) => set({ planContext: { ...context, availableStores: [...new Set(context.availableStores)] } }),
      setPlanNames: (n) => set({ planNames: n }),
      addLock: (l) => set((s) => ({ locks: [...s.locks.filter((x) => x.productId !== l.productId), l] })),
      removeLock: (productId) => set((s) => ({ locks: s.locks.filter((x) => x.productId !== productId) })),
      addPantry: (p) => set((s) => ({ pantry: [...s.pantry.filter((x) => x.id !== p.id), p] })),
      setPantry: (items) => set({ pantry: items }),
      removePantry: (id) => set((s) => ({ pantry: s.pantry.filter((x) => x.id !== id) })),
      addSpend: (sp) => set((s) => ({ spendLog: [...s.spendLog, sp] })),
      clearSpend: () => set({ spendLog: [] }),
      addAlert: (a) => set((s) => ({ alerts: [...s.alerts.filter((x) => x.id !== a.id), a] })),
      removeAlert: (id) => set((s) => ({ alerts: s.alerts.filter((x) => x.id !== id) })),
      toggleFavoriteShared: (id) => set((s) => ({
        favoriteSharedPlans: s.favoriteSharedPlans.includes(id)
          ? s.favoriteSharedPlans.filter((x) => x !== id)
          : [...s.favoriteSharedPlans, id],
      })),
      setAdvanced: (patch) => set((s) => ({ advanced: { ...s.advanced, ...patch, v: 1 } })),
      resetAdvanced: () => set({ advanced: defaultAdvanced() }),
      resetAll: () => set({
        household: null, budget: null, envelopes: [], locks: [], plan: null,
        planContext: { dateISO: dateISOInTimeZone(), season: 'normal', storeMode: 'median', availableStores: [], delivery: true },
        pantry: [], spendLog: [], alerts: [], favoriteSharedPlans: [], advanced: defaultAdvanced(),
      }),
    }),
    {
      name: 'khassis-baqalatak',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        settings: s.settings,
        household: s.household,
        budget: s.budget,
        envelopes: s.envelopes,
        locks: s.locks,
        plan: s.plan,
        planMode: s.planMode,
        planContext: s.planContext,
        planNames: s.planNames,
        pantry: s.pantry,
        spendLog: s.spendLog,
        alerts: s.alerts,
        favoriteSharedPlans: s.favoriteSharedPlans,
        advanced: s.advanced,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return {
          ...current,
          ...p,
          advanced: normalizeAdvanced(p.advanced),
        }
      },
    }
  )
)
