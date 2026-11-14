import { ExpenseCategory } from '@prisma/client';

export interface CreateExpensePayload {
    expenseName?: string;
    amount: number;
    category: ExpenseCategory;
    date?: Date | string;
}

export type UpdateExpensePayload = Partial<CreateExpensePayload>;