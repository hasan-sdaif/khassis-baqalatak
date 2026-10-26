'use client'
/**
 * Hash router — single-route constraint: all views live under `/` with #hash
 * navigation. Views: #/ #/start #/plan #/shopping #/catalog #/product/:id
 * #/envelopes #/reports #/calculators #/pantry #/spending #/alerts #/index
 * #/community #/settings #/admin #/help
 */
import { useEffect, useState, useCallback } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'start' }
  | { name: 'plan' }
  | { name: 'shopping' }
  | { name: 'catalog'; category?: string }
  | { name: 'product'; id: string }
  | { name: 'envelopes' }
  | { name: 'reports' }
  | { name: 'calculators' }
  | { name: 'advanced' }
  | { name: 'pantry' }
  | { name: 'spending' }
  | { name: 'alerts' }
  | { name: 'index' }
  | { name: 'community'; slug?: string }
  | { name: 'settings' }
  | { name: 'admin'; tab?: string }
  | { name: 'help' }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '').split('?')[0] ?? ''
  const parts = h.split('/').filter(Boolean)
  switch (parts[0]) {
    case undefined:
    case '':
      return { name: 'home' }
    case 'start': return { name: 'start' }
    case 'plan': return { name: 'plan' }
    case 'shopping': return { name: 'shopping' }
    case 'catalog': return { name: 'catalog', category: parts[1] }
    case 'product': return { name: 'product', id: parts[1] ?? '' }
    case 'envelopes': return { name: 'envelopes' }
    case 'reports': return { name: 'reports' }
    case 'calculators': return { name: 'calculators' }
    case 'advanced': return { name: 'advanced' }
    case 'pantry': return { name: 'pantry' }
    case 'spending': return { name: 'spending' }
    case 'alerts': return { name: 'alerts' }
    case 'index': return { name: 'index' }
    case 'community': return { name: 'community', slug: parts[1] }
    case 'settings': return { name: 'settings' }
    case 'admin': return { name: 'admin', tab: parts[1] }
    case 'help': return { name: 'help' }
    default: return { name: 'home' }
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home': return '#/'
    case 'catalog': return route.category ? `#/catalog/${route.category}` : '#/catalog'
    case 'product': return `#/product/${route.id}`
    case 'community': return route.slug ? `#/community/${route.slug}` : '#/community'
    case 'admin': return route.tab ? `#/admin/${route.tab}` : '#/admin'
    default: return `#/${route.name}`
  }
}

export function navigate(route: Route): void {
  if (typeof window !== 'undefined') window.location.hash = routeToHash(route)
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => (typeof window === 'undefined' ? { name: 'home' } : parseHash(window.location.hash)))
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((r: Route) => {
    window.location.hash = routeToHash(r)
  }, [])
  return [route, go]
}
