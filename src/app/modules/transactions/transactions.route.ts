import express from 'express';
import { Role } from '@prisma/client';
import auth from '../../middlewares/auth';
import validationRequest from '../../middlewares/validationRequest';
import TransactionsController from './transactions.controller';
import TransactionsValidation from './transactions.validation';

const router = express.Router();

router.post(
  '/recorded-transactions',
  auth(Role.ADMIN, Role.USER),
  validationRequest(TransactionsValidation.createTransactionZodSchema),
  TransactionsController.createTransaction,
);
router.get('/get-transactions', auth(Role.ADMIN, Role.USER), TransactionsController.getTransactions);
router.get(
  '/find-by-transactionId/:transactionId',
  auth(Role.ADMIN, Role.USER),
  validationRequest(TransactionsValidation.transactionIdParamsSchema),
  TransactionsController.findTransactionById,
);
router.patch(
  '/update-transaction/:transactionId',
  auth(Role.ADMIN, Role.USER),
  validationRequest(TransactionsValidation.updateTransactionZodSchema),
  TransactionsController.updateTransaction,
);
router.delete(
  '/delete-transaction/:transactionId',
  auth(Role.ADMIN, Role.USER),
  validationRequest(TransactionsValidation.transactionIdParamsSchema),
  TransactionsController.deleteTransaction,
);

router.get(
  '/invoices-report',
  auth(Role.ADMIN, Role.USER),
  TransactionsController.getFinancialReport,
);

router.get("/financial-report", auth(Role.USER, Role.USER), TransactionsController.getFinancialReportOne)

export default router;