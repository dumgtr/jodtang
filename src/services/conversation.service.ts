export interface ConversationState {
  draftId: string;
  step: 'select_field' | 'waiting_for_input';
  fieldToEdit?: string;
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
