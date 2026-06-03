---
name: testing-crm
description: Test the XRP Roofing CRM locally — public invoice/payment pages and the auth-protected /crm/* admin pages. Use when verifying invoice, Stripe payment, or CRM dashboard UI changes.
---

# Testing the XRP Roofing CRM

## Run locally
- `npm install` then `npm run dev` (Next.js, serves on `http://localhost:3000`).
- Lint/typecheck/build: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Preview deployments are behind Vercel SSO
The Vercel preview URL on each PR is protected by Vercel deployment protection (SSO login wall), so it generally CANNOT be browser-tested without the user's Vercel access. Prefer testing locally. If you must use the preview, ask the user to disable protection or provide a bypass.

## Public pages — no auth needed
Public invoice/payment pages render without login:
- Public invoice: `/invoice/<id>` (fetches from Supabase `invoice_shares` via `/api/invoices/share`; shows an "unavailable" message if not configured, which is fine for UI checks of the page shell).
- Payment confirmation: `/invoice/<any-id>/thank-you` — fully static, always renders. Good for verifying the post-payment "Thank you" page.

## Auth-protected /crm/* pages
All `/crm/*` pages are guarded client-side by `components/crm/CrmShell.tsx` (`createClient().auth.getSession()` → redirects to `/login` when there's no Supabase session). `lib/supabase/client.ts` THROWS if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset.

To test these pages locally without real credentials, use a temporary, test-only bypass (revert before committing — never commit these):
1. Create `.env.local` with a dummy URL + anon key so `createClient()` doesn't throw:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_test_localonly
   ```
2. In `CrmShell.tsx`, change the `if (!data.session)` branch to `setCheckingAuth(false); return;` instead of redirecting to `/login`.
3. Restart `npm run dev` (env changes need a restart; kill stale `next dev`/`next-server` and remove `.next/dev/lock` if the port lock complains).
4. After testing, `git checkout components/crm/CrmShell.tsx` and `rm .env.local`.

With the bypass, `/crm/*` pages render from their localStorage seed data (e.g. the Invoice Board's `initialInvoices`), so dashboard counts/derivations can be verified deterministically against the seed.

## Stripe invoice payment workflow — what needs live config
The real Stripe loop CANNOT be tested without the user's live setup. It depends on:
- `supabase/invoice-shares.sql` run once in the Supabase SQL editor (creates `invoice_shares` + realtime).
- A configured Supabase project + `SUPABASE_SERVICE_ROLE_KEY` (webhook + tracking write server-side).
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (webhook signature verification).
- `RESEND_API_KEY` + `INVOICE_NOTIFICATION_EMAIL` (internal notification emails).

Without these, the webhook (`app/api/stripe/webhook/route.ts`), realtime board sync (`lib/invoice-sync.ts`), view tracking (`app/api/invoices/track`), and emails (`lib/invoice-emails.ts`) no-op. The full payment → Paid → cascade flow is best verified by the user with a Stripe test card (`4242 4242 4242 4242`) after setup. Locally testable without config: the `/thank-you` confirmation page and the Invoice Board metric tiles (via the auth bypass above).

## Devin Secrets Needed
None are currently stored. To test the full Stripe flow end-to-end, the following would be needed (user-provided): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Supabase URL/anon/service-role keys, `RESEND_API_KEY`, plus CRM login credentials for the protected pages. Without them, scope testing to the public confirmation page + seed-data board metrics.
