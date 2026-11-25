import { Prisma } from "@prisma/client";
import prisma from "../../shared/prisma";



type Stage = Record<string, unknown>;
type Query = Record<string, unknown>;
type Pager = { page: number; limit: number; skip: number };
type DateRange = {
  start: Date | null;
  end: Date | null; // exclusive
  startDate: string | null;
  endDate: string | null;
};

const DAY_MS = 86_400_000;
const DHAKA_OFFSET_MS = 6 * 3_600_000; // UTC+6
const TZ = "Asia/Dhaka";

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

/** Prisma aggregateRaw Extended JSON চায়: ObjectId => {$oid}, Date => {$date} */
const oid = (id: string) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError(400, `Invalid id: ${id}`);
  return { $oid: id };
};
const dt = (d: Date) => ({ $date: d.toISOString() });
const asPipeline = (p: Stage[]) => p as unknown as Prisma.InputJsonValue[];

/** query-string থেকে নিরাপদে মান পড়া */
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) =>
  v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;

/** ঢাকার সময় অনুযায়ী YYYY-MM-DD */
const toYmd = (d: Date) => new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

const parseYmd = (value: string, name: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpError(400, `${name} must be in YYYY-MM-DD format`);
  }
  const d = new Date(`${value}T00:00:00+06:00`);
  if (Number.isNaN(d.getTime())) throw httpError(400, `Invalid ${name}`);
  return d;
};

/** startDate / endDate পড়ে ও যাচাই করে। endDate নিজেও অন্তর্ভুক্ত (inclusive)। */
const getRange = (query: Query): DateRange => {
  const startStr = str(query.startDate);
  const endStr = str(query.endDate);
  const start = startStr ? parseYmd(startStr, "startDate") : null;
  const endDay = endStr ? parseYmd(endStr, "endDate") : null;
  if (start && endDay && endDay < start) {
    throw httpError(400, "endDate must not be before startDate");
  }
  return {
    start,
    end: endDay ? new Date(endDay.getTime() + DAY_MS) : null,
    startDate: startStr ?? null,
    endDate: endStr ?? null,
  };
};

/** $match-এ বসানোর date শর্ত। কোনো তারিখ না দিলে খালি অবজেক্ট। */
const dateMatch = (r: DateRange) =>
  r.start || r.end
    ? {
        date: {
          ...(r.start ? { $gte: dt(r.start) } : {}),
          ...(r.end ? { $lt: dt(r.end) } : {}),
        },
      }
    : {};

/** মাসের শুরু (ঢাকা সময়): 0 = চলতি মাস, -1 = গত মাস, 1 = আগামী মাস */
const monthStart = (offset: number) => {
  const now = new Date(Date.now() + DHAKA_OFFSET_MS);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1) - DHAKA_OFFSET_MS,
  );
};

/* ---- পেজিনেশন ---- */

const getPager = (query: Query, defaultLimit: number, maxLimit: number): Pager => {
  const limit = Math.min(Math.max(Math.floor(num(query.limit) ?? defaultLimit), 1), maxLimit);
  const page = Math.max(Math.floor(num(query.page) ?? 1), 1);
  return { page, limit, skip: (page - 1) * limit };
};

const buildMeta = (p: Pager, total: number) => ({
  page: p.page,
  limit: p.limit,
  total,
  totalPage: Math.ceil(total / p.limit),
});

/** facet-এর `total` ব্রাঞ্চ ([{ total: n }] বা []) থেকে সংখ্যা বের করা */
const totalFromFacet = {
  $ifNull: [{ $arrayElemAt: ["$total.total", 0] }, 0],
};

/* ---- পুনর্ব্যবহারযোগ্য aggregation expression ---- */

const round2 = (expr: unknown) => ({ $round: [expr, 2] });
const ageInDays = (field: string) => ({
  $divide: [{ $subtract: ["$$NOW", field] }, DAY_MS],
});
const ymd = (field: string) => ({
  $dateToString: { date: field, format: "%Y-%m-%d", timezone: TZ },
});
const sumIf = (cond: unknown, value: unknown) => ({
  $sum: { $cond: [cond, value, 0] },
});

/**
 * ইনভয়েসের বাকি টাকা (ড্যাশবোর্ড ও ফাইন্যান্সিয়াল রিপোর্টের সাথে একই নিয়ম):
 * REMAINING => remainingBalnace, UNPAID => পুরো amount, PAID => ০
 */
const DUE_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ["$status", "REMAINING"] }, then: { $ifNull: ["$remainingBalnace", 0] } },
      { case: { $eq: ["$status", "UNPAID"] }, then: { $ifNull: ["$amount", 0] } },
    ],
    default: 0,
  },
};

/* -------------------------------------------------------------------------- */
/*                    ১. Stock Runway (মাল কত দিন চলবে)                         */
/*   ফিল্টার: startDate/endDate (ব্যাচের তারিখ), supplierId, status,            */
/*            includeSoldOut | পেজিনেশন: page, limit (ডিফল্ট ১০, সর্বোচ্চ ১০০)   */
/* -------------------------------------------------------------------------- */

const CRITICAL_DAYS = 7; // ৭ দিনের কম => লাল
const LOW_DAYS = 15; // ১৫ দিনের কম => হলুদ
const SLOW_AGE_DAYS = 30; // ৩০ দিনের পুরনো ব্যাচ ...
const SLOW_SELL_THROUGH = 40; // ... আর ৪০%-এর কম বিক্রি => ধীর মাল
const STATUS_ORDER = ["OUT_OF_STOCK", "CRITICAL", "LOW", "SLOW", "HEALTHY"];

const getStockRunwayIntoDb = async (query: Query, userId: string) => {
  const supplierId = str(query.supplierId);
  const range = getRange(query);
  const pager = getPager(query, 10, 100);

  const statusParam = str(query.status)?.toUpperCase();
  if (statusParam && !/^(OUT_OF_STOCK|CRITICAL|LOW|SLOW|HEALTHY)$/.test(statusParam)) {
    throw httpError(400, "status must be OUT_OF_STOCK, CRITICAL, LOW, SLOW or HEALTHY");
  }

  // তালিকা ও মোট সংখ্যায় প্রযোজ্য শর্ত (summary সবসময় পুরো ফিল্টার করা ডেটার)
  const listFilter = statusParam
    ? { status: statusParam }
    : query.includeSoldOut === "true"
      ? {}
      : { status: { $ne: "OUT_OF_STOCK" } };

  const pipeline: Stage[] = [
    {
      $match: {
        userId: oid(userId),
        isDeleted: false,
        ...(supplierId ? { supplierId: oid(supplierId) } : {}),
        ...dateMatch(range),
      },
    },
    {
      $addFields: {
        sold: { $ifNull: ["$sellingProducts", 0] },
        ageDays: { $max: [1, { $ceil: ageInDays("$date") }] },
      },
    },
    {
      $addFields: {
        stock: { $max: [0, { $subtract: ["$quantity", "$sold"] }] },
        dailyRate: { $divide: ["$sold", "$ageDays"] },
        sellThrough: {
          $cond: [
            { $gt: ["$quantity", 0] },
            { $multiply: [{ $divide: ["$sold", "$quantity"] }, 100] },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        runwayDays: {
          $cond: [{ $gt: ["$dailyRate", 0] }, { $divide: ["$stock", "$dailyRate"] }, null],
        },
        stockValue: { $multiply: ["$stock", "$price"] },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ["$stock", 0] }, then: "OUT_OF_STOCK" },
              {
                case: {
                  $and: [{ $ne: ["$runwayDays", null] }, { $lte: ["$runwayDays", CRITICAL_DAYS] }],
                },
                then: "CRITICAL",
              },
              {
                case: {
                  $and: [{ $ne: ["$runwayDays", null] }, { $lte: ["$runwayDays", LOW_DAYS] }],
                },
                then: "LOW",
              },
              {
                case: {
                  $and: [
                    { $gte: ["$ageDays", SLOW_AGE_DAYS] },
                    { $lt: ["$sellThrough", SLOW_SELL_THROUGH] },
                  ],
                },
                then: "SLOW",
              },
            ],
            default: "HEALTHY",
          },
        },
      },
    },
    {
      $addFields: {
        statusRank: { $indexOfArray: [STATUS_ORDER, "$status"] },
        runwaySort: { $ifNull: ["$runwayDays", 1e12] }, // null সবার শেষে যাবে
      },
    },
    {
      $facet: {
        items: [
          { $match: listFilter },
          { $sort: { statusRank: 1, runwaySort: 1, date: 1, _id: 1 } },
          { $skip: pager.skip },
          { $limit: pager.limit },
          {
            $project: {
              _id: 0,
              id: { $toString: "$_id" },
              productName: { $ifNull: ["$productName", "Unnamed"] },
              batchDate: ymd("$date"),
              quantity: 1,
              sold: 1,
              stock: 1,
              price: 1,
              ageDays: 1,
              status: 1,
              stockValue: round2("$stockValue"),
              dailyRate: round2("$dailyRate"),
              runwayDays: round2("$runwayDays"),
              sellThroughPercent: round2("$sellThrough"),
            },
          },
        ],
        total: [{ $match: listFilter }, { $count: "total" }],
        summary: [
          {
            $group: {
              _id: null,
              totalBatches: { $sum: 1 },
              outOfStock: sumIf({ $eq: ["$status", "OUT_OF_STOCK"] }, 1),
              critical: sumIf({ $eq: ["$status", "CRITICAL"] }, 1),
              low: sumIf({ $eq: ["$status", "LOW"] }, 1),
              slow: sumIf({ $eq: ["$status", "SLOW"] }, 1),
              healthy: sumIf({ $eq: ["$status", "HEALTHY"] }, 1),
              totalStockValue: { $sum: "$stockValue" },
              slowStockValue: sumIf({ $eq: ["$status", "SLOW"] }, "$stockValue"),
            },
          },
          {
            $project: {
              _id: 0,
              totalBatches: 1,
              outOfStock: 1,
              critical: 1,
              low: 1,
              slow: 1,
              healthy: 1,
              totalStockValue: round2("$totalStockValue"),
              slowStockValue: round2("$slowStockValue"),
            },
          },
        ],
      },
    },
    {
      $project: {
        items: 1,
        total: totalFromFacet,
        summary: {
          $ifNull: [
            { $arrayElemAt: ["$summary", 0] },
            {
              totalBatches: 0,
              outOfStock: 0,
              critical: 0,
              low: 0,
              slow: 0,
              healthy: 0,
              totalStockValue: 0,
              slowStockValue: 0,
            },
          ],
        },
      },
    },
  ];

  const [result] = (await prisma.products.aggregateRaw({
    pipeline: asPipeline(pipeline),
  })) as unknown as Array<{ items: unknown[]; summary: unknown; total: number }>;

  return {
    startDate: range.startDate,
    endDate: range.endDate,
    summary: result.summary,
    items: result.items,
    meta: buildMeta(pager, result.total),
  };
};



const isPlaceholder = (field: string) => ({
  $in: [{ $toLower: field }, ["", "xxxxx"]], // ফাঁকা বা ডিফল্ট "xxxxx" মান
});

const getDueRadarIntoDb = async (query: Query, userId: string) => {
  const range = getRange(query);
  const pager = getPager(query, 10, 100);
  const minAgeDays = num(query.minAgeDays);

  const listFilter = minAgeDays === undefined ? {} : { oldestAgeDays: { $gte: minAgeDays } };
  const byOldest = { oldestAgeDays: -1, totalDue: -1, _id: 1 };

  const pipeline: Stage[] = [
    {
      $match: {
        userId: oid(userId),
        isDeleted: false,
        status: { $in: ["REMAINING", "UNPAID"] }, // বদলেছে: আগে শুধু remainingBalnace > 0 ছিল
        ...dateMatch(range),
      },
    },
    {
      $addFields: {
        due: DUE_EXPR, // নতুন: প্রতি ইনভয়েসের বাকি টাকা
        ageDays: { $floor: ageInDays("$date") },
        phoneT: { $trim: { input: { $ifNull: ["$phone", ""] } } },
        nameT: { $trim: { input: { $ifNull: ["$customerName", ""] } } },
      },
    },
    { $match: { due: { $gt: 0 } } }, // নতুন
    {
      $addFields: {
        // ফোন নম্বর থেকে স্পেস, হাইফেন ও শুরুর + সরানো
        phoneClean: {
          $cond: [
            isPlaceholder("$phoneT"),
            null,
            {
              $ltrim: {
                chars: "+",
                input: {
                  $replaceAll: {
                    input: { $replaceAll: { input: "$phoneT", find: " ", replacement: "" } },
                    find: "-",
                    replacement: "",
                  },
                },
              },
            },
          ],
        },
        nameClean: { $cond: [isPlaceholder("$nameT"), null, "$nameT"] },
      },
    },
    {
      $addFields: {
        // একই কাস্টমারকে এক ধরার চাবি: ফোন > নাম > unknown
        customerKey: {
          $ifNull: [
            { $concat: ["p:", "$phoneClean"] },
            { $ifNull: [{ $concat: ["n:", { $toLower: "$nameClean" }] }, "unknown"] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$customerKey",
        customerName: { $max: "$nameClean" },
        phone: { $max: "$phoneClean" },
        totalDue: { $sum: "$due" },
        invoiceCount: { $sum: 1 },
        oldestAgeDays: { $max: "$ageDays" },
        oldestDate: { $min: "$date" },
        days0to7: sumIf({ $lte: ["$ageDays", 7] }, "$due"),
        days8to30: sumIf(
          { $and: [{ $gt: ["$ageDays", 7] }, { $lte: ["$ageDays", 30] }] },
          "$due",
        ),
        days30plus: sumIf({ $gt: ["$ageDays", 30] }, "$due"),
      },
    },
    {
      // WhatsApp-এর জন্য 8801XXXXXXXXX ফরম্যাট
      $addFields: {
        whatsappNumber: {
          $switch: {
            branches: [
              { case: { $eq: ["$phone", null] }, then: null },
              { case: { $eq: [{ $substrCP: ["$phone", 0, 3] }, "880"] }, then: "$phone" },
              {
                case: {
                  $and: [
                    { $eq: [{ $substrCP: ["$phone", 0, 1] }, "0"] },
                    { $eq: [{ $strLenCP: "$phone" }, 11] },
                  ],
                },
                then: { $concat: ["88", "$phone"] },
              },
            ],
            default: "$phone",
          },
        },
      },
    },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              customerCount: { $sum: 1 },
              totalDue: { $sum: "$totalDue" },
              days0to7: { $sum: "$days0to7" },
              days8to30: { $sum: "$days8to30" },
              days30plus: { $sum: "$days30plus" },
            },
          },
          {
            $project: {
              _id: 0,
              customerCount: 1,
              totalDue: round2("$totalDue"),
              days0to7: round2("$days0to7"),
              days8to30: round2("$days8to30"),
              days30plus: round2("$days30plus"),
            },
          },
        ],
        customers: [
          { $match: listFilter },
          { $sort: byOldest },
          { $skip: pager.skip },
          { $limit: pager.limit },
          {
            $project: {
              _id: 0,
              customerKey: "$_id",
              customerName: 1,
              phone: 1,
              whatsappNumber: 1,
              invoiceCount: 1,
              oldestAgeDays: 1,
              oldestDate: ymd("$oldestDate"),
              totalDue: round2("$totalDue"),
              days0to7: round2("$days0to7"),
              days8to30: round2("$days8to30"),
              days30plus: round2("$days30plus"),
            },
          },
        ],
        total: [{ $match: listFilter }, { $count: "total" }],
      },
    },
    {
      $project: {
        customers: 1,
        total: totalFromFacet,
        summary: {
          $ifNull: [
            { $arrayElemAt: ["$summary", 0] },
            { customerCount: 0, totalDue: 0, days0to7: 0, days8to30: 0, days30plus: 0 },
          ],
        },
      },
    },
  ];

  const [result] = (await prisma.invoices.aggregateRaw({
    pipeline: asPipeline(pipeline),
  })) as unknown as Array<{ customers: unknown[]; summary: unknown; total: number }>;

  return {
    startDate: range.startDate,
    endDate: range.endDate,
    summary: result.summary,
    customers: result.customers,
    meta: buildMeta(pager, result.total),
  };
};

/* -------------------------------------------------------------------------- */
/*                              ৩. Cash Pulse                                  */
/*   ফিল্টার: startDate/endDate (কিছু না দিলে আজ) | পেজিনেশন: খরচের ক্যাটাগরি     */
/*   page, limit (ডিফল্ট ২০, সর্বোচ্চ ৫০)                                        */
/* -------------------------------------------------------------------------- */

const ZERO_CASH = {
  invoiceCount: 0,
  sales: 0,
  dueCreated: 0,
  cashIn: 0,
  expenses: 0,
  supplierPayments: 0,
  cashOut: 0,
  netCash: 0,
};

const getCashPulseIntoDb = async (query: Query, userId: string) => {
  const given = getRange(query);
  const pager = getPager(query, 20, 50);

  // তারিখ না দিলে আজকের দিন
  const todayStr = toYmd(new Date());
  const todayStart = parseYmd(todayStr, "date");
  const range: DateRange =
    given.start || given.end
      ? given
      : {
          start: todayStart,
          end: new Date(todayStart.getTime() + DAY_MS),
          startDate: todayStr,
          endDate: todayStr,
        };

  const base = { userId: oid(userId), isDeleted: false, ...dateMatch(range) };

  // এক কোয়েরিতে তিন কালেকশন: invoices + expenses + supplier_transactions
  const totalsPipeline: Stage[] = [
    { $match: base },
    {
      $group: {
        _id: null,
        sales: { $sum: "$amount" },
        dueCreated: { $sum: DUE_EXPR }, // বদলেছে: আগে $sum: "$remainingBalnace" ছিল
        invoiceCount: { $sum: 1 },
      },
    },
    {
      $unionWith: {
        coll: "expenses",
        pipeline: [{ $match: base }, { $group: { _id: null, expenses: { $sum: "$amount" } } }],
      },
    },
    {
      $unionWith: {
        coll: "supplier_transactions",
        pipeline: [
          { $match: { ...base, type: "PAYMENT" } },
          { $group: { _id: null, supplierPayments: { $sum: "$amount" } } },
        ],
      },
    },
    {
      $group: {
        _id: null,
        invoiceCount: { $sum: "$invoiceCount" },
        sales: { $sum: "$sales" },
        dueCreated: { $sum: "$dueCreated" },
        expenses: { $sum: "$expenses" },
        supplierPayments: { $sum: "$supplierPayments" },
      },
    },
    {
      $addFields: {
        cashIn: { $subtract: ["$sales", "$dueCreated"] }, // বাকি বাদে যা হাতে এসেছে
        cashOut: { $add: ["$expenses", "$supplierPayments"] },
      },
    },
    { $addFields: { netCash: { $subtract: ["$cashIn", "$cashOut"] } } },
    {
      $project: {
        _id: 0,
        invoiceCount: 1,
        sales: round2("$sales"),
        dueCreated: round2("$dueCreated"),
        cashIn: round2("$cashIn"),
        expenses: round2("$expenses"),
        supplierPayments: round2("$supplierPayments"),
        cashOut: round2("$cashOut"),
        netCash: round2("$netCash"),
      },
    },
  ];

  const categoryPipeline: Stage[] = [
    { $match: base },
    { $group: { _id: "$category", amount: { $sum: "$amount" } } },
    {
      $facet: {
        items: [
          { $sort: { amount: -1, _id: 1 } },
          { $skip: pager.skip },
          { $limit: pager.limit },
          { $project: { _id: 0, category: "$_id", amount: round2("$amount") } },
        ],
        total: [{ $count: "total" }],
      },
    },
    { $project: { items: 1, total: totalFromFacet } },
  ];

  const [totals, categories] = await Promise.all([
    prisma.invoices.aggregateRaw({ pipeline: asPipeline(totalsPipeline) }),
    prisma.expenses.aggregateRaw({ pipeline: asPipeline(categoryPipeline) }),
  ]);

  const [row] = totals as unknown as Array<Record<string, unknown>>;
  const [category] = categories as unknown as Array<{ items: unknown[]; total: number }>;

  return {
    startDate: range.startDate,
    endDate: range.endDate,
    ...(row ?? ZERO_CASH),
    expenseByCategory: category.items,
    meta: buildMeta(pager, category.total),
  };
};

/* -------------------------------------------------------------------------- */
/*                    ৪. অটো-টার্গেট (আগের সময়ের বিক্রিই টার্গেট)                 */
/*   তারিখ না দিলে: চলতি মাস বনাম গত মাস।                                      */
/*   startDate ও endDate দুটোই দিলে: ওই সময়কাল বনাম তার ঠিক আগের সমান সময়কাল।   */
/* -------------------------------------------------------------------------- */

const getAutoTargetIntoDb = async (query: Query, userId: string) => {
  const range = getRange(query);
  if (Boolean(range.start) !== Boolean(range.end)) {
    throw httpError(400, "Both startDate and endDate are required for a custom period");
  }

  const periodStart = range.start ?? monthStart(0);
  const periodEnd = range.end ?? monthStart(1);
  const prevStart =
    range.start && range.end
      ? new Date(periodStart.getTime() - (periodEnd.getTime() - periodStart.getTime()))
      : monthStart(-1);

  const now = Date.now();
  const totalDays = Math.max(Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS), 1);
  const periodStatus =
    now < periodStart.getTime() ? "UPCOMING" : now >= periodEnd.getTime() ? "ENDED" : "RUNNING";

  const elapsedDays =
    periodStatus === "UPCOMING"
      ? 0
      : periodStatus === "ENDED"
        ? totalDays
        : Math.min(Math.ceil((now - periodStart.getTime()) / DAY_MS), totalDays);
  const daysLeft =
    periodStatus === "RUNNING" ? totalDays - elapsedDays + 1 : periodStatus === "UPCOMING" ? totalDays : 0;

  const pipeline: Stage[] = [
    {
      $match: {
        userId: oid(userId),
        isDeleted: false,
        date: { $gte: dt(prevStart), $lt: dt(periodEnd) },
      },
    },
    {
      $group: {
        _id: null,
        currentPeriodSales: sumIf({ $gte: ["$date", dt(periodStart)] }, "$amount"),
        previousPeriodSales: sumIf({ $lt: ["$date", dt(periodStart)] }, "$amount"),
      },
    },
    {
      $addFields: {
        dailyAverage: { $divide: ["$currentPeriodSales", Math.max(elapsedDays, 1)] },
        target: { $cond: [{ $gt: ["$previousPeriodSales", 0] }, "$previousPeriodSales", null] },
      },
    },
    {
      $addFields: {
        projectedSales: { $multiply: ["$dailyAverage", totalDays] },
        remainingToTarget: {
          $cond: [
            { $eq: ["$target", null] },
            null,
            { $max: [0, { $subtract: ["$target", "$currentPeriodSales"] }] },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        currentPeriodSales: round2("$currentPeriodSales"),
        previousPeriodSales: round2("$previousPeriodSales"),
        target: 1,
        dailyAverage: round2("$dailyAverage"),
        projectedSales: round2("$projectedSales"),
        remainingToTarget: round2("$remainingToTarget"),
        achievedPercent: {
          $cond: [
            { $eq: ["$target", null] },
            null,
            round2({ $multiply: [{ $divide: ["$currentPeriodSales", "$target"] }, 100] }),
          ],
        },
        onTrack: {
          $cond: [{ $eq: ["$target", null] }, null, { $gte: ["$projectedSales", "$target"] }],
        },
        requiredDailySales:
          daysLeft > 0
            ? {
                $cond: [
                  { $eq: ["$target", null] },
                  null,
                  round2({ $divide: ["$remainingToTarget", daysLeft] }),
                ],
              }
            : { $literal: null },
      },
    },
  ];

  const [row] = (await prisma.invoices.aggregateRaw({
    pipeline: asPipeline(pipeline),
  })) as unknown as Array<Record<string, unknown>>;

  return {
    startDate: toYmd(periodStart),
    endDate: toYmd(new Date(periodEnd.getTime() - 1)),
    periodStatus,
    totalDays,
    elapsedDays,
    daysLeft,
    ...(row ?? {
      currentPeriodSales: 0,
      previousPeriodSales: 0,
      target: null,
      dailyAverage: 0,
      projectedSales: 0,
      remainingToTarget: null,
      achievedPercent: null,
      onTrack: null,
      requiredDailySales: null,
    }),
  };
};

/* -------------------------------------------------------------------------- */
/*          ওভারভিউ: চারটাই এক কলে। একই startDate/endDate/page/limit সবখানে।      */
/* -------------------------------------------------------------------------- */

const getOverviewIntoDb = async (query: Query, userId: string) => {
  const [stockRunway, dueRadar, cashPulse, autoTarget] = await Promise.all([
    getStockRunwayIntoDb(query, userId),
    getDueRadarIntoDb(query, userId),
    getCashPulseIntoDb(query, userId),
    getAutoTargetIntoDb(query, userId),
  ]);
  return { stockRunway, dueRadar, cashPulse, autoTarget };
};

const InsightsServices = {
  getStockRunwayIntoDb,
  getDueRadarIntoDb,
  getCashPulseIntoDb,
  getAutoTargetIntoDb,
  getOverviewIntoDb,
};

export default InsightsServices;