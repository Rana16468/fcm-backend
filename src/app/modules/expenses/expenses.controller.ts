import { RequestHandler } from 'express';
import status from 'http-status';
import catchAsync from '../../utils/asyncCatch';
import sendResponse from '../../utils/sendResponse';
import ExpensesServices from './expenses.services';

const createExpense: RequestHandler = catchAsync(async (req, res) => {
    const result = await ExpensesServices.createExpenseIntoDb(req.body, req.user.id);
    sendResponse(res, {
        statusCode: status.CREATED,
        success: true,
        message: 'Expense recorded successfully',
        data: result,
    });
});

const getExpenses: RequestHandler = catchAsync(async (req, res) => {
    const result = await ExpensesServices.getExpensesFromDb(req.user.id, req.query);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Expenses fetched successfully',
        data: result,
    });
});

const findExpenseById: RequestHandler = catchAsync(async (req, res) => {
    const result = await ExpensesServices.findExpenseByIdFromDb(
        req.user.id,
        req.params.expenseId as string,
    );
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Expense fetched successfully',
        data: result,
    });
});

const updateExpense: RequestHandler = catchAsync(async (req, res) => {
    const result = await ExpensesServices.updateExpenseIntoDb(
        req.user.id,
        req.params.expenseId as string,
        req.body,
    );
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Expense updated successfully',
        data: result,
    });
});

const deleteExpense: RequestHandler = catchAsync(async (req, res) => {
    const result = await ExpensesServices.deleteExpenseFromDb(
        req.user.id,
        req.params.expenseId as string,
    );
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Expense deleted successfully',
        data: result,
    });
});

const ExpensesController = {
    createExpense,
    getExpenses,
    findExpenseById,
    updateExpense,
    deleteExpense,
};

export default ExpensesController;