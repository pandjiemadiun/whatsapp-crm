import { z } from 'zod';
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type LoginInput = z.infer<typeof loginSchema>;
export declare const registerAdminSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type RegisterAdminInput = z.infer<typeof registerAdminSchema>;
export declare const storeLoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type StoreLoginInput = z.infer<typeof storeLoginSchema>;
export declare const storeRegisterSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    phoneNumber: z.ZodString;
    address: z.ZodString;
    originProvinceId: z.ZodString;
    originProvinceName: z.ZodString;
    originCityId: z.ZodString;
    originCityName: z.ZodString;
    originSubdistrictId: z.ZodString;
    originSubdistrictName: z.ZodString;
}, z.core.$strip>;
export type StoreRegisterInput = z.infer<typeof storeRegisterSchema>;
export declare const queryStoresSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    search: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        suspended: "suspended";
    }>>;
}, z.core.$strip>;
export type QueryStoresInput = z.infer<typeof queryStoresSchema>;
export declare const updateProfileSchema: z.ZodObject<{
    storeId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    timezone: z.ZodOptional<z.ZodString>;
    phoneNumber: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    fonnteToken: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    fonnteNumber: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    acceptsTransfer: z.ZodOptional<z.ZodBoolean>;
    acceptsQris: z.ZodOptional<z.ZodBoolean>;
    acceptsCod: z.ZodOptional<z.ZodBoolean>;
    qrisImageUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    shippingMode: z.ZodOptional<z.ZodEnum<{
        flat: "flat";
        pickup: "pickup";
    }>>;
    shippingFlatInCity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    shippingFlatOutCity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export declare const resetPasswordSchema: z.ZodObject<{
    tempPassword: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export declare const updateStatusSchema: z.ZodObject<{
    status: z.ZodEnum<{
        resolved: "resolved";
        human_takeover: "human_takeover";
        open: "open";
        closed: "closed";
    }>;
}, z.core.$strip>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export declare const replyMessageSchema: z.ZodObject<{
    message: z.ZodString;
}, z.core.$strip>;
export type ReplyMessageInput = z.infer<typeof replyMessageSchema>;
export declare const updateConfigSchema: z.ZodObject<{
    value: z.ZodString;
    category: z.ZodOptional<z.ZodString>;
    isSecret: z.ZodOptional<z.ZodBoolean>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;
export declare const listProductsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    offset: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    sortBy: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        createdAt: "createdAt";
        name: "name";
        price: "price";
    }>>>;
    order: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>>;
}, z.core.$strip>;
export type ListProductsQueryInput = z.infer<typeof listProductsQuerySchema>;
export declare const searchProductsQuerySchema: z.ZodObject<{
    q: z.ZodString;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    offset: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type SearchProductsQueryInput = z.infer<typeof searchProductsQuerySchema>;
export declare const productImageSchema: z.ZodObject<{
    url: z.ZodString;
    alt: z.ZodString;
}, z.core.$strip>;
export declare const createProductSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    price: z.ZodCoercedNumber<unknown>;
    stock: z.ZodNullable<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    weight: z.ZodCoercedNumber<unknown>;
    sku: z.ZodString;
    categoryId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    currency: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        alt: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export declare const updateProductSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    price: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    stock: z.ZodNullable<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    weight: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    categoryId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    currency: z.ZodOptional<z.ZodString>;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        alt: z.ZodString;
    }, z.core.$strip>>>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export declare const magicPasteSchema: z.ZodObject<{
    text: z.ZodString;
    storeId: z.ZodString;
}, z.core.$strip>;
export type MagicPasteInput = z.infer<typeof magicPasteSchema>;
//# sourceMappingURL=index.d.ts.map