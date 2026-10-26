/**
 * i18n — Arabic (default, RTL) + English. Lightweight dictionary (the spec's
 * full view surface is Arabic-first; EN covers navigation & core UI).
 */
export type Lang = 'ar' | 'en'

const dict = {
  // app
  appName: { ar: 'خصص بقالتك', en: 'Khassis Baqalatak' },
  appTagline: { ar: 'أخبرنا عن أسرتك وميزانيتك، ونرتّب لك بقالتك بأذكى توزيع', en: 'Tell us your family and budget; we arrange the smartest grocery plan' },
  home: { ar: 'الرئيسية', en: 'Home' },
  start: { ar: 'ابدأ الخطة', en: 'Start plan' },
  plan: { ar: 'خطتي', en: 'My plan' },
  shopping: { ar: 'قائمة التسوق', en: 'Shopping list' },
  catalog: { ar: 'الكتالوج', en: 'Catalog' },
  envelopes: { ar: 'الأظرف العامة', en: 'Budget envelopes' },
  reports: { ar: 'التقارير', en: 'Reports' },
  calculators: { ar: 'الحاسبات', en: 'Calculators' },
  pantry: { ar: 'المخزون', en: 'Pantry' },
  spending: { ar: 'الإنفاق', en: 'Spending' },
  alerts: { ar: 'التنبيهات', en: 'Alerts' },
  index: { ar: 'مؤشر الأسعار', en: 'Price index' },
  community: { ar: 'المجتمع', en: 'Community' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  admin: { ar: 'الإدارة', en: 'Admin' },
  help: { ar: 'المساعدة', en: 'Help' },
  advanced: { ar: 'الخيارات المتقدمة', en: 'Advanced options' },
  // generic
  search: { ar: 'بحث', en: 'Search' },
  save: { ar: 'حفظ', en: 'Save' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  edit: { ar: 'تعديل', en: 'Edit' },
  delete: { ar: 'حذف', en: 'Delete' },
  add: { ar: 'إضافة', en: 'Add' },
  close: { ar: 'إغلاق', en: 'Close' },
  back: { ar: 'رجوع', en: 'Back' },
  next: { ar: 'التالي', en: 'Next' },
  prev: { ar: 'السابق', en: 'Previous' },
  done: { ar: 'تم', en: 'Done' },
  print: { ar: 'طباعة', en: 'Print' },
  share: { ar: 'مشاركة', en: 'Share' },
  export: { ar: 'تصدير', en: 'Export' },
  total: { ar: 'الإجمالي', en: 'Total' },
  budget: { ar: 'الميزانية', en: 'Budget' },
  why: { ar: 'لماذا؟', en: 'Why?' },
  swap: { ar: 'تبديل', en: 'Swap' },
  pin: { ar: 'تثبيت', en: 'Pin' },
  locked: { ar: 'ثابت', en: 'Locked' },
  warning: { ar: 'تنبيه', en: 'Warning' },
  // plan
  crisis: { ar: 'طوارئ', en: 'Crisis' },
  economy: { ar: 'اقتصادية', en: 'Economy' },
  balanced: { ar: 'متوازنة (موصى بها)', en: 'Balanced (recommended)' },
  comfortable: { ar: 'مريحة', en: 'Comfortable' },
  custom: { ar: 'مخصصة', en: 'Custom' },
  expectedSpend: { ar: 'المتوقع صرفه', en: 'Expected spend' },
  surplus: { ar: 'الوفر', en: 'Surplus' },
  shortfall: { ar: 'العجز', en: 'Shortfall' },
  items: { ar: 'بنود', en: 'items' },
  waste: { ar: 'هدر متوقع', en: 'Expected waste' },
  coverage: { ar: 'تغطية الأساسيات', en: 'Essentials coverage' },
  whatIf: { ar: 'ماذا لو؟', en: 'What if?' },
  regenerate: { ar: 'أعد التوليد', en: 'Regenerate' },
  // wizard
  whoAreYou: { ar: 'من أنتم؟', en: 'Who are you?' },
  members: { ar: 'الأفراد', en: 'Members' },
  infants: { ar: 'الرضّع والأطفال', en: 'Infants & toddlers' },
  habits: { ar: 'العادات', en: 'Habits' },
  dietary: { ar: 'القيود الغذائية', en: 'Dietary restrictions' },
  stores: { ar: 'المتاجر والتوصيل', en: 'Stores & delivery' },
  naming: { ar: 'التسمية', en: 'Naming' },
  qualityPrefs: { ar: 'تفضيلات الجودة', en: 'Quality preferences' },
  quickStart: { ar: 'ابدأ بسرعة', en: 'Quick start' },
  generatePlan: { ar: 'ولّد الخطة', en: 'Generate plan' },
} as const

export type TKey = keyof typeof dict

export function t(key: TKey, lang: Lang): string {
  return dict[key]?.[lang] ?? dict[key]?.ar ?? key
}

/** number of members phrasing */
export function membersLabel(count: number, lang: Lang): string {
  if (lang === 'en') return `${count} members`
  if (count === 1) return 'فرد واحد'
  if (count === 2) return 'فردان'
  return `${count} أفراد`
}
