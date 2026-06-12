import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  sanitizeOtpCode,
  classifySendError,
  friendlySendError,
  friendlyVerifyError,
  OTP_LENGTH,
} from "./authHelpers";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("chris@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.domain.co")).toBe(true);
    expect(isValidEmail("  padded@example.com  ")).toBe(true); // trimmed before check
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("two words@example.com")).toBe(false);
    expect(isValidEmail("double@@example.com")).toBe(false);
    expect(isValidEmail("short.tld@example.c")).toBe(false);
  });
});

describe("sanitizeOtpCode", () => {
  it("strips non-digits and caps at OTP_LENGTH", () => {
    expect(sanitizeOtpCode("12a3-45 6789")).toBe("123456");
    expect(sanitizeOtpCode("123456").length).toBe(OTP_LENGTH);
    expect(sanitizeOtpCode("abc")).toBe("");
  });
});

describe("classifySendError", () => {
  it("maps the unknown-email 422 from shouldCreateUser:false", () => {
    // Real Supabase response shape for an email not in auth.users
    expect(
      classifySendError({ message: "Signups not allowed for otp", status: 422, code: "otp_disabled" })
    ).toBe("unknown_email");
    // Message-only fallback (older supabase-js without .code)
    expect(classifySendError({ message: "Signups not allowed for otp" })).toBe("unknown_email");
    expect(classifySendError({ message: "x", code: "signup_disabled" })).toBe("unknown_email");
  });

  it("maps rate-limit responses", () => {
    expect(
      classifySendError({
        message: "For security purposes, you can only request this after 54 seconds.",
        status: 429,
        code: "over_email_send_rate_limit",
      })
    ).toBe("rate_limit");
    expect(classifySendError({ message: "Email rate limit exceeded" })).toBe("rate_limit");
    expect(classifySendError({ message: "x", status: 429 })).toBe("rate_limit");
  });

  it("falls through to other for anything else", () => {
    expect(classifySendError({ message: "fetch failed" })).toBe("other");
    expect(classifySendError({})).toBe("other");
  });
});

describe("friendlySendError / friendlyVerifyError — raw strings never pass through", () => {
  it("never echoes the Supabase message", () => {
    const raw = "Signups not allowed for otp";
    expect(friendlySendError({ message: raw })).not.toContain(raw);
    expect(friendlyVerifyError({ message: "Token has expired or is invalid" })).toBe(
      "That code didn't work — check for a newer email or resend."
    );
  });

  it("distinguishes rate-limit copy", () => {
    expect(friendlySendError({ status: 429 })).toContain("Too many emails");
    expect(friendlyVerifyError({ status: 429 })).toContain("Too many attempts");
    expect(friendlySendError({ message: "boom" })).toContain("try again");
  });
});
