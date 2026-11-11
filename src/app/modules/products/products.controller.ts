import { RequestHandler } from 'express';
import status from 'http-status';
import catchAsync from '../../utils/asyncCatch';
import sendResponse from '../../utils/sendResponse';
import ProductsServices from './products.services';

const createProduct: RequestHandler = catchAsync(async (req, res) => {
    const result = await ProductsServices.createProductIntoDb(req.body, req.user.id);
    sendResponse(res, {
        statusCode: status.CREATED,
        success: true,
        message: 'Product recorded successfully',
        data: result,
    });
});

const getProducts: RequestHandler = catchAsync(async (req, res) => {
    const result = await ProductsServices.getProductsFromDb(req.user.id, req.query);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Products fetched successfully',
        data: result,
    });
});

const findProductById: RequestHandler = catchAsync(async (req, res) => {
    const result = await ProductsServices.findProductByIdFromDb(req.user.id, req.params.productId as string);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Product fetched successfully',
        data: result,
    });
});

const updateProduct: RequestHandler = catchAsync(async (req, res) => {
    const result = await ProductsServices.updateProductIntoDb(req.user.id, req.params.productId as string, req.body);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Product updated successfully',
        data: result,
    });
});

const deleteProduct: RequestHandler = catchAsync(async (req, res) => {
    const result = await ProductsServices.deleteProductFromDb(req.user.id, req.params.productId as string);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Product deleted successfully',
        data: result,
    });
});

const getMyAllProducts: RequestHandler = catchAsync(async (req, res) => {
    const result = await ProductsServices.getMyAllProductsFromDb(req.user.id, req.query);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Find My All Product Successfully',
        data: result,
    });
})

const ProductsController = {
    createProduct,
    getProducts,
    findProductById,
    updateProduct,
    deleteProduct,
    getMyAllProducts
};

export default ProductsController;