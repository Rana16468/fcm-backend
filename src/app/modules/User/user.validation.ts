import { BusinesType, Role, Status } from '@prisma/client';
import { z } from 'zod';

const createUserZodSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),

    phone: z
      .string({
        error:
          'Phone number is required. Account creation is not allowed without a phone number.',
      })
      .min(10, 'Phone number must be at least 10 digits')
      .optional()
      .or(z.literal('')),

    password: z
      .string()
      .min(6, 'Password must be at least 6 characters')
      .optional(),

    email: z.string().email('Invalid email address'),

    status: z.nativeEnum(Status).default(Status.ACTIVE),
    role: z.nativeEnum(Role).default(Role.USER),

    os: z.string().optional(),
    browser: z.string().optional(),
    device: z.string().optional(),
    isOnline: z.boolean().default(true),
    isVerify: z.boolean().default(false),
    photo: z.string().optional(),
    isDeleted: z.boolean().default(false),
  }),
});

const createAdminAccountZodSchema = z.object({
  body: z.object({
    name: z
      .string({
        error: 'Name is required',
      })
      .min(1, 'Name cannot be empty'),

    phone: z
      .string({
        error:
          'Phone number is required. Account creation is not allowed without a phone number.',
      })
      .min(10, 'Phone number must be at least 10 digits'),

    password: z
      .string({ error: "Password is required" })
      .min(6, 'Password must be at least 6 characters'),


    email: z
      .string({ error: "Email is required" })
      .email('Invalid email address')
      .or(z.literal('')),

    status: z.nativeEnum(Status).default(Status.ACTIVE),
    role: z.nativeEnum(Role).default(Role.ADMIN),

    os: z.string().optional(),
    browser: z.string().optional(),
    device: z.string().optional(),
    ipAddress: z.string().optional(),

    isOnline: z.boolean().default(true),
    isVerify: z.boolean().default(true),
    photo: z.string().optional(),
    isDeleted: z.boolean().default(false),
  }),
});

 const BUSINESS_TYPES = [
  "RetailShop",
  "GroceryShop",
  "Restaurent",
  "ECommerce",
  "Freelancer",
  "ServiceBusiness",
  "Startup",
  "Maunfacturing",
  "CorporateBusiness",
  "Others",
] as const;

 const businessTypeEnum = z.enum(BUSINESS_TYPES);

// Update User Validation Schema
const updateUserZodSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(10).optional(),
    os: z.string().optional(),
    browser: z.string().optional(),
    device: z.string().optional(),
    photo: z.string().optional(),
    businessType: businessTypeEnum.nullable().optional(),
    businessName: z.string().optional()


  }),
});

const qrAuthorizeValidationSchema = z.object({
  body: z.object({
    sessionId: z.string({
      error: "Session ID is required",
    }),
    phone: z.string({
      error: "Phone number is required",
    }).min(10, "Phone number must be valid"),
    name: z.string().optional(),
    os: z.string().optional(),
    browser: z.string().optional(),
    device: z.string().optional(),
    ipAddress: z.string().optional(),
  }),
});

const qrStatusValidationSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, "Session ID is required"),
    watchToken: z.string().min(32, "Invalid QR session watcher token"),
  }),
});

export const UserValidation = {
  createUserZodSchema,
  updateUserZodSchema,
  createAdminAccountZodSchema,
  qrAuthorizeValidationSchema,
  qrStatusValidationSchema
};

export default UserValidation;