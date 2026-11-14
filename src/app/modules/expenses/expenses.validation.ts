import { ExpenseCategory } from '@prisma/client';
import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid MongoDB ObjectId');
const expenseCategorySchema = z.nativeEnum(ExpenseCategory);

const createExpenseZodSchema = z.object({
    body: z.object({
        expenseName: z.string().trim().min(1).optional(),
        amount: z.number().positive('Amount must be greater than zero'),
        category: expenseCategorySchema,
        date: z.coerce.date().optional(),
    }),
});

const updateExpenseZodSchema = z.object({
    params: z.object({ expenseId: objectIdSchema }),
    body: z
        .object({
            expenseName: z.string().trim().min(1).nullable().optional(),
            amount: z.number().positive('Amount must be greater than zero').optional(),
            category: expenseCategorySchema.optional(),
            date: z.coerce.date().optional(),
        })
        .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided'),
});

const expenseIdParamsSchema = z.object({
    params: z.object({ expenseId: objectIdSchema }),
});

const expensesQuerySchema = z.object({
    query: z.object({
        category: expenseCategorySchema.optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        searchTerm: z.string().optional()

    }),
});

const ExpensesValidation = {
    createExpenseZodSchema,
    updateExpenseZodSchema,
    expenseIdParamsSchema,
    expensesQuerySchema,
};

export default ExpensesValidation;