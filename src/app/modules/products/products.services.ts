import status from 'http-status';
import { meta, QueryBuilder, QueryParams } from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import catchError from '../../errors/catchError';
import prisma from '../../shared/prisma';
import { searchableFields } from './products.constant';

type CreateProductPayload = {
    productName: string;
    quantity: number;
    price: number;
    date: Date | string;
    supplierId: string;
};

type UpdateProductPayload = Partial<Pick<CreateProductPayload, 'productName' | 'quantity' | 'price' | 'date'>>;

const ensureOwnedSupplier = async (userId: string, supplierId: string) => {
    const supplier = await prisma.suppliers.findFirst({
        where: { id: supplierId, userId, isDeleted: false },
        select: { id: true },
    });

    if (!supplier) {
        throw new AppError(status.NOT_FOUND, 'Supplier not found.');
    }
};

const createProductIntoDb = async (payload: CreateProductPayload, userId: string) => {
    try {
        await ensureOwnedSupplier(userId, payload.supplierId);
        await prisma.products.create({
            data: {
                ...payload,
                date: payload.date instanceof Date ? payload.date : new Date(payload.date),
                totalAmount: payload.quantity * payload.price,
            },
        });
        return {
            status: true,
            message: "Product created successfully"
        }
    } catch (error) {
        throw catchError(error);
    }
};

const getProductsFromDb = async (userId: string, query: QueryParams) => {
    try {
        const queryBuilder = new QueryBuilder(query);
        queryBuilder.search(searchableFields);
        queryBuilder.filter(['supplierId']);

        queryBuilder.scope({
            isDeleted: false,
            supplier: { is: { userId, isDeleted: false } },
        });

        const builtQuery = queryBuilder.build('createdAt');

        const { startDate, endDate } = query;
        if (startDate || endDate) {
            builtQuery.where.date = {};
            if (startDate) {
                builtQuery.where.date.gte = new Date(startDate as string);
            }
            if (endDate) {
                builtQuery.where.date.lte = new Date(endDate as string);
            }
        }

        const [data, total, aggregationResult] = await Promise.all([
            prisma.products.findMany({
                where: builtQuery.where,
                select: {
                    id: true,
                    productName: true,
                    quantity: true,
                    price: true,
                    totalAmount: true,
                    date: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: builtQuery.orderBy,
                skip: builtQuery.skip,
                take: builtQuery.take,
            }),
            prisma.products.count({ where: builtQuery.where }),

            prisma.products.aggregate({
                where: builtQuery.where,
                _sum: {
                    totalAmount: true, // ফিল্টারিং করা ডেটার টোটাল অ্যামাউন্ট যোগ করবে
                },
            }),
        ]);


        const grandTotalAmount = aggregationResult._sum.totalAmount || 0;

        return {
            meta: meta(total, builtQuery),
            totalAmount: grandTotalAmount, // রেসপন্সে টোটাল অ্যামাউন্ট যুক্ত করে দেওয়া হলো
            data,
        };
    } catch (error) {
        throw catchError(error);
    }
};

const findProductByIdFromDb = async (userId: string, productId: string) => {
    try {
        return await prisma.products.findFirst({
            where: {
                id: productId,
                isDeleted: false,
                supplier: { is: { userId, isDeleted: false } },

            },
            select: {
                id: true,
                productName: true,
                quantity: true,
                price: true,
                totalAmount: true,
                date: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    } catch (error) {
        throw catchError(error);
    }
};

const updateProductIntoDb = async (
    userId: string,
    productId: string,
    payload: UpdateProductPayload,
) => {
    try {
        const existing = await prisma.products.findFirst({
            where: {
                id: productId,
                isDeleted: false,
                supplier: { is: { userId, isDeleted: false } },
            },
            select: { quantity: true, price: true },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, 'Product not found or already deleted.');
        }

        const quantity = typeof payload.quantity === 'number' ? payload.quantity : existing.quantity;
        const price = typeof payload.price === 'number' ? payload.price : existing.price;
        const result = await prisma.products.updateMany({
            where: {
                id: productId,
                isDeleted: false,
            },
            data: {
                ...payload,
                ...(payload.date !== undefined
                    ? { date: payload.date instanceof Date ? payload.date : new Date(payload.date) }
                    : {}),
                totalAmount: quantity * price,
            },
        });

        if (result.count === 0) {
            throw new AppError(status.NOT_FOUND, 'Product not found or already deleted.');
        }
        return { status: true, message: 'Product updated successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const deleteProductFromDb = async (userId: string, productId: string) => {
    try {


        await prisma.products.delete({
            where: { id: productId },

        });


        return { status: true, message: 'Product deleted successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const ProductsServices = {
    createProductIntoDb,
    getProductsFromDb,
    findProductByIdFromDb,
    updateProductIntoDb,
    deleteProductFromDb,
};

export default ProductsServices;