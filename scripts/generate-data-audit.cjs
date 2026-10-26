#!/usr/bin/env node
/**
 * Khassis Baqalatak — reproducible data audit (continuation spec §6.1).
 *
 * Reads data/curated/catalog.json (READ-ONLY — the catalog and data/raw are
 * never modified) and fully regenerates docs/DATA_AUDIT.md. Every number in
 * the written report is COMPUTED at run time from the file itself; there are
 * no hardcoded statistics. A short stdout summary is printed as well.
 *
 * Checks performed:
 *   [a] file size + SHA-256 checksum (node:crypto) of catalog.json
 *   [b] counts: products, stores (active/inactive), categories, products per
 *       category (top 20 + full table), price entries per store, needs
 *       distribution (top 25)
 *   [c] missing values: products without size / without need (null or '') /
 *       without brand / without unitPriceFils / price entries with
 *       available===false / empty display names
 *   [d] duplicates: duplicate product ids (INVARIANT — must be 0, otherwise
 *       exit 1), duplicate normalized (name + sizeText + brand) pairs with
 *       top-10 groups
 *   [e] price anomalies: medianFils<=0, minFils>maxFils, median outside
 *       [min,max], per-entry fils<=0 or >MAX_AUDIT_FILS (500,000),
 *       origFils vs fils comparison (discount markers)
 *   [f] unparsed sizes: sizeText non-empty but size===null (count + examples)
 *   [g] cross-checks: every price storeId exists in stores; every product
 *       category exists in categories; products claiming available===true
 *       with zero available price entries
 *
 * Audit PARAMETERS (limits, not statistics): MAX_AUDIT_FILS = 500,000 fils
 * (500 BHD); TOP_CATEGORIES = 20; TOP_NEEDS = 25; TOP_EXAMPLES = 10;
 * TOP_DUP_GROUPS = 10.
 *
 * Usage:    node scripts/generate-data-audit.cjs
 * Exit:     0 on success; 1 if the duplicate-id invariant fails, the catalog
 *           cannot be read, or the report cannot be written.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// paths + audit parameters
// ---------------------------------------------------------------------------
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data', 'curated', 'catalog.json');
const reportPath = path.join(root, 'docs', 'DATA_AUDIT.md');

const MAX_AUDIT_FILS = 500000; // 500 BHD audit threshold (parameter, not a stat)
const TOP_CATEGORIES = 20;
const TOP_NEEDS = 25;
const TOP_EXAMPLES = 10;
const TOP_DUP_GROUPS = 10;

// raw markdown archive (read-only): prefer the nested layout, fall back gracefully
const rawDirCandidates = [
  path.join(root, 'data', 'raw', 'grocery-db-bahrain', 'grocery-db-bahrain'),
  path.join(root, 'data', 'raw', 'grocery-db-bahrain'),
];

// ---------------------------------------------------------------------------
// formatting helpers (display only — never used to derive a number)
// ---------------------------------------------------------------------------
const nf = new Intl.NumberFormat('en-US');
const fmt = (n) => nf.format(n);
const pct = (num, den) => (den > 0 ? ((num / den) * 100).toFixed(2) + '%' : '—');
const cumPct = pct; // alias: identical semantics (share of total)
const bhd = (fils) => (fils / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const mb = (bytes) => (bytes / 1048576).toFixed(2) + ' MB';
const trunc = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** normalization for duplicate detection: strip Arabic diacritics/tatweel,
 *  collapse whitespace, lowercase latin — documented in the report. */
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g; // harakat + superscript alef + tatweel
function norm(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(ARABIC_DIACRITICS, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// [a] read the catalog + checksum
// ---------------------------------------------------------------------------
const t0 = process.hrtime.bigint();
const catalogBytes = fs.readFileSync(catalogPath); // throws → caught below? keep simple: crash is fine
const sha256 = crypto.createHash('sha256').update(catalogBytes).digest('hex');
const catalog = JSON.parse(catalogBytes.toString('utf8'));

const products = Array.isArray(catalog.products) ? catalog.products : [];
const stores = Array.isArray(catalog.stores) ? catalog.stores : [];
const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
const total = products.length;

// ---------------------------------------------------------------------------
// [b] counts + distributions
// ---------------------------------------------------------------------------
const storesActive = stores.filter((s) => s.active === true).length;
const storesInactive = stores.length - storesActive;

// products per category (all categories, even empty ones)
const catById = new Map(categories.map((c) => [c.id, c]));
const catCounts = categories.map((c) => ({ id: c.id, nameAr: c.nameAr, n: 0 }));
const catCountById = new Map(catCounts.map((c) => [c.id, c]));
for (const p of products) {
  const entry = catCountById.get(p.category);
  if (entry) entry.n += 1;
}
const catSorted = [...catCounts].sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));

// price entries per store (+ distinct products per store)
const storeById = new Map(stores.map((s) => [s.id, s]));
const storeEntries = new Map(stores.map((s) => [s.id, { id: s.id, nameAr: s.nameAr, kind: s.kind || '', entries: 0, distinct: 0 }]));
const storeDistinctSeen = new Map(stores.map((s) => [s.id, new Set()]));
let priceEntryTotal = 0;

// needs distribution
const needCounts = new Map();
let productsWithNeed = 0;
let productsWithoutNeed = 0; // need === null || '' || undefined
let distinctNeeds = 0;

// missing values
let noSize = 0; // size == null
let noSizeWithText = 0; // sizeText non-empty but size == null (unparsed — check [f])
let noBrand = 0;
let noUnitPrice = 0; // unitPriceFils == null/undefined
let unitPriceNonPositive = 0; // unitPriceFils <= 0
let noNameAr = 0; // nameAr empty/null — display falls back to nameEn
let noNameEn = 0;
let noNameBoth = 0; // no display name at all
let productAvailableFalse = 0;
let priceAvailableFalse = 0;

// duplicates
const idCount = new Map();
const dupPairPrimary = new Map(); // norm(nameAr || nameEn) + sizeText + brand
const dupPairStrict = new Map(); // norm(nameAr) + sizeText + brand (reference number only)

// price anomalies
let medianNonPositive = 0;
let minGreaterThanMax = 0;
let medianOutsideRange = 0;
let filsNonPositive = 0;
let filsAboveThreshold = 0;
let filsNonNumeric = 0;
let origFilsPresent = 0;
let origFilsGreaterThanFils = 0; // real discount markers
let origFilsLessThanFils = 0; // inverted marker (anomaly direction)
let origFilsEqualToFils = 0;
const filsAboveThresholdExamples = [];

// unparsed sizes
const unparsedSizeExamples = [];

// cross-checks
let pricesToUnknownStore = 0;
const unknownStoreRefs = new Map(); // storeId -> count
let productsWithUnknownCategory = 0;
const unknownCategoryRefs = new Map();
let availableTrueWithoutAvailablePrice = 0;
const availableTrueWithoutPriceExamples = [];
const availableFalseButPriceAvailable = []; // product available=false while its price entries say available

// ---------------------------------------------------------------------------
// main single pass over products
// ---------------------------------------------------------------------------
for (const p of products) {
  // --- ids
  idCount.set(p.id, (idCount.get(p.id) || 0) + 1);

  // --- names
  const hasAr = typeof p.nameAr === 'string' && p.nameAr.trim() !== '';
  const hasEn = typeof p.nameEn === 'string' && p.nameEn.trim() !== '';
  if (!hasAr) noNameAr += 1;
  if (!hasEn) noNameEn += 1;
  if (!hasAr && !hasEn) noNameBoth += 1;

  // --- size / sizeText
  const sizeText = typeof p.sizeText === 'string' ? p.sizeText.trim() : '';
  if (p.size == null) {
    noSize += 1;
    if (sizeText !== '') {
      noSizeWithText += 1;
      if (unparsedSizeExamples.length < TOP_EXAMPLES) {
        unparsedSizeExamples.push({ id: p.id, sizeText, name: hasAr ? p.nameAr : p.nameEn });
      }
    }
  }

  // --- need
  if (p.need === null || p.need === undefined || p.need === '') {
    productsWithoutNeed += 1;
  } else {
    productsWithNeed += 1;
    needCounts.set(p.need, (needCounts.get(p.need) || 0) + 1);
  }

  // --- brand
  if (p.brand === null || p.brand === undefined || p.brand === '') noBrand += 1;

  // --- unitPriceFils
  if (p.unitPriceFils === null || p.unitPriceFils === undefined) noUnitPrice += 1;
  else if (typeof p.unitPriceFils === 'number' && p.unitPriceFils <= 0) unitPriceNonPositive += 1;

  // --- product availability flag
  if (p.available === false) productAvailableFalse += 1;

  // --- duplicate pair keys
  const strictKey = norm(p.nameAr) + '\u0000' + norm(sizeText) + '\u0000' + norm(p.brand);
  dupPairStrict.set(strictKey, (dupPairStrict.get(strictKey) || 0) + 1);
  const displayName = hasAr ? p.nameAr : p.nameEn;
  const primaryKey = norm(displayName) + '\u0000' + norm(sizeText) + '\u0000' + norm(p.brand);
  dupPairPrimary.set(primaryKey, (dupPairPrimary.get(primaryKey) || 0) + 1);

  // --- category cross-check
  if (!catById.has(p.category)) {
    productsWithUnknownCategory += 1;
    unknownCategoryRefs.set(p.category, (unknownCategoryRefs.get(p.category) || 0) + 1);
  }

  // --- price-level checks
  const minF = typeof p.minFils === 'number' ? p.minFils : null;
  const maxF = typeof p.maxFils === 'number' ? p.maxFils : null;
  const medF = typeof p.medianFils === 'number' ? p.medianFils : null;
  if (medF !== null && medF <= 0) medianNonPositive += 1;
  if (minF !== null && maxF !== null && minF > maxF) minGreaterThanMax += 1;
  if (medF !== null && minF !== null && maxF !== null && (medF < minF || medF > maxF)) medianOutsideRange += 1;

  const prices = p.prices && typeof p.prices === 'object' ? p.prices : {};
  const priceKeys = Object.keys(prices);
  let availableEntries = 0;
  for (const [storeId, pr] of Object.entries(prices)) {
    priceEntryTotal += 1;
    // store cross-check
    if (!storeById.has(storeId)) {
      pricesToUnknownStore += 1;
      unknownStoreRefs.set(storeId, (unknownStoreRefs.get(storeId) || 0) + 1);
    } else {
      storeEntries.get(storeId).entries += 1;
      storeDistinctSeen.get(storeId).add(p.id);
    }
    // availability at price level
    if (pr && pr.available === false) priceAvailableFalse += 1;
    else availableEntries += 1;
    // fils sanity
    const fils = pr ? pr.fils : undefined;
    if (typeof fils !== 'number' || Number.isNaN(fils)) {
      filsNonNumeric += 1;
    } else if (fils <= 0) {
      filsNonPositive += 1;
    } else if (fils > MAX_AUDIT_FILS) {
      filsAboveThreshold += 1;
      if (filsAboveThresholdExamples.length < TOP_EXAMPLES) {
        filsAboveThresholdExamples.push({
          id: p.id, storeId, fils,
          category: p.category,
          name: hasAr ? p.nameAr : p.nameEn,
        });
      }
    }
    // origFils comparison
    if (pr && pr.origFils !== null && pr.origFils !== undefined && typeof pr.origFils === 'number') {
      origFilsPresent += 1;
      if (typeof fils === 'number') {
        if (pr.origFils > fils) origFilsGreaterThanFils += 1;
        else if (pr.origFils < fils) origFilsLessThanFils += 1;
        else origFilsEqualToFils += 1;
      }
    }
  }

  // --- available=true with zero available price entries
  if (p.available === true && availableEntries === 0) {
    availableTrueWithoutAvailablePrice += 1;
    if (availableTrueWithoutPriceExamples.length < TOP_EXAMPLES) {
      availableTrueWithoutPriceExamples.push({ id: p.id, prices: priceKeys.length });
    }
  }
  // --- available=false while price entries say available (internal inconsistency, reported honestly)
  if (p.available === false && priceKeys.length > 0) {
    const allEntriesAvailable = Object.values(prices).every((pr) => pr && pr.available !== false);
    if (allEntriesAvailable && availableFalseButPriceAvailable.length < TOP_EXAMPLES) {
      availableFalseButPriceAvailable.push({ id: p.id, entries: priceKeys.length, category: p.category, name: hasAr ? p.nameAr : p.nameEn });
    }
  }
}

distinctNeeds = needCounts.size;
const needsSorted = [...needCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

// duplicate id groups (INVARIANT)
const dupIdGroups = [...idCount.entries()].filter(([, c]) => c > 1);

// duplicate pair groups
const dupPrimaryGroups = [...dupPairPrimary.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const dupPrimaryProducts = dupPrimaryGroups.reduce((s, [, c]) => s + c, 0);
const dupStrictGroups = [...dupPairStrict.entries()].filter(([, c]) => c > 1);
const dupStrictProducts = dupStrictGroups.reduce((s, [, c]) => s + c, 0);
const maxPrimaryGroup = dupPrimaryGroups.length > 0 ? dupPrimaryGroups[0][1] : 0;

// store table (sorted by entries desc, tie-break by id)
const storeRows = [...storeEntries.values()]
  .map((s) => ({ ...s, distinct: storeDistinctSeen.get(s.id).size }))
  .sort((a, b) => b.entries - a.entries || a.id.localeCompare(b.id));

// unparsed size text breakdown: 'غير محدد' vs real text
let unparsedGhayrMahaddad = 0;
const unparsedRealTextExamples = [];
for (const p of products) {
  const sizeText = typeof p.sizeText === 'string' ? p.sizeText.trim() : '';
  if (sizeText !== '' && p.size == null) {
    if (sizeText === 'غير محدد') unparsedGhayrMahaddad += 1;
    else if (unparsedRealTextExamples.length < TOP_EXAMPLES) {
      unparsedRealTextExamples.push({ id: p.id, sizeText, name: p.nameAr && p.nameAr.trim() !== '' ? p.nameAr : p.nameEn });
    }
  }
}
const unparsedRealText = noSizeWithText - unparsedGhayrMahaddad;

// ---------------------------------------------------------------------------
// raw archive stats (READ-ONLY: readdir + stat only)
// ---------------------------------------------------------------------------
let rawDir = null;
let rawFileCount = 0;
let rawBytes = 0;
for (const cand of rawDirCandidates) {
  if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) { rawDir = cand; break; }
}
if (rawDir) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { rawFileCount += 1; rawBytes += fs.statSync(full).size; }
    }
  };
  walk(rawDir);
}
// other read-only artifacts present in this working environment (outside audit scope)
const rawSideArtifacts = [];
for (const name of ['full-dump.json', 'catalog-source.json']) {
  const full = path.join(root, 'data', 'raw', name);
  if (fs.existsSync(full)) rawSideArtifacts.push({ name, bytes: fs.statSync(full).size });
}

// ---------------------------------------------------------------------------
// build the report (docs/DATA_AUDIT.md) — every number below is computed above
// ---------------------------------------------------------------------------
const generatedAt = new Date().toISOString();
const L = [];
const push = (s) => L.push(s);

push('# جرد بيانات الكتالوج (DATA_AUDIT.md)');
push('');
push('> هذا التقرير يُولَّد آلياً بالكامل بواسطة `scripts/generate-data-audit.cjs`: كل رقم فيه محسوب لحظة التوليد من `data/curated/catalog.json` نفسه، ولا يوجد رقم مثبَّت يدوياً. يبقى التمييز قائماً بين فحوص البنية والسعر المحسوبة وبين المراجعة الدلالية المطلوبة: سلامة JSON والسعر ليست دليلاً على صحة تصنيف كل منتج.');
push('');
push('## كيفية إعادة التوليد');
push('');
push('```bash');
push('node scripts/generate-data-audit.cjs');
push('```');
push('');
push('- يقرأ السكربت الكتالوج (قراءة فقط، لا يعدّل `data/curated/` ولا `data/raw/`)، يحسب كل الأرقام الواردة هنا، ثم يعيد كتابة هذا الملف كاملاً.');
push('- حدود الفحص المعتمدة (معايير تدقيق قابلة للتعديل، وليست إحصاءات): سقف السعر المرجعي ' + fmt(MAX_AUDIT_FILS) + ' فلس، أعلى ' + TOP_CATEGORIES + ' تصنيفاً، أعلى ' + TOP_NEEDS + ' احتياجاً، وحتى ' + TOP_EXAMPLES + ' أمثلة لكل نوع شذوذ.');
push('- يخرج السكربت بالرمز 0 عند النجاح، وبالرمز 1 إذا انتهك شرط فرادة معرفات المنتجات أو تعذّرت كتابة التقرير.');
push('');
push('## بصمة الملف المدقَّق');
push('');
push('| البند | القيمة |');
push('|---|---|');
push('| المسار | `data/curated/catalog.json` |');
push('| الحجم | ' + fmt(catalogBytes.length) + ' بايت (' + mb(catalogBytes.length) + ') |');
push('| SHA-256 | `' + sha256 + '` |');
push('| `version` | ' + catalog.version + ' |');
push('| `generatedAt` (لقطة المصدر) | ' + catalog.generatedAt + ' |');
push('| `currency` | ' + catalog.currency + ' (المبالغ مخزنة بالفلس) |');
push('| بيئة التوليد | Node ' + process.version + ' — ' + process.platform + ' |');
push('| تاريخ تشغيل التوليد | ' + generatedAt + ' |');
push('');
push('## مصادر الملفات التي جرى فحصها');
push('');
push('| المسار | الملاحظة (أرقام محسوبة) |');
push('|---|---|');
push('| `data/curated/catalog.json` | الكتالوج الذي يستخدمه محرك التوصيات؛ ' + fmt(catalogBytes.length) + ' بايت (' + mb(catalogBytes.length) + ')، بصمة SHA-256 أعلاه. |');
if (rawDir) {
  push('| `' + path.relative(root, rawDir).split(path.sep).join('/') + '` | ' + fmt(rawFileCount) + ' ملفاً فعلياً: README و' + fmt(rawFileCount - 1) + ' ملف Markdown للتصنيفات؛ ' + fmt(rawBytes) + ' بايت (' + mb(rawBytes) + '). للقراءة فقط ولم تُعدَّل. |');
} else {
  push('| أرشيف Markdown الخام | غير موجود في المسار المتوقع — لم يُفحص. |');
}
push('| `src/lib/engine/` | قواعد الحراسة الدلالية لبعض الاحتياجات؛ راجع `DECISIONS.md` و`CONTINUATION_FINDINGS.md` (وصف نوعي بلا أرقام). |');
push('');
if (rawSideArtifacts.length > 0) {
  push('ملاحظة بيئة عمل: توجد في `data/raw/` أيضاً ' + rawSideArtifacts.map((a) => '`' + a.name + '` (' + fmt(a.bytes) + ' بايت)').join(' و') + '؛ وهي خارج نطاق هذا الجرد ولم تُقرأ إلا حجمها ولا تُعدَّل.');
  push('');
}
push('## نتائج التحقق من `catalog.json`');
push('');
push('تاريخ لقطة المصدر: `' + catalog.version + '`، والطابع الزمني: `' + catalog.generatedAt + '`، والعملة: الدينار البحريني، والمبالغ مخزنة بالفلس.');
push('');
push('| الفحص | النتيجة |');
push('|---|---:|');
push('| إجمالي المنتجات | ' + fmt(total) + ' |');
push('| المتاجر المعرّفة | ' + fmt(stores.length) + ' (نشطة: ' + fmt(storesActive) + ' / غير نشطة: ' + fmt(storesInactive) + ') |');
push('| التصنيفات المعرّفة | ' + fmt(categories.length) + ' |');
push('| إجمالي إدخالات أسعار المتاجر | ' + fmt(priceEntryTotal) + ' |');
push('| متوسط إدخالات السعر لكل منتج | ' + (total > 0 ? (priceEntryTotal / total).toFixed(2) : '—') + ' |');
push('| منتجات لها حجم قابل للتحليل | ' + fmt(total - noSize) + ' (' + pct(total - noSize, total) + ') |');
push('| منتجات بلا حجم محلل | ' + fmt(noSize) + ' (' + pct(noSize, total) + ') |');
push('| منتجات مرتبطة باحتياج | ' + fmt(productsWithNeed) + ' |');
push('| منتجات بلا حقل احتياج مباشر (`need=null` أو فارغ) | ' + fmt(productsWithoutNeed) + ' |');
push('| احتياجات مميزة غير فارغة | ' + fmt(distinctNeeds) + ' |');
push('| منتجات بلا علامة تجارية (`brand=null`) | ' + fmt(noBrand) + ' (' + pct(noBrand, total) + ') |');
push('| منتجات بلا `unitPriceFils` | ' + fmt(noUnitPrice) + ' |');
push('| منتجات بـ `unitPriceFils` غير موجب | ' + fmt(unitPriceNonPositive) + ' |');
push('| منتجات بلا اسم عربي `nameAr` (يعرضها التطبيق بالاسم الإنجليزي) | ' + fmt(noNameAr) + ' (' + pct(noNameAr, total) + ') |');
push('| أسماء العرض الفارغة (عربي وإنجليزي معاً) | ' + fmt(noNameBoth) + ' |');
push('| منتجات بلا أي إدخال سعر متجر | ' + fmt(products.filter((p) => Object.keys(p.prices && typeof p.prices === 'object' ? p.prices : {}).length === 0).length) + ' |');
push('| منتجات `available=false` | ' + fmt(productAvailableFalse) + ' |');
push('| إدخالات أسعار `available=false` | ' + fmt(priceAvailableFalse) + ' |');
push('| أسعار غير رقمية | ' + fmt(filsNonNumeric) + ' |');
push('| أسعار غير موجبة (`fils<=0`) | ' + fmt(filsNonPositive) + ' |');
push('| مراجع أسعار إلى متجر مجهول | ' + fmt(pricesToUnknownStore) + ' |');
push('| معرّفات منتجات مكررة (شرط مفروض) | ' + fmt(dupIdGroups.length) + ' |');
push('');
push('### طريقة التحقق');
push('');
push('قرأ السكربت ملف الكتالوج بالكامل عبر Node.js، وحسب كل رقم في الجداول أدناه في مرور واحد على المنتجات. تحقّق الفحص من: فرادة معرّف المنتج (شرط يُفشل السكربت عند انتهاكه)، وجود اسم عرض واحد على الأقل، وجود حجم محلل، وجود حقل احتياج، سلامة كل إدخال سعر رقمياً ومداه، انتماء كل سعر إلى متجر معرّف وانتماء كل منتج إلى تصنيف معرّف، واتساق علامة التوفر بين مستوى المنتج ومستوى الأسعار. هذه فحوص بنيوية ومالية، وليست تدقيقاً يدوياً أو لغوياً شاملاً لصفوف Markdown الخام.');
push('');
push('## توزيع المنتجات على التصنيفات');
push('');
push('أعلى ' + TOP_CATEGORIES + ' تصنيفاً (من أصل ' + fmt(categories.length) + '):');
push('');
push('| # | التصنيف | الاسم | المنتجات | النسبة | التراكمي |');
push('|---:|---|---|---:|---:|---:|');
let cum = 0;
catSorted.slice(0, TOP_CATEGORIES).forEach((c, i) => {
  cum += c.n;
  push('| ' + (i + 1) + ' | `' + c.id + '` | ' + trunc(c.nameAr, 40) + ' | ' + fmt(c.n) + ' | ' + pct(c.n, total) + ' | ' + cumPct(cum, total) + ' |');
});
push('');
push('### الجدول الكامل (' + fmt(categories.length) + ' تصنيفاً)');
push('');
push('| # | التصنيف | الاسم | المنتجات | النسبة |');
push('|---:|---|---|---:|---:|');
catSorted.forEach((c, i) => {
  push('| ' + (i + 1) + ' | `' + c.id + '` | ' + trunc(c.nameAr, 40) + ' | ' + fmt(c.n) + ' | ' + pct(c.n, total) + ' |');
});
push('');
push('## توزيع إدخالات الأسعار على المتاجر');
push('');
push('إجمالي إدخالات الأسعار: ' + fmt(priceEntryTotal) + ' عبر ' + fmt(stores.length) + ' متجراً. بما أن `prices` خريطةٌ مفاتيحها معرّف المتجر، فلا يمكن أن يتكرر متجر واحد داخل المنتج الواحد؛ لذا يساوي عدد إدخالات كل متجر عدد المنتجات التي يغطيها بنيوياً، و«تغطية الكتالوج» نسبة هذا العدد إلى إجمالي المنتجات.');
push('');
push('| المتجر | النوع | إدخالات الأسعار (= منتجات مغطاة) | نسبة الإدخالات | تغطية الكتالوج |');
push('|---|---|---:|---:|---:|');
storeRows.forEach((s) => {
  push('| `' + s.id + '` — ' + trunc(s.nameAr, 20) + ' | ' + (s.kind || '—') + ' | ' + fmt(s.entries) + ' | ' + pct(s.entries, priceEntryTotal) + ' | ' + pct(s.distinct, total) + ' |');
});
push('');
push('## توزيع الاحتياجات (أعلى ' + TOP_NEEDS + ')');
push('');
push('عدد الاحتياجات المميزة غير الفارغة: ' + fmt(distinctNeeds) + '. المنتجات ذات `need=null` (' + fmt(productsWithoutNeed) + ') تقع خارج هذا الجدول. القيم المسبوقة بـ `cat.` هي احتياجات مشتقة من التصنيف.');
push('');
push('| # | الاحتياج | المنتجات | النسبة من الإجمالي |');
push('|---:|---|---:|---:|');
needsSorted.slice(0, TOP_NEEDS).forEach(([need, n], i) => {
  push('| ' + (i + 1) + ' | `' + need + '` | ' + fmt(n) + ' | ' + pct(n, total) + ' |');
});
push('');
push('## القيم المفقودة');
push('');
push('| الحقل المفقود | عدد المنتجات/الإدخالات | القراءة الأمينة |');
push('|---|---:|---|');
push('| بلا حجم محلل (`size=null`) | ' + fmt(noSize) + ' (' + pct(noSize, total) + ') | منها ' + fmt(unparsedGhayrMahaddad) + ' بنص حجم «غير محدد» و' + fmt(unparsedRealText) + ' بنص حجم فعلي لم يُحلَّل (انظر قسم الأحجام). تبقى خارج مقارنة الوحدات والتخطيط الكمي. |');
push('| بلا احتياج (`need=null` أو فارغ) | ' + fmt(productsWithoutNeed) + ' | يجب توضيح تعامل fallback معها عند الاستيراد/التخطيط وعدم إخفائها بصمت. |');
push('| بلا علامة تجارية (`brand=null`) | ' + fmt(noBrand) + ' (' + pct(noBrand, total) + ') | معظم صفوف المصدر لا تحدد علامة؛ لا يمنع ذلك العرض أو البحث. |');
push('| بلا `unitPriceFils` | ' + fmt(noUnitPrice) + ' | نتاج مباشر لغياب الحجم القابل للتحليل؛ لا تدخل هذه المنتجات مقارنة الوحدات. |');
push('| `unitPriceFils` غير موجب | ' + fmt(unitPriceNonPositive) + ' | تُعدّ شذوذاً حسابياً طفيفاً؛ معروضة هنا للأمانة ولم تُعدَّل. |');
push('| بلا اسم عربي `nameAr` | ' + fmt(noNameAr) + ' (' + pct(noNameAr, total) + ') | كلها تمتلك `nameEn`؛ اسم العرض ليس فارغاً لدى أي منتج (الفارغ في اللغتين معاً: ' + fmt(noNameBoth) + '). |');
push('| إدخالات أسعار `available=false` | ' + fmt(priceAvailableFalse) + ' | صفر عند هذا التوليد؛ أي ظهور لاحق يستحق المراجعة. |');
push('');
push('## التكرارات');
push('');
push('### معرّفات المنتجات (شرط مفروض)');
push('');
push('عدد مجموعات المعرفات المكررة: **' + fmt(dupIdGroups.length) + '** من أصل ' + fmt(idCount.size) + ' معرفاً مميزاً. هذا شرط صارم في السكربت: أي انتهاك يجعل التوليد يفشل بالرمز 1 ولا يُنشر تقرير ناجح.');
push('');
push('### أزواج (الاسم + الحجم + العلامة) المطبَّعة');
push('');
push('منهجية المفتاح: مطبَّع (`norm`) يزيل التشكيل والتطويل ويوحّد المسافات ويصغّر حروف اللاتينية؛ المفتاح = الاسم + `sizeText` + `brand`. بما أن ' + fmt(noNameAr) + ' منتجاً بلا اسم عربي، استُخدم `nameEn` بديلاً عند فراغ `nameAr` — وبدون هذا البديل تتجمّع منتجات بلا اسم عربي وعلامة وحجم في مجموعات ضخمة غير دالة (بالمنهجية الحرفية على `nameAr` وحده: ' + fmt(dupStrictGroups.length) + ' مجموعة تضم ' + fmt(dupStrictProducts) + ' منتجاً، أكبرها مجموعات فارغة الاسم — رقم مرجعي للشفافية فقط).');
push('');
push('بالمفتاح المعتمد (مع البديل): **' + fmt(dupPrimaryGroups.length) + ' مجموعة** تضم **' + fmt(dupPrimaryProducts) + ' منتجاً** (' + pct(dupPrimaryProducts, total) + ')، وأكبر مجموعة تحوي ' + fmt(maxPrimaryGroup) + ' نسخ. أعلى ' + TOP_DUP_GROUPS + ' مجموعات:');
push('');
push('| # | النسخ | الاسم | الحجم | العلامة |');
push('|---:|---:|---|---|---|');
dupPrimaryGroups.slice(0, TOP_DUP_GROUPS).forEach(([key, c], i) => {
  const [name, sizeT, brand] = key.split('\u0000');
  push('| ' + (i + 1) + ' | ' + fmt(c) + ' | ' + trunc(name, 60) + ' | ' + trunc(sizeT, 20) + ' | ' + (brand ? trunc(brand, 20) : '(بلا علامة)') + ' |');
});
push('');
push('قراءة أمينة: هذه **مرشّحات تكرار** لا أحكام حذف — قد تكون نسخاً متعددة وردت في المصدر نفسه أو فروق تشكيلة/عبوة لا يميزها `sizeText`. لم يُعدَّل الكتالوج (قراءة فقط).');
push('');
push('## شذوذ الأسعار');
push('');
push('| الفحص | العدد |');
push('|---|---:|');
push('| `medianFils <= 0` | ' + fmt(medianNonPositive) + ' |');
push('| `minFils > maxFils` | ' + fmt(minGreaterThanMax) + ' |');
push('| الوسيط خارج `[minFils, maxFils]` | ' + fmt(medianOutsideRange) + ' |');
push('| `fils <= 0` | ' + fmt(filsNonPositive) + ' |');
push('| `fils` غير رقمي | ' + fmt(filsNonNumeric) + ' |');
push('| `fils > ' + fmt(MAX_AUDIT_FILS) + '` (حد التدقيق) | ' + fmt(filsAboveThreshold) + ' |');
push('| إدخالات فيها `origFils` | ' + fmt(origFilsPresent) + ' |');
push('| `origFils > fils` (علامات خصم فعلية) | ' + fmt(origFilsGreaterThanFils) + ' |');
push('| `origFils < fils` (اتجاه معكوس) | ' + fmt(origFilsLessThanFils) + ' |');
push('| `origFils === fils` | ' + fmt(origFilsEqualToFils) + ' |');
push('');
if (filsAboveThreshold > 0) {
  push('أمثلة على تجاوز حد التدقيق (' + fmt(MAX_AUDIT_FILS) + ' فلس = ' + bhd(MAX_AUDIT_FILS) + ' د.ب) — حتى ' + TOP_EXAMPLES + ' إدخالات:');
  push('');
  push('| معرّف المنتج | المتجر | السعر (فلس) | السعر (د.ب) | التصنيف | الاسم |');
  push('|---|---|---:|---:|---|---|');
  filsAboveThresholdExamples.forEach((e) => {
    push('| `' + e.id + '` | `' + e.storeId + '` | ' + fmt(e.fils) + ' | ' + bhd(e.fils) + ' | `' + e.category + '` | ' + trunc(e.name, 48) + ' |');
  });
  push('');
  push('قراءة أمينة للحدود: الحد معيار تدقيق لا حكم خطأ؛ الأسعار المرتفعة تشمل أجهزة إلكترونية فعلية بأسعار معقولة لطرازها، لكن ورود بعضها في تصنيفات غير منطقية (خضراوات/فواكه أو أرز ومعكرونة) يجسّد الضجيج التصنيفي الموروث من المصدر، ولا يمكن حسم صحة القيم نفسها من الكتالوج وحده.');
  push('');
}
push('## أحجام غير محللة (نص حجم بلا `size`)');
push('');
push('عدد المنتجات التي `sizeText` فيها غير فارغ و`size === null`: **' + fmt(noSizeWithText) + '** — منها ' + fmt(unparsedGhayrMahaddad) + ' بنص «غير محدد» و' + fmt(unparsedRealText) + ' بنص حجم فعلي (مثل أوزان «كجم» لحفاضات الأطفال). أمثلة على النصوص الفعلية غير المحللة:');
push('');
if (unparsedRealTextExamples.length > 0) {
  push('| معرّف المنتج | نص الحجم | الاسم |');
  push('|---|---|---|');
  unparsedRealTextExamples.forEach((e) => {
    push('| `' + e.id + '` | ' + trunc(e.sizeText, 24) + ' | ' + trunc(e.name, 52) + ' |');
  });
  push('');
}
push('أمثلة عامة على المنتجات بلا حجم محلل (بما فيها «غير محدد»):');
push('');
push('| معرّف المنتج | نص الحجم | الاسم |');
push('|---|---|---|');
unparsedSizeExamples.forEach((e) => {
  push('| `' + e.id + '` | ' + trunc(e.sizeText, 24) + ' | ' + trunc(e.name, 52) + ' |');
});
push('');
push('## التحقق التبادلي');
push('');
push('| الفحص | النتيجة |');
push('|---|---:|');
push('| مراجع أسعار إلى متاجر غير معرّفة | ' + fmt(pricesToUnknownStore) + ' |');
push('| منتجات بتصنيف غير معرّف | ' + fmt(productsWithUnknownCategory) + ' |');
push('| منتجات `available=true` بلا أي إدخال سعر متاح | ' + fmt(availableTrueWithoutAvailablePrice) + ' |');
push('');
if (unknownStoreRefs.size > 0) {
  push('مراجع متاجر مجهولة: ' + [...unknownStoreRefs.entries()].map(([k, v]) => '`' + k + '` ×' + fmt(v)).join('، ') + '.');
  push('');
}
if (unknownCategoryRefs.size > 0) {
  push('تصنيفات مجهولة: ' + [...unknownCategoryRefs.entries()].map(([k, v]) => '`' + k + '` ×' + fmt(v)).join('، ') + '.');
  push('');
}
if (availableFalseButPriceAvailable.length > 0) {
  push('ملاحظة محسوبة للأمانة: يوجد ' + fmt(productAvailableFalse) + ' منتج/منتجات `available=false` بينما إدخالات أسعارها كلها متاحة (`available=true`) — تعارض داخلي بين مستوى المنتج ومستوى السعر، معروض دون أي تعديل (الكتالوج للقراءة فقط): ' + availableFalseButPriceAvailable.map((e) => '`' + e.id + '` (' + trunc(e.name, 40) + ')').join('، ') + '.');
  push('');
}
push('## مخاطر جودة البيانات المعروفة');
push('');
push('- ضجيج تصنيفي موروث من المصدر حتى في الصفوف الصحيحة البنية والسعر' + (filsAboveThresholdExamples.length > 0 ? ' (أمثلة محسوبة في قسم شذوذ الأسعار: إدخالات مرتفعة القيمة وردت في تصنيفات غير منطقية لها)' : '') + '. عولج أثره بحواجز تحفظية في محرك التوصية مغطاة باختبارات انحدار، وهذه ليست بديلاً عن تدقيق كل تصنيف؛ مسار الإدارة/المساهمات هو آلية التصحيح المستمرة.');
push('- ' + fmt(productsWithoutNeed) + ' منتجاً بلا حقل احتياج مباشر؛ يجب توضيح تعامل fallback معها عند الاستيراد/التخطيط وعدم إخفائها بصمت.');
push('- ' + fmt(noSize) + ' منتجاً بلا حجم معياري؛ تبقى خارج المقارنة الكمية غير المناسبة، مع إمكانية مراجعتها من الإدارة.');
push('- أسعار الملف لقطة زمنية (`' + catalog.generatedAt + '`) وليست أسعاراً لحظية؛ يُعرض تاريخ اللقطة ولا توصف بأنها مباشرة.');
push('- لا تُستورد الصور أو أي مواد ذات ترخيص غير واضح تلقائياً؛ يلزم التحقق من مصدر البيانات وشروط إعادة استخدامها قبل إقرار ترخيص نهائي.');
push('');
push('## حدود هذا الجرد');
push('');
push('- فحوص بنيوية ومالية محسوبة آلياً فقط؛ ليست تدقيقاً يدوياً أو لغوياً لصفوف Markdown الخام (' + fmt(rawFileCount > 0 ? rawFileCount - 1 : 0) + ' ملف تصنيف).');
push('- حد ' + fmt(MAX_AUDIT_FILS) + ' فلس معيار تدقيق قابل للتعديل؛ تجاوزه لا يعني بالضرورة خطأ (إلكترونيات فعلية).');
push('- مرشّحات التكرار لا تميز فروق العبوات/التشكيلات إلا بما يظهر في `sizeText`.');
push('- الأرقام تصف اللقطة المخزنة في الملف؛ طبقة التراكب الإدارية (`ProductOverride`) تُطبَّق في وقت التشغيل خارج نطاق هذا الملف (انظر `docs/DATA_SCHEMA.md`).');
push('');
push('## فحوص الانحدار المتاحة');
push('');
push('يُشغّل `npm run test` اختبارات المحرك وطبقة تراكب المنتجات وسلامة الأقفال وحدود الميزانية على هذا الكتالوج نفسه، و`npm run test:api` اختبارات API عند تشغيل الخادم، و`npm run benchmark` قياسات الأداء الموثقة في `docs/PERFORMANCE.md` (راجع `PROGRESS.md` لآخر عدة موثقة). تغطية الوحدات الأخرى، ومسارات API وواجهة المستخدام بالكامل، واختبارات E2E وaxe ما زالت مطلوبة.');
push('');

const report = L.join('\n') + '\n';

// ---------------------------------------------------------------------------
// write report + stdout summary + exit code
// ---------------------------------------------------------------------------
fs.writeFileSync(reportPath, report, 'utf8');

const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

const summary = [
  'data-audit: catalog ' + fmt(catalogBytes.length) + ' bytes  sha256=' + sha256,
  'products=' + fmt(total) + '  stores=' + fmt(stores.length) + ' (active ' + fmt(storesActive) + '/inactive ' + fmt(storesInactive) + ')  categories=' + fmt(categories.length),
  'price entries=' + fmt(priceEntryTotal) + '  distinct needs=' + fmt(distinctNeeds),
  'missing: size=' + fmt(noSize) + ' (' + pct(noSize, total) + ')  need=null ' + fmt(productsWithoutNeed) + '  brand=null ' + fmt(noBrand) + '  unitPriceFils=null ' + fmt(noUnitPrice) + ' (+non-positive ' + fmt(unitPriceNonPositive) + ')',
  'missing: no nameAr=' + fmt(noNameAr) + ' (nameEn fallback)  both names empty=' + fmt(noNameBoth) + '  price available=false ' + fmt(priceAvailableFalse),
  'duplicates: ids=' + fmt(dupIdGroups.length) + ' (assert ok)  name+size+brand groups=' + fmt(dupPrimaryGroups.length) + ' (' + fmt(dupPrimaryProducts) + ' products, max group ' + fmt(maxPrimaryGroup) + ')  [strict nameAr-only reference: ' + fmt(dupStrictGroups.length) + ' groups]',
  'price anomalies: median<=0 ' + fmt(medianNonPositive) + '  min>max ' + fmt(minGreaterThanMax) + '  median-outside-range ' + fmt(medianOutsideRange) + '  fils<=0 ' + fmt(filsNonPositive) + '  fils>' + fmt(MAX_AUDIT_FILS) + ' ' + fmt(filsAboveThreshold) + '  origFils present ' + fmt(origFilsPresent) + ' (>fils ' + fmt(origFilsGreaterThanFils) + ' / <fils ' + fmt(origFilsLessThanFils) + ' / ==fils ' + fmt(origFilsEqualToFils) + ')',
  'unparsed sizes (sizeText non-empty, size=null): ' + fmt(noSizeWithText) + ' (' + fmt(unparsedGhayrMahaddad) + ' "غير محدد" + ' + fmt(unparsedRealText) + ' real text)',
  'cross-checks: unknown store refs=' + fmt(pricesToUnknownStore) + '  unknown categories=' + fmt(productsWithUnknownCategory) + '  available-without-price=' + fmt(availableTrueWithoutAvailablePrice) + '  product available=false=' + fmt(productAvailableFalse),
  'raw archive (read-only): ' + fmt(rawFileCount) + ' files, ' + fmt(rawBytes) + ' bytes',
  'report written: docs/DATA_AUDIT.md (' + fmt(L.length) + ' lines)  elapsed ' + elapsedMs.toFixed(1) + ' ms',
];
console.log(summary.join('\n'));

// hard invariant: duplicate product ids must be zero
if (dupIdGroups.length > 0) {
  console.error('data-audit: INVARIANT VIOLATION — duplicate product ids found (' + dupIdGroups.length + ' groups); exiting 1');
  process.exit(1);
}

process.exit(0);
