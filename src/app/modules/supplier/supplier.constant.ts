import { Prisma } from "@prisma/client";

export const searchableFields = ['companyName', 'name', 'phone', 'address'];

export type Stage = Record<string, unknown>;

export const SORTABLE = ["createdAt", "updatedAt", "companyName", "name"];

export const ZERO_SUMMARY = { totalPurchase: 0, totalPaid: 0, totalReturn: 0, totalPayable: 0 };

export const mongoRound = (expr: unknown) => ({ $round: [expr, 2] });
export const sumIf = (cond: unknown, value: unknown) => ({ $sum: { $cond: [cond, value, 0] } });
export const isoDate = (field: string) => ({
    $dateToString: { date: field, format: "%Y-%m-%dT%H:%M:%S.%LZ" },
});
export const asPipeline = (p: Stage[]) => p as unknown as Prisma.InputJsonValue[];