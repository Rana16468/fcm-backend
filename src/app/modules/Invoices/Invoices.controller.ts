import { RequestHandler } from "express";
import catchAsync from "../../utils/asyncCatch";
import InvoicesServices from "./Invoices.services";
import sendResponse from "../../utils/sendResponse";
import status from "http-status";


const recordedInvoices: RequestHandler = catchAsync(async (req, res) => {

    const result = await InvoicesServices.recordedInvoicesIntoDb(req.body, req.user.id);
    sendResponse(res, {
        statusCode: status.CREATED,
        success: true,
        message: 'Invoices Recorded Successfully',
        data: result,
    });
});

const findMyAllInvoice: RequestHandler = catchAsync(async (req, res) => {

    const result = await InvoicesServices.findMyAllInvoiceIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Find My Invoice Successfully',
        data: result,
    });

});

const findMySpecificInvoices: RequestHandler = catchAsync(async (req, res) => {

    const result = await InvoicesServices.findMySpecificInvoicesIntoDb(req.params.id as string);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Find My  Successfully',
        data: result,
    });
});

const updateInvoices: RequestHandler = catchAsync(async (req, res) => {

    const result = await InvoicesServices.updateInvoicesIntoDb(req.params.id as string, req.user.id, req.body);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Update  Successfully',
        data: result,
    });

});

const deleteInvoice: RequestHandler = catchAsync(async (req, res) => {


    const result = await InvoicesServices.deleteInvoiceFromDb(req.params.id as string, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Delete Invoices  Successfully',
        data: result,
    });
});

const findMyAllCustomer: RequestHandler = catchAsync(async (req, res) => {

    const result = await InvoicesServices.findMyAllCustomerIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Successfully Find By All Customer',
        data: result,
    });

})

const InvoicesController = {
    recordedInvoices,
    findMyAllInvoice,
    findMySpecificInvoices,
    updateInvoices,
    deleteInvoice,
    findMyAllCustomer
};
export default InvoicesController