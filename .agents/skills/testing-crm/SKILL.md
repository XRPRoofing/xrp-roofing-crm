---
name: testing-crm
description: Test the XRP Roofing CRM locally (invoices, crew camera/photos, real-time/no-refresh). Use when verifying CRM UI or photo-handling changes end-to-end.
---

# Testing the XRP Roofing CRM

## Run locally in test mode
The CRM is a Next.js app. For UI testing without real auth/Supabase, create `.env.local` with:
```
NEXT_PUBLIC_TEST_BYPASS_AUTH=1
NEXT_PUBLIC_TEST_FORCE_LOCAL=1
```
- `TEST_BYPASS_AUTH` skips login so you land directly in the CRM.
- `TEST_FORCE_LOCAL` runs in "Local mode" — data (jobs, customers, draft invoices, crew photos) is stored in the browser's localStorage instead of Supabase. The header shows a "Local mode (configure Supabase for live sync)" banner.

Start with `npm run dev` (serves on http://localhost:3000). Maximize the browser before recording.

## Crew camera / photo upload
The camera + Before/Progress/After photo sections exist in TWO places (share the same handler logic):
- **Field Crew Portal** — `/crew` (phone view; pick a team member, tap a job, "Job Completion Form").
- **Admin Crew Workflow** — `/crm/crew` (office view; click a job row, right panel "Uploaded Photos").

Each section (Before / Progress / After) has "Take Photo" + "Upload Photo". On desktop, "Take Photo" falls back to the file picker; the rear-camera (`capture="environment"`) only opens on a physical phone — don't expect the camera to open on desktop.

Uploading to one section increments only that section's count — good regression check (verify the other two stay unchanged).

## Verifying photo compression (PR #13 feature)
Photos are compressed client-side before save (`lib/image-compress.ts`: longest edge ≤1600px, JPEG q0.7) to fix slow save/load.
- Generate a realistic large test image (a tiny JPEG won't compress — the code keeps the original if smaller). Use PIL to make a noisy ~10MB 4000×3000 JPEG.
- To make the (otherwise invisible) size reduction visible, temporarily add a `console.log` in `handlePhotoUpload` after `compressImageToDataUrl`, logging `file.size` vs the compressed data-URL byte length. **Revert this before merge** — confirm with `git diff` that feature files are clean.
- Expect ~90% reduction (e.g. 10.5MB → ~0.9MB) and format `image/jpeg`.
- Verify the thumbnail renders (not blank/corrupted/rotated) and persists after F5.

## Known limitations when testing locally
- **Optimistic "instant display" can't be proven in localStorage mode** — local saves are already instant, so optimistic vs normal render look identical. Its real payoff is over slow Supabase sync in production. State this honestly; don't claim the production speed-up was proven locally.
- **Real-time cross-device sync** needs a live Supabase DB — only the no-F5 auto-reload-on-focus path is testable locally.
- Selecting/deselecting a job toggles the right detail panel; opening DevTools can deselect it — re-click the job row.

## Devin Secrets Needed
- None for local UI testing (bypass + local mode require no secrets).
- For production/Stripe webhook or email flows: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INVOICE_NOTIFICATION_EMAIL` (set in Vercel, not needed locally).
