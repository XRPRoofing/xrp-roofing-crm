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
- **Port conflicts**: If port 3000 is in use, Next.js may start on 3001. Delete `.next/dev/lock` and kill old processes if needed.
- **Address autocomplete**: Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Without it, the field shows "Address autocomplete unavailable" — you can still manually type or use console to remove the disabled attribute.
- **Proposal scope collapse threshold**: The collapse button only appears when `scopeLines.length > 2` (3+ items after splitting by `\n|✓|•|·|;`). For edge case testing, use 1-2 lines for "no button" and 4+ lines for "should collapse".
- **Twilio call features**: Hold, transfer, and conference behaviors require real Twilio credentials and actual phone calls. The `controlCall()` function makes API requests that will fail silently in local mode. Test UI rendering and state transitions locally; test actual call behavior in production.

## Devin Secrets Needed
- None for local UI testing (bypass + local mode require no secrets).
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — optional, only needed for address autocomplete in proposal creation.
- For production/Stripe webhook or email flows: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INVOICE_NOTIFICATION_EMAIL` (set in Vercel, not needed locally).
- For Twilio call flow testing in production: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET` (set in Vercel).
