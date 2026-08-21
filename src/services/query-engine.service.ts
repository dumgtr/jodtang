import { PoolClient } from 'pg';
import {
  QueryIntent,
  QueryResult,
  SummaryQueryResult,
  RankingQueryResult,
  ListingQueryResult,
  CountQueryResult,
} from '../types/query';
import { resolveQueryDateRange } from '../utils/query-date-resolver';
import { QueryRepository, QueryDbFilter } from '../modules/query/query.repository';

export class QueryEngineService {
  /**
   * Executes a structured QueryIntent deterministically against PostgreSQL database.
   * Strictly READ-ONLY. Zero LLM math calculations.
   */
  static async executeQuery(
    userId: string,
    intent: QueryIntent,
    referenceDate: string = new Date().toISOString().split('T')[0],
    client?: PoolClient
  ): Promise<QueryResult> {
    const resolvedDateRange = resolveQueryDateRange(intent.date_range, referenceDate);

    const dbFilter: QueryDbFilter = {
      startDate: resolvedDateRange.startDate,
      endDate: resolvedDateRange.endDate,
      transactionType: intent.transaction_type,
      category: intent.category || null,
      merchant: intent.merchant || null,
    };

    switch (intent.intent) {
      case 'SUMMARY': {
        const summary = await QueryRepository.getSummary(userId, dbFilter, client);
        let categoryBreakdown = undefined;

        // If not filtered to a single category, fetch top category breakdown
        if (!intent.category && summary.totalAmount > 0) {
          const breakdown = await QueryRepository.getCategoryBreakdown(userId, dbFilter, 6, client);
          categoryBreakdown = breakdown.map((item) => ({
            ...item,
            percentage: summary.totalAmount > 0 ? (item.amount / summary.totalAmount) * 100 : 0,
          }));
        }

        const result: SummaryQueryResult = {
          type: 'SUMMARY',
          dateRange: resolvedDateRange,
          transactionType: intent.transaction_type,
          totalAmount: summary.totalAmount,
          transactionCount: summary.totalCount,
          categoryBreakdown,
          filteredCategory: intent.category || null,
          filteredMerchant: intent.merchant || null,
        };
        return result;
      }

      case 'RANKING': {
        const limit = intent.limit && intent.limit > 0 ? Math.min(intent.limit, 20) : 5;
        const groupBy = intent.group_by === 'CATEGORY' ? 'CATEGORY' : 'MERCHANT';

        if (groupBy === 'CATEGORY') {
          const items = await QueryRepository.getCategoryBreakdown(userId, dbFilter, limit, client);
          const totalAmount = items.reduce((acc, curr) => acc + curr.amount, 0);

          const result: RankingQueryResult = {
            type: 'RANKING',
            dateRange: resolvedDateRange,
            transactionType: intent.transaction_type,
            groupBy: 'CATEGORY',
            rankings: items.map((item, idx) => ({
              rank: idx + 1,
              name: item.name,
              amount: item.amount,
              count: item.count,
            })),
            totalAmount,
          };
          return result;
        } else {
          const items = await QueryRepository.getMerchantBreakdown(userId, dbFilter, limit, client);
          const totalAmount = items.reduce((acc, curr) => acc + curr.amount, 0);

          const result: RankingQueryResult = {
            type: 'RANKING',
            dateRange: resolvedDateRange,
            transactionType: intent.transaction_type,
            groupBy: 'MERCHANT',
            rankings: items.map((item, idx) => ({
              rank: idx + 1,
              name: item.name,
              amount: item.amount,
              count: item.count,
            })),
            totalAmount,
          };
          return result;
        }
      }

      case 'LISTING': {
        const limit = intent.limit && intent.limit > 0 ? Math.min(intent.limit, 50) : 20;
        const items = await QueryRepository.getListing(userId, dbFilter, limit, client);
        const totalAmount = items.reduce((acc, curr) => acc + curr.amount, 0);

        const result: ListingQueryResult = {
          type: 'LISTING',
          dateRange: resolvedDateRange,
          transactionType: intent.transaction_type,
          items,
          totalAmount,
          count: items.length,
        };
        return result;
      }

      case 'COUNT': {
        const count = await QueryRepository.getCount(userId, dbFilter, client);

        const result: CountQueryResult = {
          type: 'COUNT',
          dateRange: resolvedDateRange,
          transactionType: intent.transaction_type,
          count,
          filteredCategory: intent.category || null,
          filteredMerchant: intent.merchant || null,
        };
        return result;
      }

      default: {
        // Fallback to empty summary
        const result: SummaryQueryResult = {
          type: 'SUMMARY',
          dateRange: resolvedDateRange,
          transactionType: intent.transaction_type,
          totalAmount: 0,
          transactionCount: 0,
          filteredCategory: null,
          filteredMerchant: null,
        };
        return result;
      }
    }
  }
}
