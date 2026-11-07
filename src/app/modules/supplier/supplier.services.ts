import { Suppliers } from "@prisma/client";
import catchError from "../../errors/catchError";
import prisma from "../../shared/prisma";
import { meta, QueryBuilder, QueryParams } from "../../builder/QueryBuilder";
import { searchableFields } from "./supplier.constant";
import status from "http-status";
import AppError from "../../errors/AppError";


const RecordedSuppliersIntoDb = async (payload: Suppliers, userId: string) => {


    try {

        const result = await prisma.suppliers.create({
            data: {
                ...payload,
                userId: userId
            }
        });

        return result && { status: true, message: "Supplier recorded successfully" };



    }
    catch (error) {
        throw catchError(error);
    }

};

const getSuppliersFromDb = async (userId: string, query: QueryParams) => {
    try {
        const queryBuilder = new QueryBuilder(query);

        queryBuilder.search(searchableFields);

        queryBuilder.filter(['isDeleted']);
        queryBuilder.scope({ userId, isDeleted: false });

        const builtQuery = queryBuilder.build('createdAt');

        const [result, total] = await Promise.all([
            prisma.suppliers.findMany({
                where: builtQuery.where,
                orderBy: builtQuery.orderBy,
                skip: builtQuery.skip,
                take: builtQuery.take,
            }),
            prisma.suppliers.count({
                where: builtQuery.where,
            }),
        ]);

        return {
            meta: meta(total, builtQuery),
            data: result,
        };

    } catch (error) {
        throw catchError(error);
    }
};


const findBySupplierIdFromDb = async (userId: string, supplierId: string) => {
    try {
        const result = await prisma.suppliers.findUnique({
            where: { id: supplierId, userId, isDeleted: false },
        });
        return result;
    } catch (error) {
        throw catchError(error);
    }
};


const updateSupplierIntoDb = async (userId: string, supplierId: string, payload: Partial<Suppliers>) => {
    try {
        await prisma.suppliers.updateMany({
            where: { id: supplierId, userId, isDeleted: false },
            data: payload,
        }).catch((error) => {
            throw new AppError(status.NOT_FOUND, "Supplier not found or already deleted.", error);
        });
        return {
            status: true,
            message: "Supplier updated successfully"
        }
    } catch (error) {
        throw catchError(error);
    }
};


const deleteSupplierFromDb = async (userId: string, supplierId: string) => {
    try {
       
        const isExistingSupplier = await prisma.suppliers.findFirst({
            where: { id: supplierId, userId, isDeleted: false },
        });

        if (!isExistingSupplier) {
            throw new AppError(status.NOT_FOUND, "Supplier not found or already deleted.");
        }

       
        await prisma.$transaction(async (tx) => {
            
            await tx.suppliers.update({
                where: { id: supplierId },
                data: { isDeleted: true },
            });

          
            await tx.products.updateMany({
                where: { supplierId: supplierId, isDeleted: false },
                data: { isDeleted: true },
            });

           
            await tx.transactions.updateMany({
                where: { supplierId: supplierId, isDeleted: false },
                data: { isDeleted: true },
            });
        });

        return { message: "Supplier and all associated records deleted successfully." };
    } catch (error) {
        // কোনো একটি স্টেপে ফেইল করলে ট্রানজেকশন অটোমেটিক রোলব্যাক হয়ে যাবে এবং এরর থ্রো করবে
        throw catchError(error);
    }
};

const SupplierServices = {
    RecordedSuppliersIntoDb,
    getSuppliersFromDb,
    findBySupplierIdFromDb,
    updateSupplierIntoDb,
    deleteSupplierFromDb
};

export default SupplierServices;