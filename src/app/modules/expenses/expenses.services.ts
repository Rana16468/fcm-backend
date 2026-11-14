import { Prisma } from '@prisma/client';
import status from 'http-status';
import { meta, QueryBuilder, QueryParams } from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import catchError from '../../errors/catchError';
import prisma from '../../shared/prisma';
import { searchableFields } from './expenses.constant';
import { CreateExpensePayload, UpdateExpensePayload } from './expenses.interface';

const parseDate = (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(status.BAD_REQUEST, 'Invalid expense date.');
    }
    return date;
};

const createExpenseIntoDb = async (payload: CreateExpensePayload, userId: string) => {
    try {
        const { date, ...expenseData } = payload;
        const expense = await prisma.expenses.create({
            data: {
                ...expenseData,
                userId,
                ...(date !== undefined ? { date: parseDate(date) } : {}),
            },
            select: {
                id: true,
                expenseName: true,
                amount: true,
                category: true,
                date: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return expense;
    } catch (error) {
        throw catchError(error);
    }
};

const getExpensesFromDb = async (userId: string, query: QueryParams) => {
    try {
        console.log(userId, query)
        const queryBuilder = new QueryBuilder(query);
        queryBuilder.search(searchableFields);
        queryBuilder.filter(['category']);
        queryBuilder.scope({ userId });

        const builtQuery = queryBuilder.build('createdAt', [
            'createdAt',
            'date',
            'amount',
            'category',
            'expenseName',
        ]);
        const { startDate, endDate } = query;

        if (startDate !== undefined || endDate !== undefined) {
            builtQuery.where.date = {};
            if (startDate !== undefined) {
                const start = parseDate(String(startDate));
                start.setHours(0, 0, 0, 0);
                builtQuery.where.date.gte = start;
            }
            if (endDate !== undefined) {
                const end = parseDate(String(endDate));
                end.setHours(23, 59, 59, 999);
                builtQuery.where.date.lte = end;
            }
        }

        const [data, total, aggregate] = await Promise.all([
            prisma.expenses.findMany({
                where: builtQuery.where as Prisma.ExpensesWhereInput,
                orderBy: builtQuery.orderBy as Prisma.ExpensesOrderByWithRelationInput,
                skip: builtQuery.skip,
                take: builtQuery.take,
                select: {
                    id: true,
                    expenseName: true,
                    amount: true,
                    category: true,
                    date: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.expenses.count({
                where: builtQuery.where as Prisma.ExpensesWhereInput,
            }),
            prisma.expenses.aggregate({
                where: builtQuery.where as Prisma.ExpensesWhereInput,
                _sum: { amount: true },
            }),
        ]);

        return {
            meta: meta(total, builtQuery),
            totalAmount: aggregate._sum.amount ?? 0,
            data,
        };
    } catch (error) {
        throw catchError(error);
    }
};

const findExpenseByIdFromDb = async (userId: string, expenseId: string) => {
    try {
        const expense = await prisma.expenses.findFirst({
            where: { id: expenseId, userId },
            select: {
                id: true,
                expenseName: true,
                amount: true,
                category: true,
                date: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!expense) {
            throw new AppError(status.NOT_FOUND, 'Expense not found.');
        }
        return expense;
    } catch (error) {
        throw catchError(error);
    }
};

const updateExpenseIntoDb = async (
    userId: string,
    expenseId: string,
    payload: UpdateExpensePayload,
) => {
    try {
        const { date, ...expenseData } = payload;
        const result = await prisma.expenses.updateMany({
            where: { id: expenseId, userId },
            data: {
                ...expenseData,
                ...(date !== undefined ? { date: parseDate(date) } : {}),
            },
        });

        if (result.count === 0) {
            throw new AppError(status.NOT_FOUND, 'Expense not found.');
        }
        return { status: true, message: 'Expense updated successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const deleteExpenseFromDb = async (userId: string, expenseId: string) => {
    try {
        const result = await prisma.expenses.deleteMany({
            where: { id: expenseId, userId },
        });

        if (result.count === 0) {
            throw new AppError(status.NOT_FOUND, 'Expense not found.');
        }
        return { status: true, message: 'Expense deleted successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const ExpensesServices = {
    createExpenseIntoDb,
    getExpensesFromDb,
    findExpenseByIdFromDb,
    updateExpenseIntoDb,
    deleteExpenseFromDb,
};

export default ExpensesServices;
