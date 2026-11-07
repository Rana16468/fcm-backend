import { PaymentMethod, TrxType } from '@prisma/client';
import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid MongoDB ObjectId');

const createTransactionZodSchema = z.object({
  body: z.object({
    supplierId: objectIdSchema,
    date: z.coerce.date().optional(),
    type: z.enum(TrxType),
    amount: z.number().positive('Amount must be greater than zero'),
    paymentMethod: z.enum(PaymentMethod).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
});

const updateTransactionZodSchema = z.object({
  params: z.object({ transactionId: objectIdSchema }),
  body: z.object({
    supplierId: objectIdSchema.optional(),
    date: z.coerce.date().optional(),
    type: z.enum(TrxType).optional(),
    amount: z.number().positive().optional(),
    paymentMethod: z.enum(PaymentMethod).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  }),
});

const transactionIdParamsSchema = z.object({
  params: z.object({ transactionId: objectIdSchema }),
});

const TransactionsValidation = {
  createTransactionZodSchema,
  updateTransactionZodSchema,
  transactionIdParamsSchema,
};

export default TransactionsValidation;