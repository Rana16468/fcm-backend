import { Suppliers } from './../../../../node_modules/.prisma/client/index.d';

import { z } from 'zod';


const createSupplierZodSchema = z.object({
  body: z.object({
    companyName: z.string({
      error: 'Company name is required',
    })
    .min(1, 'Company name cannot be empty'),

    name: z.string().optional(), 

    phone: z.string({
      error: 'Phone number is required. Supplier creation is not allowed without a phone number.',
    })
    .min(11, 'Phone number must be at least 10 digits')
    .regex(/^[0-9+\-\s()]*$/, 'Invalid phone number format'), 

    address: z.string().optional(), 
  }),
});

const updateSupplierZodSchema = z.object({
  body: z.object({
    companyName: z.string().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),
}); 

const SuppliersValidation = {   
createSupplierZodSchema,
updateSupplierZodSchema

};

export default SuppliersValidation;