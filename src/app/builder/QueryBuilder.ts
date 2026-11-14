export type QueryParams = Record<string, unknown>;

export interface BuiltQuery {
  where: Record<string, any>;
  orderBy: Record<string, 'asc' | 'desc'>;
  skip: number;
  take: number;
  page: number;
  limit: number;
}

export class QueryBuilder {
  private query: QueryParams;
  private where: Record<string, unknown> = {};

  constructor(query: QueryParams = {}) {
    this.query = query;
  }

  search(fields: string[]) {
    const term = this.query.searchTerm;
    if (typeof term === 'string' && term.trim() && fields.length) {
      const searchTerm = term.trim();
      this.where.OR = fields.map((field) => {
        const path = field.split('.');
        const leaf = path.pop() as string;
        const condition = { [leaf]: { contains: searchTerm, mode: 'insensitive' } };

        return path.reduceRight<Record<string, unknown>>(
          (nested, relation) => ({ [relation]: nested }),
          condition,
        );
      });
    }
    return this;
  }

  filter(allowed: string[]) {
    for (const key of allowed) {
      const value = this.query[key];
      if (
        (typeof value === 'string' && value.trim() !== '') ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        this.where[key] = value;
      }
    }
    return this;
  }

  scope(extra: Record<string, unknown>) {
    Object.assign(this.where, extra);
    return this;
  }

  build(defaultSort = 'createdAt', allowedSortFields?: readonly string[]): BuiltQuery {
    const requestedPage = Number(this.query.page ?? 1);
    const requestedLimit = Number(this.query.limit ?? 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1;
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 10;
    const requestedSort = this.query.sortBy;
    const sortBy =
      typeof requestedSort === 'string' &&
      (!allowedSortFields || allowedSortFields.includes(requestedSort))
        ? requestedSort
        : defaultSort;
    const sortOrder = this.query.sortOrder === 'asc' ? 'asc' : 'desc';

    return {
      where: this.where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
      page,
      limit,
    };
  }
}

export const meta = (total: number, q: BuiltQuery) => ({
  page: q.page || 1,
  limit: q.limit || 10,
  total,
  totalPage: Math.ceil(total / q.limit),
});