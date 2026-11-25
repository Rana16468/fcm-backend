import status from 'http-status';
import { meta, QueryBuilder, QueryParams } from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import catchError from '../../errors/catchError';
import prisma from '../../shared/prisma';
import { searchableFields } from './products.constant';
import { Prisma } from '@prisma/client';

type CreateProductPayload = {
    productName: string;
    quantity: number;
    price: number;
    date: Date | string;
    supplierId: string;
};

type UpdateProductPayload = Partial<Pick<CreateProductPayload, 'productName' | 'quantity' | 'price' | 'date'>>;

const ensureOwnedSupplier = async (userId: string, supplierId: string) => {
    const supplier = await prisma.suppliers.findFirst({
        where: { id: supplierId, userId, isDeleted: false },
        select: { id: true },
    });

    if (!supplier) {
        throw new AppError(status.NOT_FOUND, 'Supplier not found.');
    }
};

const createProductIntoDb = async (payload: CreateProductPayload, userId: string) => {
    try {
        await ensureOwnedSupplier(userId, payload.supplierId);
        await prisma.products.create({
            data: {
                ...payload,
                userId,
                date: payload.date instanceof Date ? payload.date : new Date(payload.date),
                totalAmount: payload.quantity * payload.price,
            },
        });
        return {
            status: true,
            message: "Product created successfully"
        }
    } catch (error) {
        throw catchError(error);
    }
};

const getProductsFromDb = async (userId: string, query: QueryParams) => {
    try {
        const queryBuilder = new QueryBuilder(query);
        queryBuilder.search(searchableFields); // searchableFields তোমার প্রয়োজনমতো ডিফাইন করা থাকবে

        // যদি supplierId পাঠানো হয়, তবেই ফিল্টার করবে
        if (query.supplierId) {
            queryBuilder.filter(['supplierId']);
        }

        // স্কোপ সেটআপ
        const scopeConditions: any = {
            isDeleted: false,
            supplier: { is: { userId, isDeleted: false } },
        };

        if (query.supplierId) {
            scopeConditions.supplierId = query.supplierId;
        }

        queryBuilder.scope(scopeConditions);

        const builtQuery = queryBuilder.build('createdAt');

        const { startDate, endDate } = query;
        if (startDate || endDate) {
            builtQuery.where.date = {};
            if (startDate) {
                builtQuery.where.date.gte = new Date(startDate as string);
            }
            if (endDate) {
                builtQuery.where.date.lte = new Date(endDate as string);
            }
        }

        const [data, total, aggregationResult] = await Promise.all([
            prisma.products.findMany({
                where: builtQuery.where,
                select: {
                    id: true,
                    productName: true,
                    quantity: true,
                    sellingProducts:true,
                    price: true,
                    totalAmount: true,
                    date: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: builtQuery.orderBy,
                skip: builtQuery.skip,
                take: builtQuery.take,
            }),
            prisma.products.count({ where: builtQuery.where }),

            prisma.products.aggregate({
                where: builtQuery.where,
                _sum: {
                    totalAmount: true,
                },
            }),
        ]);

        const grandTotalAmount = aggregationResult._sum.totalAmount || 0;

        return {
            meta: meta(total, builtQuery),
            totalAmount: grandTotalAmount,
            data,
        };
    } catch (error) {
        throw catchError(error);
    }
};

const findProductByIdFromDb = async (userId: string, productId: string) => {
    try {
        return await prisma.products.findFirst({
            where: {
                id: productId,
                isDeleted: false,
                supplier: { is: { userId, isDeleted: false } },

            },
            select: {
                id: true,
                productName: true,
                quantity: true,
                price: true,
                totalAmount: true,
                date: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    } catch (error) {
        throw catchError(error);
    }
};

const updateProductIntoDb = async (
    userId: string,
    productId: string,
    payload: UpdateProductPayload,
) => {
    try {
        const existing = await prisma.products.findFirst({
            where: {
                id: productId,
                isDeleted: false,
                supplier: { is: { userId, isDeleted: false } },
            },
            select: { quantity: true, price: true },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, 'Product not found or already deleted.');
        }

        const quantity = typeof payload.quantity === 'number' ? payload.quantity : existing.quantity;
        const price = typeof payload.price === 'number' ? payload.price : existing.price;
        const result = await prisma.products.updateMany({
            where: {
                id: productId,
                isDeleted: false,
            },
            data: {
                ...payload,
                ...(payload.date !== undefined
                    ? { date: payload.date instanceof Date ? payload.date : new Date(payload.date) }
                    : {}),
                totalAmount: quantity * price,
            },
        });

        if (result.count === 0) {
            throw new AppError(status.NOT_FOUND, 'Product not found or already deleted.');
        }
        return { status: true, message: 'Product updated successfully' };
    } catch (error) {
        throw catchError(error);
    }
};

const deleteProductFromDb = async (userId: string, productId: string) => {
    try {


        await prisma.products.delete({
            where: { id: productId },

        });


        return { status: true, message: 'Product deleted successfully' };
    } catch (error) {
        throw catchError(error);
    }
};


const getMyAllProductsFromDb = async (userId: string, query: QueryParams) => {
    try {
        const queryBuilder = new QueryBuilder(query);
        queryBuilder.search(searchableFields); 

        
        const scopeConditions: any = {
            isDeleted: false,
            supplier: { is: { userId, isDeleted: false } },
        };

       
        queryBuilder.scope(scopeConditions);

        const builtQuery = queryBuilder.build('createdAt');

        const { startDate, endDate } = query;
        if (startDate || endDate) {
            builtQuery.where.date = {};
            if (startDate) {
                builtQuery.where.date.gte = new Date(startDate as string);
            }
            if (endDate) {
                builtQuery.where.date.lte = new Date(endDate as string);
            }
        }

        const [data, total, aggregationResult] = await Promise.all([
            prisma.products.findMany({
                where: builtQuery.where,
                select: {
                    id: true,
                    productName: true,
                    quantity: true,
                    price: true,
                    totalAmount: true,
                    supplierId:true,
                    date: true,
                    createdAt: true,
                    updatedAt: true,
                    supplier:{
                        select:{
                             name:true ,
                             companyName:true ,
                             address:true ,
                             phone:true
                        }
                    }
                },
                orderBy: builtQuery.orderBy,
                skip: builtQuery.skip,
                take: builtQuery.take,
            }),
            prisma.products.count({ where: builtQuery.where }),

            prisma.products.aggregate({
                where: builtQuery.where,
                _sum: {
                    totalAmount: true,
                },
            }),
        ]);

        const grandTotalAmount = aggregationResult._sum.totalAmount || 0;

        return {
            meta: meta(total, builtQuery),
            totalAmount: grandTotalAmount,
            data,
        };
    } catch (error) {
        throw catchError(error);
    }
};



type Stage = Prisma.InputJsonObject;
type Flag = "BLUE" | "RED";

const SORT_FIELDS = {
  rank: "rank",
  profit: "profit",
  margin: "marginPercent",
  qtySold: "qtySold",
  daysInStock: "daysInStock",
} as const;

type QueryParamss = {
  startDate?: string;
  endDate?: string;
  page?: number | string;
  limit?: number | string;
  flag?: Flag;
  sortBy?: keyof typeof SORT_FIELDS;
  sortOrder?: "asc" | "desc";
};

type Facet = {
  rows: Prisma.JsonObject[];
  total: { n: number }[];
  overview: Prisma.JsonObject[];
};

const CFG = {
  BLUE_MIN_MARGIN: 10, // margin % below this => RED
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

const BD_OFFSET = "+06:00"; // বাংলাদেশ সময়
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

const EMPTY_OVERVIEW = {
  totalRevenue: 0,
  totalCost: 0,
  totalProfit: 0,
  overallMarginPercent: 0,
  expectedExtraProfitFromStock: 0,
  blueCount: 0,
  redCount: 0,
};

/* ---------------- helpers ---------------- */

const oid = (id: string) => ({ $oid: id });
const dt = (v: Date) => ({ $date: v.toISOString() });
const r2 = (expr: Prisma.InputJsonValue) => ({ $round: [expr, 2] });
const nameKey = (path: string) => ({
  $toLower: { $trim: { input: { $ifNull: [path, "Unknown"] } } },
});
const safeDiv = (num: Prisma.InputJsonValue, den: string) => ({
  $cond: [{ $gt: [den, 0] }, { $divide: [num, den] }, 0],
});

// তারিখ বাংলাদেশ সময় (+06:00) অনুযায়ী: দিনের শুরু 00:00:00, শেষ 23:59:59.999
const parseDate = (value?: string, endOfDay = false) => {
  if (!value) return undefined;

  let ymd = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const raw = new Date(value);
    if (Number.isNaN(raw.getTime())) throw new Error(`Invalid date: ${value}`);
    ymd = new Date(raw.getTime() + BD_OFFSET_MS).toISOString().slice(0, 10);
  }

  const d = new Date(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${BD_OFFSET}`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
};

const toInt = (value: number | string | undefined, fallback: number) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/* ---------------- stage builders ---------------- */

// 1) Stock: every purchase batch -> purchased, lifetime sold, remaining stock, supplier info
const buildStockStages = (userId: string): Stage[] => [
  { $match: { userId: oid(userId), isDeleted: false } },
  {
    $lookup: {
      from: "invoice_items",
      localField: "_id",
      foreignField: "productId",
      pipeline: [
        { $match: { isDeleted: false } },
        { $group: { _id: null, sold: { $sum: "$productQuantity" } } },
      ],
      as: "soldAgg",
    },
  },
  {
    $lookup: {
      from: "suppliers",
      localField: "supplierId",
      foreignField: "_id",
      pipeline: [{ $project: { _id: 0, name: 1, phone: 1, companyName: 1 } }],
      as: "supplierArr",
    },
  },
  {
    $addFields: {
      sold: { $ifNull: [{ $arrayElemAt: ["$soldAgg.sold", 0] }, 0] },
      supplier: { $arrayElemAt: ["$supplierArr", 0] },
    },
  },
  {
    $addFields: { left: { $max: [{ $subtract: ["$quantity", "$sold"] }, 0] } },
  },
  {
    $project: {
      _id: 0,
      key: nameKey("$productName"),
      productName: { $ifNull: ["$productName", "Unknown"] },
      supplier: 1,
      batchDate: "$date",
      purchased: "$quantity",
      purchaseValue: { $multiply: ["$quantity", "$price"] },
      soldLifetime: "$sold",
      stockLeft: "$left",
      stockValue: { $multiply: ["$left", "$price"] },
      staleDate: { $cond: [{ $gt: ["$left", 0] }, "$date", null] },
    },
  },
];

// 2) Sales: invoices in the date range. Invoices with NO invoice items are skipped.
//    Revenue per product = InvoiceItem.amount (আসল বিক্রয়মূল্য).
//    - যদি invoice.amount আর আইটেমগুলোর যোগফল আলাদা হয় (যেমন ডিসকাউন্ট), তাহলে
//      আইটেমের অনুপাত ধরে invoice.amount ভাগ করা হয়, যাতে মোট বিক্রি ড্যাশবোর্ডের সাথে মেলে।
//    - পুরোনো ইনভয়েস (যেখানে আইটেমের amount নেই বা ০): আগের মতো cost-অনুপাতে ভাগ হয়।
const buildSalesBranch = (invoiceMatch: Stage): Stage => ({
  $unionWith: {
    coll: "invoices",
    pipeline: [
      { $match: invoiceMatch },
      {
        $lookup: {
          from: "invoice_items",
          localField: "_id",
          foreignField: "invoiceId",
          pipeline: [
            { $match: { isDeleted: false } },
            {
              $lookup: {
                from: "supplier_products",
                localField: "productId",
                foreignField: "_id",
                pipeline: [{ $project: { productName: 1, price: 1 } }],
                as: "product",
              },
            },
            { $unwind: "$product" },
            {
              $project: {
                _id: 0,
                productQuantity: 1,
                itemAmount: { $ifNull: ["$amount", 0] },
                productName: "$product.productName",
                itemCost: { $multiply: ["$productQuantity", "$product.price"] },
              },
            },
          ],
          as: "items",
        },
      },
      // skip invoices that have no invoice items
      { $match: { "items.0": { $exists: true } } },
      {
        $addFields: {
          invoiceCost: { $sum: "$items.itemCost" },
          invoiceQty: { $sum: "$items.productQuantity" },
          itemsAmount: { $sum: "$items.itemAmount" },
        },
      },
      { $unwind: "$items" },
      {
        $project: {
          _id: 0,
          key: nameKey("$items.productName"),
          productName: { $ifNull: ["$items.productName", "Unknown"] },
          qtySold: "$items.productQuantity",
          cost: "$items.itemCost",
          revenue: {
            $switch: {
              branches: [
                // নতুন ইনভয়েস: আইটেমের নিজের amount
                {
                  case: { $gt: ["$itemsAmount", 0] },
                  then: {
                    $multiply: [
                      "$items.itemAmount",
                      {
                        $cond: [
                          { $gt: ["$amount", 0] },
                          { $divide: ["$amount", "$itemsAmount"] },
                          1,
                        ],
                      },
                    ],
                  },
                },
                // পুরোনো ইনভয়েস: cost অনুপাতে
                {
                  case: { $gt: ["$invoiceCost", 0] },
                  then: {
                    $divide: [{ $multiply: ["$amount", "$items.itemCost"] }, "$invoiceCost"],
                  },
                },
                // cost ০ হলে পরিমাণ অনুপাতে
                {
                  case: { $gt: ["$invoiceQty", 0] },
                  then: {
                    $divide: [{ $multiply: ["$amount", "$items.productQuantity"] }, "$invoiceQty"],
                  },
                },
              ],
              default: 0,
            },
          },
        },
      },
    ],
  },
});

// 3) Merge stock + sales by product name (suppliers collected as a distinct set)
const MERGE_GROUP: Stage = {
  $group: {
    _id: "$key",
    productName: { $max: "$productName" },
    suppliers: { $addToSet: "$supplier" },
    purchased: { $sum: "$purchased" },
    purchaseValue: { $sum: "$purchaseValue" },
    soldLifetime: { $sum: "$soldLifetime" },
    stockLeft: { $sum: "$stockLeft" },
    stockValue: { $sum: "$stockValue" },
    oldestStockDate: { $min: "$staleDate" },
    firstPurchase: { $min: "$batchDate" },
    qtySold: { $sum: "$qtySold" },
    revenue: { $sum: "$revenue" },
    cost: { $sum: "$cost" },
  },
};

// 4) Margin, sell rate, flag, rank
const buildMetricStages = (start?: Date, end?: Date): Stage[] => [
  {
    $addFields: {
      suppliers: {
        $filter: { input: "$suppliers", as: "s", cond: { $ne: ["$$s", null] } },
      },
      profit: { $subtract: ["$revenue", "$cost"] },
      sellThroughPercent: safeDiv({ $multiply: ["$soldLifetime", 100] }, "$purchased"),
      daysInStock: {
        $cond: [
          { $ifNull: ["$oldestStockDate", false] },
          { $dateDiff: { startDate: "$oldestStockDate", endDate: "$$NOW", unit: "day" } },
          0,
        ],
      },
      periodDays: {
        $max: [
          1,
          {
            $dateDiff: {
              startDate: start ? dt(start) : "$firstPurchase",
              endDate: end ? dt(end) : "$$NOW",
              unit: "day",
            },
          },
        ],
      },
      avgBuyPrice: {
        $cond: [
          { $gt: ["$qtySold", 0] },
          { $divide: ["$cost", "$qtySold"] },
          safeDiv("$purchaseValue", "$purchased"),
        ],
      },
      avgSellPrice: {
        $cond: [{ $gt: ["$qtySold", 0] }, { $divide: ["$revenue", "$qtySold"] }, 0],
      },
    },
  },
  {
    $addFields: {
      marginPercent: safeDiv({ $multiply: ["$profit", 100] }, "$revenue"),
      unitsPerDay: { $divide: ["$qtySold", "$periodDays"] },
      potentialProfit: {
        $cond: [
          { $gt: ["$qtySold", 0] },
          { $multiply: ["$stockLeft", { $divide: ["$profit", "$qtySold"] }] },
          0,
        ],
      },
    },
  },
  {
    $addFields: {
      flag: {
        $cond: [
          {
            $and: [
              { $gt: ["$qtySold", 0] },
              { $gte: ["$marginPercent", CFG.BLUE_MIN_MARGIN] },
            ],
          },
          "BLUE",
          "RED",
        ],
      },
      reason: {
        $switch: {
          branches: [
            { case: { $eq: ["$qtySold", 0] }, then: "No sales in this period" },
            { case: { $lt: ["$marginPercent", 0] }, then: "Selling at a loss" },
            { case: { $lt: ["$marginPercent", CFG.BLUE_MIN_MARGIN] }, then: "Low margin" },
          ],
          default: "Good sales and good margin",
        },
      },
    },
  },
  // Drop products with no sales AND no stock
  { $match: { $or: [{ qtySold: { $gt: 0 } }, { stockLeft: { $gt: 0 } }] } },
  // Rank by profit: highest profit = rank 1, lowest profit = last.
  // $documentNumber accepts exactly ONE sortBy field, and profit is that one field.
  {
    $setWindowFields: {
      sortBy: { profit: -1 },
      output: { rank: { $documentNumber: {} } },
    },
  },
];

const ROW_PROJECTION: Stage = {
  _id: 0,
  rank: 1,
  productName: 1,
  suppliers: 1, // [{ name, phone, companyName }]
  flag: 1,
  reason: 1,
  buyingPrice: r2("$avgBuyPrice"),
  sellingPrice: r2("$avgSellPrice"),
  qtySold: 1,
  revenue: r2("$revenue"),
  productCost: r2("$cost"),
  profit: r2("$profit"),
  marginPercent: r2("$marginPercent"),
  sellThroughPercent: r2("$sellThroughPercent"),
  unitsPerDay: r2("$unitsPerDay"),
  stockLeft: 1,
  stockValue: r2("$stockValue"),
  daysInStock: 1,
  potentialProfit: r2("$potentialProfit"),
};

// 5) One pass: paginated rows + total + overview
const buildFacet = (opts: { flag?: Flag; sort: Stage; skip: number; limit: number }): Stage => {
  const flagMatch: Stage = opts.flag ? { flag: opts.flag } : {};
  return {
    $facet: {
      rows: [
        { $match: flagMatch },
        { $sort: opts.sort },
        { $skip: opts.skip },
        { $limit: opts.limit },
        { $project: ROW_PROJECTION },
      ],
      total: [{ $match: flagMatch }, { $count: "n" }],
      overview: [
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$revenue" },
            totalCost: { $sum: "$cost" },
            totalProfit: { $sum: "$profit" },
            expectedExtraProfitFromStock: { $sum: "$potentialProfit" },
            blueCount: { $sum: { $cond: [{ $eq: ["$flag", "BLUE"] }, 1, 0] } },
            redCount: { $sum: { $cond: [{ $eq: ["$flag", "RED"] }, 1, 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            totalRevenue: r2("$totalRevenue"),
            totalCost: r2("$totalCost"),
            totalProfit: r2("$totalProfit"),
            overallMarginPercent: r2(
              safeDiv({ $multiply: ["$totalProfit", 100] }, "$totalRevenue"),
            ),
            expectedExtraProfitFromStock: r2("$expectedExtraProfitFromStock"),
            blueCount: 1,
            redCount: 1,
          },
        },
      ],
    },
  };
};



 const winningProductFromDb = async (userId: string, query: QueryParamss) => {
  const start = parseDate(query.startDate);
  const end = parseDate(query.endDate, true);
  if (start && end && start > end) throw new Error("startDate must be before endDate");

  const page = toInt(query.page, 1);
  const limit = Math.min(toInt(query.limit, CFG.DEFAULT_LIMIT), CFG.MAX_LIMIT);
  const flag = query.flag === "BLUE" || query.flag === "RED" ? query.flag : undefined;

  const sortBy = query.sortBy && query.sortBy in SORT_FIELDS ? query.sortBy : "rank";
  const defaultDir = sortBy === "rank" ? 1 : -1;
  const dir = query.sortOrder ? (query.sortOrder === "asc" ? 1 : -1) : defaultDir;
  const sort: Stage = { [SORT_FIELDS[sortBy]]: dir, _id: 1 };

  const invoiceMatch: Stage = {
    userId: oid(userId),
    isDeleted: false,
    ...((start || end) && {
      date: { ...(start && { $gte: dt(start) }), ...(end && { $lte: dt(end) }) },
    }),
  };

  const pipeline: Stage[] = [
    ...buildStockStages(userId),
    buildSalesBranch(invoiceMatch),
    MERGE_GROUP,
    ...buildMetricStages(start, end),
    buildFacet({ flag, sort, skip: (page - 1) * limit, limit }),
  ];

  const raw = await prisma.products.aggregateRaw({
    pipeline,
    options: { allowDiskUse: true },
  });

  const [facet] = raw as unknown as Facet[];
  const total = facet?.total[0]?.n ?? 0;

  return {
    filter: { startDate: query.startDate ?? null, endDate: query.endDate ?? null },
    overview: facet?.overview[0] ?? EMPTY_OVERVIEW,
    products: facet?.rows ?? [],
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};



const ProductsServices = {
    createProductIntoDb,
    getProductsFromDb,
    findProductByIdFromDb,
    updateProductIntoDb,
    deleteProductFromDb,
    getMyAllProductsFromDb,
    winningProductFromDb
};

export default ProductsServices;