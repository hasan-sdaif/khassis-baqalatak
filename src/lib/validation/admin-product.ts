import { z } from 'zod'

export const AdminPriceSchema = z.object({
  fils: z.number().int().min(1).max(1_000_000_000),
  available: z.boolean().optional(),
}).strict()

const ProductEditableFields = {
  nameAr: z.string().trim().min(1).max(1_000),
  nameEn: z.string().trim().max(1_000),
  brand: z.string().trim().max(250).nullable(),
  category: z.string().trim().min(1).max(200),
  sizeText: z.string().trim().max(500).nullable(),
  need: z.string().trim().max(250).nullable(),
  medianFils: z.number().int().min(1).max(1_000_000_000),
  prices: z.record(z.string().min(1).max(100), AdminPriceSchema),
}

export const ProductPatchSchema = z.object({
  nameAr: ProductEditableFields.nameAr.optional(),
  nameEn: ProductEditableFields.nameEn.optional(),
  brand: ProductEditableFields.brand.optional(),
  category: ProductEditableFields.category.optional(),
  sizeText: ProductEditableFields.sizeText.optional(),
  need: ProductEditableFields.need.optional(),
  medianFils: ProductEditableFields.medianFils.optional(),
  prices: ProductEditableFields.prices.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'empty_patch' })

export const ProductCreateSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().max(1_000).default(''),
  nameEn: z.string().trim().max(1_000).default(''),
  brand: z.string().trim().max(250).nullable().optional().default(null),
  category: z.string().trim().min(1).max(200).default('pantry-other'),
  sizeText: z.string().trim().max(500).nullable().optional().default(null),
  need: z.string().trim().max(250).nullable().optional(),
  medianFils: z.number().int().min(1).max(1_000_000_000),
  prices: z.record(z.string().min(1).max(100), AdminPriceSchema).default({}),
}).strict().refine((value) => Boolean(value.nameAr || value.nameEn), { message: 'name_required' })

export const ProductBulkSchema = z.object({
  bulk: z.literal(true),
  items: z.array(z.object({ id: z.string().trim().min(1).max(200), patch: ProductPatchSchema }).strict()).min(1).max(100),
}).strict()
