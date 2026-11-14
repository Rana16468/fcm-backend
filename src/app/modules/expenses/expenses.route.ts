import express from 'express';
import { Role } from '@prisma/client';
import auth from '../../middlewares/auth';
import validationRequest from '../../middlewares/validationRequest';
import ExpensesController from './expenses.controller';
import ExpensesValidation from './expenses.validation';

const router = express.Router();

router.post(
    '/recorded-expenses',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ExpensesValidation.createExpenseZodSchema),
    ExpensesController.createExpense,
);
router.get(
    '/get-expenses',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ExpensesValidation.expensesQuerySchema),
    ExpensesController.getExpenses,
);
router.get(
    '/find-by-expenseId/:expenseId',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ExpensesValidation.expenseIdParamsSchema),
    ExpensesController.findExpenseById,
);
router.patch(
    '/update-expense/:expenseId',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ExpensesValidation.updateExpenseZodSchema),
    ExpensesController.updateExpense,
);
router.delete(
    '/delete-expense/:expenseId',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ExpensesValidation.expenseIdParamsSchema),
    ExpensesController.deleteExpense,
);

export default router;