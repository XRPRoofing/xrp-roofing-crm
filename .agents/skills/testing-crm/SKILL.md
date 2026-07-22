---
name: testing-crm
description: Test the XRP Roofing CRM locally (invoices, crew camera/photos, real-time/no-refresh, call flows). Use when verifying CRM UI or photo-handling changes end-to-end.
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

## Twilio Call Flow Testing

### Architecture
- **Outbound calls** use Twilio Conferences — the agent and customer are both participants.
- **Incoming calls** use `<Dial><Client>crm-agent</Client>` — no conference. The customer's call is the parent; the browser leg is the child.
- Call state is managed globally in `CrmShell.tsx` via React state (`globalActiveIncomingCall`, `globalIncomingHeld`, etc.).
- The `FloatingCallCard` component renders for both outbound and incoming active calls with Mute, Hold, Transfer, End buttons.
- `BroadcastChannel` syncs call state across browser tabs.

### Testing call UI locally (no Twilio needed)
Twilio Voice SDK won't initialize without real API keys, so you can't make actual calls locally. To test call UI changes:

1. Add a temporary test trigger button in `CrmShell.tsx` (just before the `{/* Sidebar */}` comment) to simulate an active incoming call:
```tsx
{process.env.NEXT_PUBLIC_TEST_BYPASS_AUTH === "1" && !globalActiveIncomingCall && !globalIncomingCall && (
  <button
    type="button"
    onClick={() => {
      setGlobalActiveIncomingCall(true);
      setGlobalIncomingCaller({ name: "Test Customer", phone: "+16235551234" });
      setGlobalIncomingTwilioNumber("+16233000611");
    }}
    className="fixed bottom-4 right-4 z-[9999] rounded bg-purple-600 px-3 py-2 text-xs text-white shadow-lg"
  >
    Simulate Incoming Call
  </button>
)}
```
2. Click the button to show the FloatingCallCard in "active" state.
3. Verify UI elements (buttons, inputs, state transitions).
4. **Revert this trigger before merge** — it's only for local testing.

### What CAN be tested locally
- FloatingCallCard renders with correct buttons (Mute, Hold, Transfer, End)
- Transfer button reveals number input with disabled submit when empty
- End button clears call state and removes the card
- Card shows caller info (name, phone number)

### What CANNOT be tested locally (requires real Twilio calls)
- `endConferenceOnExit` behavior (customer hangup ending the conference)
- `disconnect`/`error` event handler timing (handlers before `accept()`)
- Hold/Resume toggle (depends on Twilio API `controlCall()` succeeding)
- Call transfer via parent SID redirect
- IVR flow (DTMF `<Gather>` input routing)
- Real-time call status webhooks

### Key files for call flow
- `lib/twilio/server.ts` — TwiML builders (conference, IVR, forward)
- `components/crm/CrmShell.tsx` — Global call state, answer/end/transfer/hold handlers
- `components/crm/FloatingCallCard.tsx` — Call UI component (shared by outbound and incoming)
- `app/api/twilio/voice/call-control/route.ts` — Hold, resume, forward API
- `app/api/twilio/webhooks/incoming-call/route.ts` — IVR entry point
- `lib/twilio/client.ts` — Browser Voice SDK, `controlCall()` helper

### Production domain
The CRM production domain is `https://www.xrproofing.app`. Twilio webhooks and TwiML App must point to this domain. Google Maps API key referrer restrictions must include `www.xrproofing.app/*`.

## Proposals
The proposal system is at `/crm/proposals`. In local mode, proposals are stored in localStorage.

### Creating a test proposal
1. Click "⊕ Proposal" → select "New Customer"
2. Fill customer name, address (address autocomplete may be disabled without `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — if the address field is disabled, use browser console to remove the `disabled` attribute or just use the address as-is)
3. Click "Create Proposal" → the editor opens

### Proposal modal overlays
Modals in the proposal editor use `fixed inset-0 z-50` positioning but may render outside the visible viewport due to the parent layout nesting. If a modal doesn't appear visually but IS in the DOM, use browser console to click the confirm button programmatically (`document.querySelectorAll('button')` → find by textContent → `.click()`). The functional behavior works correctly.

### File upload testing
The "Upload Signed Proposal" button is a `<label>` wrapping a hidden `<input type="file">`. To programmatically upload in tests:
```js
const labels = document.querySelectorAll('label');
let fileInput = null;
for (const label of labels) {
  if (label.textContent.includes('Upload Signed Proposal')) {
    fileInput = label.querySelector('input[type="file"]');
    break;
  }
}
// Create a test image via canvas
const canvas = document.createElement('canvas');
canvas.width = 400; canvas.height = 300;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, 400, 300);
ctx.font = 'bold 20px Arial'; ctx.fillText('SIGNED PROPOSAL', 100, 50);
canvas.toBlob(function(blob) {
  const file = new File([blob], 'signed-proposal.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
}, 'image/png');
```

### Proposal statuses and locking
- Statuses: Draft, Sent, Viewed, Signed, Won, Approved, Signed Offline
- "Signed", "Won", and "Signed Offline" lock the proposal (🔒 badge, fields disabled)
- "Mark as Signed Offline" button only appears for non-signed statuses
- "Upload Signed Proposal" button appears only after signing (any sign type)
- Uploaded images render inline; PDFs show a download link

### Proposal preview testing
To test proposal preview features:

1. **Edit package scope**: Click GOOD/BETTER/BEST tabs in the sidebar to switch packages. Each has a scope textarea.
2. **Set scope via console** (faster than typing): React textareas require native setter + event dispatch:
   ```js
   const ta = document.querySelector('textarea'); // find the right one
   const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
   setter.call(ta, 'Line 1\nLine 2\nLine 3');
   ta.dispatchEvent(new Event('input', { bubbles: true }));
   ta.dispatchEvent(new Event('change', { bubbles: true }));
   ```
3. **Preview mode**: Click the "Preview" button in the toolbar to see the rendered proposal.
4. **Collapsible scope**: Packages with >2 scope items show `max-h-32` CSS clip with fade gradient and "See full scope of work" button. Packages with ≤2 items show no button/gradient. Each package expands/collapses independently.

### Mobile proposal editor (collapsible sections + sticky action bar)
The proposal editor (`app/crm/proposals/page.tsx`, active when `activeProposal` is set) has a mobile layout that differs from desktop at the Tailwind `lg` breakpoint (1024px):
- **Testing mobile width**: resize the Chrome window narrow+tall with `wmctrl` (e.g. `wmctrl -ir <winid> -e 0,20,20,430,900`) so `lg:hidden`/`lg:block` mobile styles render. `xdotool key super+Up` maximizes wide and would hit the desktop layout. Below `sm` (640px) the Team-chat FAB is hidden (`hidden sm:flex`).
- **Collapsible sections**: mobile shows one accordion section open at a time (`mobileSection` state); desktop keeps all expanded via `lg:block`. Section headers: Customer, Template, Proposal Details, Scope of Work, Pricing, Terms and Notes, Preview.
- **Sticky action bar gotcha (z-index)**: the mobile Save/Preview/Send bar is `fixed bottom-0`. The CRM global mobile bottom nav (`CrmShell.tsx`) is ALSO `fixed bottom-0` but `z-[9999]`, so any page-level `fixed bottom-0` bar with a lower z-index is completely hidden behind the nav. When testing/adding a mobile bottom bar, verify it's actually visible (not just present in the DOM) — offset it above the nav with `bottom-[calc(72px+env(safe-area-inset-bottom))]` (the same offset the Team-chat FAB uses) rather than relying on z-index alone, and add bottom padding to scrollable panes so content isn't hidden behind it.
- **Rich Scope editor** (`components/crm/RichTextEditor.tsx`) is an uncontrolled `contentEditable` using `document.execCommand` (bold/insertUnorderedList/insertOrderedList/undo/redo). Core regression to check: type + format, switch to another section and back — text/formatting must survive (no reset). Rich HTML is sanitized via `lib/proposal-rich-text.ts` allowlist before public render.
- **Optional line items** are additive JSON (`lineItems` on the proposal payload; no schema change). When ≥1 line item exists the manual Total input is disabled and shows the summed total ("Calculated from line items"); with 0 items the manual total is preserved. Separate from Good/Better/Best.

### Dev-server gotcha: don't `npm run build` while `npm run dev` is running
Both share the `.next` directory; running a production `build` against a running dev server corrupts it and the browser then shows a plain **"Internal Server Error"** (even though `curl` may still 200 a cached route). Recover by killing the dev processes, `rm -rf .next`, and restarting `npm run dev`. To verify a build for CI, do it in a separate checkout or after stopping the dev server.

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

## Automation Center (workflow rules / triggers / templates)
The Automation Center is at `/crm/automations`. Triggers, action metadata, and pre-built templates live in `lib/workflow-engine.ts` (`WorkflowTrigger`, `TRIGGER_META`, `WORKFLOW_TEMPLATES`); the server execution engine is `lib/automation/engine.server.ts`.

### What CAN be tested locally (UI + rule config)
- New triggers show up grouped by `TRIGGER_META[...].category` in the **New Rule** builder's "WHEN this happens" `<select>` (grouped into `<optgroup>`s). Verify the option appears under the right category with its label/emoji and that selecting it shows the trigger description.
- Rules seeded from `WORKFLOW_TEMPLATES` appear automatically as rows in the Workflow Rules table (default workflows are seeded into localStorage on first load), so a newly-added template's rule may already be present — no need to add it manually to verify it exists. The **Templates** button toggles a picker to add one on demand.
- Open a rule's **Edit** view to confirm exact action config: e.g. `Send SMS` → Recipient (`customer`/`office`/`assigned_crew`) + the exact SMS message text; `Log Activity` message. The stripped DOM (`read_dom`) exposes `<option selected>` / `<input text=...>` values, which is the fastest way to assert exact copy.

### What CANNOT be tested locally
- Actual firing of a trigger from a live event and real SMS/email delivery. This needs the shared server engine (apply `supabase/automation-engine.sql` — the on-page yellow banner reminds you) plus Twilio/Stripe/Supabase creds. Locally, rules are "on this device only" and `dispatchAutomation` won't send. Verify the dispatch wiring (e.g. `deposit_paid` fired from `app/api/proposals/share/route.ts` on first `depositPaidAt`) by code review + `npx tsc --noEmit` + `npm run build`, and state the runtime-delivery caveat honestly.

## Testing the customer-facing proposal (`/proposal/[id]`)
- The public proposal route (`app/proposal/[id]/page.tsx`) loads the payload from Supabase and needs `SUPABASE_SERVICE_ROLE_KEY`. Without it (local mode) the URL shows "proposal link unavailable", so you can't test the real URL locally.
- Workaround: render the real `ProposalClientView` component directly via a **temporary** harness page (e.g. `app/proposal-test-preview/page.tsx`) that passes a mock `proposal` object. This exercises the exact customer rendering (scope via `toRenderableHtml`, line items, packages, photos). Delete the harness + any test images afterward and confirm `git status` is clean.
- Staff **preview** and the **customer** page render scope through the SAME `toRenderableHtml()` sanitizer, so they stay consistent — but they are separate components: a field shown in the staff preview is NOT necessarily rendered on the customer page. Verify each field on the customer component specifically. Example gap found: estimate/`inspectionPhotos` were shown in the staff preview but not on the customer page until a "Project Photos" section was added to `ProposalClientView`.
- Photos: `brochures[]` = "Product Brochure"; `inspectionPhotos[]` (label/image/note) = estimate photos → "Project Photos". Both render as `<img src={dataUrl}>`. `inspectionPhotos` persist in the shared payload (only `brochures` are stripped by the list API).
- Dev-server stale cache: after editing a harness/page, the browser may serve a minutes-old cached render — force a hard refresh (Ctrl+Shift+R) before trusting what you see.

## Testing Supabase-sync-only code paths with a mock Supabase
Some changes only run when Supabase is configured (`hasSupabaseConfig()` / `proposalSyncEnabled()` in `lib/supabase/client.ts` + `lib/proposal-sync.ts`) — e.g. the proposals board's server fetch, per-id photo rehydration (`/api/proposals/share?id=`), and the slim list payload in `/api/proposals`. In pure `TEST_FORCE_LOCAL=1` mode these paths are skipped, so to exercise them without touching production, run a **local mock PostgREST** and point the app at it:
- Start `npx next dev` with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:<port>`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon`, `SUPABASE_SERVICE_ROLE_KEY=test-service`, `NEXT_PUBLIC_TEST_BYPASS_AUTH=1`, and `NEXT_PUBLIC_TEST_FORCE_LOCAL=0`. This flips `hasSupabaseConfig()` true and routes the real API handlers through your mock — no prod creds, no prod writes.
- The mock only needs to implement the PostgREST subset the routes use: `GET`/`POST` on `proposal_shares` (with `?id=eq.<id>` and `select=`), returning `{ payload, id }` rows; return empty arrays for unrelated tables. Seed a couple of rows whose `payload` includes `inspectionPhotos` (label/image/note) and `brochures` so you can assert photo stripping vs rehydration.
- **Seed realistic rows**: real proposals always have `total`, `status`, etc. The board renders `proposal.total.toLocaleString()` directly (`app/crm/proposals/page.tsx`), so a seeded/curled row missing `total` throws a runtime `Cannot read properties of undefined (reading 'toLocaleString')` — a test-data artifact, not a bug. Include the fields real payloads have.
- **`POST /api/proposals` expects the raw proposal object** as the request body (not wrapped in `{proposal: ...}`) — it parses `proposalSchema.parse(await req.json())`. Wrapping it returns `{"error":"Invalid proposal"}` (HTTP 400).
- Keep the mock server OUTSIDE the repo (e.g. `/home/ubuntu/mock-supabase/server.js`) so it's never committed.
- Assertions this enables: list API strips `inspectionPhotos`+`brochures` (count 0) while keeping names/totals; `/api/proposals/share?id=` returns the photos; a slim-copy POST that omits `inspectionPhotos` still preserves the stored photos on re-fetch (save-preservation, protects against data loss).

## Known limitations when testing locally
- **Optimistic "instant display" can't be proven in localStorage mode** — local saves are already instant, so optimistic vs normal render look identical. Its real payoff is over slow Supabase sync in production. State this honestly; don't claim the production speed-up was proven locally.
- **Mobile load-speed / slim-payload changes**: the mock-Supabase harness (above) proves the *mechanism* (slim list, local-first render, on-open rehydration, save preservation) but not a real wall-clock number — that depends on production network/Supabase latency. Confirm perceived speed on the Vercel PR preview.
- **Real-time cross-device sync** needs a live Supabase DB — only the no-F5 auto-reload-on-focus path is testable locally.
- Selecting/deselecting a job toggles the right detail panel; opening DevTools can deselect it — re-click the job row.
- **Port conflicts**: If port 3000 is in use, Next.js may start on 3001. Delete `.next/dev/lock` and kill old processes if needed.
- **Address autocomplete**: Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Without it, the field shows "Address autocomplete unavailable" — you can still manually type or use console to remove the disabled attribute.
- **Proposal scope collapse threshold**: The collapse button only appears when `scopeLines.length > 2` (3+ items after splitting by `\n|✓|•|·|;`). For edge case testing, use 1-2 lines for "no button" and 4+ lines for "should collapse".
- **Twilio call features**: Hold, transfer, and conference behaviors require real Twilio credentials and actual phone calls. The `controlCall()` function makes API requests that will fail silently in local mode. Test UI rendering and state transitions locally; test actual call behavior in production.

## Devin Secrets Needed
- None for local UI testing (bypass + local mode require no secrets).
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — optional, only needed for address autocomplete in proposal creation.
- For production/Stripe webhook or email flows: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INVOICE_NOTIFICATION_EMAIL` (set in Vercel, not needed locally).
- For Twilio call flow testing in production: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET` (set in Vercel).
