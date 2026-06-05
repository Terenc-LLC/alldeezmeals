export function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Best-effort Resend send. Returns true on success, false on any failure. Never throws.
export async function sendResendEmail(opts: { to: string; subject: string; html: string; from?: string; headers?: Record<string, string> }): Promise<boolean> {
  const key  = process.env.RESEND_API_KEY;
  const from = opts.from ?? process.env.USER_FROM_EMAIL;
  if (!key || !from || !opts.to) { console.error("sendResendEmail: missing key/from/to"); return false; }
  try {
    const body: Record<string, unknown> = { from, to: opts.to, subject: opts.subject, html: opts.html };
    if (opts.headers) body.headers = opts.headers;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error("sendResendEmail: Resend error", r.status, await r.text()); return false; }
    return true;
  } catch (e: any) { console.error("sendResendEmail: fetch failed", e?.message); return false; }
}
