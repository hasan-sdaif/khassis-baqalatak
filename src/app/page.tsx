'use client'
/**
 * Khassis Baqalatak — single-route SPA (hash router). All views are client
 * components under src/views; backend is API-route-only.
 */
import { Suspense, lazy } from 'react'
import { useRoute } from '@/lib/router'
import { AppShell } from '@/components/glass/app-shell'
import { SkeletonRows, Spinner } from '@/components/glass/glass'
import { FadeIn } from '@/components/glass/motion'
import { HomeView } from '@/views/home-view'
import { WizardView } from '@/views/wizard-view'
import { PlanView } from '@/views/plan-view'

const CatalogView = lazy(() => import('@/views/catalog-view').then((m) => ({ default: m.CatalogView })))
const ProductView = lazy(() => import('@/views/product-view').then((m) => ({ default: m.ProductView })))
const ShoppingView = lazy(() => import('@/views/shopping-view').then((m) => ({ default: m.ShoppingView })))
const EnvelopesView = lazy(() => import('@/views/envelopes-view').then((m) => ({ default: m.EnvelopesView })))
const ReportsView = lazy(() => import('@/views/reports-view').then((m) => ({ default: m.ReportsView })))
const CalculatorsView = lazy(() => import('@/views/calculators-view').then((m) => ({ default: m.CalculatorsView })))
const AdvancedView = lazy(() => import('@/views/advanced-view').then((m) => ({ default: m.AdvancedView })))
const PantryView = lazy(() => import('@/views/pantry-view').then((m) => ({ default: m.PantryView })))
const SpendingView = lazy(() => import('@/views/spending-view').then((m) => ({ default: m.SpendingView })))
const AlertsView = lazy(() => import('@/views/alerts-view').then((m) => ({ default: m.AlertsView })))
const IndexView = lazy(() => import('@/views/index-view').then((m) => ({ default: m.IndexView })))
const CommunityView = lazy(() => import('@/views/community-view').then((m) => ({ default: m.CommunityView })))
const SettingsView = lazy(() => import('@/views/settings-view').then((m) => ({ default: m.SettingsView })))
const AdminView = lazy(() => import('@/views/admin-view').then((m) => ({ default: m.AdminView })))
const HelpView = lazy(() => import('@/views/help-view').then((m) => ({ default: m.HelpView })))

const TITLES: Record<string, string> = {
  shopping: 'قائمة التسوق',
  catalog: 'الكتالوج',
  product: 'المنتج',
  envelopes: 'العناصر العامة وأظرف الميزانية',
  reports: 'مركز التقارير',
  calculators: 'الحاسبات الذكية',
  advanced: 'الخيارات المتقدمة',
  pantry: 'المخزون المنزلي',
  spending: 'تتبع الإنفاق',
  alerts: 'تنبيهات الأسعار',
  index: 'مؤشر الأسعار والسلال',
  community: 'مجتمع الخطط',
  settings: 'الإعدادات',
  admin: 'لوحة الإدارة',
  help: 'المساعدة والمنهجية',
}

export default function Page() {
  const [route] = useRoute()
  const showTitle = route.name !== 'home' && route.name !== 'plan' && route.name !== 'start'

  return (
    <AppShell title={showTitle ? TITLES[route.name] : undefined}>
      <Suspense fallback={<div className="flex justify-center py-16"><Spinner className="w-8 h-8 text-primary" /></div>}>
        <FadeIn key={route.name}>
          {route.name === 'home' && <HomeView />}
          {route.name === 'start' && <WizardView />}
          {route.name === 'plan' && <PlanView />}
          {route.name === 'shopping' && <ShoppingView />}
          {route.name === 'catalog' && <CatalogView category={route.category} />}
          {route.name === 'product' && <ProductView id={route.id} />}
          {route.name === 'envelopes' && <EnvelopesView />}
          {route.name === 'reports' && <ReportsView />}
          {route.name === 'calculators' && <CalculatorsView />}
          {route.name === 'advanced' && <AdvancedView />}
          {route.name === 'pantry' && <PantryView />}
          {route.name === 'spending' && <SpendingView />}
          {route.name === 'alerts' && <AlertsView />}
          {route.name === 'index' && <IndexView />}
          {route.name === 'community' && <CommunityView slug={route.slug} />}
          {route.name === 'settings' && <SettingsView />}
          {route.name === 'admin' && <AdminView tab={route.tab} />}
          {route.name === 'help' && <HelpView />}
        </FadeIn>
      </Suspense>
    </AppShell>
  )
}
