import type { Request, Response } from 'express';
import { TransactionRepository } from '../modules/transaction/transaction.repository';
import { buildTransactionsCsv, verifyExportToken } from '../services/export-csv.service';

function isLineInAppBrowser(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return /Line\//i.test(userAgent) || /LineApp/i.test(userAgent);
}

function renderLineInAppLandingHtml(host: string, token: string): string {
  const directDownloadUrl = `https://${host}/exports/transactions.csv?download=1&token=${encodeURIComponent(token)}`;
  const androidIntentUrl = `intent://${host}/exports/transactions.csv?download=1&token=${encodeURIComponent(token)}#Intent;scheme=https;package=com.android.chrome;end`;

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ดาวน์โหลดไฟล์ CSV - จดตัง</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Prompt', sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 9999px;
      margin-bottom: 20px;
    }
    .icon { font-size: 52px; margin-bottom: 16px; line-height: 1; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 10px; color: #f1f5f9; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
    .btn {
      display: block;
      width: 100%;
      background: #06c755;
      color: #ffffff;
      text-decoration: none;
      font-weight: 700;
      font-size: 16px;
      padding: 16px 20px;
      border-radius: 14px;
      margin-bottom: 16px;
    }
    .guide {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 16px;
      text-align: left;
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .guide-title { font-weight: 600; color: #38bdf8; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .guide-step { margin-top: 4px; color: #94a3b8; }
  </style>
  <script>
    window.addEventListener('DOMContentLoaded', function() {
      var isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid) {
        var btn = document.getElementById('dl-btn');
        if (btn) {
          btn.href = '${androidIntentUrl}';
        }
      }
    });
  </script>
</head>
<body>
  <div class="card">
    <div class="badge">✨ พร้อมดาวน์โหลด</div>
    <div class="icon">📥</div>
    <h1>ไฟล์ CSV พร้อมแล้วครับ</h1>
    <p>เนื่องจากระบบของ LINE ไม่อนุญาตให้เซฟไฟล์ในแอปโดยตรง กรุณากดปุ่มด้านล่างเพื่อเปิดและดาวน์โหลดในเบราว์เซอร์ของเครื่องครับ</p>
    
    <a id="dl-btn" href="${directDownloadUrl}" class="btn" target="_blank" rel="noopener noreferrer">
      🌐 เปิดใน Chrome เพื่อดาวน์โหลด
    </a>

    <div class="guide">
      <div class="guide-title">💡 วิธีเปิดผ่านเมนู LINE:</div>
      <div class="guide-step">1. กดปุ่มจุดสามจุด <strong>⠇</strong> ที่มุมขวาล่างหรือขวาบน</div>
      <div class="guide-step">2. เลือก <strong>"เปิดด้วยเบราว์เซอร์อื่น"</strong> (Open in external browser)</div>
    </div>
  </div>
</body>
</html>`;
}

export async function handleTransactionCsvExport(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const userId = verifyExportToken(token);

  if (!userId) {
    res.status(401).set('Cache-Control', 'no-store').send('Invalid or expired export link.');
    return;
  }

  // If opened inside LINE In-App Browser and not explicitly requesting direct download
  const userAgent = req.get('user-agent');
  if (isLineInAppBrowser(userAgent) && req.query.download !== '1') {
    const host = req.get('host') || 'jodtang.onrender.com';
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
      })
      .send(renderLineInAppLandingHtml(host, token));
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
