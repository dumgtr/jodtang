import type { Request, Response } from 'express';
import { TransactionRepository } from '../modules/transaction/transaction.repository';
import { buildTransactionsCsv, verifyExportToken } from '../services/export-csv.service';

export async function handleTransactionCsvExport(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const userId = verifyExportToken(token);

  if (!userId) {
    res.status(401).set('Cache-Control', 'no-store').send('Invalid or expired export link.');
    return;
  }

  try {
    const transactions = await TransactionRepository.findAllByUser(userId);
    const csv = buildTransactionsCsv(transactions);
    const filename = `jodtang-transactions-${new Date().toISOString().slice(0, 10)}.csv`;

    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(Buffer.from(csv, 'utf8'));
  } catch (error) {
    console.error('[CSV Export Error]', error);
    res.status(500).set('Cache-Control', 'no-store').send('Unable to generate export.');
  }
}
