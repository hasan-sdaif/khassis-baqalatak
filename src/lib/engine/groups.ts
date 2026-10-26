/**
 * Generic groups (spec 6.20-A / 4.4): brand-agnostic buckets the user can
 * budget with a range (e.g. "chocolate 1.500-7.000 BHD"). Editable overlay
 * supported via admin; seeds derived from actual catalog categories.
 */
import type { GenericGroup } from './types'

const G = (g: GenericGroup): GenericGroup => g

export const GENERIC_GROUPS: GenericGroup[] = [
  G({ id: 'chocolate', nameAr: 'شوكولاتة', nameEn: 'Chocolate', icon: 'chocolate-sweets', needs: ['cat.chocolate-sweets'], categories: ['chocolate-sweets'], keywords: ['شوكولاتة', 'chocolate', 'ب協ر'], ceilingPerAdultMonthly: 400, clazz: 'treat', allergenTags: ['allergen:nuts', 'allergen:milk'], audience: 'all' }),
  G({ id: 'chocolate-bars', parent: 'chocolate', nameAr: 'ألواح شوكولاتة', nameEn: 'Chocolate Bars', icon: 'chocolate-sweets', needs: ['cat.chocolate-sweets'], categories: ['chocolate-sweets'], keywords: ['بار', 'bar', 'لوح'], ceilingPerAdultMonthly: 150, clazz: 'treat', allergenTags: ['allergen:nuts', 'allergen:milk'], audience: 'all' }),
  G({ id: 'sweets', nameAr: 'حلويات وسكاكر', nameEn: 'Sweets & Candy', icon: 'chocolate-sweets', needs: ['cat.chocolate-sweets'], categories: ['chocolate-sweets', 'arabic-sweets'], keywords: ['حلوى', 'candy', 'جيلي', 'علكة', 'سكاكر'], ceilingPerAdultMonthly: 300, clazz: 'treat', allergenTags: [], audience: 'all' }),
  G({ id: 'biscuits', nameAr: 'بسكويت وكوكيز', nameEn: 'Biscuits & Cookies', icon: 'biscuits-cookies', needs: ['cat.biscuits-cookies'], categories: ['biscuits-cookies'], keywords: ['بسكويت', 'biscuit', 'كوكيز', 'cookie', 'كيك'], ceilingPerAdultMonthly: 500, clazz: 'treat', allergenTags: ['allergen:gluten'], audience: 'all' }),
  G({ id: 'juices', nameAr: 'عصائر', nameEn: 'Juices', icon: 'juices', needs: ['juice'], categories: ['juices'], keywords: ['عصير', 'juice', 'نكتار', 'nectar'], ceilingPerAdultMonthly: 4000, clazz: 'regular', allergenTags: [], audience: 'all' }),
  G({ id: 'soft-drinks', nameAr: 'مشروبات غازية', nameEn: 'Soft Drinks', icon: 'soft-drinks', needs: ['soft-drinks'], categories: ['soft-drinks'], keywords: ['غازي', 'cola', 'pepsi', 'ميرندا', 'فانتا', 'سبرايت'], ceilingPerAdultMonthly: 3000, clazz: 'comfort', allergenTags: [], audience: 'all' }),
  G({ id: 'coffee', nameAr: 'قهوة', nameEn: 'Coffee', icon: 'coffee-tea', needs: ['coffee'], categories: ['coffee-tea'], keywords: ['قهوة', 'coffee', 'نسكافيه', 'اسبريسو'], ceilingPerAdultMonthly: 300, clazz: 'regular', allergenTags: [], audience: 'adults' }),
  G({ id: 'tea', nameAr: 'شاي', nameEn: 'Tea', icon: 'coffee-tea', needs: ['tea'], categories: ['coffee-tea'], keywords: ['شاي', 'tea', 'ليبتون', 'أحمد'], ceilingPerAdultMonthly: 120, clazz: 'regular', allergenTags: [], audience: 'all' }),
  G({ id: 'nuts', nameAr: 'مكسرات', nameEn: 'Nuts', icon: 'nuts-seeds', needs: ['nuts'], categories: ['nuts-seeds'], keywords: ['مكسرات', 'nut', 'لوز', 'كاجو', 'فستق', 'بندق'], ceilingPerAdultMonthly: 400, clazz: 'comfort', allergenTags: ['allergen:nuts'], audience: 'all' }),
  G({ id: 'dates', nameAr: 'تمور', nameEn: 'Dates', icon: 'dates-dried-fruits', needs: ['dates'], categories: ['dates-dried-fruits'], keywords: ['تمر', 'date', 'خلاص', 'سكري'], ceilingPerAdultMonthly: 800, clazz: 'regular', allergenTags: [], audience: 'all' }),
  G({ id: 'ice-cream', nameAr: 'مثلجات', nameEn: 'Ice Cream', icon: 'ice-cream', needs: ['cat.ice-cream'], categories: ['ice-cream'], keywords: ['آيس', 'ice cream', 'مثلجات', 'جيلاتو'], ceilingPerAdultMonthly: 600, clazz: 'treat', allergenTags: ['allergen:milk'], audience: 'all' }),
  G({ id: 'salty-snacks', nameAr: 'وجبات خفيفة مالحة', nameEn: 'Salty Snacks', icon: 'salty-snacks', needs: ['cat.salty-snacks'], categories: ['salty-snacks'], keywords: ['شيبسي', 'chips', 'بشار', 'popcorn', 'بريتزل'], ceilingPerAdultMonthly: 500, clazz: 'treat', allergenTags: ['allergen:gluten'], audience: 'all' }),
  G({ id: 'energy-drinks', nameAr: 'مشروبات طاقة', nameEn: 'Energy Drinks', icon: 'energy-drinks', needs: ['energy-drinks'], categories: ['energy-drinks'], keywords: ['ريد بول', 'monster', 'طاقة', 'energy'], ceilingPerAdultMonthly: 1500, clazz: 'comfort', allergenTags: [], audience: 'adults' }),
  G({ id: 'desserts', nameAr: 'حلويات مبردة', nameEn: 'Chilled Desserts', icon: 'desserts-chilled', needs: ['cat.desserts-chilled'], categories: ['desserts-chilled'], keywords: ['جيلي', 'كاسترد', 'مهلبية', 'بودينغ'], ceilingPerAdultMonthly: 400, clazz: 'treat', allergenTags: ['allergen:milk'], audience: 'all' }),
  G({ id: 'cleaning', nameAr: 'منظفات', nameEn: 'Cleaning Supplies', icon: 'household-cleaning', needs: ['cleaners', 'floor-cleaner', 'toilet-cleaner', 'dish-soap'], categories: ['household-cleaning'], keywords: ['منظف', 'cleaner', 'مطهر'], ceilingPerAdultMonthly: 2000, clazz: 'regular', allergenTags: [], audience: 'adults' }),
  G({ id: 'personal-care', nameAr: 'عناية شخصية', nameEn: 'Personal Care', icon: 'personal-care', needs: ['cat.personal-care', 'shampoo', 'soap', 'toothpaste', 'deodorant'], categories: ['personal-care'], keywords: ['عناية', 'care', 'شامبو', 'صابون'], ceilingPerAdultMonthly: 0, clazz: 'regular', allergenTags: [], audience: 'all' }),
  G({ id: 'fruits', nameAr: 'فواكه', nameEn: 'Fruits', icon: 'fruits-vegetables', needs: ['fruits'], categories: ['fruits-vegetables'], keywords: ['فواكه', 'تفاح', 'موز', 'برتقال'], ceilingPerAdultMonthly: 5000, clazz: 'essential', allergenTags: [], audience: 'all' }),
  G({ id: 'vegetables', nameAr: 'خضروات', nameEn: 'Vegetables', icon: 'fruits-vegetables', needs: ['vegetables'], categories: ['fruits-vegetables'], keywords: ['خضار', 'خضروات', 'بندورة', 'بطاطا'], ceilingPerAdultMonthly: 7000, clazz: 'essential', allergenTags: [], audience: 'all' }),
  G({ id: 'stationery', nameAr: 'قرطاسية', nameEn: 'Stationery', icon: 'stationery-toys', needs: ['cat.stationery-toys'], categories: ['stationery-toys'], keywords: ['دفتر', 'قلم', 'notebook', 'pen', 'ملونة'], ceilingPerAdultMonthly: 0, clazz: 'comfort', allergenTags: [], audience: 'kids' }),
  G({ id: 'baby-extras', nameAr: 'مستلزمات أطفال (غير الثابتة)', nameEn: 'Baby Extras', icon: 'baby-products', needs: ['baby-wipes', 'baby-food', 'cat.baby-products'], categories: ['baby-products'], keywords: ['أطفال', 'baby', 'زجاجات', 'لهاية'], ceilingPerAdultMonthly: 0, clazz: 'regular', allergenTags: [], audience: 'kids' }),
  G({ id: 'pet', nameAr: 'مستلزمات حيوانات', nameEn: 'Pet Supplies', icon: 'pet-supplies', needs: ['cat.pet-supplies'], categories: ['pet-supplies'], keywords: ['قطط', 'كلاب', 'cat food', 'dog food', 'رمل'], ceilingPerAdultMonthly: 0, clazz: 'comfort', allergenTags: [], audience: 'adults' }),
]

/** default envelope templates offered to users */
export const ENVELOPE_TEMPLATES = [
  { groupId: 'chocolate', nameAr: 'حلويات الأطفال', min: 1500, max: 7000, priority: 'ifLeft' as const, audience: ['kids', 'all'] as const },
  { groupId: 'juices', nameAr: 'سلة العصائر', min: 1000, max: 5000, priority: 'normal' as const, audience: ['all'] as const },
  { groupId: 'coffee', nameAr: 'قهوة الضيافة', min: 2000, max: 12000, priority: 'high' as const, audience: ['adults'] as const },
  { groupId: 'fruits', nameAr: 'فواكه المنزل', min: 3000, max: 15000, priority: 'high' as const, audience: ['all'] as const },
  { groupId: 'sweets', nameAr: 'سلة الحلويات', min: 1500, max: 8000, priority: 'ifLeft' as const, audience: ['all'] as const },
]
