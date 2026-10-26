# واجهات API — عقود الطلب والاستجابة

**آخر تحديث:** 26 أكتوبر 2026 (بعد جولة التطوير 4) · الأمان والحدود: راجع `docs/API_SECURITY_MATRIX.md`.

كل الاستجابات JSON بشكل موحد؛ الأخطاء `{"error":"<code>"}` (وأحياناً `issues[]` لتحقق Zod). كل المبالغ **فلس (أعداد صحيحة)** والعملة BHD. لا توجد حالة جلسة — المصادقة الإدارية بترويسة `x-admin-key` لكل طلب.

## عام (قراءة)

### `GET /api/health`
 readiness بسيط: `{"status":"ok","db":true,"catalogFile":true,"time":"ISO"}` · 200 دائماً (أو 500 عند فشل داخلي).

### `GET /api`
 فهرس المسارات المتاحة (وصفي).

### `GET /api/catalog`
 بيانات وصفية للعميل: `{version, generatedAt, currency, productCount, categories[], stores[], groups[], needs[], brands[]}` (أفضل 400 علامة مع عدد منتجاتها).

### `GET /api/index?…`
 مؤشر الأسعار والسلال القياسية لكل متجر (سلة أسرة-4، رضيع، طالب) محسوبة من الكتالوج الحي.

### `GET /api/search?q&category&brand&store&need&minFils&maxFils&sort&limit&offset`
 بحث المنتجات. `sort ∈ relevance|price-asc|price-desc|unit-asc|popularity`، `limit≤100`. الاستجابة `{items[], total}`. أخطاء: 400 `invalid_*`، 429 عند تجاوز 120 طلب/دقيقة.

### `GET /api/product/{id}`
 منتج واحد: `{product, prices[{storeId,storeNameAr,storeNameEn,fils,origFils,url}], similar[]}` · 404 لمعرف مجهول.

### `GET /api/dump`
 الكتالوج المفتوح كاملاً كملف تنزيل JSON (بلا تراكبات داخلية) · 503 عند غياب الملف · حد 6/دقيقة.

## الخطة (حساب عام)

### `POST /api/plan`
 الجسم: `PlanBodySchema` —
```jsonc
{
  "household": { "members": [{"id","ageMonths","gender?","activity?","specials[]"}], "habits": {}, "dietary": {"halalOnly"}, "prefs": {"favoriteBrands[]","blockedBrands[]","blockedProducts[]","qualityBias{}","globalQualityBias"}, "eatingOutPerWeek", "guestsPerMonth", "hasWaterDispenser", "storage" },
  "budget": { "fils", "period", "horizonDays", "paydayWeekday?", "flexibilityPct", "reservePct" },
  "mode": "crisis|economy|balanced|comfortable|custom",
  "season": "normal|ramadan|eid|back-to-school|summer",
  "storeMode": "median|best-single|split",
  "availableStores[]", "delivery": true, "locks": [{"productId","qty?","fromEnvelopeId?"}],
  "envelopes": [{"id","name","groups[]","mode","minFils?","maxFils?","fixedFils?","quantity?","frequency?","priority","fillToMax","preferences?","audience[]"}],
  "pantry": [{"id","productId?","name","needId?","qtyBaseUnit","unit","addedAtISO"}],
  "seed": 42, "dateISO?": "YYYY-MM-DD", "advanced?": { /* ملف تفضيلات متقدمة مُوثق في ALGORITHM.md */ }
}
```
 الاستجابة: `{plan: PlanResult, engineMs}` حيث تتضمن `plan`: `items[]`، `fixedItems[]` (الأقفال والإلزاميات)، `envelopes[]`، `totals{costFils,budgetFils,optimisticFils,pessimisticFils,wastePct,coverageEssentials}`، `diagnostics{totalCostFils,targetFils,shortfallFils,cuts[],warnings[],notes[],allocation,modeOffsetPct,refinementPasses…}`، `alternatives` لكل بند، `fingerprint` (بصمة كل المدخلات)، `generatedAt` (تاريخ لقطة الكتالوج — حتمية كاملة).
 الثوابت المضمونة (مُثبتة بالاختبارات): مجموع الأسطر المرئية = `totals.costFils` = `diagnostics.totalCostFils`؛ لا تجاوز للهدف إلا مع `shortfallFils` معلن؛ الأقفال تظهر مرة واحدة بكميتها ولا تُعدَّل أبداً.
 الأخطاء: 400 `invalid_input`+issues، 400 `invalid_json/invalid_encoding`، 413 `request_too_large` (>512KB)، 429 (60/دقيقة).

## المشاركة (مجتمع)

### `GET /api/plans?sort=likes|recent&limit≤60`
 معرض الخطط العامة: `{items[{id,slug,title,familyName,authorName,likes,forks,createdAt,stats}]}`.

### `POST /api/plans`
 نشر خطة — نفس شكل الخطة أعلاه + `title` + `isAnonymous` + **`consentToPublishHousehold: true` (حرفية إلزامية — الرفض = 400)**. يُخزَّن payload مجرد الأسماء والمعرفات (`shared-member-N`) ويُحجب اسم الناشر عند `isAnonymous`. الاستجابة `{id,slug,stats}`. أخطاء: 422 `unknown_or_inactive_store`/`unknown_locked_product` (مع معرفات)، 429 (6/دقيقة).

### `GET /api/plans/{slug}`
 عرض خطة عامة مع إعادة توليدها من الكتالوج الحي (فلترة معرفات تاريخية محذوفة): `{id,slug,title,familyName,authorName,likes,forks,createdAt,stats,input,plan}` · 404 لغير الموجود/الخاص/الشكل الخاطئ · 500 `plan_data_unavailable` لبيانات تالفة.

## المساهمات

### `GET /api/contribute?status=pending` (الوحيد المسموح)
 طابور المراجعة العام بلا ملاحظات داخلية ولا هوية مرسل: `{items[{id,kind,productId,payload,votes,status,createdAt}]}` · 400 `unsupported_status`.

### `POST /api/contribute`
 `{kind: price-update|name-fix|size-fix|category-fix|new-product|availability|barcode|generic, productId?, payload{}, note?≤500}` → `{id,status:"pending"}`. الهوية الخادمية: هاش SHA-256 يوميّ الملح. حدود: 6/دقيقة (ذاكرة) + 10/ساعة (قاعدة بيانات).

### `POST /api/contribute/{id}/vote`
 `{voterKey: 8-60 حرفاً, value: 1|-1}` → `{ok,votes}`. صوت واحد لكل مفتاح (التبديل يحرّك العدد ±2). أخطاء: 404، 409 `already_reviewed`، 400، 429 (60/دقيقة).

## الإدارة (ترويسة `x-admin-key`)

### `GET /api/admin/stats`
 إحصاءات مجمعة للوحة الإدارة.
### `GET /api/admin/audit` · `POST /api/admin/audit`
 قراءة سجل التدقيق / تراجع عن إدخال (`{"id"}`) مع تسجيل before/after.
### `GET|POST /api/admin/products` · `GET|PATCH|DELETE /api/admin/product/{id}`
 CRUD المنتجات مع إعادة اشتقاق الحقول المشتقة (`deriveProductOverride`) والتحقق من الفئة/المتجر (422 عند مجهول) والحذف المنطقي والتراكبات فوق الكتالوج.
### `POST /api/admin/import`
 استيراد ETL: dry-run يعرض الإضافات/التعديلات/الشذوذات بلا كتابة؛ apply يتطلب تأكيد الدفعة ويحفظ `manual_overrides` (معاملات ذرية + سجل تدقيق).
### `POST /api/admin/moderate`
 موافقة/رفض المساهمات مع إعادة بناء الحقول المشتقة عند القبول.

## حدود الاستخدام الموحدة

| المسار | الحد لكل IP/دقيقة |
|---|---|
| POST /api/plan | 60 |
| POST /api/plans | 6 |
| GET /api/plans | 60 |
| POST /api/contribute | 6 (+10/ساعة) |
| POST /api/contribute/{id}/vote | 60 |
| GET /api/contribute | 60 |
| GET /api/search | 120 |
| GET /api/dump | 6 |
| بوابة الإدارة (فشل المفتاح) | 12 لكل 5 دقائق → 429 |

(فوق الحد: 429 مع `Retry-After` — عدّاد لكل عملية، انظر حدود التوسع في KNOWN_LIMITATIONS.)

## التحقق الآلي

`bun run test:api` (يتطلب خادماً حياً): 11 اختباراً تغطي العقود أعلاه — رفض الأجسام الفاسدة/المتجاوزة، موافقة النشر، تجريد الأسماء، خصوصية الخطة، البوابة السالبة، سلامة التصويت، وحدود المعدل.
