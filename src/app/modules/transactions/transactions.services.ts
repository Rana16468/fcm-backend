import { PaymentMethod, Prisma, TrxType } from '@prisma/client';
import status from 'http-status';
import { meta, QueryBuilder, QueryParams } from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import catchError from '../../errors/catchError';
import prisma from '../../shared/prisma';
import { searchableFields } from './transactions.constant';
import { ExpenseFacet, FinancialReportQuery, InventoryRow, SalesRow, SupplierRow, TimelineRow } from './transactions.interface';

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



const TZ_OFFSET = "+06:00";

const toDayStart = (d: string) =>
    ({ $date: new Date(`${new Date(d).toISOString().slice(0, 10)}T00:00:00.000${TZ_OFFSET}`).toISOString() });

const toDayEnd = (d: string) =>
    ({ $date: new Date(`${new Date(d).toISOString().slice(0, 10)}T23:59:59.999${TZ_OFFSET}`).toISOString() });

const EMPTY_SUMMARY = {
    totalInvoices: 0,
    totalSalesAmount: 0,
    totalPaidAmount: 0,
    totalRemainingAmount: 0,
    totalUnpaidAmount: 0,
    averageInvoiceAmount: 0,
    maxInvoiceAmount: 0,
    minInvoiceAmount: 0,
};

const financialReportIntoDb = async (userId: string, query: Record<string, any>) => {
    const from = query.startDate ?? query.date;
    const to = query.endDate ?? from;

    const pipeline = [
        {
            $match: {
                userId: { $oid: userId },
                isDeleted: false,
                ...(from && { date: { $gte: toDayStart(from), $lte: toDayEnd(to) } }),
            },
        },
        {
            $group: {
                _id: null,
                totalInvoices: { $sum: 1 },
                totalSalesAmount: { $sum: "$amount" },
                totalPaidAmount: {
                    $sum: {
                        $switch: {
                            branches: [
                                { case: { $eq: ["$status", "PAID"] }, then: "$amount" },
                                {
                                    case: { $eq: ["$status", "REMAINING"] },
                                    then: { $subtract: ["$amount", { $ifNull: ["$remainingBalnace", 0] }] },
                                },
                            ],
                            default: 0,
                        },
                    },
                },
                totalRemainingAmount: {
                    $sum: { $cond: [{ $eq: ["$status", "REMAINING"] }, { $ifNull: ["$remainingBalnace", 0] }, 0] },
                },
                totalUnpaidAmount: {
                    $sum: { $cond: [{ $eq: ["$status", "UNPAID"] }, "$amount", 0] },
                },
                averageInvoiceAmount: { $avg: "$amount" },
                maxInvoiceAmount: { $max: "$amount" },
                minInvoiceAmount: { $min: "$amount" },
            },
        },
        { $project: { _id: 0 } },
    ];

    const [summary] = (await prisma.invoices.aggregateRaw({ pipeline })) as unknown as Record<string, number>[];

    return {
        success: true,
        message: "Financial report fetched successfully",
        summary: summary ?? EMPTY_SUMMARY,
    };
};





const TRX_TYPES = ["PURCHASE", "PAYMENT", "RETURN"];
const PAYMENT_METHODS = ["CASH", "BKASH", "NAGAD", "BANK", "CHEQUE"];
const EXPENSE_CATEGORIES = [
    "SALARY_AND_WAGES", "FACTORY_RENT", "OFFICE_RENT", "UTILITIES", "MAINTENANCE_AND_REPAIR",
    "TRANSPORTATION", "OFFICE_SUPPLIES", "MARKETING_AND_SALES", "TAXES_AND_FEES", "MISCELLANEOUS", "Others",
];

const toDate = (d: string, endOfDay = false) => ({
    $date: new Date(
        `${new Date(d).toISOString().slice(0, 10)}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${TZ_OFFSET}`
    ).toISOString(),
});

const round = (n?: number) => Math.round((n ?? 0) * 100) / 100;
const percent = (part: number, whole: number) => (whole ? round((part / whole) * 100) : 0);

// সব key সহ { KEY: total } object (ডেটা না থাকলে ০)
const toTotals = (keys: string[], rows: Record<string, any>[]) =>
    Object.fromEntries(keys.map((k) => [k, round(rows.find((r) => r._id === k)?.total)]));

const sumValues = (obj: Record<string, number>) => round(Object.values(obj).reduce((s, v) => s + v, 0));

const groupByField = (field: string) => [
    { $group: { _id: `$${field}`, total: { $sum: "$amount" }, count: { $sum: 1 } } },
];

const financialReportOneIntoDb = async (userId: string, query: Record<string, any>) => {
    const { startDate, endDate } = query;

    const match = {
        userId: { $oid: userId },
        isDeleted: false,
        ...(startDate && {
            date: { $gte: toDate(startDate), $lte: toDate(endDate ?? startDate, true) },
        }),
    };

    const run = async (model: any, pipeline: Record<string, any>[]) =>
        (await model.aggregateRaw({ pipeline })) as unknown as Record<string, any>[];

    const [[sales], expenseRows, [trxFacet], [products], [cogsRow], totalSuppliers] = await Promise.all([
        // ১. Invoices
        run(prisma.invoices, [
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalInvoices: { $sum: 1 },
                    totalSales: { $sum: "$amount" },
                    totalPaid: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ["$status", "PAID"] }, then: "$amount" },
                                    {
                                        case: { $eq: ["$status", "REMAINING"] },
                                        then: { $subtract: ["$amount", { $ifNull: ["$remainingBalnace", 0] }] },
                                    },
                                ],
                                default: 0,
                            },
                        },
                    },
                    totalRemaining: {
                        $sum: { $cond: [{ $eq: ["$status", "REMAINING"] }, { $ifNull: ["$remainingBalnace", 0] }, 0] },
                    },
                    totalUnpaid: { $sum: { $cond: [{ $eq: ["$status", "UNPAID"] }, "$amount", 0] } },
                },
            },
        ]),

        // ২. Expenses (ক্যাটাগরি অনুযায়ী)
        run(prisma.expenses, [{ $match: match }, ...groupByField("category")]),

        // ৩. Transactions (টাইপ ও পেমেন্ট মেথড অনুযায়ী, এক কুয়েরিতে)
        run(prisma.transactions, [
            { $match: match },
            { $facet: { byType: groupByField("type"), byMethod: groupByField("paymentMethod") } },
        ]),

        // ৪. Products
        run(prisma.products, [
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalProducts: { $sum: 1 },
                    totalAmount: { $sum: "$totalAmount" },
                    totalQuantity: { $sum: "$quantity" },
                    totalSoldQuantity: { $sum: { $ifNull: ["$sellingProducts", 0] } },
                    stockValue: {
                        $sum: {
                            $multiply: [{ $subtract: ["$quantity", { $ifNull: ["$sellingProducts", 0] }] }, "$price"],
                        },
                    },
                },
            },
        ]),

        // ৫. COGS (বিক্রিত পণ্যের কেনা দাম)
        run(prisma.invoices, [
            { $match: match },
            { $lookup: { from: "invoice_items", localField: "_id", foreignField: "invoiceId", as: "item" } },
            { $unwind: "$item" },
            { $lookup: { from: "supplier_products", localField: "item.productId", foreignField: "_id", as: "product" } },
            { $unwind: "$product" },
            { $group: { _id: null, cogs: { $sum: { $multiply: ["$item.productQuantity", "$product.price"] } } } },
        ]),

        // ৬. সাপ্লায়ার সংখ্যা
        prisma.suppliers.count({ where: { userId, isDeleted: false } }),
    ]);

    // ---------- বেসিক হিসাব ----------
    const expenseByCategory = toTotals(EXPENSE_CATEGORIES, expenseRows);
    const totalExpenses = sumValues(expenseByCategory);

    const trxByType = toTotals(TRX_TYPES, trxFacet?.byType ?? []);
    const trxByMethod = toTotals(PAYMENT_METHODS, trxFacet?.byMethod ?? []);

    const totalSales = sales?.totalSales ?? 0;
    const totalPaid = sales?.totalPaid ?? 0;
    const totalReceivable = (sales?.totalRemaining ?? 0) + (sales?.totalUnpaid ?? 0);
    const purchaseAmount = products?.totalAmount ?? 0;
    const cogs = cogsRow?.cogs ?? 0;

    // ---------- লেজার (Debit / Credit) ----------
    const credit = [
        { head: "Sales Received (বিক্রির আদায়)", amount: round(totalPaid) },
        { head: "Supplier Return (সাপ্লায়ার রিটার্ন)", amount: trxByType.RETURN },
    ];
    const debit = [
        { head: "Supplier Payment (সাপ্লায়ারকে পেমেন্ট)", amount: trxByType.PAYMENT },
        ...EXPENSE_CATEGORIES.map((c) => ({ head: `Expense: ${c}`, amount: expenseByCategory[c] })),
    ];
    const totalCredit = sumValues(Object.fromEntries(credit.map((c, i) => [i, c.amount])));
    const totalDebit = sumValues(Object.fromEntries(debit.map((d, i) => [i, d.amount])));
    const closingBalance = round(totalCredit - totalDebit);

    // ---------- লাভ-ক্ষতি তুলনা ----------
    const totalCost = cogs + totalExpenses;
    const netProfit = totalSales - totalCost;

    return {

        period: { startDate: startDate ?? null, endDate: endDate ?? startDate ?? null },

        sales: {
            totalInvoices: sales?.totalInvoices ?? 0,
            totalSales: round(totalSales),
            totalPaid: round(totalPaid),
            totalRemaining: round(sales?.totalRemaining),
            totalUnpaid: round(sales?.totalUnpaid),
            totalReceivable: round(totalReceivable),
        },

        expenses: { ...expenseByCategory, totalExpenses },

        products: {
            totalProducts: products?.totalProducts ?? 0,
            totalAmount: round(purchaseAmount),
            totalQuantity: products?.totalQuantity ?? 0,
            totalSoldQuantity: products?.totalSoldQuantity ?? 0,
            remainingStockQuantity: (products?.totalQuantity ?? 0) - (products?.totalSoldQuantity ?? 0),
            stockValue: round(products?.stockValue),
        },

        transactions: {
            byType: { ...trxByType, total: sumValues(trxByType) },
            byPaymentMethod: { ...trxByMethod, total: sumValues(trxByMethod) },
        },

        supplierAccount: {
            totalSuppliers,
            totalPurchase: round(purchaseAmount),
            totalPayment: trxByType.PAYMENT,
            totalReturn: trxByType.RETURN,
            totalPayable: round(purchaseAmount - trxByType.PAYMENT - trxByType.RETURN),
        },

        ledger: {
            credit: { entries: credit, total: totalCredit },
            debit: { entries: debit, total: totalDebit },
            closingBalance,
            balanceType: closingBalance >= 0 ? "CREDIT" : "DEBIT",
        },

        profitAndLoss: {
            totalSales: round(totalSales),
            costOfGoodsSold: round(cogs),
            grossProfit: round(totalSales - cogs),
            totalExpenses,
            netProfit: round(netProfit),
        },

        comparison: {
            totalRevenue: round(totalSales),
            totalCost: round(totalCost),
            netProfit: round(netProfit),
            profitPercentOnSales: percent(netProfit, totalSales), // বিক্রির তুলনায় %
            profitPercentOnCost: percent(netProfit, totalCost), // খরচের তুলনায় %
            status: netProfit > 0 ? "PROFIT" : netProfit < 0 ? "LOSS" : "BREAK_EVEN",
            cashStatus: closingBalance > 0 ? "POSITIVE" : closingBalance < 0 ? "NEGATIVE" : "ZERO",
        },
    };
};



const TransactionsServices = {
    createTransactionIntoDb,
    getTransactionsFromDb,
    findTransactionByIdFromDb,
    updateTransactionIntoDb,
    deleteTransactionFromDb,
    financialReportIntoDb,
    financialReportOneIntoDb
};

export default TransactionsServices;