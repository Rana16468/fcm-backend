import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { BusinessProfile, QrStatus, Role, Status, User } from "@prisma/client";
import AppError from "../../errors/AppError";
import prisma from "../../shared/prisma";
import { QrAuthorizePayload, QrClientMetadata, QrStatusPayload, TJwtPayload, TUser } from "./user.interface";
import httpStatus from 'http-status'
import config from "../../config";
import { jwtHelpers } from "../../helper/jwtHelpers";
import bcrypt from 'bcrypt';
import { sendFileToCloudinary } from "../../utils/Cloudinary/sendFileToCloudinary";
import deleteFileFromCloudinary from "../../utils/Cloudinary/deleteFileFromCloudinary";
import fs from 'fs';
import catchError from "../../errors/catchError";
import { cacheAside, invalidateCacheDomains } from "../../redis/cache";
import { cacheKeys, cacheTtlSeconds } from "../../redis/cacheKeys";
import QRCode from "qrcode";

const createTokenPair = (user: Pick<User, "id" | "role" | "email" | "phone">, sessionId?: string) => {
    if (!config.jwt_access_secret || !config.jwt_refresh_secret) {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "JWT secrets are not configured.");
    }

    const payload: TJwtPayload = {
        id: user.id,
        role: user.role,
        email: user.email ?? user.phone ?? "",
        phone: user.phone ?? undefined,
        ...(sessionId ? { sessionId } : {}),
    };

    return {
        accessToken: jwtHelpers.generateToken(payload, config.jwt_access_secret, config.expires_in as string),
        refreshToken: jwtHelpers.generateToken(payload, config.jwt_refresh_secret, config.refresh_expires_in as string),
    };
};

const createUserIntoDb = async (
    payload: Partial<TUser> & Pick<TUser, "email">,
    clientIpAddress: string
) => {
    if (!config.jwt_access_secret || !config.jwt_refresh_secret) {
        throw new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            "JWT Secret keys are not defined in the configuration"
        );
    }

    // Dynamic IP fetch using the passed clientIpAddress (fallback to empty if local/invalid)
    let cityData = null;
    try {
        const ipToCheck = payload.ipAddress ? payload.ipAddress : clientIpAddress || '';


        const ipApiUrl = ipToCheck ? `http://ip-api.com/json/${ipToCheck}` : `http://ip-api.com/json/`;
        const response = await fetch(ipApiUrl);
        const data = await response.json();

        cityData = data.city || null;

    } catch (error) {
        console.error("Failed to fetch IP geolocation:", error);
    }

    const { user, created } = await prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findFirst({
            where: { email: payload.email },
            select: {
                id: true,
                role: true,
                email: true,
                status: true,
                isDeleted: true,
                phone: true,
            },
        });

        if (existingUser) {
            if (existingUser.isDeleted) {
                throw new AppError(
                    httpStatus.FORBIDDEN,
                    "This account has been deleted. Please contact support."
                );
            }

            if (existingUser.status === Status.BLOCKED) {
                throw new AppError(
                    httpStatus.FORBIDDEN,
                    "Your account has been blocked. You cannot sign in."
                );
            }

            if (!existingUser.phone) {
                throw new AppError(
                    httpStatus.BAD_REQUEST,
                    "Phone number is required. Account creation is not allowed without a phone number."
                );
            }

            // If account exists, update user's current session/location info
            const updatedUser = await tx.user.update({
                where: { id: existingUser.id },
                data: {
                    os: payload.os,
                    browser: payload.browser,
                    device: payload.device,
                    ipAddress: payload.ipAddress ? payload.ipAddress : clientIpAddress,
                    city: cityData,
                    isOnline: payload.isOnline ?? true,
                },
                select: {
                    id: true,
                    role: true,
                    email: true,
                },
            });

            return { user: updatedUser, created: false };
        }

        // Registration condition: Phone and Name are mandatory for new accounts
        if (!payload.phone) {
            throw new AppError(
                httpStatus.BAD_REQUEST,
                "Phone number is required. Account creation is not allowed without a phone number."
            );
        }

        if (!payload.name) {
            throw new AppError(httpStatus.BAD_REQUEST, "Name is required to create an account.");
        }

        const newUser = await tx.user.create({
            data: {
                name: payload.name,
                phone: payload.phone,
                email: payload.email,
                photo: payload.photo,
                os: payload.os,
                browser: payload.browser,
                device: payload.device,
                ipAddress: payload.ipAddress ? payload.ipAddress : clientIpAddress,
                isOnline: payload.isOnline ?? true,
                isVerify: true,
                status: Status.ACTIVE,
                city: cityData,
                role: payload.role ?? Role.USER,
            },
            select: {
                id: true,
                role: true,
                email: true,
            },
        });

        return { user: newUser, created: true };
    });

    if (created) {
        await invalidateCacheDomains("users", "rooms", "saved-rooms");
    }

    const jwtPayload: TJwtPayload = {
        id: user.id,
        role: user.role,
        email: user.email ?? "",
    };

    const accessToken = jwtHelpers.generateToken(
        jwtPayload,
        config.jwt_access_secret,
        config.expires_in as string
    );

    const refreshToken = jwtHelpers.generateToken(
        jwtPayload,
        config.jwt_refresh_secret,
        config.refresh_expires_in as string
    );

    return { accessToken, refreshToken };
};

const createAccountIntoDb = async (payload: TUser) => {
    if (!payload.phone) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            "Phone number is required. Account creation is not allowed without a phone number."
        );
    }

    // 1. Validate mandatory identifier
    if (!payload.email) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Either email or phone is required to create an account'
        );
    }

    // 2. Check existing account state (Find by unique email or phone)
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [
                ...(payload.email ? [{ email: payload.email }] : []),
                ...(payload.phone ? [{ phone: payload.phone }] : []),
            ],
        },
        select: { id: true, status: true, isDeleted: true, email: true, phone: true },
    });

    if (existingUser?.isDeleted) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'This account has been deleted. Please contact support.'
        );
    }

    if (existingUser?.status === Status.BLOCKED) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Your account has been blocked. You cannot sign in.'
        );
    }

    // 3. Validate JWT config early
    if (!config.jwt_access_secret || !config.jwt_refresh_secret) {
        throw new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            'JWT Secret keys are not defined in the configuration'
        );
    }

    // 4. Hash password if provided
    const hashedPassword = payload.password
        ? await bcrypt.hash(payload.password, Number(config.bcrypt_salt_rounds) || 10)
        : undefined;

    // 5. Build base user payload defaults
    const userData = {
        ...payload,
        ...(hashedPassword && { password: hashedPassword }),
        role: payload.role || Role.ADMIN, // Default fallback role
        status: Status.ACTIVE,

        isVerify: true,
    };

    let user;

    await invalidateCacheDomains("users", "rooms", "saved-rooms");
    if (existingUser) {
        user = await prisma.user.update({
            where: { id: existingUser.id },
            data: userData,
        });
    } else {
        user = await prisma.user.create({
            data: userData,
        });
    }
    await invalidateCacheDomains("users", "rooms", "saved-rooms");

    // 7. Generate JWT Payload
    const jwtPayload = {
        id: user.id,
        role: user.role,
        email: user.email,
        phone: user.phone,
    };

    // 8. Issue Authentication Tokens
    const accessToken = jwtHelpers.generateToken(
        jwtPayload as TJwtPayload,
        config.jwt_access_secret as string,
        config.expires_in as string
    );

    const refreshToken = jwtHelpers.generateToken(
        jwtPayload as TJwtPayload,
        config.jwt_refresh_secret as string,
        config.refresh_expires_in as string
    );

    return {
        accessToken,
        refreshToken
    };
};

const changeProfilePictureIntoDB = async (
    userId: string,
    payload: Partial<TUser>
) => {
    try {

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                photo: true,
                isDeleted: true,
                status: true,
            },
        }) as any;

        if (!existingUser) {
            throw new AppError(httpStatus.NOT_FOUND, 'User not found.');
        }

        if (existingUser.isDeleted) {
            throw new AppError(httpStatus.FORBIDDEN, 'This account has been deleted.');
        }

        const updateData: Record<string, any> = { ...payload };

        if (payload.photo) {
            const localFilePath = payload.photo;

            try {
                const fileName = `profile-${userId}-${Date.now()}`;
                const cloudinaryResponse = await sendFileToCloudinary(fileName, localFilePath);

                if (cloudinaryResponse?.secure_url) {

                    if (existingUser.photo && existingUser.photo.includes('cloudinary.com')) {
                        await deleteFileFromCloudinary(existingUser.photo);
                    }
                    updateData.photo = cloudinaryResponse.secure_url;
                }
            } catch (uploadError) {
                if (fs.existsSync(localFilePath)) {
                    fs.unlinkSync(localFilePath);
                }
                throw new AppError(
                    httpStatus.INTERNAL_SERVER_ERROR,
                    'Failed to upload image to Cloudinary'
                );
            }
        }
        await invalidateCacheDomains("users", "rooms", "saved-rooms");
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                photo: true,
                role: true,
                status: true,
                updatedAt: true,
            },
        });
        await invalidateCacheDomains("users", "rooms", "saved-rooms");

        return updatedUser && {
            status: true,
            message: 'Profile picture updated successfully',
        };
    } catch (error) {
        throw catchError(error, 'Failed to update profile');
    }
};

const findMyProfileIntoDb = async (userId: string) => {

    try {


        const result = await cacheAside(
            "users",
            cacheKeys.users.profile(userId),
            cacheTtlSeconds.profile,
            () => prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    photo: true,
                    phone: true,
                    role: true,
                    status: true,
                    isVerify: true,
                    businessProfiles: {
                        select: {
                            businessName: true,
                            businessType: true,
                        }
                    },
                    createdAt: true
                }
            })
        );

        return result


    }

    catch (error) {
        throw catchError(error, 'Failed to update profile');
    }
}

const avaterIntoDb = async (userId: string) => {

    try {
        const result = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                photo: true,
                email: true,
                name: true,

            }
        });

        return result


    } catch (error) {
        throw catchError(error, 'Failed to update avatar');
    }
};
const qrGenerateIntoDb = async (metadata: QrClientMetadata, clientIpAddress: string) => {
    try {
        await prisma.qrSession.updateMany({
            where: { status: QrStatus.PENDING, expiresAt: { lte: new Date() } },
            data: { status: QrStatus.EXPIRED },
        });

        const sessionId = randomUUID();
        const watchToken = randomBytes(32).toString("base64url");
        const watchTokenHash = createHash("sha256").update(watchToken).digest("hex");
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

        await prisma.qrSession.create({
            data: {
                sessionId,
                status: QrStatus.PENDING,
                watchTokenHash,
                expiresAt,
                browser: metadata.browser,
                os: metadata.os,
                device: metadata.device,
                ipAddress: clientIpAddress,
            }
        });

        const qrCodeImage = await QRCode.toDataURL(sessionId);
        return { sessionId, qrCodeImage, watchToken, expiresAt };

    } catch (error) {
        throw catchError(error, 'QR Generation Error');
    }
};

const normalizePhone = (phone: string) => phone.replace(/\D/g, "");

const qrAuthorizeIntoDb = async (
    payload: QrAuthorizePayload,
    authenticatedUserId: string,
    clientIpAddress: string
) => {
    try {
        const session = await prisma.qrSession.findUnique({
            where: { sessionId: payload.sessionId },
        });

        if (!session) {
            throw new AppError(httpStatus.NOT_FOUND, "QR session not found.");
        }
        if (session.status !== QrStatus.PENDING || !session.expiresAt || session.expiresAt <= new Date()) {
            if (session.status === QrStatus.PENDING) {
                await prisma.qrSession.update({
                    where: { sessionId: session.sessionId },
                    data: { status: QrStatus.EXPIRED },
                });
            }
            throw new AppError(httpStatus.GONE, "QR session has expired or was already authorized.");
        }

        const user = await prisma.user.findFirst({
            where: {
                id: authenticatedUserId,
                status: Status.ACTIVE,
                isDeleted: false,
                isVerify: true,
            },
            select: { id: true, name: true, phone: true, role: true, email: true },
        });
        if (!user || !user.phone || normalizePhone(user.phone) !== normalizePhone(payload.phone)) {
            throw new AppError(httpStatus.FORBIDDEN, "The authenticated account does not match the submitted phone number.");
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                isOnline: true,
                ipAddress: session.ipAddress || clientIpAddress,
                os: session.os || payload.os,
                browser: session.browser || payload.browser,
                device: session.device || payload.device,
            },
        });

        const claimed = await prisma.qrSession.updateMany({
            where: {
                sessionId: session.sessionId,
                status: QrStatus.PENDING,
                expiresAt: { gt: new Date() },
            },
            data: {
                status: QrStatus.AUTHORIZED,
                userId: user.id,
            },
        });
        if (claimed.count !== 1) {
            throw new AppError(httpStatus.CONFLICT, "QR session was already used or expired.");
        }

        return { status: QrStatus.AUTHORIZED };

    } catch (error) {
        throw catchError(error, 'QR Authorization Error');
    }
};

const qrStatusIntoDb = async (payload: QrStatusPayload) => {
    try {
        const session = await prisma.qrSession.findUnique({
            where: { sessionId: payload.sessionId },
        });
        if (!session || !session.watchTokenHash) {
            throw new AppError(httpStatus.NOT_FOUND, "QR session not found.");
        }

        const presentedHash = createHash("sha256").update(payload.watchToken).digest("hex");
        const expectedHash = Buffer.from(session.watchTokenHash, "hex");
        const actualHash = Buffer.from(presentedHash, "hex");
        if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
            throw new AppError(httpStatus.UNAUTHORIZED, "Invalid QR session watcher token.");
        }

        const now = new Date();
        if (!session.expiresAt || session.expiresAt <= now) {
            if (session.status !== QrStatus.EXPIRED) {
                await prisma.qrSession.update({
                    where: { sessionId: session.sessionId },
                    data: { status: QrStatus.EXPIRED },
                });
            }
            return { status: QrStatus.EXPIRED };
        }
        if (session.status !== QrStatus.AUTHORIZED || !session.userId) {
            return { status: session.status, expiresAt: session.expiresAt };
        }

        const user = await prisma.user.findFirst({
            where: {
                id: session.userId,
                status: Status.ACTIVE,
                isDeleted: false,
                isVerify: true,
            },
            select: { id: true, name: true, phone: true, role: true, email: true },
        });
        if (!user) {
            throw new AppError(httpStatus.UNAUTHORIZED, "Authorized account is no longer available.");
        }

        return {
            status: QrStatus.AUTHORIZED,
            ...createTokenPair(user, session.sessionId),
            user,
        };
    } catch (error) {
        throw catchError(error, "QR status check failed.");
    }
};

const refreshTokenIntoDb = async (refreshToken: string) => {
    if (!config.jwt_refresh_secret) {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "JWT refresh secret is not configured.");
    }

    let decoded: ReturnType<typeof jwtHelpers.verifyToken>;
    try {
        decoded = jwtHelpers.verifyToken(refreshToken, config.jwt_refresh_secret);
    } catch {
        throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is invalid or expired.");
    }
    if (typeof decoded.id !== "string" || !decoded.id) {
        throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token payload is invalid.");
    }

    const user = await prisma.user.findFirst({
        where: {
            id: decoded.id,
            status: Status.ACTIVE,
            isDeleted: false,
            isVerify: true,
        },
        select: { id: true, name: true, phone: true, role: true, email: true },
    });
    if (!user) {
        throw new AppError(httpStatus.UNAUTHORIZED, "Account is no longer available.");
    }

    if (!config.jwt_access_secret) {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "JWT access secret is not configured.");
    }

    const payload: TJwtPayload = {
        id: user.id,
        role: user.role,
        email: user.email ?? user.phone ?? "",
        phone: user.phone ?? undefined,
    };
    return {
        accessToken: jwtHelpers.generateToken(payload, config.jwt_access_secret, config.expires_in as string),
        user,
    };
};

type UpdateBusinessProfilePayload = Pick<User, "name" | "phone"> &
    Pick<BusinessProfile, "businessName" | "businessType">;

const businessProfileIntoDb = async (
    userId: string,
    payload: UpdateBusinessProfilePayload
) => {
    try {
        const { name, phone, businessName, businessType } = payload;

        const result = await prisma.$transaction(async (tx) => {
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: { name, phone },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    updatedAt: true,
                },
            });

            await tx.businessProfile.upsert({
                where: { userId },
                create: {
                    userId,
                    businessName,
                    businessType,
                },
                update: {
                    businessName,
                    businessType,
                },
            });

            return {
                status: true,
                message: "successfully recorded"
            };
        });

        return result;
    } catch (error) {
        throw catchError(error, "Business profile update failed.");
    }
};
const UserService = {
    createUserIntoDb,
    createAccountIntoDb,
    changeProfilePictureIntoDB,
    findMyProfileIntoDb,
    avaterIntoDb,
    qrGenerateIntoDb,
    qrAuthorizeIntoDb,
    qrStatusIntoDb,
    refreshTokenIntoDb,
    businessProfileIntoDb
};

export default UserService;