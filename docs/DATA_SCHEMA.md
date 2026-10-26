# مخطط البيانات (DATA_SCHEMA)

توثيق الحقول كما هي في الكود الفعلي: `prisma/schema.prisma` لقاعدة SQLite، و`src/lib/engine/types.ts` (مع `src/lib/server/catalog.ts` و`src/lib/server/product-overlay.ts`) لبنية الكتالوج المفتوح. كل المبالغ **فلس بأعداد صحيحة** (1 د.ب = 1000 فلس) — لا عشري عائم في العملة.

## الفكرة المعمارية باختصار

الكتالوج الكامل (39,831 منتجاً) يعيش كملف مفتوح قابل للمراجعة: `data/curated/catalog.json` — هذا **مصدر الحقيقة**. قاعدة SQLite لا تكرر الكتالوج بل تخزن **تراكبات (Overlays)** — فروق تُطبَّق فوق الملف عند التحميل — إلى جانب حالة التطبيق والمجتمع (القرار D-003 في `docs/DECISIONS.md`). النتيجة: التعديلات اليدوية تنجو من إعادة الاستيراد، والـ ETL قابل لإعادة التشغيل (idempotent).

## أولاً: قاعدة SQLite (عبر Prisma)

### `Setting` — إعدادات التطبيق (مفتاح/قيمة)

| الحقل | النوع | المعنى |
|---|---|---|
| `key` | String (PK) | اسم الإعداد |
| `value` | String | قيمة مرمّزة JSON |
| `updatedAt` | DateTime | آخر تحديث |

تُستخدم للعملة والمنطقة وأعلام الميزات، ولإعداد خاص: **`catalogRev`** — رقم مراجعة الكتالوج الذي تزيده `bumpCatalogRev()` بعد كل تعديل إداري ليُلغى كاش التحميل ويعاد تطبيق التراكبات.

### `User` — المستخدمون

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف السجل |
| `key` | String (unique) | مفتاح مجهول ثابت للجهاز/المستخدم (يعيش في localStorage بالمتصفح) |
| `name` | String? | اسم عرض اختياري |
| `role` | String (افتراضي `viewer`) | أحد: `owner` \| `admin` \| `editor` \| `moderator` \| `contributor` \| `viewer` |
| `createdAt` / `updatedAt` | DateTime | طوابع زمنية |

التطبيق محلي أولاً ويعمل بلا حساب؛ الأدوار مخصصة لمسارات الإشراف. (عملياً حماية الإدارة الحالية بمفتاح مشترك — انظر `docs/API_SECURITY_MATRIX.md`.)

### `ProductOverride` — تراكب التعديلات فوق الكتالوج

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK) | **معرف المنتج في الكتالوج نفسه** (بصمة مستقرة) — التراكب يقابل منتجاً واحداً |
| `data` | String | JSON بالفروق: `nameAr?`, `nameEn?`, `brand?`, `sizeText?`, `size?`, `category?`, `need?`, `tags?`, `status?`, `prices?` (لكل متجر `{fils, origFils?, available?}`), `added?`, `deleted?`, `notes?` |
| `createdAt` / `updatedAt` | DateTime | طوابع زمنية |

انظر قسم «علاقة الكتالوج بالتراكبات» أدناه لطريقة التطبيق.

### `Contribution` — مساهمات المجتمع

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف المساهمة |
| `kind` | String | `price-update` \| `name-fix` \| `size-fix` \| `category-fix` \| `new-product` \| `availability` \| `barcode` \| `generic` |
| `productId` | String? | المنتج المعني إن وجد |
| `payload` | String | JSON بالحقول المرسلة + ملاحظة اختيارية |
| `submittedBy` | String? | مفتاح المستخدم المرسل |
| `votes` | Int (افتراضي 0) | صافي التصويت |
| `status` | String (افتراضي `pending`) | `pending` \| `approved` \| `rejected` \| `applied` |
| `createdAt` | DateTime | وقت الإرسال |
| `reviewedAt` / `reviewedBy` / `reviewNote` | اختيارية | بيانات المراجعة — **لا تُعرض في الطابور العام** |

الطابور العام (`GET /api/contribute`) يعرض `pending` فقط، بلا حقول المراجعة الداخلية.

### `Vote` — تصويت على مساهمة

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف الصوت |
| `contributionId` | String | المساهمة |
| `voterKey` | String | مفتاح الناخب من العميل |
| `value` | Int (افتراضي 1) | `1` أو `-1` |
| `createdAt` | DateTime | وقت التصويت |

قيد التفرد `@@unique([contributionId, voterKey])` يمنع مضاعفة صوت المفتاح الواحد (والسباق المتزامن يعالج بدل الانهيار). التصويت بلا حسابات — ثقة منخفضة بحكم التصميم.

### `SharedPlan` — الخطط المشتركة

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف السجل |
| `slug` | String (unique) | رابط عام قصير (نمط `[A-Za-z0-9_-]{5,80}`) |
| `title` | String | عنوان الخطة |
| `familyName` / `authorName` | String? | أسماء عرض اختيارية للناشر |
| `payload` | String | JSON: `{ household, budget, envelopes, context, config, planResult }` — **بعد تجريد أسماء أفراد الأسرة ومعرفاتهم** (`shared-member-N`) |
| `stats` | String | JSON: `{ cost, items, coverage, waste, mode, members }` |
| `likes` / `forks` | Int | عدادات الإعجاب والنسخ |
| `isPublic` | Boolean (افتراضي true) | الخاصة (false) تعيد 404 للزوار |
| `createdAt` | DateTime | وقت النشر |

النشر يتطلب موافقة صريحة (`consentToPublishHousehold: true`) على مستوى عقد الـ API.

### `PlanLike` — إعجاب بخطة

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف السجل |
| `planId` | String | الخطة |
| `voterKey` | String | مفتاح الناخب |
| `createdAt` | DateTime | الوقت |

قيد التفرد `@@unique([planId, voterKey])`.

### `ReportRecord` — أرشيف التقارير المولّدة

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف السجل |
| `type` | String | `full-plan` \| `shopping-list` \| `budget` \| `spending` \| `store-compare` \| `consumption` \| `product-compare` \| `calculator` \| `pantry` \| `admin-quality` |
| `name` | String | اسم التقرير |
| `familyName` / `preparerName` / `planName` | String? | الأسماء المخصصة |
| `options` | String | JSON: المقاطع المفعلة، مقاس الورق، وضع الحبر، عام/تفصيلي |
| `dataSnapshot` | String | JSON لقطة البيانات التي وُلّد منها التقرير (إثبات المصدر) |
| `planFingerprint` | String? | بصمة الخطة لتتبع تطابق النتائج |
| `createdAt` | DateTime | وقت التوليد |

### `ImportBatch` — دفعات الاستيراد (ETL)

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف الدفعة |
| `source` | String | اسم ملف المصدر |
| `format` | String | `json` \| `markdown` \| `csv` |
| `mode` | String | `dry` (تجربة بلا كتابة) \| `apply` (تطبيق فعلي) |
| `stats` | String | JSON: `{ read, inserted, updated, unchanged, skipped, errors[] }` |
| `createdAt` / `appliedAt` | DateTime | وقت التشغيل ووقت التطبيق |

### `AuditEntry` — سجل التدقيق بتراجع انتقائي

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف القيد |
| `actor` | String | مفتاح المستخدم أو `admin` \| `system` \| `import` |
| `action` | String | `create` \| `update` \| `delete` \| `import` \| `rollback` \| `moderate` \| `share` |
| `targetType` | String | `product` \| `contribution` \| `setting` \| `plan` \| `import` \| `user` |
| `targetId` | String | معرف الهدف |
| `before` / `after` | String? | JSON للحالة قبل/بعد — أساس التراجع |
| `createdAt` | DateTime | وقت القيد |
| `revertedAt` | DateTime? | لا يساوي null إلا إذا رُوجع القيد (تراجع) |

عمليات الإدارة تكتب القيد والتغيير داخل **معاملة واحدة ذرية**.

### `DataRequest` — طلبات البيانات الناقصة

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | String (PK, cuid) | معرف السجل |
| `kind` | String | نوع النقص (مثل `tobacco` \| `barcode` \| `category`) |
| `label` | String | البند الناقص |
| `count` | Int (افتراضي 1) | عدد مرات الطلب المجمّعة |
| `createdAt` / `updatedAt` | DateTime | طوابع زمنية |

قيد التفرد `@@unique([kind, label])` يجعل الطلبات المتكررة تتراكم عدّاً لا صفوفاً.

## ثانياً: بنية الكتالوج المفتوح `data/curated/catalog.json`

الملف الحالي: `version: "2026-10-25"`، `generatedAt: "2026-10-25T21:42:57.356Z"`، `currency: "BHD"`، **37 متجراً، 43 تصنيفاً، 39,831 منتجاً**.

### المستوى الأعلى (`Catalog`)

| الحقل | النوع | المعنى |
|---|---|---|
| `version` | string | نسخة اللقطة (تاريخها) |
| `generatedAt` | string (ISO) | وقت توليد الكتالوج |
| `currency` | string | العملة (`BHD`) — كل الأسعار بالفلس |
| `stores` | StoreDef[] | تعريفات المتاجر (37) |
| `categories` | CategoryDef[] | التصنيفات (43) |
| `products` | CatalogProduct[] | المنتجات (39,831) |
| `fingerprint` | string (اختياري — **زمن تشغيل**) | بصمة محتوى الكتالوج بعد تطبيق التراكبات؛ ليست مخزنة في الملف، يحسبها الخادم عند التحميل وتتغير بعد أي تعديل إداري |

### المنتج (`CatalogProduct`)

| الحقل | النوع | المعنى | مشتق؟ |
|---|---|---|---|
| `id` | string | بصمة مستقرة للمنتج — هويتها ثابتة عبر الاستيرادات (مفتاح التراكبات والمسارات) | محسوبة عند التوليد |
| `category` | string | معرف تصنيف من `categories[]` | من المصدر/التصنيف |
| `nameEn` / `nameAr` | string | الاسم كما ورد في المصدر | من المصدر |
| `nameNorm` | string | تطبيع عربي لـ«الاسم العربي + الإنجليزي + العلامة» — أساس البحث النصي (توحيد الهمزات/الأشكال) | **مشتق** |
| `brand` / `brandNorm` | string \| null | العلامة التجارية + نسختها المطبعة لمطابقة مرشح العلامات | `brand` من المصدر، `brandNorm` **مشتق** |
| `sizeText` | string \| null | نص الحجم الخام من المصدر (مثل «120 جم») | من المصدر |
| `size` | ParsedSize \| null | الحجم المحلل — انظر أدناه | **مشتق** من `sizeText` |
| `need` | string \| null | معرف الاحتياج المعياري من مصنّف القواعد (عربي/إنجليزي)، أو null | **مشتق** |
| `tags` | string[] | وسوم مستخرجة من الاسم/النكهات/الحجم (نباتي، عضوي…) | **مشتق** |
| `flavors` | string[] | نكهات/تنويعات (≤100) | من المصدر |
| `prices` | Record<storeId, StorePrice> | سعر لكل متجر: `{ fils, origFils?, url?, available? }` | من المصدر (يُدمج مع التراكب) |
| `available` | boolean | متاح إذا وُجد سعر متاح واحد على الأقل ولم يُعطَّل صراحة | **مشتق** |
| `medianFils` | number | **وسيط** الأسعار المتاحة — المرجع الأساسي للمحرك | **مشتق** |
| `minFils` / `maxFils` | number | حدود نطاق الأسعار (يشمل الوسيط) | **مشتق** |
| `unitPriceFils` | number \| null | فلس لكل وحدة أساس (للتر/الكيلو؛ `pcs` بلا سعر وحدة) = `medianFils × 1000 / baseQuantity` | **مشتق** |
| `rank` | number | ترتيب المصدر (`source_rank`) — ترتيب «الحاجة العملية» من الأرشيف؛ الأصغر أدلّ على الشيوع، يستخدم في ترتيب الملاءمة | من المصدر |
| `storesCount` | number | عدد المتاجر ذات الأسعار **المتاحة** | **مشتق** |
| `dataConfidence` | number (0..1) | ثقة البيانات الإجمالية | محسوبة عند التوليد |

`ParsedSize`: `baseQuantity` (الكمية الكلية بوحدة الأساس)، `unit` (`ml` \| `g` \| `pcs` \| `sheets` \| `rolls` \| `bags`)، `packCount` (عدد العبوات الفرعية: «6×200مل» ← 6)، `unitSize` (حجم العبوة الفرعية: 200)، `confidence` (0..1 ثقة التحليل)، `trace` (شرح بشري لكيفية التحليل — لواجهة المراجعة).

~20% من المنتجات بلا حجم قابل للتحليل (`size: null`) — تظهر في البحث ولا تدخل مقارنات الوحدات أو التخطيط الآلي (سلوك مقصود، موثق في `docs/KNOWN_LIMITATIONS.md`).

### المتجر (`StoreDef`)

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | string | معرف المتجر (مفتاح `prices`) |
| `nameAr` / `nameEn` | string | الاسم |
| `url` | string? | رابط المتجر |
| `kind` | string | `hypermarket` \| `quick-commerce` \| `market` \| `specialty` |
| `deliveryFeeFils` | number | رسوم التوصيل (فلس) |
| `freeDeliveryThresholdFils` | number \| null | حد التوصيل المجاني |
| `minOrderFils` | number | الحد الأدنى للطلب |
| `deliveryTimeText` | string | نص مدة التوصيل |
| `active` | boolean | متجر نشط |

المتاجر في هذا التطبيق **مراجع أسعار** — المحرك يعتمد الوسيط افتراضياً، لا يزكّي متجراً.

### التصنيف (`CategoryDef`)

| الحقل | النوع | المعنى |
|---|---|---|
| `id` | string | معرف التصنيف (قيمة `category` في المنتجات) |
| `nameAr` / `nameEn` | string | الاسم |
| `priority` | 1 \| 2 \| 3 \| 4 | أولوية العرض |
| `icon` | string | أيقونة SVG أحادية |

## ثالثاً: علاقة الكتالوج بالتراكبات

عند تحميل الكتالوج خادمياً (`src/lib/server/catalog.ts`):

1. يُقرأ الملف مرة واحدة ويُخزَّن في كاش عام مفاتيحه **mtime للملف + قيمة `catalogRev`** — أي تعديل إداري يستدعي `bumpCatalogRev()` فيُعاد التحميل.
2. تُطبَّق صفوف `ProductOverride` بالترتيب:
   - `deleted: true` ← يُحذف المنتج من الفهرس؛
   - تراكب على منتج موجود ← دمج shallow فوق الحقول (`{ ...existing, ...data }`)؛
   - `added: true` بلا منتج موجود ← يُنشأ منتج جديد بقيم افتراضية موثقة.
3. تُحسب `fingerprint` **بعد** التطبيق — فبصمات التقارير تتغير بعد أي تعديل، وهذا جزء من إثبات الحتمية.
4. إن تعذر الوصول للقاعدة تُقدَّم اللقطة الأساسية من الملف كما هي.

**الحقول التي يعيد حسابها `deriveProductOverride`** (عند أي تعديل إداري أو موافقة مساهمة — `src/lib/server/product-overlay.ts`): `nameNorm`، `brandNorm`، `size` (من `sizeText` عبر محلل الأحجام)، `need` (إعادة تصنيف عند تغير مدخلات التصنيف، أو احترام تعديل صريح)، `tags`، `medianFils` (يعاد من الأسعار المتاحة عند تعديل أسعار المتاجر — أسعار المتاجر حجة؛ تعديل الوسيط المستقل مدعوم للمنتجات بلا رقعة أسعار)، `minFils`/`maxFils`، `storesCount`، `unitPriceFils`، `available`. كما يدمج رقع الأسعار الجزئية لكل متجر محافظاً على `url`/`origFils`/`available` السابقة عند عدم تعديلها.

بهذا التصميم: الملف مفتوح ومراجَع، والتعديل اليدوي تراكب صغير قابل للتراجع من سجل التدقيق، وإعادة الاستيراد لا تمسح التعديلات — والحقول المشتقة تبقى متسقة لأن مسار اشتقاقها واحد.
