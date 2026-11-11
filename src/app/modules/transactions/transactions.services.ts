import { PaymentMethod, Prisma, TrxType } from '@prisma/client';
import status from 'http-status';
import { meta, QueryBuilder, QueryParams } from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import catchError from '../../errors/catchError';
import prisma from '../../shared/prisma';
import { searchableFields } from './transactions.constant';

type CreateTransactionPayload = {
    supplierId: string;
    date?: Date | string;
    type: TrxType;
    amount: number;
    paymentMethod?: PaymentMethod;
    note?: string;
};

const ensureOwnedSupplier = async (userId: string, supplierId: string) => {
    const supplier = await prisma.suppliers.findFirst({
        where: { id: supplierId, userId, isDeleted: false },
        select: { id: true },
    });

    if (!supplier) {
        throw new AppError(status.NOT_FOUND, 'Supplier not found.');
    }
};

const createTransactionIntoDb = async (payload: CreateTransactionPayload, userId: string) => {
    try {
        const { supplierId, amount, type, ...transactionData } = payload;

        const isExistingSupplier = await prisma.suppliers.findFirst({
            where: {
                id: supplierId,
                userId,
                isDeleted: false
            },
        });

        if (!isExistingSupplier) {
            throw new AppError(status.NOT_FOUND, 'Supplier not found or unauthorized.');
        }
        if (type === TrxType.PAYMENT) {


            const totalProductsResult = await prisma.products.aggregate({
                where: {
                    supplierId: supplierId,
                    isDeleted: false,
                },
                _sum: {
                    totalAmount: true,
                },
            });
            const totalPayable = totalProductsResult._sum.totalAmount || 0;

            const totalPaidResult = await prisma.transactions.aggregate({
                where: {
                    supplierId: supplierId,
                    userId: userId,
                    type: TrxType.PAYMENT,
                    isDeleted: false,
                },
                _sum: {
                    amount: true,
                },
            });
            const totalPaid = totalPaidResult._sum.amount || 0;

            const currentDue = totalPayable - totalPaid;

            if (amount > currentDue) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Invalid transaction! Current due amount for this supplier is ${currentDue} BDT, but you are trying to pay ${amount} BDT (Overpayment is not allowed).`
                );
            }
        }

        return await prisma.transactions.create({
            data: {
                ...transactionData,
                supplierId,
                amount,
                type,
                userId,
                ...(transactionData.date !== undefined
                    ? { date: transactionData.date instanceof Date ? transactionData.date : new Date(transactionData.date) }
                    : {}),
            },
        });
    } catch (error) {
        throw catchError(error);
    }
};

const getTransactionsFromDb = async (userId: string, query: QueryParams) => {
    try {
        const queryBuilder = new QueryBuilder(query);
        queryBuilder.search(searchableFields);
        queryBuilder.filter(['supplierId', 'type']);
        queryBuilder.scope({ userId, isDeleted: false });

        // Build query without wrong sorting
        const builtQuery = queryBuilder.build();

        // Fix sorting: Always sort by createdAt (latest entry first)
        builtQuery.orderBy = {
            createdAt: 'desc'
        };

        const { startDate, endDate } = query;
        if (startDate || endDate) {
            builtQuery.where.date = {};
            if (startDate) {
                const start = new Date(startDate as string);
                start.setHours(0, 0, 0, 0); // Start of the day
                builtQuery.where.date.gte = start;
            }
            if (endDate) {
                const end = new Date(endDate as string);
                end.setHours(23, 59, 59, 999); // End of the day
                builtQuery.where.date.lte = end;
            }
        }

        const [data, total, totalAmountSum, typeWiseSum] = await Promise.all([
            prisma.transactions.findMany({
                where: builtQuery.where,
                orderBy: builtQuery.orderBy, // Now correctly ordered by latest entry/createdAt desc
                skip: builtQuery.skip,
                take: builtQuery.take,
                select: {
                    id: true,
                    supplierId: true,
                    date: true,
                    type: true,
                    amount: true,
                    paymentMethod: true,
                    note: true,
                    supplier: {
                        select: {
                            name: true,
                            phone: true,
                            companyName: true
                        }
                    },
                    createdAt: true,
                    updatedAt: true,
                }
            }),
            prisma.transactions.count({ where: builtQuery.where }),
            prisma.transactions.aggregate({
                where: builtQuery.where,
                _sum: {
                    amount: true,
                },
            }),
            prisma.transactions.groupBy({
                by: ['type'],
                where: builtQuery.where,
                _sum: {
                    amount: true,
                },
            }),
        ]);

        return {
            meta: meta(total, builtQuery),
            summary: {
                totalAmount: totalAmountSum._sum.amount || 0,
                typeWiseBreakdown: typeWiseSum
            },
            data
        };
    } catch (error) {
        throw catchError(error);
    }
};

const findTransactionByIdFromDb = async (userId: string, transactionId: string) => {
    try {
        return await prisma.transactions.findFirst({
            where: { id: transactionId, userId, isDeleted: false },
            select: {
                id: true,
                date: true,
                type: true,
                amount: true,
                paymentMethod: true,
                note: true,
                createdAt: true,
                updatedAt: true,
            }

        });
    } catch (error) {
        throw catchError(error);
    }
};

const updateTransactionIntoDb = async (
    userId: string,
    transactionId: string,
    payload: Prisma.TransactionsUncheckedUpdateManyInput,
) => {
    try {
        const supplierId = typeof payload.supplierId === 'string' ? payload.supplierId : undefined;
        if (supplierId) {
            await ensureOwnedSupplier(userId, supplierId);
        }

        const result = await prisma.transactions.updateMany({
            where: { id: transactionId, userId, isDeleted: false },
            data: {
                ...payload,
                ...(payload.date !== undefined
                    ? { date: new Date(payload.date as unknown as string) }
                    : {}),
            },
        });

        if (result.count === 0) {
            throw new AppError(status.NOT_FOUND, 'Transaction not found or already deleted.');
        }
        return { status: true, message: 'Transaction updated successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const deleteTransactionFromDb = async (userId: string, transactionId: string) => {
    try {
        await prisma.transactions.delete({
            where: { id: transactionId, userId, isDeleted: false },
        })


        return { status: true, message: 'Transaction deleted successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const TransactionsServices = {
    createTransactionIntoDb,
    getTransactionsFromDb,
    findTransactionByIdFromDb,
    updateTransactionIntoDb,
    deleteTransactionFromDb,
};

export default TransactionsServices;