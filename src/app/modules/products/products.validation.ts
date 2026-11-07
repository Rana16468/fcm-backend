import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid MongoDB ObjectId');

const createProductZodSchema = z.object({
  body: z.object({
    productName: z.string().trim().min(1, 'Product name is required'),
    quantity: z.number().int().positive('Quantity must be greater than zero'),
    price: z.number().nonnegative('Price cannot be negative'),
    date: z.coerce.date(),
    supplierId: objectIdSchema,
  }),
});

const updateProductZodSchema = z.object({
  params: z.object({ productId: objectIdSchema }),
  body: z.object({
    productName: z.string().trim().min(1).optional(),
    quantity: z.number().int().positive().optional(),
    price: z.number().nonnegative().optional(),
    date: z.coerce.date().optional(),
  }),
});

const productIdParamsSchema = z.object({
  params: z.object({ productId: objectIdSchema }),
});

const ProductsValidation = {
  createProductZodSchema,
  updateProductZodSchema,
  productIdParamsSchema,
};

export default ProductsValidation;