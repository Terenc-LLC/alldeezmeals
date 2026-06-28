import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { supabase } from "@terenc/shared/supabase";
import { Button } from "@/components/ui/button";

const OTP_LENGTH = 6;

// Lean magic-link / OTP sign-in for the admin app. Sign-in only — admins are
// pre-provisioned, so there is no sign-up path (shouldCreateUser: false).
// Non-admin accounts can still authenticate here; the server gate (/api/me)
// decides access, so App renders "Not authorized" for them.
export default function SignInView() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const sendCode = async () => {
    const addr = email.trim();
    if (!addr) { setError("Enter your email address."); return; }
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (err) { setError(err.message || "Could not send the sign-in email."); return; }
    setSent(true);
  };

  const verifyCode = async () => {
    if (otp.length !== OTP_LENGTH || verifying) return;
    setVerifying(true);
    setError("");
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp,
      type: "email",
    });
    setVerifying(false);
    // Success: verifyOtp establishes the session; onAuthStateChange in App swaps this view out.
    if (err) { setError(err.message || "That code didn't work."); setOtp(""); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6"
        style={{ boxShadow: "var(--elev-2)" }}
      >
        <h1 className="text-xl font-semibold text-foreground">
          ALLDEEZ<span className="text-primary">Meals</span> Admin
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sent
            ? `Enter the 6-digit code we sent to ${email.trim()}.`
            : "Sign in with your admin email."}
        </p>

        {!sent ? (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCode()}
              placeholder="you@terenc.com"
              autoFocus
              className="mt-4 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button onClick={sendCode} disabled={!email || loading} className="mt-3 w-full">
              {loading ? "Sending…" : "Send code"}
            </Button>
          </>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={otp}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH)); if (error) setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && verifyCode()}
              placeholder="123456"
              autoFocus
              className="mt-4 w-full rounded-md border border-input bg-card px-3 py-2 text-center text-lg tracking-[0.3em] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button onClick={verifyCode} disabled={otp.length !== OTP_LENGTH || verifying} className="mt-3 w-full">
              {verifying ? "Verifying…" : "Verify code"}
            </Button>
            <button
              onClick={() => { setSent(false); setOtp(""); setError(""); }}
              className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </>
        )}

        {error && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-destructive">
            <AlertCircle size={14} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
