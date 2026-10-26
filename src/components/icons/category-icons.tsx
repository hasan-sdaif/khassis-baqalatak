'use client'
/**
 * Category icon registry (spec 10.5-2): monochrome SVG mapping for all 43
 * catalog categories + generic groups. lucide-react icons (mono, currentColor,
 * ISC license). Unknown categories fall back to the generic icon.
 */
import type { ComponentType } from 'react'
import {
  Milk, Egg, ChefHat, Wheat, Droplets, Grape, CupSoda, Zap, Coffee,
  Cookie, Candy, Popcorn, Baby, Sparkles, SprayCan, Trash2, Pill, Wrench,
  Smartphone, Pencil, PawPrint, Cigarette, PartyPopper, Leaf, Fish, Beef,
  IceCreamBowl, Croissant, CookingPot, Blocks, Package, ShoppingCart,
  Boxes, CircleDot, Utensils, LeafyGreen, Snowflake, type LucideProps,
} from 'lucide-react'

const MAP: Record<string, ComponentType<LucideProps>> = {
  milk: Milk,
  eggs: Egg,
  'yogurt-laban': ChefHat, // laban
  cheese: Blocks,
  'butter-cream': CookingPot,
  'ice-cream': IceCreamBowl,
  'desserts-chilled': Candy,
  bakery: Croissant,
  'breakfast-cereals': Wheat,
  'rice-pasta-grains': Wheat,
  'cooking-oils': Droplets,
  'sauces-condiments': CookingPot,
  'canned-food': Package,
  'honey-spreads': Droplets,
  'pantry-other': Boxes,
  'meat-poultry': Beef,
  'fish-seafood': Fish,
  'frozen-food': Snowflake,
  'fruits-vegetables': LeafyGreen,
  'ready-to-eat': Utensils,
  water: Droplets,
  juices: Grape,
  'soft-drinks': CupSoda,
  'energy-drinks': Zap,
  'coffee-tea': Coffee,
  'biscuits-cookies': Cookie,
  'chocolate-sweets': Candy,
  'arabic-sweets': Candy,
  'salty-snacks': Popcorn,
  'baby-products': Baby,
  'personal-care': Sparkles,
  'household-cleaning': SprayCan,
  disposables: Trash2,
  'health-pharmacy': Pill,
  'home-kitchenware': Wrench,
  'electronics-accessories': Smartphone,
  'stationery-toys': Pencil,
  'pet-supplies': PawPrint,
  'vape-tobacco': Cigarette,
  'party-supplies': PartyPopper,
  'dates-dried-fruits': Leaf,
  'nuts-seeds': CircleDot,
  'baking-supplies': Wheat,
}

export function CategoryIcon({ category, className, size = 20 }: { category: string; className?: string; size?: number }) {
  const Icon = MAP[category] ?? ShoppingCart
  return <Icon className={className} size={size} strokeWidth={1.75} aria-hidden />
}

export function categoryIconFor(category: string): ComponentType<LucideProps> {
  return MAP[category] ?? ShoppingCart
}
