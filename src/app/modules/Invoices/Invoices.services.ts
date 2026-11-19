import { Invoices } from "@prisma/client";
import catchError from "../../errors/catchError";
import prisma from "../../shared/prisma";
import AppError from "../../errors/AppError";
import status from "http-status";
import { BuiltQuery, meta, QueryBuilder } from "../../builder/QueryBuilder";

// প্রোডাক্ট আইডি এবং কোয়ান্টিটির টাইপ ডিফিনিশন
export type ProductQuantityPayload = {
    productId: string;
    productQuentity: number;
};

// ১. ইনভয়েস রেকর্ড বা ক্রিয়েট করার ফাংশন
const recordedInvoicesIntoDb = async (
    payload: Omit<Invoices, 'productListId' | 'productList'> & { productListId: ProductQuantityPayload[] },
    userId: string
) => {
    try {
        const productItems = payload.productListId || [];

        return await prisma.$transaction(async (tx) => {
            if (productItems.length > 0) {
                const productIds = productItems.map(item => item.productId);
                const products = await tx.products.findMany({
                    where: {
                        id: { in: productIds },
                        isDeleted: false
                    },
                });

                if (products.length !== productIds.length) {
                    throw new AppError(
                        status.NOT_FOUND,
                        "One or more products from the list were not found."
                    );
                }

                // স্টক ভ্যালিডেশন
                for (const item of productItems) {
                    const product = products.find(p => p.id === item.productId);
                    if (!product) continue;

                    const soldCount = product.sellingProducts || 0;
                    const availableStock = product.quantity - soldCount;

                    if (availableStock < item.productQuentity) {
                        throw new AppError(
                            status.BAD_REQUEST,
                            `Product "${product.productName}" has insufficient stock! Available: ${availableStock}`
                        );
                    }
                }

                // প্রোডাক্টের sellingProducts পরিমাণ আপডেট করা
                const updatePromises = productItems.map((item) =>
                    tx.products.update({
                        where: { id: item.productId },
                        data: {
                            sellingProducts: {
                                increment: item.productQuentity,
                            },
                        },
                    })
                );

                const [, newInvoice] = await Promise.all([
                    Promise.all(updatePromises),
                    tx.invoices.create({
                        data: {
                            amount: payload.amount,
                            quentity: payload.quentity,
                            status: payload.status,
                            userId,
                            date: new Date(payload.date),
                            customerName: payload.customerName,
                            phone: payload.phone,
                            productName: payload.productName,
                            remainingBalnace:payload.remainingBalnace,
                            // নতুন রিলেশন অনুযায়ী InvoiceItem টেবিল এ ডাটা সেভ হচ্ছে
                            invoiceItems: {
                                create: productItems.map(item => ({
                                    productId: item.productId,
                                    productQuantity: item.productQuentity,
                                })),
                            },
                        },
                        include: {
                            invoiceItems: true,
                        },
                    }),
                ]);

                return newInvoice;
            }

            // যদি কোনো productListId না থাকে
            const newInvoice = await tx.invoices.create({
                data: {
                    amount: payload.amount,
                    quentity: payload.quentity,
                    status: payload.status,
                    userId,
                    date: new Date(payload.date),
                    customerName: payload.customerName,
                    phone: payload.phone,
                    productName: payload.productName,
                },
            });

            return {
                status: true,
                message: 'Recorded Successfully'
            };
        });

    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw catchError(error);
    }
};
const findMyAllInvoiceIntoDb = async (query: Record<string, unknown>, userId: string) => {
    const queryBuilder = new QueryBuilder(query);

    queryBuilder.search(["customerName", "productName", "phone"]);
    queryBuilder.filter(["status"]);
    queryBuilder.scope({ userId });

    const startDate = query.startDate as string | undefined;
    const endDate = query.endDate as string | undefined;

    if (startDate || endDate) {
        const dateFilter: { gte?: string | Date; lte?: string | Date } = {};

        if (startDate) {
            dateFilter.gte = new Date(startDate).toISOString();
        }
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setHours(23, 59, 59, 999);
            dateFilter.lte = endDateTime.toISOString();
        }

        queryBuilder.scope({
            date: dateFilter
        });
    }

    const builtQuery: BuiltQuery = queryBuilder.build("createdAt");

    const [result, total, aggregationResult] = await Promise.all([
        prisma.invoices.findMany({
            where: builtQuery.where,
            orderBy: builtQuery.orderBy,
            skip: builtQuery.skip,
            take: builtQuery.take,
            select: {
                id: true,
                customerName: true,
                productName: true,
                amount: true,
                quentity: true,
                date: true,
                phone: true,
                status: true,
                remainingBalnace: true,
                invoiceItems: {
                    select: {
                        productId: true,
                        productQuantity: true,
                    }
                },
                createdAt: true,
                updatedAt: true
            }
        }),
        prisma.invoices.count({
            where: builtQuery.where,
        }),
        prisma.invoices.aggregate({
            where: builtQuery.where,
            _sum: {
                amount: true,
            },
            _avg: {
                amount: true,
            },
        }),
    ]);

    const totalIncome = aggregationResult._sum.amount || 0;

    return {
        meta: meta(total, builtQuery),
        stats: {
            totalIncome,
        },
        data: result,
    };
};

// ৩. নির্দিষ্ট একটি ইনভয়েস দেখার ফাংশন
const findMySpecificInvoicesIntoDb = async (id: string) => {
    try {
        const result = await prisma.invoices.findUnique({
            where: { id },
            select: {
                id: true,
                customerName: true,
                productName: true,
                amount: true,
                quentity: true,
                date: true,
                phone: true,
                status: true,
                remainingBalnace: true,
                invoiceItems: {
                    select: {
                        productId: true,
                        productQuantity: true,
                    }
                },
                createdAt: true,
                updatedAt: true
            }
        });

        return result;
    } catch (error) {
        throw catchError(error);
    }
};


const updateInvoicesIntoDb = async (
    invoiceId: string,
    userId: string,
    payload: Partial<Invoices> & { productListId?: ProductQuantityPayload[] }
) => {
    try {
        return await prisma.$transaction(async (tx) => {
            // ১. ইনভয়েস ও তার প্রিভিয়াস আইটেমগুলো একসাথে ফেচ করা
            const existingInvoice = await tx.invoices.findFirst({
                where: { id: invoiceId, userId },
                select: {
                    id: true, amount: true, quentity: true, status: true,
                    date: true, customerName: true, phone: true, productName: true,
                    invoiceItems: { select: { productId: true, productQuantity: true } }
                }
            });

            if (!existingInvoice) {
                throw new AppError(status.NOT_FOUND, "Invoice not found or unauthorized!", "");
            }

            const newItems = payload.productListId || [];
            const oldItems = existingInvoice.invoiceItems;

            if (payload.productListId) {
                // ২. সব ইউনিক প্রোডাক্ট আইডি কালেক্ট করা
                const productIds = Array.from(new Set([
                    ...oldItems.map(i => i.productId),
                    ...newItems.map(i => i.productId)
                ]));

                const products = await tx.products.findMany({
                    where: { id: { in: productIds }, isDeleted: false }
                });

                // ৩. স্টক ভ্যালিডেশন (এক সাথে স্টক রিলিজ ও নতুন স্টক রিকোয়ারমেন্ট চেক)
                for (const newItem of newItems) {
                    const product = products.find(p => p.id === newItem.productId);
                    if (!product) {
                        throw new AppError(status.NOT_FOUND, `Product with ID ${newItem.productId} not found.`, "");
                    }

                    const oldQty = oldItems.find(o => o.productId === newItem.productId)?.productQuantity || 0;
                    const netChange = newItem.productQuentity - oldQty; // পজেটিভ হলে স্টক আরও কমবে

                    if (netChange > 0) {
                        const availableStock = product.quantity - (product.sellingProducts || 0);
                        if (availableStock < netChange) {
                            throw new AppError(
                                status.BAD_REQUEST,
                                `Product "${product.productName}" has insufficient stock! Available: ${availableStock}`,
                                ""
                            );
                        }
                    }
                }

                // ৪. প্রোডাক্টের `sellingProducts` আপডেট করার প্রমিজ অ্যারে তৈরি ও একবারে রান করা
                const stockUpdatePromises = productIds.map(async (productId) => {
                    const oldQty = oldItems.find(o => o.productId === productId)?.productQuantity || 0;
                    const newQty = newItems.find(n => n.productId === productId)?.productQuentity || 0;
                    const diff = newQty - oldQty;

                    if (diff !== 0) {
                        return tx.products.update({
                            where: { id: productId },
                            data: {
                                sellingProducts: {
                                    ...(diff > 0 ? { increment: diff } : { decrement: Math.abs(diff) })
                                }
                            }
                        });
                    }
                });

                // ৫. পুরোনো ইনভয়েস আইটেম ডিলিট এবং স্টক আপডেট প্যারালালি এক্সিকিউট করা (ফাস্ট পারফরম্যান্সের জন্য)
                await Promise.all([
                    tx.invoiceItem.deleteMany({ where: { invoiceId } }),
                    Promise.all(stockUpdatePromises.filter(Boolean))
                ]);
            }

            // ৬. মূল ইনভয়েস আপডেট ও নতুন আইটেম ক্রিয়েট করা
            await tx.invoices.update({
                where: { id: invoiceId },
                data: {
                    amount: payload.amount ?? existingInvoice.amount,
                    quentity: payload.quentity ?? existingInvoice.quentity,
                    status: payload.status ?? existingInvoice.status,
                    date: payload.date ? new Date(payload.date) : existingInvoice.date,
                    customerName: payload.customerName ?? existingInvoice.customerName,
                    phone: payload.phone ?? existingInvoice.phone,
                    productName: payload.productName ?? existingInvoice.productName,
                    remainingBalnace:payload.remainingBalnace,
                    ...(payload.productListId && {
                        invoiceItems: {
                            create: newItems.map(item => ({
                                productId: item.productId,
                                productQuantity: item.productQuentity,
                            })),
                        },
                    }),
                },
                include: { invoiceItems: true },
            });
            return {
                status: true,
                message: "Successfully Update"
            }
        });

    } catch (error) {
        if (error instanceof AppError) throw error;
        throw catchError(error);
    }
};


const deleteInvoiceFromDb = async (id: string, userId: string) => {
    try {
        return await prisma.$transaction(async (tx) => {
            const existingInvoice = await tx.invoices.findFirst({
                where: { id, userId },
                include: { invoiceItems: true },
            });

            if (!existingInvoice) {
                throw new AppError(status.NOT_FOUND, "Invoice not found or unauthorized!");
            }

            const stockRevertPromises = existingInvoice.invoiceItems.map((item) =>
                tx.products.update({
                    where: { id: item.productId },
                    data: {
                        sellingProducts: { decrement: item.productQuantity },
                    },
                })
            );

            await Promise.all(stockRevertPromises);

            return await tx.invoices.delete({
                where: { id },
                include: { invoiceItems: true },
            });
        });

    } catch (error) {
        if (error instanceof AppError) throw error;
        throw catchError(error);
    }
};

const findMyAllCustomerIntoDb = async (query: Record<string, unknown>, userId: string) => {
    const queryBuilder = new QueryBuilder(query);

    queryBuilder.search(["customerName", "productName", "phone"]);
    queryBuilder.filter(["status"]);
    queryBuilder.scope({ userId });

    const startDate = query.startDate as string | undefined;
    const endDate = query.endDate as string | undefined;

    if (startDate || endDate) {
        const dateFilter: { gte?: string | Date; lte?: string | Date } = {};

        if (startDate) {
            dateFilter.gte = new Date(startDate).toISOString();
        }
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setHours(23, 59, 59, 999);
            dateFilter.lte = endDateTime.toISOString();
        }

        queryBuilder.scope({
            date: dateFilter
        });
    }

    const builtQuery: BuiltQuery = queryBuilder.build("createdAt");

    const [result, total, aggregationResult] = await Promise.all([
        prisma.invoices.findMany({
            where: builtQuery.where,
            orderBy: builtQuery.orderBy,
            skip: builtQuery.skip,
            take: builtQuery.take,
            select: {
                id: true,
                customerName: true,
                productName: true,
                amount: true,
                quentity: true,
                date: true,
                phone: true,
                status: true,
                remainingBalnace:true,

                invoiceItems: {
                    select: {

                        productQuantity: true,
                    }
                },
                createdAt: true,
                updatedAt: true
            }
        }),
        prisma.invoices.count({
            where: builtQuery.where,
        }),
        prisma.invoices.aggregate({
            where: builtQuery.where,
            _sum: {
                amount: true,
            },
            _avg: {
                amount: true,
            },
        }),
    ]);

    const totalIncome = aggregationResult._sum.amount || 0;

    return {
        meta: meta(total, builtQuery),
        stats: {
            totalIncome,
        },
        data: result,
    };
};

const InvoicesServices = {
    recordedInvoicesIntoDb,
    findMyAllInvoiceIntoDb,
    findMySpecificInvoicesIntoDb,
    updateInvoicesIntoDb,
    deleteInvoiceFromDb,
    findMyAllCustomerIntoDb
};

export default InvoicesServices;