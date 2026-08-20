/**
 * Single application-wide invariant for monetary values.
 * Only finite, strictly positive numbers may reach draft or transaction storage.
 */
export function isValidPositiveAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
