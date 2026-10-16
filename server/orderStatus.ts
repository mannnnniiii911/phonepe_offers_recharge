/**
 * Canonical order payment_status vocabulary.
 *
 * Decision log (Phase 1):
 *   The SQLite schema uses TEXT without a CHECK constraint, so any value was silently accepted.
 *   The PostgreSQL schema previously defined CHECK (payment_status IN ('pending_verification',
 *   'verified_paid', 'rejected')) which excluded all values actually written by the routes.
 *
 *   After reconciliation we keep the route-side vocabulary intact (no behavior change)
 *   and update only the schema CHECK constraint to match. The two schema-only values
 *   ('verified_paid', 'rejected') are REMOVED because no route ever writes them.
 *
 * Allowed transitions:
 *   pending_verification  →  pending_verification (no-op re-queue)
 *   pending_verification  →  submitted_for_review
 *   pending_verification  →  pending
 *   pending              →  submitted_for_review
 *   any non-terminal     →  paid      (admin manual verification)
 *   any non-terminal     →  failed    (admin reject / error)
 *   any non-terminal     →  cancelled (admin cancel)
 *
 * Terminal statuses (no further transitions allowed by policy):
 *   paid, failed, cancelled
 */

export const ORDER_PAYMENT_STATUSES = [
  'pending_verification',
  'pending',
  'submitted_for_review',
  'paid',
  'failed',
  'cancelled',
] as const;

export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

/** Non-terminal statuses that can still be updated by admin. */
export const NON_TERMINAL_STATUSES: OrderPaymentStatus[] = [
  'pending_verification',
  'pending',
  'submitted_for_review',
];

/** Terminal statuses — admin should not change these without explicit override. */
export const TERMINAL_STATUSES: OrderPaymentStatus[] = ['paid', 'failed', 'cancelled'];

/** The default status assigned to new orders on creation. */
export const DEFAULT_ORDER_STATUS: OrderPaymentStatus = 'pending_verification';

export function isValidOrderStatus(value: unknown): value is OrderPaymentStatus {
  return ORDER_PAYMENT_STATUSES.includes(value as OrderPaymentStatus);
}
