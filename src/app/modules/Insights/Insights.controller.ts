import { RequestHandler } from 'express';
import status from 'http-status';
import sendResponse from '../../utils/sendResponse';   
import catchAsync from '../../utils/asyncCatch';
import InsightsServices from './Insights.services';


const getStockRunway: RequestHandler = catchAsync(async (req, res) => {
    const result = await InsightsServices.getStockRunwayIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Successfully Find Stock Runway',
        data: result,
    });
});

const getDueRadar: RequestHandler = catchAsync(async (req, res) => {
    const result = await InsightsServices.getDueRadarIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Successfully Find Due Radar',
        data: result,
    });
});

const getCashPulse: RequestHandler = catchAsync(async (req, res) => {
    const result = await InsightsServices.getCashPulseIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Successfully Find Cash Pulse',
        data: result,
    });
});

const getAutoTarget: RequestHandler = catchAsync(async (req, res) => {
    const result = await InsightsServices.getAutoTargetIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Successfully Find Auto Target',
        data: result,
    });
});

const getOverview: RequestHandler = catchAsync(async (req, res) => {
    const result = await InsightsServices.getOverviewIntoDb(req.query, req.user.id);
    sendResponse(res, {
        statusCode: status.OK,
        success: true,
        message: 'Successfully Find Insights Overview',
        data: result,
    });
});

const InsightsController = {
    getStockRunway,
    getDueRadar,
    getCashPulse,
    getAutoTarget,
    getOverview,
};

export default InsightsController;