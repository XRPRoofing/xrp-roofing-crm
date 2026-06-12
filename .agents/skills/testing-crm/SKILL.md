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

## Conversation board: call summary + mobile "+" new conversation
The Conversation board is at `/crm/conversations` (`ConversationBoard.tsx`).
- **Mobile "+" new conversation**: at phone width the inbox "+" button opens a "New conversation" popup (Phone required, Name optional) → creates/selects a thread and opens it with a reachable composer. This works fully in local mode (no Twilio needed) — verify popup opens, thread opens with the entered name, To field prefilled, composer accepts text. Actual SMS send is off locally.
- **Compact call summary card + modal**: the green call card shows a concise inline "Call summary" (Summary + Next steps, ~3-line clamp) + a "Details & recording" link → modal with summary on top and a "Full transcript" toggle that is COLLAPSED by default and expands on click; modal closes on backdrop click.
- **Seeding a call_recording locally**: Twilio is off in local mode, so the call card won't render without data. To exercise it, temporarily seed a sample `call_recording` event in the `!result.ok` branch of `app/api/twilio/events/route.ts` (guard with `if (process.env.NEXT_PUBLIC_TEST_FORCE_LOCAL === "1")`, return an `events` array with one `call_status` + one `call_recording` event whose `payload.summary` and `payload.transcript` are set). **Revert this seed before merge** — confirm `git status` is clean. This may move into a proper local fixture later; if so, prefer that over hand-seeding.
- **Summary generation speed** (the OpenAI prompt + `max_tokens` limit in `lib/twilio/recording-insights.ts`) is server-side and only runs on a real call in production — it can't be timed locally. Test the display/layout changes locally and state the latency caveat honestly.
- At tablet width (~820px) the board switches to the mobile single-panel layout with the bottom nav; the inbox preview still shows the concise summary. Resize the window with `wmctrl` to test intermediate widths.

## Known limitations when testing locally
- **Optimistic "instant display" can't be proven in localStorage mode** — local saves are already instant, so optimistic vs normal render look identical. Its real payoff is over slow Supabase sync in production. State this honestly; don't claim the production speed-up was proven locally.
- **Real-time cross-device sync** needs a live Supabase DB — only the no-F5 auto-reload-on-focus path is testable locally.
- Selecting/deselecting a job toggles the right detail panel; opening DevTools can deselect it — re-click the job row.

## Devin Secrets Needed
- None for local UI testing (bypass + local mode require no secrets).
- For production/Stripe webhook or email flows: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INVOICE_NOTIFICATION_EMAIL` (set in Vercel, not needed locally).