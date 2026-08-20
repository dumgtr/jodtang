export type ConversationStep =
  | 'select_field' // Draft edit
  | 'waiting_for_input' // Draft edit value
  | 'select_transaction_to_edit' // Select confirmed tx to edit
  | 'select_transaction_to_void' // Select confirmed tx to void
  | 'select_tx_field' // Select field on confirmed tx
  | 'waiting_for_tx_input'; // Provide value for confirmed tx field

export interface ConversationState {
  targetType?: 'draft' | 'transaction';
  draftId?: string;
  transactionId?: string;
  step: ConversationStep;
  fieldToEdit?: string;
  pendingEdits?: {
    amount?: number;
    category_id?: string;
    description?: string;
    occurred_at?: string;
  };
}

/**
 * In-memory conversation state service for managing multi-step chat flows.
 * Ephemeral store ready to be swapped with Redis or persistent cache in future iterations.
 */
export class ConversationService {
  private static states = new Map<string, ConversationState>();

  /**
   * Set the state for a specific user.
   */
  static setState(userId: string, state: ConversationState): void {
    this.states.set(userId, state);
  }

  /**
   * Get the state for a specific user.
   */
  static getState(userId: string): ConversationState | undefined {
    return this.states.get(userId);
  }

  /**
   * Clear the state for a specific user.
   */
  static clearState(userId: string): void {
    this.states.delete(userId);
  }
}
