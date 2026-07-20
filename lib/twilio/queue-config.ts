// Shared constants for the inbound call queue ("all admins busy" hold queue).
// Kept in their own module so both the TwiML builders (server.ts) and the
// webhook/route handlers can import them without creating an import cycle.

/** Twilio Queue friendly name callers are placed into when every admin is busy. */
export const QUEUE_NAME = "xrp-support";

/** Max time (seconds) a caller waits on hold before we stop holding them and
 *  fall back to the normal missed-call ending (hang up + missed-call auto-text).
 *  ~5 minutes so no one is stuck forever. */
export const MAX_QUEUE_WAIT_SECONDS = 300;
