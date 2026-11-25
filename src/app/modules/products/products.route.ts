import express from 'express';
import { Role } from '@prisma/client';
import auth from '../../middlewares/auth';
import validationRequest from '../../middlewares/validationRequest';
import ProductsController from './products.controller';
import ProductsValidation from './products.validation';

const router = express.Router();

router.post(
    '/recorded-products',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ProductsValidation.createProductZodSchema),
    ProductsController.createProduct,
);
router.get('/get-products', auth(Role.ADMIN, Role.USER), ProductsController.getProducts);
router.get(
    '/find-by-productId/:productId',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ProductsValidation.productIdParamsSchema),
    ProductsController.findProductById,
);
router.patch(
    '/update-product/:productId',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ProductsValidation.updateProductZodSchema),
    ProductsController.updateProduct,
);
router.delete(
    '/delete-product/:productId',
    auth(Role.ADMIN, Role.USER),
    validationRequest(ProductsValidation.productIdParamsSchema),
    ProductsController.deleteProduct,
);

router.get("/all-product-list",
    auth(Role.ADMIN, Role.USER),
    ProductsController.getMyAllProducts

)

router.get('/wining-product', auth(Role.ADMIN, Role.USER), ProductsController.winningProduct)

export default router;