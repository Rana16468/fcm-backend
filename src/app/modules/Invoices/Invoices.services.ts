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

// ২. সকল ইনভয়েস ফিল্টার, সার্চ, ডেট রেঞ্জ এবং ইনকাম সামারিসহ ফেচ করার ফাংশন
const findMyAllInvoiceIntoDb = async (query: Record<string, unknown>, userId: string) => {
    const queryBuilder = new QueryBuilder(query);

    queryBuilder.search(["customerName", "productName", "id"]);
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
                invoiceItems: { // নতুন রিলেশন থেকে প্রোডাক্ট ও কোয়ান্টিটি সিলেক্ট করা হলো
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

// ৪. ইনভয়েস আপডেট করার ফাংশন (স্টক রোলব্যাক ও নতুন আইটেম সিঙ্ক সহ)
const updateInvoicesIntoDb = async (
    invoiceId: string,
    userId: string,
    payload: Partial<Invoices> & { productListId?: ProductQuantityPayload[] },

) => {
    try {
        return await prisma.$transaction(async (tx) => {
            // ১. ইনভয়েসটি ডাটাবেজে আছে কি না এবং ইউজারের কি না তা চেক করা
            const existingInvoice = await tx.invoices.findFirst({
                where: {
                    id: invoiceId,
                    userId: userId, // ওনারশিপ নিশ্চিত করার জন্য
                },
                select: {
                    id: true,
                    amount: true,
                    quentity: true,
                    status: true,
                    date: true,
                    customerName: true,
                    phone: true,
                    productName: true,
                    invoiceItems: {
                        select: {
                            id: true,
                            productId: true,
                            productQuantity: true,
                        }
                    }
                }
            });

            if (!existingInvoice) {
                throw new AppError(status.NOT_FOUND, "Invoice not found or unauthorized!", "");
            }

            const newProductItems: ProductQuantityPayload[] = payload.productListId || [];
            const oldProductItems = existingInvoice.invoiceItems;

            // ২. স্টক অ্যাডজাস্টমেন্ট ও লজিক হ্যান্ডেলিং
            if (payload.productListId) {

                // সমস্ত ইউনিক প্রোডাক্ট আইডি সংগ্রহ করা (পুরোনো ও নতুন মিলিয়ে)
                const allProductIds = Array.from(new Set([
                    ...oldProductItems.map(item => item.productId),
                    ...newProductItems.map(item => item.productId)
                ]));

                // প্রোডাক্টগুলোর বর্তমান ডাটা নিয়ে আসা
                const products = await tx.products.findMany({
                    where: {
                        id: { in: allProductIds },
                        isDeleted: false,
                    },
                });

                // প্রতিটি প্রোডাক্টের জন্য স্টকে পর্যাপ্ত পরিমাণ আছে কি না তা যাচাই করার লজিক
                for (const newItem of newProductItems) {
                    const product = products.find(p => p.id === newItem.productId);
                    if (!product) {
                        throw new AppError(status.NOT_FOUND, `Product with ID ${newItem.productId} not found.`, "");
                    }

                    const oldItem = oldProductItems.find(o => o.productId === newItem.productId);
                    const oldQty = oldItem ? oldItem.productQuantity : 0;

                    // অতিরিক্ত কত পিস লাগবে তা হিসাব করা
                    const qtyDifference = newItem.productQuentity - oldQty;

                    if (qtyDifference > 0) {
                        // যদি কোয়ান্টিটি বাড়ে, তবে স্টক চেক করতে হবে
                        const soldCount = product.sellingProducts || 0;
                        const availableStock = product.quantity - soldCount;

                        if (availableStock < qtyDifference) {
                            throw new AppError(
                                status.BAD_REQUEST,
                                `Product "${product.productName}" has insufficient stock! Available: ${availableStock}`,
                                ""
                            );
                        }
                    }
                }

                // ৩. প্রোডাক্ট টেবিলের `sellingProducts` আপডেট করা
                for (const productId of allProductIds) {
                    const oldItem = oldProductItems.find(o => o.productId === productId);
                    const newItem = newProductItems.find(n => n.productId === productId);

                    const oldQty = oldItem ? oldItem.productQuantity : 0;
                    const newQty = newItem ? newItem.productQuentity : 0;

                    const diff = newQty - oldQty; // পজেটিভ হলে স্টক আরও কমবে, নেগেটিভ হলে স্টক ব্যাক আসবে

                    if (diff !== 0) {
                        await tx.products.update({
                            where: { id: productId },
                            data: {
                                sellingProducts: {
                                    // যদি diff পজেটিভ হয় increment হবে, নেগেটিভ হলে decrement হবে
                                    ...(diff > 0 ? { increment: diff } : { decrement: Math.abs(diff) })
                                }
                            }
                        });
                    }
                }

                // ৪. পুরোনো InvoiceItem গুলো ডিলিট করে নতুনগুলো ক্রিয়েট করা
                await tx.invoiceItem.deleteMany({
                    where: { invoiceId },
                });
            }

            // ৫. মূল ইনভয়েস টেবিল আপডেট করা
            const updatedInvoice = await tx.invoices.update({
                where: { id: invoiceId },
                data: {
                    amount: payload.amount ?? existingInvoice.amount,
                    quentity: payload.quentity ?? existingInvoice.quentity,
                    status: payload.status ?? existingInvoice.status,
                    date: payload.date ? new Date(payload.date) : existingInvoice.date,
                    customerName: payload.customerName ?? existingInvoice.customerName,
                    phone: payload.phone ?? existingInvoice.phone,
                    productName: payload.productName ?? existingInvoice.productName,
                    ...(payload.productListId && {
                        invoiceItems: {
                            create: newProductItems.map(item => ({
                                productId: item.productId,
                                productQuantity: item.productQuentity,
                            })),
                        },
                    }),
                },
                include: {
                    invoiceItems: true,
                },
            });

            return updatedInvoice;
        });

    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw catchError(error);
    }
};

// ৫. হার্ড ডিলিট করার ফাংশন (স্টক রোলব্যাক সহ)
const deleteInvoiceFromDb = async (id: string, userId: string) => {
    try {
        return await prisma.$transaction(async (tx) => {
            const existingInvoice = await tx.invoices.findFirst({
                where: {
                    id,
                    userId,
                },
                include: {
                    invoiceItems: true,
                },
            });

            if (!existingInvoice) {
                throw new AppError(
                    status.NOT_FOUND,
                    "Invoice not found or you do not have permission to delete this invoice!"
                );
            }
            if (existingInvoice.invoiceItems.length > 0) {
                const revertPromises = existingInvoice.invoiceItems.map((item) =>
                    tx.products.update({
                        where: { id: item.productId },
                        data: {
                            sellingProducts: {
                                decrement: item.productQuantity,
                            },
                        },
                    })
                );
                await Promise.all(revertPromises);
            }


            const deletedInvoice = await tx.invoices.delete({
                where: {
                    id,
                },
                include: {
                    invoiceItems: true,
                },
            });

            return deletedInvoice;
        });

    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw catchError(error);
    }
};

const InvoicesServices = {
    recordedInvoicesIntoDb,
    findMyAllInvoiceIntoDb,
    findMySpecificInvoicesIntoDb,
    updateInvoicesIntoDb,
    deleteInvoiceFromDb,
};

export default InvoicesServices;