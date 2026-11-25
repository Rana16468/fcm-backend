import { RequestHandler } from "express";

import catchAsync from "../../utils/asyncCatch";
import sendResponse from "../../utils/sendResponse";
import httpStatus from "http-status";
import config from "../../config";
import UserService from "./user.services";
import AppError from "../../errors/AppError";

const refreshCookieOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: (config.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
    path: "/api/v1/user",
    maxAge: config.refresh_cookie_max_age_ms,
};

const createUser: RequestHandler = catchAsync(async (req, res) => {

    const clientIpAddress = req.ip ?? req.socket.remoteAddress;
    if (!clientIpAddress) {
        throw new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            "Unable to determine the client IP address."
        );
    }

    const result = await UserService.createUserIntoDb(
        req.body,
        clientIpAddress.replace(/^::ffff:/, "")
    );
    const { refreshToken, ...responseData } = result;
    res.cookie("refreshToken", refreshToken, refreshCookieOptions);
    sendResponse(res, {
        success: true,
        statusCode: httpStatus.OK,
        message: "Successfully Login",
        data: responseData
    });
});

const createAccount: RequestHandler = catchAsync(async (req, res) => {
    const result = await UserService.createAccountIntoDb(req.body);
    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: "Account created successfully",
        data: result,
    });
});

const changeProfilePicture: RequestHandler = catchAsync(async (req, res) => {
    const result = await UserService.changeProfilePictureIntoDB(req.user.id, req.body);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Profile picture changed successfully",
        data: result,
    });
});

const findMyProfile: RequestHandler = catchAsync(async (req, res) => {
    const result = await UserService.findMyProfileIntoDb(req.user.id);
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Successfully fetched user profile",
        data: result,
    });
});

const avater: RequestHandler = catchAsync(async (req, res) => {
    const result = await UserService.avaterIntoDb(req.user.id);
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Successfully fetched user profile",
        data: result,
    });
});


const qrGenerate: RequestHandler = catchAsync(async (req, res) => {
    const clientIpAddress = req.ip ?? req.socket.remoteAddress ?? "";
    const result = await UserService.qrGenerateIntoDb({
        browser: req.get("x-client-browser")?.slice(0, 120),
        os: req.get("x-client-os")?.slice(0, 120),
        device: req.get("x-client-device")?.slice(0, 120),
    }, clientIpAddress.replace(/^::ffff:/, ""));
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Successfully generated QR code",
        data: result,
    });
});

const qrAuthorize: RequestHandler = catchAsync(async (req, res) => {
    const clientIpAddress = req.ip ?? req.socket.remoteAddress;
    if (!clientIpAddress) {
        throw new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            "Unable to determine the client IP address."
        );
    }

    const result = await UserService.qrAuthorizeIntoDb(
        req.body,
        req.user.id,
        clientIpAddress.replace(/^::ffff:/, "")
    );
    sendResponse(res, {
        success: true,
        statusCode: httpStatus.OK,
        message: "QR session authorized",
        data: result
    });
});

const qrStatus: RequestHandler = catchAsync(async (req, res) => {
    const result = await UserService.qrStatusIntoDb(req.body);
    if ("refreshToken" in result) {
        const { refreshToken, ...responseData } = result;
        res.cookie("refreshToken", refreshToken, refreshCookieOptions);
        sendResponse(res, {
            success: true,
            statusCode: httpStatus.OK,
            message: "QR login authorized",
            data: responseData,
        });
        return;
    }

    sendResponse(res, {
        success: true,
        statusCode: httpStatus.OK,
        message: "QR session status",
        data: result,
    });
});

const refreshToken: RequestHandler = catchAsync(async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token) {
        throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is missing.");
    }

    const result = await UserService.refreshTokenIntoDb(token);
    sendResponse(res, {
        success: true,
        statusCode: httpStatus.OK,
        message: "Session refreshed",
        data: result,
    });
});

const logout: RequestHandler = (_req, res) => {
    res.clearCookie("refreshToken", refreshCookieOptions);
    sendResponse(res, {
        success: true,
        statusCode: httpStatus.OK,
        message: "Logged out",
        data: null,
    });
};

const businessProfile: RequestHandler = catchAsync(async (req, res) => {
    const result = await UserService.businessProfileIntoDb(req.user.id, req.body);
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Suceesfully Recorded",
        data: result,
    });
});


const UserController = {
    createUser,
    createAccount,
    changeProfilePicture,
    findMyProfile,
    avater,
    qrGenerate,
    qrAuthorize,
    qrStatus,
    refreshToken,
    logout,
    businessProfile
};
export default UserController;