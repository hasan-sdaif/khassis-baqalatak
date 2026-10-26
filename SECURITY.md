# سياسة الأمان (SECURITY)

## النسخ المدعومة (Supported Versions)

| النسخة | مدعومة |
|---|---|
| أحدث إصدار على الفرع `main` | نعم |
| أي نقطة/وسم/فرع آخر | لا |

نصلح الثغرات على `main` فقط؛ لا نصدر رقعاً لأفروع قديمة. إن كنت توزّع نسخة قديمة فحدّثها قبل الإبلاغ.

## الإبلاغ عن ثغرة (Reporting a Vulnerability)

- **المسار المفضل:** GitHub Security Advisory على المستودع `hasan-sdaif/khassis-baqalatak` (تبويب **Security ← Report a vulnerability**) — يبقى التقرير خاصاً بمالك المستودع والمراسلين.
- أو راسل مالك المستودع عبر حسابه على GitHub (`hasan-sdaif`).
- **لا تفتح Issue عامة** ولا تناقش تفاصيل الثغرة في الـ PRs أو التعليقات قبل معالجتها والإفصاح المشترك.
- **لا تضمّن في تقريرك** أي مفاتيح أو أسرار حقيقية (مثل `ADMIN_API_KEY` أو مفاتيح حسابات) — صف الإعداد المرتبط بلا قيمة السر نفسه، وأزِل أي سر تعرّضته عرضاً ودوّره فوراً.
- أرفق ما يمكن إعادة إنتاجه: خطوات التشغيل، الطلب/الاستجابة، والبيئة. لا نلتزم حالياً بمهلة استجابة محددة (SLA) — المشروع تطوعي ونرد قدر الإمكان.

## نطاق التطبيق الأمني الموثق (Documented Security Posture)

المرجع التفصيلي للأمان هو المصفوفة الكاملة:

- **`docs/API_SECURITY_MATRIX.md`** — تصنيف كل مسارات الـ API الـ 18: المصادقة، حدود الجسم، تحديد المعدل، حالات الفشل، البيانات الحساسة، واختبارات القبول. أي تغيير في مسارات الـ API يجب أن يحدّثها.
- **`docs/THREAT_MODEL.md`** — وثيقة نموذج التهديد **مخطط لها ولم تُنشأ بعد**؛ عند إنشائها ستكون المرجع الثاني لما هو مغطى وما هو مؤجل.

حدود معروفة وموثقة بصدق (ليست مغطاة بحلول حالياً):

1. **مفتاح إدارة مشترك**: حماية `/api/admin/*` تعتمد `ADMIN_API_KEY` واحداً بترويسة `x-admin-key` — هذا حاجز وصول بمفتاح مشترك، **وليس RBAC** متعدد المستخدمين أو الأدوار، ولا يغني عن طبقة مصادقة أمامية عند النشر العام متعدد المشرفين.
2. **حدود معدل داخل الذاكرة لكل عملية**: العدادات في `src/lib/server/rate-limit.ts` تعمل داخل العملية الواحدة؛ لا تُشارك بين نسخ متعددة، والتوسع الأفقي يحتاج مخزناً مشتركاً (مخطط، لم يُنفذ).
3. **تصويت مجتمعي بلا حسابات**: مفتاح `voterKey` قابل للتوليد من العميل، فالإجماع على المساهمات **ثقة منخفضة بحكم التصميم** — تُعرض في الواجهة كـ«تصويت مجتمعي استرشادي»، وتُراجع يدوياً قبل التطبيق.

## ما لا نعتبره ثغرة في النطاق الحالي (Out of Scope)

موثقة هنا حتى لا تُرفع كتقارير أمنية؛ تُدرَس كتحسينات معمارية لاحقاً:

- **تجاوز حدود المعدل عبر توزيع الطلبات على عناوين IP متعددة**: الحدود الحالية لكل IP (مع مسار ثقة وكيل صريح)، والإساءة المنسقة عبر مصادر متعددة خارج ما تحسبه النسخة أحادية العملية.
- **تحطيم حدود الذاكرة عبر إعادة تشغيل العملية**: العدادات في الذاكرة تُصفَّر بإعادة التشغيل؛ هذا حد معروف للنشر الأحادي الحالي.

انظر `docs/KNOWN_LIMITATIONS.md` لبقية حدود النشر والبنية.

---

# Security Policy (English)

## Supported Versions

| Version | Supported |
|---|---|
| Latest commit on `main` | Yes |
| Anything else | No |

## Reporting a Vulnerability

- **Preferred:** GitHub Security Advisory on `hasan-sdaif/khassis-baqalatak` (Security tab → "Report a vulnerability") — reports stay private.
- Or contact the repository owner (`hasan-sdaif`) directly via GitHub.
- Do **not** open public Issues or PRs for vulnerabilities before they are fixed and disclosed.
- Do **not** include real secrets or API keys in your report; if you exposed one, rotate it immediately.

## Documented Posture and Known Limits

- Full reference: `docs/API_SECURITY_MATRIX.md` (all 18 API routes). `docs/THREAT_MODEL.md` is planned and does not exist yet.
- Known, documented limits: a **shared admin key** (not RBAC), **in-memory per-process rate limits** (not shared across replicas), and **accountless community voting** (low-trust by design).

## Out of Scope for the Current Version

- Rate-limit abuse by distributing requests across multiple IPs.
- Defeating in-memory limits via process restarts.

These are documented architectural limits of the current single-process deployment, tracked in `docs/KNOWN_LIMITATIONS.md`.
