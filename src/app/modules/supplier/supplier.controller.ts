import { RequestHandler } from "express";
import SupplierServices from "./supplier.services";
import catchAsync from "../../utils/asyncCatch";
import sendResponse from "../../utils/sendResponse";
import status from "http-status";
import { send } from "node:process";


const RecordedSuppliers: RequestHandler = catchAsync(async (req, res) => {
    const result = await SupplierServices.RecordedSuppliersIntoDb(req.body, req.user.id);

    sendResponse(res, {
        statusCode: status.CREATED,
        success: true,
        message: "Supplier recorded successfully",
        data: result,
    });
});

const getSuppliers: RequestHandler = catchAsync(async (req, res) => {
    const result = await SupplierServices.getSuppliersFromDb(req.user.id, req.query);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: "Suppliers fetched successfully",
        data: result,
    });
});


const findBySupplierId: RequestHandler = catchAsync(async (req, res) => {

    const result = await SupplierServices.findBySupplierIdFromDb(req.user.id, req.params.supplierId as string);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: "Supplier fetched successfully",
        data: result,
    });
});


const updateSupplier: RequestHandler = catchAsync(async (req, res) => {
    const result = await SupplierServices.updateSupplierIntoDb(req.user.id, req.params.supplierId as string, req.body);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: "Supplier updated successfully",
        data: result,
    });
});


const deleteSupplier: RequestHandler = catchAsync(async (req, res) => {
    const result = await SupplierServices.deleteSupplierFromDb(req.user.id, req.params.supplierId as string);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: "Supplier deleted successfully",
        data: result,
    });
});


const SupplierController = {
    RecordedSuppliers,
    getSuppliers,
    findBySupplierId,
    updateSupplier,
    deleteSupplier
};

export default SupplierController;