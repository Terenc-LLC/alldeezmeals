/**
 * TER-412 — auth screen helpers: client-side email validation and friendly
 * mapping of Supabase auth errors. Pure functions so they're unit-testable;
 * SignInView in App.tsx consumes them. Raw Supabase error strings must never
 * reach the UI — every path through here returns curated copy.
 */

export type AuthErrorLike = {
  message?: string | null;
  status?: number;
  code?: string | null;
};

export type SendErrorKind = "unknown_email" | "rate_limit" | "other";

export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_S = 60;

/** Pragmatic format check: local@domain.tld, no spaces, 2+ char TLD. */
export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

/** Keep only digits, capped at OTP_LENGTH — applied on every code-input change. */
export function sanitizeOtpCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

/**
 * Classify a failed signInWithOtp. With shouldCreateUser:false, an unknown
 * email comes back as 422 "Signups not allowed for otp" (code otp_disabled) —
 * the UI turns that into a Request-access pointer rather than an error string.
 */
export function classifySendError(err: AuthErrorLike): SendErrorKind {
  const msg = (err.message || "").toLowerCase();
  const code = (err.code || "").toLowerCase();
  if (code === "otp_disabled" || code === "signup_disabled" || msg.includes("signups not allowed")) {
    return "unknown_email";
  }
  if (
    err.status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    msg.includes("rate limit") ||
    msg.includes("you can only request this")
  ) {
    return "rate_limit";
  }
  return "other";
}

/** Friendly copy for non-unknown-email send failures. */
export function friendlySendError(err: AuthErrorLike): string {
  return classifySendError(err) === "rate_limit"
    ? "Too many emails requested — wait a minute, then try again."
    : "Couldn't send the email — please try again in a moment.";
}

/** Friendly copy for a failed verifyOtp (wrong, expired, or rate-limited code). */
export function friendlyVerifyError(err: AuthErrorLike): string {
  const msg = (err.message || "").toLowerCase();
  if (err.status === 429 || msg.includes("rate limit")) {
    return "Too many attempts — wait a minute, then try again.";
  }
  return "That code didn't work — check for a newer email or resend.";
}
