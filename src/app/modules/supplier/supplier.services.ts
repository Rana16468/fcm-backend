import { Suppliers } from "@prisma/client";
import catchError from "../../errors/catchError";
import prisma from "../../shared/prisma";
import { meta, QueryBuilder, QueryParams } from "../../builder/QueryBuilder";
import { searchableFields } from "./supplier.constant";
import status from "http-status";
import AppError from "../../errors/AppError";


const RecordedSuppliersIntoDb = async (payload: Suppliers, userId: string) => {


    try {

        const result = await prisma.suppliers.create({
            data: {
                ...payload,
                userId: userId
            }
        });

        return result && { status: true, message: "Supplier recorded successfully" };



    }
    catch (error) {
        throw catchError(error);
    }

};

const getSuppliersFromDb = async (userId: string, query: QueryParams) => {
    try {
        const queryBuilder = new QueryBuilder(query);

        queryBuilder.search(searchableFields);

        queryBuilder.filter(['isDeleted']);
        queryBuilder.scope({ userId, isDeleted: false });

        const builtQuery = queryBuilder.build('createdAt');

        const [result, total] = await Promise.all([
            prisma.suppliers.findMany({
                where: builtQuery.where,
                orderBy: builtQuery.orderBy,
                skip: builtQuery.skip,
                take: builtQuery.take,
            }),
            prisma.suppliers.count({
                where: builtQuery.where,
            }),
        ]);

        return {
            meta: meta(total, builtQuery),
            data: result,
        };

    } catch (error) {
        throw catchError(error);
    }
};


const findBySupplierIdFromDb = async (userId: string, supplierId: string) => {
    try {
        const result = await prisma.suppliers.findUnique({
            where: { id: supplierId, userId, isDeleted: false },
        });
        return result;
    } catch (error) {
        throw catchError(error);
    }
};


const updateSupplierIntoDb = async (userId: string, supplierId: string, payload: Partial<Suppliers>) => {
    try {
        await prisma.suppliers.updateMany({
            where: { id: supplierId, userId, isDeleted: false },
            data: payload,
        }).catch((error) => {
            throw new AppError(status.NOT_FOUND, "Supplier not found or already deleted.", error);
        });
        return {
            status: true,
            message: "Supplier updated successfully"
        }
    } catch (error) {
        throw catchError(error);
    }
};


const deleteSupplierFromDb = async (userId: string, supplierId: string) => {
    try {

        const isExistingSupplier = await prisma.suppliers.findFirst({
            where: { id: supplierId, userId, isDeleted: false },
        });

        if (!isExistingSupplier) {
            throw new AppError(status.NOT_FOUND, "Supplier not found or already deleted.");
        }


        await prisma.$transaction(async (tx) => {

            await tx.suppliers.update({
                where: { id: supplierId },
                data: { isDeleted: true },
            });


            await tx.products.updateMany({
                where: { supplierId: supplierId, isDeleted: false },
                data: { isDeleted: true },
            });


            await tx.transactions.updateMany({
                where: { supplierId: supplierId, isDeleted: false },
                data: { isDeleted: true },
            });
        });

        return { message: "Supplier and all associated records deleted successfully." };
    } catch (error) {

        throw catchError(error);
    }
};


const TZ = "+06:00"; // বাংলাদেশ
const TZ_MS = 6 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const round = (n?: number | null) => Math.round((n ?? 0) * 100) / 100;
const percent = (part: number, whole: number) => (whole ? round((part / whole) * 100) : 0);

const toYmd = (d: Date) => new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
const parseYmd = (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new Error("Invalid date format. Use YYYY-MM-DD");
    return toYmd(d);
};
const addDays = (ymd: string, n: number) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const at = (ymd: string, endOfDay = false) => ({
    $date: new Date(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${TZ}`).toISOString(),
});
const range = (from: string, to: string) => ({ date: { $gte: at(from), $lte: at(to, true) } });

const MONTH_KEY = { $dateToString: { format: "%Y-%m", date: "$date", timezone: TZ } };

const REMAINING = { $cond: [{ $eq: ["$status", "REMAINING"] }, { $ifNull: ["$remainingBalnace", 0] }, 0] };
const UNPAID = { $cond: [{ $eq: ["$status", "UNPAID"] }, "$amount", 0] };
const DUE = { $add: [REMAINING, UNPAID] };
const PAID = { $subtract: ["$amount", DUE] }; // paid = amount − (remaining + unpaid)

const run = async (model: any, pipeline: Record<string, any>[]) =>
    (await model.aggregateRaw({ pipeline })) as unknown as Record<string, any>[];

const toMap = (rows: Record<string, any>[] = [], key: string) =>
    Object.fromEntries(rows.map((r) => [r._id, r[key] as number]));

const dashboardReportIntoDb = async (userId: string, query: Record<string, any>) => {
    // পিরিয়ড: না দিলে চলতি মাস
    const today = toYmd(new Date());
    const start = query.startDate ? parseYmd(query.startDate) : `${today.slice(0, 7)}-01`;
    const end = query.endDate ? parseYmd(query.endDate) : query.startDate ? start : today;

    // আগের সমান পিরিয়ড (growth এর জন্য)
    const length = daysBetween(start, end) + 1;
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -(length - 1));

    // শেষ ৬ মাস (চার্টের জন্য)
    const [ey, em] = end.split("-").map(Number);
    const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(Date.UTC(ey, em - 1 - (5 - i), 1));
        return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getUTCMonth()] };
    });
    const from = [`${months[0].key}-01`, prevStart, start].sort()[0]; // সবচেয়ে পুরোনো তারিখ

    const base = { userId: { $oid: userId }, isDeleted: { $ne: true } };
    const period = range(start, end);

    const [[inv], [exp], [trx], [due], [prod]] = await Promise.all([
        // ১. Invoices
        run(prisma.invoices, [
            { $match: { ...base, ...range(from, end) } },
            {
                $facet: {
                    current: [
                        { $match: period },
                        {
                            $group: {
                                _id: null,
                                count: { $sum: 1 },
                                sales: { $sum: "$amount" },
                                paid: { $sum: PAID },
                                due: { $sum: DUE },
                            },
                        },
                    ],
                    previous: [
                        { $match: range(prevStart, prevEnd) },
                        { $group: { _id: null, sales: { $sum: "$amount" } } },
                    ],
                    monthly: [{ $group: { _id: MONTH_KEY, income: { $sum: "$amount" } } }],
                    topCustomers: [
                        { $match: period },
                        { $group: { _id: "$customerName", invoices: { $sum: 1 }, sales: { $sum: "$amount" }, due: { $sum: DUE } } },
                        { $sort: { sales: -1 } },
                        { $limit: 5 },
                    ],
                    recent: [
                        { $match: period },
                        { $sort: { date: -1 } },
                        { $limit: 5 },
                        {
                            $project: {
                                _id: 0,
                                id: { $toString: "$_id" },
                                customerName: 1,
                                amount: 1,
                                status: 1,
                                date: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ } },
                            },
                        },
                    ],
                    cogs: [
                        { $match: period },
                        { $lookup: { from: "invoice_items", localField: "_id", foreignField: "invoiceId", as: "item" } },
                        { $unwind: "$item" },
                        { $lookup: { from: "supplier_products", localField: "item.productId", foreignField: "_id", as: "p" } },
                        { $unwind: "$p" },
                        { $group: { _id: null, total: { $sum: { $multiply: ["$item.productQuantity", "$p.price"] } } } },
                    ],
                },
            },
        ]),

        // ২. Expenses
        run(prisma.expenses, [
            { $match: { ...base, ...range(from, end) } },
            {
                $facet: {
                    byCategory: [
                        { $match: period },
                        { $group: { _id: "$category", total: { $sum: "$amount" } } },
                        { $sort: { total: -1 } },
                    ],
                    monthly: [{ $group: { _id: MONTH_KEY, total: { $sum: "$amount" } } }],
                },
            },
        ]),

        // ৩. Supplier transactions
        run(prisma.transactions, [
            { $match: base },
            {
                $facet: {
                    period: [{ $match: period }, { $group: { _id: "$type", total: { $sum: "$amount" } } }],
                    settled: [
                        { $match: { type: { $in: ["PAYMENT", "RETURN"] } } },
                        { $group: { _id: null, total: { $sum: "$amount" } } },
                    ],
                },
            },
        ]),

        // ৪. মোট পাওনা (সর্বকালের)
        run(prisma.invoices, [
            { $match: { ...base, status: { $in: ["REMAINING", "UNPAID"] } } },
            { $group: { _id: null, total: { $sum: DUE } } },
        ]),

        // ৫. Products
        run(prisma.products, [
            { $match: base },
            {
                $facet: {
                    purchased: [{ $group: { _id: null, total: { $sum: "$totalAmount" } } }],
                    stock: [
                        {
                            $group: {
                                _id: null,
                                value: { $sum: { $multiply: [{ $subtract: ["$quantity", { $ifNull: ["$sellingProducts", 0] }] }, "$price"] } },
                            },
                        },
                    ],
                    topSuppliers: [
                        { $match: period },
                        { $group: { _id: "$supplierId", purchase: { $sum: "$totalAmount" } } },
                        { $sort: { purchase: -1 } },
                        { $limit: 5 },
                        { $lookup: { from: "suppliers", localField: "_id", foreignField: "_id", as: "s" } },
                        {
                            $project: {
                                _id: 0,
                                supplierId: { $toString: "$_id" },
                                name: { $ifNull: [{ $arrayElemAt: ["$s.companyName", 0] }, "Unknown"] },
                                purchase: 1,
                            },
                        },
                    ],
                    topProducts: [
                        { $match: { sellingProducts: { $gt: 0 } } },
                        { $sort: { sellingProducts: -1 } },
                        { $limit: 5 },
                        { $project: { _id: 0, name: "$productName", sold: "$sellingProducts", price: 1 } },
                    ],
                },
            },
        ]),
    ]);

    // ---------- হিসাব ----------
    const cur = inv.current[0];
    const totalSales = cur?.sales ?? 0;
    const collected = cur?.paid ?? 0;
    const totalExpenses = (exp.byCategory as any[]).reduce((s, r) => s + r.total, 0);
    const cogs = inv.cogs[0]?.total ?? 0;
    const netProfit = totalSales - cogs - totalExpenses;

    const prevSales = inv.previous[0]?.sales ?? 0;
    const revenueGrowth = prevSales ? percent(totalSales - prevSales, prevSales) : null;

    const trxMap = toMap(trx.period, "total");
    const incoming = collected + (trxMap.RETURN ?? 0);
    const outgoing = totalExpenses + (trxMap.PAYMENT ?? 0);

    const payables = Math.max(0, (prod.purchased[0]?.total ?? 0) - (trx.settled[0]?.total ?? 0));

    const income = toMap(inv.monthly, "income");
    const expenses = toMap(exp.monthly, "total");

    return {
        period: { startDate: start, endDate: end },

        kpis: {
            totalSales: round(totalSales),
            collected: round(collected),
            due: round(cur?.due),
            totalExpenses: round(totalExpenses),
            netProfit: round(netProfit),
            profitMargin: percent(netProfit, totalSales),
            revenueGrowth, // আগের সমান পিরিয়ডের তুলনায় %
            totalInvoices: cur?.count ?? 0,
            totalReceivables: round(due?.total), // সর্বকালের পাওনা
            totalPayables: round(payables), // সর্বকালের দেনা
            stockValue: round(prod.stock[0]?.value),
        },

        cashFlow: { incoming: round(incoming), outgoing: round(outgoing), net: round(incoming - outgoing) },

        incomeVsExpenses: months.map(({ key, label }) => ({
            month: key,
            label,
            income: round(income[key]),
            expenses: round(expenses[key]),
        })),

        topExpenses: (exp.byCategory as any[]).slice(0, 5).map((r) => ({
            category: r._id,
            amount: round(r.total),
            percent: percent(r.total, totalExpenses),
        })),

        topCustomers: (inv.topCustomers as any[]).map((c) => ({
            name: c._id,
            invoices: c.invoices,
            sales: round(c.sales),
            due: round(c.due),
        })),

        topSuppliers: (prod.topSuppliers as any[]).map((s) => ({ ...s, purchase: round(s.purchase) })),

        topProducts: prod.topProducts, // সর্বকালে সবচেয়ে বেশি বিক্রিত পণ্য

        recentInvoices: inv.recent,
    };
};

const calculateSupplierAccountBlanceIntoDb = async (userId: string, supplierId: string) => {
    try {

        const [isExistSupplier, productResult, transactionResult] = await prisma.$transaction([
            // সাপ্লায়ার আছে কিনা চেক
            prisma.suppliers.findUniqueOrThrow({
                where: {
                    id: supplierId,
                    isDeleted: false
                },
                select: {
                    id: true
                }
            }),
           
            prisma.products.aggregate({
                where: {
                    supplierId,
                    isDeleted: false
                },
                _sum: {
                    totalAmount: true
                }
            }),

            prisma.transactions.aggregate({
                where: {
                    supplierId,
                    isDeleted: false
                },
                _sum: {
                    amount: true
                }
            })
        ]);


        const totalProductAmount = productResult._sum.totalAmount || 0;
        const totalPaidAmount = transactionResult._sum.amount || 0;
        const dueBalance = totalProductAmount - totalPaidAmount;

        return {
            totalProductAmount,
            totalPaidAmount,
            dueBalance
        };

    } catch (error) {
        throw catchError(error);
    }
};

const SupplierServices = {
    RecordedSuppliersIntoDb,
    getSuppliersFromDb,
    findBySupplierIdFromDb,
    updateSupplierIntoDb,
    deleteSupplierFromDb,
    dashboardReportIntoDb,
    calculateSupplierAccountBlanceIntoDb
};

export default SupplierServices;