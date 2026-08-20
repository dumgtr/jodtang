// Database Entity Types matching exact PostgreSQL Schema

export interface User {
  id: string; // UUID
  line_user_id: string;
  created_at: Date;
}

export interface ExtractedData {
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  category_id?: string | null;
  merchant_id?: string | null;
  account_id?: string | null;
  description?: string | null;
  occurred_at?: string;
  confidence?: number;
}

export type DraftStatus = 'pending_confirmation' | 'confirmed' | 'cancelled' | 'expired';

export interface TransactionDraft {
  id: string; // UUID
  user_id: string; // UUID
  source: string;
  raw_input: string;
  extracted_data: ExtractedData;
  status: DraftStatus;
  transaction_id?: string | null; // UUID
  expires_at: Date;
  created_at: Date;
}

export type TransactionType = 'expense' | 'income' | 'transfer';
export type TransactionStatus = 'confirmed' | 'voided';

export interface Transaction {
  id: string; // UUID
  user_id: string; // UUID
  type: TransactionType;
  amount: string | number; // DECIMAL(12, 2)
  category_id: string | null;
  merchant_id: string | null;
  account_id: string | null;
  description: string | null;
  status: TransactionStatus;
  occurred_at: Date;
  created_at: Date;
  updated_at?: Date;
}

export interface AuditLog {
  id: string; // UUID
  user_id: string | null; // UUID
  entity_type: string;
  entity_id: string; // UUID
  action: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  created_at: Date;
}
