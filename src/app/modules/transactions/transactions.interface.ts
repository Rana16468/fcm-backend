export type GroupBy = 'day' | 'month' | 'none';

export interface FinancialReportQuery {
  startDate?: string; // 'YYYY-MM-DD'
  endDate?: string; // 'YYYY-MM-DD' (inclusive)
  groupBy?: GroupBy; // default: 'none'
}

export interface SalesRow {
  invoiceCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  totalSales: number;
  cogs: number;
  cashReceived: number;
  receivable: number;
}

export interface ExpenseFacet {
  byCategory: { category: string; amount: number; count: number }[];
  total: { total: number }[];
}

export interface SupplierRow {
  totalPurchases: number;
  totalPayments: number;
  totalReturns: number;
}

export interface InventoryRow {
  productCount: number;
  totalPurchasedValue: number;
  stockUnits: number;
  stockValue: number;
  outOfStockCount: number;
}

export interface TimelineRow {
  period: string;
  sales: number;
  cogs: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
}
