import { RequestHandler } from 'express';
import status from 'http-status';
import catchAsync from '../../utils/asyncCatch';
import sendResponse from '../../utils/sendResponse';
import TransactionsServices from './transactions.services';

const createTransaction: RequestHandler = catchAsync(async (req, res) => {
  const result = await TransactionsServices.createTransactionIntoDb(req.body, req.user.id);
  sendResponse(res, {
    statusCode: status.CREATED,
    success: true,
    message: 'Transaction recorded successfully',
    data: result,
  });
});

const getTransactions: RequestHandler = catchAsync(async (req, res) => {
  const result = await TransactionsServices.getTransactionsFromDb(req.user.id, req.query);
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Transactions fetched successfully',
    data: result,
  });
});

const findTransactionById: RequestHandler = catchAsync(async (req, res) => {
  const result = await TransactionsServices.findTransactionByIdFromDb(
    req.user.id,
    req.params.transactionId as string,
  );
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Transaction fetched successfully',
    data: result,
  });
});

const updateTransaction: RequestHandler = catchAsync(async (req, res) => {
  const result = await TransactionsServices.updateTransactionIntoDb(
    req.user.id,
    req.params.transactionId as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Transaction updated successfully',
    data: result,
  });
});

const deleteTransaction: RequestHandler = catchAsync(async (req, res) => {
  const result = await TransactionsServices.deleteTransactionFromDb(
    req.user.id,
    req.params.transactionId as string,
  );
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Transaction deleted successfully',
    data: result,
  });
});

const TransactionsController = {
  createTransaction,
  getTransactions,
  findTransactionById,
  updateTransaction,
  deleteTransaction,
};

export default TransactionsController;