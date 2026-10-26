/**
 * Needs — the canonical consumption layer (spec 4.4).
 * Each need groups products comparable via a shared base unit.
 * Consumption seeds follow spec section 16 values; all overridable at runtime
 * via settings (algorithm config / consumption rules editor).
 */
import type { NeedClass, NeedDef } from './types'
import { formulaStageFromName } from './habits'

const N = (n: NeedDef): NeedDef => n

export const NEEDS: NeedDef[] = [
  // ---------- Milk (chilled) — NOTE: splits share the ~9-10L total per adult (spec 16.1)
  N({ id: 'milk.fresh.full', slug: 'milk-fresh-full', nameAr: 'حليب طازج كامل الدسم', nameEn: 'Fresh Full-Fat Milk', category: 'milk', baseUnit: 'ml', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 10, shelfOpenedDays: 4, storage: 'chilled', perishable: true, adultMonthly: 4_500, childFactor: 0.8, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'milk.fresh.low', slug: 'milk-fresh-low', nameAr: 'حليب طازج قليل/منزوع الدسم', nameEn: 'Fresh Low-Fat Milk', category: 'milk', baseUnit: 'ml', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 10, shelfOpenedDays: 4, storage: 'chilled', perishable: true, adultMonthly: 1_500, childFactor: 0.8, weeklyTrip: true }),
  N({ id: 'milk.uht.full', slug: 'milk-uht-full', nameAr: 'حليب طويل الأجل كامل الدسم', nameEn: 'UHT Full-Fat Milk', category: 'milk', baseUnit: 'ml', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 180, shelfOpenedDays: 4, storage: 'ambient', perishable: false, adultMonthly: 2_000, childFactor: 0.8, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'milk.uht.low', slug: 'milk-uht-low', nameAr: 'حليب طويل الأجل قليل الدسم', nameEn: 'UHT Low-Fat Milk', category: 'milk', baseUnit: 'ml', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 180, shelfOpenedDays: 4, storage: 'ambient', perishable: false, adultMonthly: 1_000, childFactor: 0.8, weeklyTrip: false }),
  N({ id: 'milk.evaporated', slug: 'milk-evaporated', nameAr: 'حليب مبخر/مركز', nameEn: 'Evaporated Milk', category: 'milk', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 365, shelfOpenedDays: 4, storage: 'ambient', perishable: false, adultMonthly: 300, childFactor: 0.6, weeklyTrip: false }),
  N({ id: 'milk.flavored', slug: 'milk-flavored', nameAr: 'حليب بنكهة', nameEn: 'Flavored Milk', category: 'milk', baseUnit: 'ml', clazz: 'treat', priorityWeight: 0.15, shelfSealedDays: 180, shelfOpenedDays: 2, storage: 'ambient', perishable: false, adultMonthly: 800, childFactor: 1.2, weeklyTrip: false }),
  N({ id: 'milk.powder', slug: 'milk-powder', nameAr: 'حليب بودرة', nameEn: 'Milk Powder', category: 'milk', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 540, shelfOpenedDays: 30, storage: 'ambient', perishable: false, adultMonthly: 250, childFactor: 0.6, weeklyTrip: false }),

  // ---------- Dairy
  N({ id: 'laban', slug: 'laban', nameAr: 'لبن/زبادي', nameEn: 'Laban & Yogurt', category: 'yogurt-laban', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.9, shelfSealedDays: 14, shelfOpenedDays: 5, storage: 'chilled', perishable: true, adultMonthly: 2_000, childFactor: 0.9, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'cheese', slug: 'cheese', nameAr: 'أجبان', nameEn: 'Cheese', category: 'cheese', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.9, shelfSealedDays: 60, shelfOpenedDays: 10, storage: 'chilled', perishable: true, adultMonthly: 700, childFactor: 1.0, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'butter', slug: 'butter', nameAr: 'زبدة وسمن', nameEn: 'Butter & Ghee', category: 'butter-cream', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 120, shelfOpenedDays: 30, storage: 'chilled', perishable: false, adultMonthly: 300, childFactor: 0.6, weeklyTrip: false }),
  N({ id: 'cream', slug: 'cream', nameAr: 'قشطة وكريمة', nameEn: 'Cream', category: 'butter-cream', baseUnit: 'ml', clazz: 'comfort', priorityWeight: 0.3, shelfSealedDays: 60, shelfOpenedDays: 7, storage: 'chilled', perishable: true, adultMonthly: 200, childFactor: 0.4, weeklyTrip: false }),

  // ---------- Essentials
  N({ id: 'eggs', slug: 'eggs', nameAr: 'بيض', nameEn: 'Eggs', category: 'eggs', baseUnit: 'pcs', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 25, shelfOpenedDays: 25, storage: 'chilled', perishable: true, adultMonthly: 25, childFactor: 0.7, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'bread', slug: 'bread', nameAr: 'خبز', nameEn: 'Bread', category: 'bakery', baseUnit: 'pcs', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 3, shelfOpenedDays: 3, storage: 'ambient', perishable: true, adultMonthly: 40, childFactor: 0.6, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'rice', slug: 'rice', nameAr: 'أرز', nameEn: 'Rice', category: 'rice-pasta-grains', baseUnit: 'g', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 4_200, childFactor: 0.6, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'pasta', slug: 'pasta', nameAr: 'مكرونة', nameEn: 'Pasta', category: 'rice-pasta-grains', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.7, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 1_200, childFactor: 0.7, weeklyTrip: false }),
  N({ id: 'flour', slug: 'flour', nameAr: 'دقيق', nameEn: 'Flour', category: 'baking-supplies', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 365, shelfOpenedDays: 120, storage: 'ambient', perishable: false, adultMonthly: 1_000, childFactor: 0.4, weeklyTrip: false }),
  N({ id: 'sugar', slug: 'sugar', nameAr: 'سكر', nameEn: 'Sugar', category: 'baking-supplies', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.8, shelfSealedDays: 1095, shelfOpenedDays: 365, storage: 'ambient', perishable: false, adultMonthly: 1_000, childFactor: 0.5, weeklyTrip: false }),
  N({ id: 'oil', slug: 'oil', nameAr: 'زيت طبخ', nameEn: 'Cooking Oil', category: 'cooking-oils', baseUnit: 'ml', clazz: 'essential', priorityWeight: 0.95, shelfSealedDays: 540, shelfOpenedDays: 120, storage: 'ambient', perishable: false, adultMonthly: 900, childFactor: 0.6, weeklyTrip: false, visibleInWizard: true }),

  // ---------- Proteins
  N({ id: 'chicken', slug: 'chicken', nameAr: 'دجاج', nameEn: 'Chicken', category: 'meat-poultry', baseUnit: 'g', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 90, shelfOpenedDays: 2, storage: 'frozen', perishable: true, adultMonthly: 3_500, childFactor: 0.7, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'meat.red', slug: 'meat-red', nameAr: 'لحوم حمراء', nameEn: 'Red Meat', category: 'meat-poultry', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.8, shelfSealedDays: 90, shelfOpenedDays: 2, storage: 'frozen', perishable: true, adultMonthly: 2_000, childFactor: 0.7, weeklyTrip: true }),
  N({ id: 'meat.processed', slug: 'meat-processed', nameAr: 'مرتديلا ولحوم مصنعة', nameEn: 'Cold Cuts', category: 'meat-poultry', baseUnit: 'g', clazz: 'comfort', priorityWeight: 0.35, shelfSealedDays: 30, shelfOpenedDays: 5, storage: 'chilled', perishable: true, adultMonthly: 400, childFactor: 0.6, weeklyTrip: true }),
  N({ id: 'fish', slug: 'fish', nameAr: 'أسماك', nameEn: 'Fish & Seafood', category: 'fish-seafood', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.7, shelfSealedDays: 90, shelfOpenedDays: 2, storage: 'frozen', perishable: true, adultMonthly: 1_000, childFactor: 0.6, weeklyTrip: true }),

  // ---------- Produce
  N({ id: 'vegetables', slug: 'vegetables', nameAr: 'خضروات', nameEn: 'Vegetables', category: 'fruits-vegetables', baseUnit: 'g', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 6, shelfOpenedDays: 6, storage: 'chilled', perishable: true, adultMonthly: 6_500, childFactor: 0.7, weeklyTrip: true, visibleInWizard: true }),
  N({ id: 'fruits', slug: 'fruits', nameAr: 'فواكه', nameEn: 'Fruits', category: 'fruits-vegetables', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.95, shelfSealedDays: 8, shelfOpenedDays: 8, storage: 'chilled', perishable: true, adultMonthly: 5_000, childFactor: 0.9, weeklyTrip: true, visibleInWizard: true }),

  // ---------- Water & drinks
  N({ id: 'water', slug: 'water', nameAr: 'مياه', nameEn: 'Bottled Water', category: 'water', baseUnit: 'ml', clazz: 'essential', priorityWeight: 1.0, shelfSealedDays: 730, shelfOpenedDays: 2, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0.7, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'juice', slug: 'juice', nameAr: 'عصائر', nameEn: 'Juices', category: 'juices', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.5, shelfSealedDays: 120, shelfOpenedDays: 5, storage: 'ambient', perishable: false, adultMonthly: 3_000, childFactor: 1.0, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'soft-drinks', slug: 'soft-drinks', nameAr: 'مشروبات غازية', nameEn: 'Soft Drinks', category: 'soft-drinks', baseUnit: 'ml', clazz: 'comfort', priorityWeight: 0.3, shelfSealedDays: 180, shelfOpenedDays: 2, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0.8, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'energy-drinks', slug: 'energy-drinks', nameAr: 'مشروبات طاقة', nameEn: 'Energy Drinks', category: 'energy-drinks', baseUnit: 'ml', clazz: 'comfort', priorityWeight: 0.2, shelfSealedDays: 365, shelfOpenedDays: 1, storage: 'ambient', perishable: false, adultMonthly: 1_000, childFactor: 0, weeklyTrip: false }),

  // ---------- Hot drinks
  N({ id: 'coffee', slug: 'coffee', nameAr: 'قهوة', nameEn: 'Coffee', category: 'coffee-tea', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.7, shelfSealedDays: 365, shelfOpenedDays: 45, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'tea', slug: 'tea', nameAr: 'شاي', nameEn: 'Tea', category: 'coffee-tea', baseUnit: 'pcs', clazz: 'regular', priorityWeight: 0.7, shelfSealedDays: 730, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false, visibleInWizard: true }),

  // ---------- Baby (mandatory habits)
  N({ id: 'diapers', slug: 'diapers', nameAr: 'حفاضات', nameEn: 'Diapers', category: 'baby-products', baseUnit: 'pcs', clazz: 'mandatory', priorityWeight: 99, shelfSealedDays: 1095, shelfOpenedDays: 1095, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'formula', slug: 'formula', nameAr: 'حليب أطفال', nameEn: 'Infant Formula', category: 'baby-products', baseUnit: 'g', clazz: 'mandatory', priorityWeight: 99, shelfSealedDays: 365, shelfOpenedDays: 28, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'baby-wipes', slug: 'baby-wipes', nameAr: 'مناديل أطفال مبللة', nameEn: 'Baby Wipes', category: 'baby-products', baseUnit: 'pcs', clazz: 'regular', priorityWeight: 0.7, shelfSealedDays: 730, shelfOpenedDays: 60, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false }),
  N({ id: 'baby-food', slug: 'baby-food', nameAr: 'طعام أطفال', nameEn: 'Baby Food', category: 'baby-products', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.8, shelfSealedDays: 365, shelfOpenedDays: 3, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false }),

  // ---------- Household
  N({ id: 'toilet-paper', slug: 'toilet-paper', nameAr: 'ورق تواليت', nameEn: 'Toilet Paper', category: 'disposables', baseUnit: 'rolls', clazz: 'essential', priorityWeight: 0.85, shelfSealedDays: 3650, shelfOpenedDays: 3650, storage: 'ambient', perishable: false, adultMonthly: 10, childFactor: 0.6, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'tissues', slug: 'tissues', nameAr: 'مناديل ورقية', nameEn: 'Tissues', category: 'disposables', baseUnit: 'sheets', clazz: 'regular', priorityWeight: 0.5, shelfSealedDays: 3650, shelfOpenedDays: 3650, storage: 'ambient', perishable: false, adultMonthly: 1_500, childFactor: 0.6, weeklyTrip: false }),
  N({ id: 'laundry', slug: 'laundry', nameAr: 'منظف غسيل', nameEn: 'Laundry Detergent', category: 'household-cleaning', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.8, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 800, childFactor: 0.5, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'dish-soap', slug: 'dish-soap', nameAr: 'سائل جلي', nameEn: 'Dish Soap', category: 'household-cleaning', baseUnit: 'ml', clazz: 'essential', priorityWeight: 0.75, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 600, childFactor: 0.2, weeklyTrip: false }),
  N({ id: 'cleaners', slug: 'cleaners', nameAr: 'منظفات منزلية', nameEn: 'Household Cleaners', category: 'household-cleaning', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.5, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 1_000, childFactor: 0, weeklyTrip: false }),

  // ---------- Personal care
  N({ id: 'shampoo', slug: 'shampoo', nameAr: 'شامبو', nameEn: 'Shampoo', category: 'personal-care', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 60, childFactor: 0.6, weeklyTrip: false }),
  N({ id: 'soap', slug: 'soap', nameAr: 'صابون', nameEn: 'Soap & Body Wash', category: 'personal-care', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.7, shelfSealedDays: 1825, shelfOpenedDays: 365, storage: 'ambient', perishable: false, adultMonthly: 120, childFactor: 0.6, weeklyTrip: false }),
  N({ id: 'toothpaste', slug: 'toothpaste', nameAr: 'معجون أسنان', nameEn: 'Toothpaste', category: 'personal-care', baseUnit: 'g', clazz: 'essential', priorityWeight: 0.7, shelfSealedDays: 730, shelfOpenedDays: 120, storage: 'ambient', perishable: false, adultMonthly: 40, childFactor: 0.5, weeklyTrip: false }),
  N({ id: 'deodorant', slug: 'deodorant', nameAr: 'مزيل عرق', nameEn: 'Deodorant', category: 'personal-care', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.45, shelfSealedDays: 1095, shelfOpenedDays: 120, storage: 'ambient', perishable: false, adultMonthly: 25, childFactor: 0.3, weeklyTrip: false }),

  // ---------- Cultural / treats
  N({ id: 'dates', slug: 'dates', nameAr: 'تمور', nameEn: 'Dates', category: 'dates-dried-fruits', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 365, shelfOpenedDays: 90, storage: 'ambient', perishable: false, adultMonthly: 500, childFactor: 0.5, weeklyTrip: false, visibleInWizard: true }),
  N({ id: 'nuts', slug: 'nuts', nameAr: 'مكسرات', nameEn: 'Nuts', category: 'nuts-seeds', baseUnit: 'g', clazz: 'comfort', priorityWeight: 0.3, shelfSealedDays: 240, shelfOpenedDays: 60, storage: 'ambient', perishable: false, adultMonthly: 300, childFactor: 0.4, weeklyTrip: false }),
  N({ id: 'tobacco', slug: 'tobacco', nameAr: 'تبغ وسجائر', nameEn: 'Tobacco & Cigarettes', category: 'vape-tobacco', baseUnit: 'pcs', clazz: 'mandatory', priorityWeight: 99, shelfSealedDays: 365, shelfOpenedDays: 365, storage: 'ambient', perishable: false, adultMonthly: 0, childFactor: 0, weeklyTrip: false, visibleInWizard: false }),

  // ---------- Grains & pulses (dried)
  N({ id: 'pulses', slug: 'pulses', nameAr: 'بقوليات وعدس', nameEn: 'Pulses & Lentils', category: 'rice-pasta-grains', baseUnit: 'g', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 1_000, childFactor: 0.5, weeklyTrip: false }),
  N({ id: 'oats', slug: 'oats', nameAr: 'شوفان', nameEn: 'Oats', category: 'rice-pasta-grains', baseUnit: 'g', clazz: 'comfort', priorityWeight: 0.3, shelfSealedDays: 730, shelfOpenedDays: 120, storage: 'ambient', perishable: false, adultMonthly: 300, childFactor: 0.4, weeklyTrip: false }),

  // ---------- Kitchen specialty
  N({ id: 'vinegar', slug: 'vinegar', nameAr: 'خل', nameEn: 'Vinegar', category: 'cooking-oils', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.4, shelfSealedDays: 1095, shelfOpenedDays: 365, storage: 'ambient', perishable: false, adultMonthly: 200, childFactor: 0.2, weeklyTrip: false }),
  N({ id: 'olive-oil', slug: 'olive-oil', nameAr: 'زيت زيتون', nameEn: 'Olive Oil', category: 'cooking-oils', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.6, shelfSealedDays: 540, shelfOpenedDays: 120, storage: 'ambient', perishable: false, adultMonthly: 200, childFactor: 0.3, weeklyTrip: false }),

  // ---------- Household extras
  N({ id: 'fabric-softener', slug: 'fabric-softener', nameAr: 'منعم أقمشة', nameEn: 'Fabric Softener', category: 'household-cleaning', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.35, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 400, childFactor: 0.1, weeklyTrip: false }),
  N({ id: 'toilet-cleaner', slug: 'toilet-cleaner', nameAr: 'منظف حمامات', nameEn: 'Toilet Cleaner', category: 'household-cleaning', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.4, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 300, childFactor: 0, weeklyTrip: false }),
  N({ id: 'floor-cleaner', slug: 'floor-cleaner', nameAr: 'منظف أرضيات ومطهر', nameEn: 'Floor Cleaner & Disinfectant', category: 'household-cleaning', baseUnit: 'ml', clazz: 'regular', priorityWeight: 0.45, shelfSealedDays: 1095, shelfOpenedDays: 180, storage: 'ambient', perishable: false, adultMonthly: 600, childFactor: 0, weeklyTrip: false }),
  N({ id: 'garbage-bags', slug: 'garbage-bags', nameAr: 'أكياس نفايات', nameEn: 'Garbage Bags', category: 'disposables', baseUnit: 'pcs', clazz: 'regular', priorityWeight: 0.5, shelfSealedDays: 3650, shelfOpenedDays: 3650, storage: 'ambient', perishable: false, adultMonthly: 60, childFactor: 0, weeklyTrip: false }),
  N({ id: 'kitchen-towel', slug: 'kitchen-towel', nameAr: 'مناشف مطبخ وورق تغليف', nameEn: 'Kitchen Towels & Foil', category: 'disposables', baseUnit: 'rolls', clazz: 'regular', priorityWeight: 0.5, shelfSealedDays: 3650, shelfOpenedDays: 3650, storage: 'ambient', perishable: false, adultMonthly: 4, childFactor: 0.1, weeklyTrip: false }),
]

/** Fallback need per category (generic need = whole category). */
const CATEGORY_FALLBACK: Record<string, { id: string; clazz: NeedClass; weight: number }> = {
  'milk': { id: 'cat.milk', clazz: 'regular', weight: 0.5 },
  'yogurt-laban': { id: 'cat.yogurt-laban', clazz: 'regular', weight: 0.5 },
  'cheese': { id: 'cat.cheese', clazz: 'regular', weight: 0.5 },
  'butter-cream': { id: 'cat.butter-cream', clazz: 'regular', weight: 0.5 },
  'ice-cream': { id: 'cat.ice-cream', clazz: 'treat', weight: 0.15 },
  'desserts-chilled': { id: 'cat.desserts-chilled', clazz: 'treat', weight: 0.15 },
  'bakery': { id: 'cat.bakery', clazz: 'regular', weight: 0.5 },
  'breakfast-cereals': { id: 'cat.breakfast-cereals', clazz: 'comfort', weight: 0.3 },
  'rice-pasta-grains': { id: 'cat.rice-pasta-grains', clazz: 'regular', weight: 0.5 },
  'baking-supplies': { id: 'cat.baking-supplies', clazz: 'regular', weight: 0.5 },
  'cooking-oils': { id: 'cat.cooking-oils', clazz: 'regular', weight: 0.5 },
  'sauces-condiments': { id: 'cat.sauces-condiments', clazz: 'regular', weight: 0.45 },
  'canned-food': { id: 'cat.canned-food', clazz: 'regular', weight: 0.5 },
  'honey-spreads': { id: 'cat.honey-spreads', clazz: 'comfort', weight: 0.3 },
  'pantry-other': { id: 'cat.pantry-other', clazz: 'comfort', weight: 0.3 },
  'meat-poultry': { id: 'cat.meat-poultry', clazz: 'regular', weight: 0.6 },
  'fish-seafood': { id: 'cat.fish-seafood', clazz: 'regular', weight: 0.5 },
  'frozen-food': { id: 'cat.frozen-food', clazz: 'regular', weight: 0.5 },
  'fruits-vegetables': { id: 'cat.fruits-vegetables', clazz: 'essential', weight: 0.8 },
  'ready-to-eat': { id: 'cat.ready-to-eat', clazz: 'comfort', weight: 0.3 },
  'water': { id: 'cat.water', clazz: 'essential', weight: 0.9 },
  'juices': { id: 'cat.juices', clazz: 'regular', weight: 0.45 },
  'soft-drinks': { id: 'cat.soft-drinks', clazz: 'comfort', weight: 0.25 },
  'energy-drinks': { id: 'cat.energy-drinks', clazz: 'comfort', weight: 0.2 },
  'coffee-tea': { id: 'cat.coffee-tea', clazz: 'regular', weight: 0.5 },
  'biscuits-cookies': { id: 'cat.biscuits-cookies', clazz: 'treat', weight: 0.2 },
  'chocolate-sweets': { id: 'cat.chocolate-sweets', clazz: 'treat', weight: 0.15 },
  'arabic-sweets': { id: 'cat.arabic-sweets', clazz: 'treat', weight: 0.2 },
  'salty-snacks': { id: 'cat.salty-snacks', clazz: 'treat', weight: 0.2 },
  'baby-products': { id: 'cat.baby-products', clazz: 'regular', weight: 0.5 },
  'personal-care': { id: 'cat.personal-care', clazz: 'regular', weight: 0.45 },
  'household-cleaning': { id: 'cat.household-cleaning', clazz: 'regular', weight: 0.5 },
  'disposables': { id: 'cat.disposables', clazz: 'regular', weight: 0.5 },
  'health-pharmacy': { id: 'cat.health-pharmacy', clazz: 'regular', weight: 0.4 },
  'home-kitchenware': { id: 'cat.home-kitchenware', clazz: 'comfort', weight: 0.2 },
  'electronics-accessories': { id: 'cat.electronics-accessories', clazz: 'comfort', weight: 0.1 },
  'stationery-toys': { id: 'cat.stationery-toys', clazz: 'comfort', weight: 0.1 },
  'pet-supplies': { id: 'cat.pet-supplies', clazz: 'comfort', weight: 0.3 },
  'vape-tobacco': { id: 'cat.vape-tobacco', clazz: 'mandatory', weight: 99 },
  'party-supplies': { id: 'cat.party-supplies', clazz: 'comfort', weight: 0.1 },
}

const CATEGORY_CLASS_AR: Record<string, string> = {}
for (const [cat, fb] of Object.entries(CATEGORY_FALLBACK)) {
  CATEGORY_CLASS_AR[cat] = fb.id
}

export const NEEDS_MAP: Map<string, NeedDef> = new Map(NEEDS.map((n) => [n.id, n]))

/** All needs incl. category fallbacks (for lookups). */
export const FALLBACK_IDS = new Set(Object.values(CATEGORY_FALLBACK).map((f) => f.id))

export function getNeed(needId: string | null | undefined): NeedDef | null {
  if (!needId) return null
  return NEEDS_MAP.get(needId) ?? null
}

export function categoryFallbackNeed(category: string): NeedDef | null {
  const fb = CATEGORY_FALLBACK[category]
  if (!fb) return null
  const catNeed: NeedDef = {
    id: fb.id,
    slug: fb.id.replace('cat.', ''),
    nameAr: categoryLabelAr(category),
    nameEn: category,
    category,
    baseUnit: 'pcs',
    clazz: fb.clazz,
    priorityWeight: fb.weight,
    shelfSealedDays: 730,
    shelfOpenedDays: 90,
    storage: 'ambient',
    perishable: false,
    adultMonthly: 0,
    childFactor: 0.5,
    weeklyTrip: false,
    fallbackForCategory: true,
  }
  return catNeed
}

export function categoryLabelAr(category: string): string {
  return (
    ({
      'milk': 'منتجات الحليب',
      'yogurt-laban': 'الزبادي واللبن',
      'cheese': 'الأجبان',
      'butter-cream': 'الزبدة والقشطة',
      'ice-cream': 'المثلجات',
      'desserts-chilled': 'الحلويات المبردة',
      'bakery': 'المخبوزات',
      'breakfast-cereals': 'حبوب الإفطار',
      'rice-pasta-grains': 'الأرز والمكرونة والحبوب',
      'baking-supplies': 'مستلزمات الخَبز',
      'cooking-oils': 'الزيوت والخل',
      'sauces-condiments': 'الصلصات والتوابل',
      'canned-food': 'الأطعمة المعلبة',
      'honey-spreads': 'العسل والمربى',
      'pantry-other': 'مقاضي متفرقة',
      'meat-poultry': 'اللحوم والدواجن',
      'fish-seafood': 'الأسماك والمأكولات البحرية',
      'frozen-food': 'الأطعمة المجمدة',
      'fruits-vegetables': 'الفواكه والخضروات',
      'ready-to-eat': 'الوجبات الجاهزة',
      'water': 'المياه',
      'juices': 'العصائر',
      'soft-drinks': 'المشروبات الغازية',
      'energy-drinks': 'مشروبات الطاقة',
      'coffee-tea': 'القهوة والشاي',
      'biscuits-cookies': 'البسكويت والكوكيز',
      'chocolate-sweets': 'الشوكولاتة والحلويات',
      'arabic-sweets': 'الحلويات الشرقية',
      'salty-snacks': 'الوجبات الخفيفة المالحة',
      'baby-products': 'مستلزمات الأطفال',
      'personal-care': 'العناية الشخصية',
      'household-cleaning': 'المنظفات',
      'disposables': 'المستهلكات الورقية',
      'health-pharmacy': 'الصحة والصيدلية',
      'home-kitchenware': 'أدوات المنزل',
      'electronics-accessories': 'الإلكترونيات',
      'stationery-toys': 'القرطاسية والألعاب',
      'pet-supplies': 'مستلزمات الحيوانات',
      'vape-tobacco': 'التبغ والفيب',
      'party-supplies': 'مستلزمات الحفلات',
      'dates-dried-fruits': 'التمور والفواكه المجففة',
      'nuts-seeds': 'المكسرات والبذور',
    } as Record<string, string>)[category] ?? category
  )
}

// ------------------------- Classifier -------------------------

interface Rule {
  need: string
  /** regex tested against the (en+ar+brand+flavors) haystack */
  re: RegExp
  /** category restriction */
  cat?: string[]
  /** name-only: exclude brand & flavors from the haystack (fresh produce etc.) */
  nf?: boolean
}

const RULES: Rule[] = [
  // --- milk-category noise guard: products in the milk category that carry no
  // dairy context in name/brand fall back to the generic category need (the
  // source archive has misfiled items like "Banana Essence").
  { need: 'cat.milk', cat: ['milk'], re: /^(?!.*(?:حليب|milk|لبن|laban|yogh|زبادي|كريم|cream|مراعي|المراعي|نادك|ندى|الصافي|صافي|اوال|أوال|awal|nada|nadec|almarai|alsa|alsafi|mazaya|rainbow|puck|nestle|anlene|ancho|hi-lo|lal|coast|nutri|mudhish|alwaha|domty|lurpak|kerry|preg|laian|jana|aquafina)).*$/i },
  // --- infant formula (before milk rules! requires milk/feeding context, excludes baby oil etc.)
  { need: 'formula', cat: ['baby-products', 'milk'], re: /حليب\s*(?:اطفال|أطفال|الرضع|رضع)|حليب\s*بودرة\s*(?:لل)?(?:رضع|أطفال)|(?:رضع|طفل|أطفال).*(?:حليب|بودرة)|infant\s*(?:formula|milk)|baby\s*(?:formula|milk)\s*(?!oil)|\b(?:aptamil|aptamil|similac|\bnan\b|s-26|s26|enfamil|bebelac|novalac|premikid|pellargon|frisolac|hipp\b)\b|stage\s*[1-4]|مرحلة\s*[1-4]|مواليد\s*حليب/i },
  // --- diapers
  { need: 'diapers', cat: ['baby-products'], re: /حفاض|حفاظ|پامبرس|بامبرس|diaper|napp|pull.?up|سروال\s*(?:اطفال|أطفال)|pants/i },
  { need: 'baby-wipes', cat: ['baby-products', 'disposables'], re: /مناديل\s*(?:اطفال|أطفال|\s*مبلله|مبللة)|baby\s*wipe|wipe/i },
  { need: 'baby-food', cat: ['baby-products'], re: /cerelac|طعام\s*(?:اطفال|أطفال)|baby\s*food|gerber/i },
  // --- milk: flavored FIRST (vanilla/dates/rose/latte etc are flavored)
  { need: 'milk.flavored', cat: ['milk'], re: /بنكهة|نكهة|شوكولاتة|فراولة|موز|فانيلا|فانيليا|تمر|ورد|قهوة\s*حليب|لاتيه|flavou?r|chocolate|choco|strawb|banana|vanil|dates\s*milk|rose\s*milk|latte|koel|kool|nijoom|نجم/i },
  // --- fresh milk (chilled short shelf)
  { need: 'milk.fresh.full', cat: ['milk'], re: /طازج|fresh\s*milk|fresh.*(milk|full)|full.*(fresh|cream.*milk)|كامل\s*(?:الدسم|القشدة)/i },
  { need: 'milk.fresh.low', cat: ['milk'], re: /طازج.*(خالي|قليل|منزوع)|fresh.*(skim|low.?fat|fat.?free|2%|1%)/i },
  // --- UHT by fat content (requires actual milk context — excludes UHT juices)
  { need: 'milk.uht.full', cat: ['milk'], re: /(?:uht|long.?life|طويل\s*ال(?:مدة|أجل|اجل)).*(?:حليب|milk)|(?:حليب|milk).*(?:uht|long.?life|طويل)|كامل\s*(?:الدسم|القشدة)|full\s*(?:cream|fat|whole)\s*milk|whole\s*milk/i },
  { need: 'milk.uht.low', cat: ['milk'], re: /(?:حليب|milk).*(خالي|قليل|منزوع)\s*الدسم|(?:خالي|قليل|منزوع)\s*الدسم.*(?:حليب|milk)|(?:حليب|milk).*(?:skim|low.?fat|fat.?free|2%|1%)|(?:skim|low.?fat|fat.?free).*(?:milk|حليب)/i },
  { need: 'milk.evaporated', cat: ['milk'], re: /مبخر|مركز|evaporated|condensed|كارنيشن|carnation/i },
  { need: 'milk.powder', cat: ['milk'], re: /بودرة|بودره|powder(?:ed)?\s*milk|milk\s*powder|نيدو|nido/i },
  // --- dairy
  { need: 'laban', cat: ['yogurt-laban'], re: /.*/ },
  { need: 'cheese', cat: ['cheese'], re: /.*/ },
  { need: 'butter', cat: ['butter-cream'], re: /زبدة|زبده|سمن|butter|ghee|lurpak|بلدي\s*زبد/i },
  { need: 'cream', cat: ['butter-cream'], re: /قشطة|قشطه|كريمة|كريمه|cream|قيمر|kimmer/i },
  // --- essentials
  { need: 'eggs', cat: ['eggs'], re: /.*/ },
  { need: 'bread', cat: ['bakery'], re: /خبز|خبزه|توست|صمون|شراق|toast|bread|baguette|باتون/i },
  { need: 'rice', cat: ['rice-pasta-grains'], re: /أرز|ارز|رز\s|بسمتي|rice|basmati|ابو\s*كاس|أبو\s*كاس/i },
  { need: 'pasta', cat: ['rice-pasta-grains'], re: /مكرونة|مكرونه|معكرونة|باستا|pasta|spaghetti|penne|fusilli|macaroni|نودلز|noodle|شعرية|vermicelli/i },
  { need: 'pulses', cat: ['rice-pasta-grains', 'fruits-vegetables', 'canned-food'], re: /عدس|فاصوليا|حمص|برغل|دال\b|masoor|moong|chana|urad|lentil|chickpea|beans\b|بازلاء|peas|matar/i },
  { need: 'oats', cat: ['rice-pasta-grains', 'breakfast-cereals'], re: /شوفان|oat/i },
  { need: 'flour', cat: ['baking-supplies'], re: /دقيق|طحين|flour|all\s*purpose/i },
  { need: 'sugar', cat: ['baking-supplies'], re: /سكر|شكر\s|sugar|سكرر/i },
  { need: 'oil', cat: ['cooking-oils'], re: /زيت\s*(?:طعام|طبخ|ذرة|دوار الشمس|نخيل|كانولا)|cooking\s*oil|sunflower\s*oil|corn\s*oil|canola|vegetable\s*oil|زيت\s*دوار/i },
  { need: 'olive-oil', cat: ['cooking-oils'], re: /زيت\s*زيتون|olive\s*oil|بكر\s*ممتاز|extra\s*virgin/i },
  { need: 'vinegar', cat: ['cooking-oils'], re: /خل\b|خل\s|vinegar/i },
  // --- proteins
  { need: 'meat.processed', cat: ['meat-poultry'], re: /مرتديلا|مورتديلا|سلامي|بسطرمة|لانشون|mortadella|salami|pastrami|luncheon|pepperoni|نقانق|sausage|susage|frank|فرانك|سجق|برجر|burger|كباب\s*مصنع|شاورما\s*مصنعة|bacon|بيكون|همبرجر|هامبرجر|باربري|strips?\s*\d|كرات\s*لحم|meatball| Nuggets|ناجتس| nugget/i },
  { need: 'chicken', cat: ['meat-poultry', 'frozen-food'], nf: true, re: /^(?!.*(?:مرقة|stock|broth|شوربة|soup|معجون|صلص|sauce|توابل|spice|بودرة|بودر|powder|cube|مكعب|نودل|noodle|كبسولة|capsule|frank|فرانك|سجق|ناجت|nugget|شاورما|strips|pet|قطط|كلاب|kitten|puppy|dog|cat\b|طعوم\s*حيوانات|masala|curry|كاري|بهار|خلطة|mix|blend|marinade|تتبيلة)).*(?:دجاج|صدور?\s*دجاج|chicken|breast|فيليه\s*دجاج|whole\s*chicken)/i },
  { need: 'meat.red', cat: ['meat-poultry'], nf: true, re: /^(?!.*(?:مرقة|stock|broth|شوربة|soup|معجون|صلص|sauce|توابل|spice|بودرة|بودر|powder|cube|مكعب|frank|فرانك|سجق|ناجت|nugget|شاورما|pet|قطط|كلاب|kitten|puppy|dog|cat\b|masala|curry|كاري|بهار|خلطة|marinade|تتبيلة)).*(?:لحم|بقري|غنم|حاشي|beef|lamb|mutton|mince|برجر\s*لحم|kebab|بطريق)/i },
  { need: 'fish', cat: ['fish-seafood'], nf: true, re: /^(?!.*(?:sauce|صلص|خل|vinegar|essence|خلاصة|معجون|بودرة|بودر|paste|زيت|oil|توابل|spice|مرقة|broth|stock|شوربة|soup|masala|curry|كاري|بهار|condiment|pickle|مخلل|colou?r|صبغ|ملون|مسحوق|flake|رقائق|chips|سناكس|snack|كريكر|cracker)).*(?:سمك|فيليه|روبيان|جمبري|قروص|سرطان|تونة|سلطون|سلمون|هامور|شعري|صافي|كنعد|قنبر|ميكر|سلقور|بيض\s*سمك|fish|tuna|salmon|shrimp|prawn|crab|sardine|mackerel|fillet|seafood)/i },
  // --- produce
  { need: 'vegetables', cat: ['fruits-vegetables'], nf: true, re: /^(?!.*(?:essence|خلاصة|معجون|صلص|بودر|powder|sauce|spice|توابل|خل|vinegar|عصير|juice|nectar|شراب|syrup|flavou?r|نكهة|زيت|oil|شامبو|shampoo|صابون|soap|مكمل|supplement|حبوب|capsule|أقراص|colou?r|صبغ|ملون|masala|curry|كاري|بهار|condiment|pickle|مخلل|بذور|seed|نبات|plant|عسل|honey|شمع|wax|سكر|ملح|salt|خلطة|mix|blend)).*(?:خض|بندورة|طماطم|بطاطا|بصل|ثوم|جزر|خيار|كوسة|باذنجان|ملفوف|بروكلي|سبانخ|خس|فلفل|بامية|بازلاء|ذرة\s*حلوة|lettuce|tomato|potato|onion|carrot|cucumber|zucchini|cabbage|broccoli|spinach|pepper|okra|veg)/i },
  { need: 'fruits', cat: ['fruits-vegetables'], nf: true, re: /^(?!.*(?:essence|خلاصة|معجون|صلص|بودر|powder|sauce|spice|توابل|خل|vinegar|مجفف|dried|عصير|juice|nectar|شراب|syrup|flavou?r|نكهة|زيت|oil|شامبو|shampoo|صابون|soap|جل|gel|كريم|cream|مكمل|supplement|dish|جلي|wash|clean|منظف|معطر|freshener|كلين|حبوب|capsule|tablet|أقراص|شاي|tea|coffee|قهوة|colou?r|صبغ|ملون|masala|curry|كاري|بهار|condiment|pickle|مخلل|قشر|peel|بذور|seed|نبات|plant|stock|مرقة|broth|cube|مكعب|\bdry\b|dry\s|مسحوق|عسل|honey|شمع|wax|ديتوكس|detox|سكر|sugar|ملح|salt|خلطة|mix|blend|عضم|bone|جلد|skin)).*(?:تفاح|موز|برتقال|عنب|بطيخ|شمام|مانجو|فراولة|ليمون|جوافة|رمان|كيوي|دراق|خوخ|كاكا|apple|banana|orange|grape|melon|mango|strawberry|lemon|guava|pomegranate|kiwi|peach|plum|fruit)/i },
  // --- drinks
  { need: 'water', cat: ['water'], re: /.*/ },
  { need: 'juice', cat: ['juices'], re: /.*/ },
  { need: 'soft-drinks', cat: ['soft-drinks'], re: /.*/ },
  { need: 'energy-drinks', cat: ['energy-drinks'], re: /.*/ },
  // --- hot drinks
  { need: 'coffee', cat: ['coffee-tea'], re: /قهوة|بن\s|قهوه|نسكافيه|coffee|espresso|nescafe|davidoff|lazenga|زلاتة|capsule|كبسولات|3\s*في\s*1|بريد/i },
  { need: 'tea', cat: ['coffee-tea'], re: /شاي|تي\s?بانكت|tea|lipton|ahmad|ربيع|green\s*tea|أخضر/i },
  // --- household
  { need: 'toilet-paper', cat: ['disposables'], re: /تواليت|wc\b|toilet\s*(?:paper|roll|tissue)|ورق\s*حمام/i },
  { need: 'tissues', cat: ['disposables'], re: /مناديل|tissue|napkin|فوطة\s*ورق/i },
  { need: 'garbage-bags', cat: ['disposables'], re: /نفايات|قمامة|garbage|trash|rubbish|bin\s*liner/i },
  { need: 'kitchen-towel', cat: ['disposables'], re: /منشفة|مناشف|kitchen\s*(?:towel|paper)|foil|ألمنيوم|المنيوم|aluminum|cling|food\s*wrap|container|حاوية/i },
  { need: 'laundry', cat: ['household-cleaning'], re: /غسيل|مسحوق|اولين|persil|\bomo\b|ariel|tide\b|detergent|بالآلة|الات\s*الغسيل|comfort|lenor/i },
  { need: 'fabric-softener', cat: ['household-cleaning'], re: /منعم|downy|softener|softners/i },
  { need: 'toilet-cleaner', cat: ['household-cleaning'], re: /مراحيض|حمامات|harpic|toilet\s*cleaner/i },
  { need: 'floor-cleaner', cat: ['household-cleaning'], re: /أرضيات|ارضيات|مطهر|floor|disinfectant|antibacterial|ديتول|dettol|ليزول|lysol/i },
  { need: 'dish-soap', cat: ['household-cleaning'], re: /جلي|dish(?:wash)?|fair\b|pril/i },
  { need: 'cleaners', cat: ['household-cleaning'], re: /.*/ },
  // --- personal care (cross-category: source categories contain noise)
  { need: 'shampoo', re: /شامبو|شامبن|shampoo|هير\s*كير|hair\s*(?:care|spray|gel|color|dye)|بلسم|conditioner|للشعر/i },
  { need: 'soap', re: /صابون|غسول\s*جسم|body\s*wash|shower\s*gel|\bsoap\b|دوف|dove|لوفا/i },
  { need: 'toothpaste', re: /معجون|أسنان|tooth|سيجنال|signal|كولجيت|colgate|اورال\s*b|فرشاة\s*أسنان/i },
  { need: 'deodorant', re: /مزيل|deodou?rant|roll\s*on|antiperspirant|\baxe\b|nivea\s*(?:spray|roll)/i },
  // --- cultural
  { need: 'dates', cat: ['dates-dried-fruits'], re: /تمر|خلاص|سلطانة|رحياني|date|sukkari|sagai|عجوة|medjool/i },
  { need: 'nuts', cat: ['nuts-seeds'], re: /.*/ },
  { need: 'tobacco', cat: ['vape-tobacco'], re: /سجائر|معسل|تبغ|marlboro|cigarette|cigar|فيب|vape|pod|شيشة|اختصام|مارلبورو|دون\s*هيل|kent|winston|pall mall|lm\b/i },
]

/** Classify a product to a need id (or null → review queue). */
export function classifyNeed(
  nameEn: string,
  nameAr: string,
  brand: string | null,
  category: string,
  flavors: string[]
): string | null {
  const hay = [nameEn, nameAr, brand ?? '', ...flavors].join(' | ')
  const nameHay = `${nameEn} ${nameAr}`
  // rules are ordered by specificity; category-restricted rules checked first
  for (const rule of RULES) {
    if (rule.cat && !rule.cat.includes(category)) continue
    if (rule.re.test(rule.nf ? nameHay : hay)) return rule.need
  }
  // loose pass: rule without category constraint may still match other categories
  for (const rule of RULES) {
    if (!rule.cat && rule.re.test(hay)) return rule.need
  }
  const fb = CATEGORY_FALLBACK[category]
  return fb ? fb.id : null
}

/** Extract dietary/special tags from product text (spec 5.2-5). */
export function extractTags(nameEn: string, nameAr: string, flavors: string[], sizeText: string | null): string[] {
  const hay = [nameEn, nameAr, ...flavors, sizeText ?? ''].join(' | ').toLowerCase()
  const tags: string[] = []
  if (/sugar\s*free|خالي.*سكر|سكر\s*زيرو|zero\s*sugar|diet\b|لايت|light\b/.test(hay)) tags.push('dietary:sugar-free')
  if (/gluten|غلوتين|سيلياك|celiac/.test(hay)) tags.push('dietary:gluten-free')
  if (/lactose|لاكتوز/.test(hay)) tags.push('dietary:lactose-free')
  if (/organic|عضوي/.test(hay)) tags.push('organic')
  if (/low\s*sodium|قليل\s*الصوديوم|قليل\s*الملح/.test(hay)) tags.push('sodium:low')
  if (/نكهة|flavou?r|بنكهة/.test(hay)) tags.push('flavored')
  const stage = formulaStageFromName(nameEn, nameAr)
  if (stage) tags.push(`baby:stage=${stage}`)
  const dsize = hay.match(/(?:مقاس|size|sz)\s*[:#]?\s*([1-7])(?!\d)/)
  if (dsize) tags.push(`diaper:size=${dsize[1]}`)
  if (/night|ليلي/.test(hay)) tags.push('diaper:night')
  return tags
}
