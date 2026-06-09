// Shared, framework-agnostic rules that make a SIGNED/ACCEPTED proposal
// immutable. Once a customer accepts and signs, the selected package, pricing,
// totals, version and signature become the locked source of truth. They must
// never be recalculated from templates or overwritten by a stale editor/board
// copy that is still holding the pre-signature values.
//
// Used on the server (proposal API routes) so the protection holds no matter
// which device or client sends the write, and on the client (Proposals board)
// to keep the in-memory copy from clobbering a signed record.

type ProposalPayload = Record<string, unknown>;

// Financial / acceptance fields that are frozen once a proposal is signed.
export const lockedProposalFields = [
  "selectedOption",
  "total",
  "acceptedPackage",
  "acceptedPackageName",
  "acceptedPrice",
  "acceptedAt",
  "proposalVersion",
  "signedAt",
  "signedBy",
  "signatureData",
  "signatureDataUrl",
  "packages",
] as const;

/** A proposal is locked once it has been signed / accepted. */
export function isProposalLocked(payload: ProposalPayload | null | undefined): boolean {
  if (!payload) return false;
  if (payload.locked === true) return true;
  if (typeof payload.signedAt === "string" && payload.signedAt.length > 0) return true;
  const status = typeof payload.status === "string" ? payload.status : "";
  return status === "Won" || status === "Signed";
}

/**
 * Re-impose the locked fields from the already-stored record onto a proposed
 * next record. Non-locked fields (notes, scope, contact info, and `deletedAt`
 * for trashing) still update; the locked financial / acceptance fields keep
 * their signed values, and the accepted status cannot be downgraded.
 *
 * If the existing record is not locked yet (e.g. the write IS the sign action),
 * the next record passes through unchanged so the lock can be established.
 */
export function applyProposalLock(
  existing: ProposalPayload | null | undefined,
  next: ProposalPayload,
): ProposalPayload {
  if (!isProposalLocked(existing) || !existing) return next;

  const result: ProposalPayload = { ...next };
  for (const field of lockedProposalFields) {
    if (field in existing) result[field] = existing[field];
  }
  // Mark it explicitly so future writes recognise the lock even if status changes.
  result.locked = true;
  // Keep the accepted status; a trash still works because it travels on `deletedAt`.
  if (typeof existing.status === "string") result.status = existing.status;
  return result;
}
