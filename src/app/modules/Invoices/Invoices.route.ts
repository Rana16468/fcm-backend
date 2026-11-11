import express from 'express';
import auth from '../../middlewares/auth';
import { Role } from '@prisma/client';
import validationRequest from '../../middlewares/validationRequest';
import InvoiceValidation from './Invoices.validation';
import InvoicesController from './Invoices.controller';


const router = express.Router();

router.post("/recorded-invoices",
    auth(Role.USER, Role.ADMIN),
    validationRequest(InvoiceValidation.createInvoiceValidationSchema),
    InvoicesController.recordedInvoices

);

router.get("/find-my-invoices",
    auth(Role.USER, Role.ADMIN),
    InvoicesController.findMyAllInvoice);

router.get("/find-by-specific-invoices/:id",
    auth(Role.USER, Role.ADMIN),
    InvoicesController.findMySpecificInvoices);

router.patch("/update-invoices/:id",
    auth(Role.ADMIN, Role.USER),
    validationRequest(InvoiceValidation.updateInvoiceValidationSchema),
    InvoicesController.updateInvoices
);

router.delete("/delete-invoices/:id",
    auth(Role.ADMIN, Role.USER),
    InvoicesController.deleteInvoice
)

const InvoicesRouter = router;

export default InvoicesRouter;