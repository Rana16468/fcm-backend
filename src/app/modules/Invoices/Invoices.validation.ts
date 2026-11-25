import { InvoicesStatus } from '@prisma/client';
import { z } from 'zod';

const productQuentity = z.object({
    productId: z.string({ error: "productId is required" }),
    productQuentity: z.number({ error: "productQuentity is required" }).int("productQuentity must be an integer"),
    amount: z.number().optional()
});

const createInvoiceValidationSchema = z.object({
    body: z.object({
        customerName: z.string().optional().default("xxxxx"),
        productListId: z.array(productQuentity).default([]).optional(),
        productName: z.string({
            error: "Product name is required",
        }).min(1, "Product name cannot be empty").optional(),
        phone: z.string().optional(),
        status: z.nativeEnum(InvoicesStatus).default(InvoicesStatus.PAID),
        quentity: z.number({
            error: "Quantity is required",
        }).int("Quantity must be an integer").positive("Quantity must be greater than 0"),
        date: z.string({ error: "date is required" }),
        amount: z.number({
            error: "Amount is required",
        }).positive("Amount must be greater than 0").default(0).optional(),
        remainingBalnace: z.number().default(0).optional()
    })
});

const updateInvoiceValidationSchema = z.object({
    body: createInvoiceValidationSchema.shape.body.partial()
});

const InvoiceValidation = {
    createInvoiceValidationSchema,
    updateInvoiceValidationSchema
};

export default InvoiceValidation;