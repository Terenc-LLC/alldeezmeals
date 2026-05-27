# TER-238: notify-signup post-deploy setup

Steps Chris runs after the PR is merged and deployed.

---

## 1. Vercel env vars (add before deploying to production)

In the Vercel project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key (`re_…`) |
| `WEBHOOK_SECRET` | A random secret string — generate with `openssl rand -hex 32` |
| `ALERT_FROM_EMAIL` | Sender address verified in Resend, e.g. `alerts@alldeezmeals.com` |
| `ALERT_TO_EMAIL` | Where signup alerts go, e.g. `chris.ball@terenc.com` |

Redeploy after adding env vars.

---

## 2. Supabase Database Webhook

In Supabase → Database → Webhooks → Create a new webhook:

| Field | Value |
|---|---|
| Name | `notify-signup` |
| Table | `profiles` (schema: `public`) |
| Events | `Insert` |
| Type | `HTTP Request` |
| Method | `POST` |
| URL | `https://alldeezmeals.com/api/admin/notify-signup` |

Headers to add:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-webhook-secret` | *(the value of `WEBHOOK_SECRET` you set in Vercel)* |

Save the webhook.

---

## 3. Approve admin accounts

Before the migration lands in production, flip `approved = true` in the Supabase dashboard for any admin email addresses (e.g. `chris.ball@terenc.com`).

In Supabase → Table Editor → `profiles` → filter by email → edit `approved` to `true`.

Or via SQL Editor:
```sql
update public.profiles
set approved = true, approved_at = now(), approved_by = 'manual'
where email in ('chris.ball@terenc.com');
```

---

## 4. Smoke test sequence

1. Open an incognito window → go to `alldeezmeals.com`.
2. Click "Sign up" → enter a throwaway email, name, nearest ALDI, reason → submit.
3. Check that a Resend email arrives at `ALERT_TO_EMAIL`.
4. Click the magic link from the throwaway email → verify you land on the **Pending Approval** screen.
5. In the app (logged in as admin) → Catalog tab → Pending Users → Approve the throwaway account.
6. Switch back to the incognito window → focus the tab → verify the Pending screen disappears and the full app loads.
7. As admin, use the Reject button on a test account and confirm the user is deleted from Supabase.
